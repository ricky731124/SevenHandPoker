/**
 * 限定房人機強度模擬(LIMITED-ROOM-SPEC §11.8)。平常略過;要跑:
 *   SIM=1 npx vitest run src/game/limited.sim.test.ts   (SIM_N=300 改場數)
 * 每種對手各打 N 場(先手隨機),報「限定層」勝率:
 *  - vs 原本邏輯:同樣的 boss 個性,但出牌走原本 bossPick / bossPlace(不懂多鬼牌)
 *  - vs 隨機:隨機出 1~5 張、隨機放
 *  - 快配人機 vs 對戰電腦:兩邊都走限定層(快配 = 隨機主線 boss 個性;電腦 = 預設個性)
 */
import { describe, it } from 'vitest'
import { bossPick, bossPlace, rollMain, type BossRuntime } from './bossAI'
import { CAMPAIGN } from './campaign'
import { defaultLimitedBrain, limitedPick, limitedPlace, type LimitedPickOpts } from './limitedAI'
import { isBlank, isJoker } from './cards'
import { CATEGORY_NAME_ZH, evaluate } from './evaluate'
import type { LimitedMode } from './limited'
import { mulberry32 } from './rng'
import { applyDraw, applyPick, applyPlace, createGame, emptySlotsFor, otherPlayer, resolveShowdown, type GameState, type PlayerId } from './state'

const N = Number(process.env.SIM_N ?? 300)
type Rng = () => number
type Brain = { pick: (g: GameState, me: PlayerId, rng: Rng) => string[]; place: (g: GameState, me: PlayerId, rng: Rng) => number }

const casualRt = (rng: Rng): BossRuntime => {
  const st = CAMPAIGN[Math.floor(rng() * CAMPAIGN.length)]
  return { profile: st.profile, main: rollMain(st.profile, rng), execution: [0.6, 0.75, 0.9][Math.floor(rng() * 3)] }
}
const limited = (rt: BossRuntime): Brain => ({
  pick: (g, me, rng) => limitedPick(g, me, rt, rng),
  place: (g, me, rng) => limitedPlace(g, me, rt, rng),
})
const original = (rt: BossRuntime): Brain => ({
  pick: (g, me, rng) => bossPick(g, me, rt, rng),
  place: (g, me, rng) => bossPlace(g, me, rt, rng),
})
// 「每手都出最大」:一般玩家的直覺打法(強攻 + 執行力 0 → 每手都走「上限內最大的大牌」,不送格子);
// 放牌固定用原本 boss 放牌(粗略「用最強去撞」),跟之前的數字可以比
const greedyRt: BossRuntime = { ...defaultLimitedBrain(), main: 'attack', execution: 0 }
const greedy: Brain = { pick: (g, me, rng) => limitedPick(g, me, greedyRt, rng), place: (g, me, rng) => bossPlace(g, me, greedyRt, rng) }
// 同樣的限定層出牌,但放牌用原本 boss 放牌(看破 0)→ 量新放牌值多少
const oldPlace = (rt: BossRuntime): Brain => ({
  pick: (g, me, rng) => limitedPick(g, me, rt, rng),
  place: (g, me, rng) => bossPlace(g, me, { ...rt, profile: { ...rt.profile, insight: 0 } }, rng),
})
const withMain = (rng: Rng, main: BossRuntime['main']): BossRuntime => ({ ...casualRt(rng), main })
const random: Brain = {
  pick: (g, me, rng) => {
    const h = [...g.hands[me]].sort(() => rng() - 0.5)
    return h.slice(0, 1 + Math.floor(rng() * Math.min(5, h.length))).map((c) => c.id)
  },
  place: (g, _me, rng) => {
    const e = emptySlotsFor(g, g.pendingPick!.by)
    return e[Math.floor(rng() * e.length)]
  },
}

function play(seed: number, a: Brain, b: Brain, mode: LimitedMode = 'ghost'): boolean {
  const rng = mulberry32(seed)
  const brains: Record<PlayerId, Brain> = { p1: a, p2: b }
  let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2', 'p2', mode)
  for (let i = 0; i < 500 && g.phase !== 'ended'; i++) {
    if (g.phase === 'pick') g = applyPick(g, g.turn, brains[g.turn].pick(g, g.turn, rng))
    else if (g.phase === 'place') {
      const placer = otherPlayer(g.pendingPick!.by)
      g = applyPlace(g, placer, brains[placer].place(g, placer, rng))
    } else if (g.phase === 'showdown') g = resolveShowdown(g)
    else if (g.phase === 'draw') g = applyDraw(g)
  }
  return g.winner === 'p1'
}

// 產生放牌用的「張數 → 牌型分布表」(§11.9):GEN=1 npx vitest run src/game/limited.sim.test.ts
// 快配人機互打,統計每一疊的(牌型, 最大點數, 用幾張鬼),印成 limitedPlace.ts 的表貼回去。
describe.skipIf(!process.env.GEN)('分布表(GEN=1 才跑)', () => {
  it('百鬼夜行', () => {
    const G = Number(process.env.SIM_N ?? 3000)
    const tally: Map<string, number>[] = Array.from({ length: 6 }, () => new Map())
    for (let i = 0; i < G; i++) {
      const r = mulberry32(7_000_000 + i)
      const rts: Record<PlayerId, BossRuntime> = { p1: casualRt(r), p2: casualRt(r) }
      const rng = mulberry32(8_000_000 + i)
      let g = createGame(8_000_000 + i, rng() < 0.5 ? 'p1' : 'p2', 'p2', 'ghost')
      for (let k = 0; k < 500 && g.phase !== 'ended'; k++) {
        if (g.phase === 'pick') {
          const ids = limitedPick(g, g.turn, rts[g.turn], rng)
          const cards = g.hands[g.turn].filter((c) => ids.includes(c.id))
          const v = evaluate(cards)
          const key = `${v.category},${v.rankSeq[0] ?? 0},${cards.filter(isJoker).length}`
          tally[cards.length].set(key, (tally[cards.length].get(key) ?? 0) + 1)
          g = applyPick(g, g.turn, ids)
        } else if (g.phase === 'place') {
          const placer = otherPlayer(g.pendingPick!.by)
          g = applyPlace(g, placer, limitedPlace(g, placer, rts[placer], rng))
        } else if (g.phase === 'showdown') g = resolveShowdown(g)
        else if (g.phase === 'draw') g = applyDraw(g)
      }
    }
    const lines = tally.slice(1).map((m) => {
      const tot = [...m.values()].reduce((s, n) => s + n, 0)
      const rows = [...m.entries()].filter(([, n]) => n / tot >= 0.002).sort((a, b) => b[1] - a[1])
      const kept = rows.reduce((s, [, n]) => s + n, 0)
      return '  [' + rows.map(([k, n]) => `[${k},${(n / kept).toFixed(3)}]`).join(', ') + '],'
    })
    console.log('\n[\n' + lines.join('\n') + '\n]')
  }, 1_800_000)
})

// ---- 空城計(§11.5a)----------------------------------------------------------
// BLANK=1 npx vitest run src/game/limited.sim.test.ts  → 牌型拿下格子比例 + 勝率表
// BLANK_GEN=1 …                                        → 「電腦式墊法」/「不墊」兩張分布表
const blankBrain = (rt: BossRuntime, opts: LimitedPickOpts = {}): Brain => ({
  pick: (g, me, rng) => limitedPick(g, me, rt, rng, opts),
  place: (g, me, rng) => limitedPlace(g, me, rt, rng),
})
// 直覺玩家:不墊空白、每手出最大(執行力 0 → 永遠「失手」= 這手最大),放牌用原本 boss 放牌
const blankGreedy: Brain = {
  pick: (g, me, rng) => limitedPick(g, me, greedyRt, rng, { noPad: true }),
  place: (g, me, rng) => bossPlace(g, me, greedyRt, rng),
}

/** 一場空城計,每一疊出牌交給 onPile(張數、真牌數、牌型…);回傳 p1 贏沒。 */
function playBlank(seed: number, a: Brain, b: Brain, onPile?: (cards: import('./cards').Card[], by: PlayerId, g: GameState) => void, onSlot?: (mine: import('./cards').Card[], won: boolean | null) => void): boolean {
  const rng = mulberry32(seed)
  const brains: Record<PlayerId, Brain> = { p1: a, p2: b }
  let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2', 'p2', 'blank')
  for (let i = 0; i < 500 && g.phase !== 'ended'; i++) {
    if (g.phase === 'pick') {
      const ids = brains[g.turn].pick(g, g.turn, rng)
      onPile?.(g.hands[g.turn].filter((c) => ids.includes(c.id)), g.turn, g)
      g = applyPick(g, g.turn, ids)
    } else if (g.phase === 'place') {
      const placer = otherPlayer(g.pendingPick!.by)
      g = applyPlace(g, placer, brains[placer].place(g, placer, rng))
    } else if (g.phase === 'showdown') g = resolveShowdown(g)
    else if (g.phase === 'draw') g = applyDraw(g)
  }
  if (onSlot) for (const s of g.slots) for (const who of ['p1', 'p2'] as const) if (s[who].length && s.owner !== null) onSlot(s[who], s.owner === 'both' ? null : s.owner === who)
  return g.winner === 'p1'
}

describe.skipIf(!process.env.BLANK_GEN)('空城計分布表(BLANK_GEN=1 才跑)', () => {
  it('電腦式墊法 / 不墊', () => {
    const G = Number(process.env.SIM_N ?? 3000)
    for (const [name, opts] of [['PAD', {}], ['NOPAD', { noPad: true }]] as const) {
      const tally: Map<string, number>[] = Array.from({ length: 6 }, () => new Map())
      for (let i = 0; i < G; i++) {
        const r = mulberry32(7_100_000 + i)
        const a = blankBrain(casualRt(r), opts)
        const b = blankBrain(casualRt(r), opts)
        playBlank(8_100_000 + i, a, b, (cards) => {
          const v = evaluate(cards)
          const reals = cards.filter((c) => !isBlank(c)).length
          const key = `${v.category},${v.rankSeq[0] ?? 0},${cards.filter(isJoker).length}`
          const k2 = `${key},${reals}`
          tally[cards.length].set(k2, (tally[cards.length].get(k2) ?? 0) + 1)
        })
      }
      const mixN = tally.slice(1).map((m) => [...m.values()].reduce((s, n) => s + n, 0))
      const all = mixN.reduce((s, n) => s + n, 0)
      const lines = tally.slice(1).map((m) => {
        const tot = [...m.values()].reduce((s, n) => s + n, 0)
        const rows = [...m.entries()].filter(([, n]) => n / tot >= 0.003).sort((x, y) => y[1] - x[1])
        const kept = rows.reduce((s, [, n]) => s + n, 0)
        // [牌型, 最大點數, 鬼, 機率, 真牌數]
        return '  [' + rows.map(([k, n]) => { const [c, t, j, re] = k.split(','); return `[${c},${t},${j},${(n / kept).toFixed(3)},${re}]` }).join(', ') + '],'
      })
      console.log(`\n${name}\n[\n${lines.join('\n')}\n]\nCOUNT_MIX ${JSON.stringify(mixN.map((n) => +(n / all).toFixed(3)))}`)
    }
  }, 1_800_000)
})

describe.skipIf(!process.env.BLANK)('空城計模擬(BLANK=1 才跑)', () => {
  it('各牌型拿下格子的比例(調價值表用)', () => {
    const won = new Map<string, [number, number]>()
    for (let i = 0; i < N; i++) {
      const r = mulberry32(40_000 + i)
      playBlank(400_000 + i, blankBrain(casualRt(r)), blankBrain(casualRt(r)), undefined, (mine, w) => {
        const v = evaluate(mine)
        const name = v.category < 0 ? '全空白' : CATEGORY_NAME_ZH[v.category]
        const key = v.category <= 1 && v.category >= 0 ? `${name} ${v.rankSeq[0] >= 13 ? 'K/A' : v.rankSeq[0] >= 10 ? '10~Q' : '7~9'}` : name
        const t = won.get(key) ?? [0, 0]
        t[0] += w === null ? 0.5 : w ? 1 : 0
        t[1]++
        won.set(key, t)
      })
    }
    const total = [...won.values()].reduce((s, [, n]) => s + n, 0)
    console.log('\n| 牌型 | 拿下比例 | 佔所有牌堆 |\n|---|---|---|\n' + [...won.entries()].sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).map(([k, [w, n]]) => `| ${k} | ${Math.round((w / n) * 100)}% | ${((n / total) * 100).toFixed(1)}% |`).join('\n'))
  }, 1_800_000)

  it(`勝率 × ${N} 場`, () => {
    const rows: [string, (r: Rng) => [Brain, Brain]][] = [
      ['快配人機 vs 直覺玩家(不墊、每手最大)', (r) => [blankBrain(casualRt(r)), blankGreedy]],
      ['對戰電腦(預設) vs 直覺玩家', () => [blankBrain(defaultLimitedBrain('blank')), blankGreedy]],
      ['強攻 vs 直覺玩家', (r) => [blankBrain(withMain(r, 'attack')), blankGreedy]],
      ['平衡 vs 直覺玩家', (r) => [blankBrain(withMain(r, 'balance')), blankGreedy]],
      ['囤牌 vs 直覺玩家', (r) => [blankBrain(withMain(r, 'hoard')), blankGreedy]],
      ['快配人機 vs 同個性原本邏輯', (r) => { const rt = casualRt(r); return [blankBrain(rt), original({ ...rt })] }],
      ['快配人機 vs 隨機', (r) => [blankBrain(casualRt(r)), random]],
      ['有墊 vs 不墊(同個性)', (r) => { const rt = casualRt(r); return [blankBrain(rt), blankBrain({ ...rt }, { noPad: true })] }],
      ['送全空白(預設) vs 送格分數決定', (r) => { const rt = casualRt(r); return [blankBrain(rt), blankBrain({ ...rt }, { sacrifice: 'score' })] }],
      ['送全空白(預設) vs 只送單張', (r) => { const rt = casualRt(r); return [blankBrain(rt), blankBrain({ ...rt }, { sacrifice: 'single' })] }],
      ['快配人機 執行力 0.35/0.5/0.65 vs 直覺玩家', (r) => [blankBrain({ ...casualRt(r), execution: [0.35, 0.5, 0.65][Math.floor(r() * 3)] }), blankGreedy]],
      ['對戰電腦 執行力 0.5 vs 直覺玩家', () => [blankBrain({ ...defaultLimitedBrain('blank'), execution: 0.5 }), blankGreedy]],
      ['快配人機 執行力 0.2/0.35/0.5 vs 直覺玩家', (r) => [blankBrain({ ...casualRt(r), execution: [0.2, 0.35, 0.5][Math.floor(r() * 3)] }), blankGreedy]],
      ['對戰電腦 執行力 0.35 vs 直覺玩家', () => [blankBrain({ ...defaultLimitedBrain('blank'), execution: 0.35 }), blankGreedy]],
      ['直覺玩家 vs 直覺玩家(先後手基準)', () => [blankGreedy, blankGreedy]],
      ['強攻 vs 平衡', (r) => [blankBrain(withMain(r, 'attack')), blankBrain(withMain(r, 'balance'))]],
      ['強攻 vs 囤牌', (r) => [blankBrain(withMain(r, 'attack')), blankBrain(withMain(r, 'hoard'))]],
      ['平衡 vs 囤牌', (r) => [blankBrain(withMain(r, 'balance')), blankBrain(withMain(r, 'hoard'))]],
    ]
    const out: string[] = ['| 對局 | 前者勝率 |', '|---|---|']
    rows.forEach(([name, mk], k) => {
      let w = 0
      for (let i = 0; i < N; i++) {
        const [a, b] = mk(mulberry32(70_000 * (k + 1) + i))
        if (play(910_000 * (k + 1) + i, a, b, 'blank')) w++
      }
      out.push(`| ${name} | ${Math.round((w / N) * 100)}% |`)
    })
    console.log('\n' + out.join('\n'))
  }, 1_800_000)

  it('出牌樣態(張數 / 真牌數 / 送格)', () => {
    const t = Array.from({ length: 7 }, () => ({ n: 0, cards: 0, reals: 0, sac: 0, allBlank: 0 }))
    for (let i = 0; i < N; i++) {
      const r = mulberry32(80_000 + i)
      playBlank(800_000 + i, blankBrain(casualRt(r)), blankGreedy, (cards, by, g) => {
        if (by !== 'p1') return
        const row = t[g.placementsDone.p1]
        const reals = cards.filter((c) => !isBlank(c)).length
        row.n++
        row.cards += cards.length
        row.reals += reals
        if (reals <= 1 && !cards.some(isJoker)) row.sac++
        if (reals === 0) row.allBlank++
      })
    }
    console.log('\n手 | 平均張數 | 平均真牌 | 送格% | 全空白%\n' + t.map((x, k) => `${k + 1} | ${(x.cards / x.n).toFixed(2)} | ${(x.reals / x.n).toFixed(2)} | ${Math.round((x.sac / x.n) * 100)} | ${Math.round((x.allBlank / x.n) * 100)}`).join('\n'))
  }, 1_800_000)
})

describe.skipIf(!process.env.SIM)('限定房模擬(SIM=1 才跑)', () => {
  it(`百鬼夜行 × ${N} 場`, () => {
    const rows: [string, (r: Rng) => [Brain, Brain]][] = [
      ['快配人機(限定層) vs 同個性原本邏輯', (r) => { const rt = casualRt(r); return [limited(rt), original({ ...rt })] }],
      ['對戰電腦(限定層預設) vs 原本邏輯(預設個性)', () => [limited(defaultLimitedBrain()), original(defaultLimitedBrain())]],
      ['快配人機(限定層) vs 隨機', (r) => [limited(casualRt(r)), random]],
      ['快配人機(限定層) vs 對戰電腦(限定層預設)', (r) => [limited(casualRt(r)), limited(defaultLimitedBrain())]],
      ['快配人機(限定層) vs 每手都出最大', (r) => [limited(casualRt(r)), greedy]],
      ['強攻 vs 每手都出最大', (r) => [limited(withMain(r, 'attack')), greedy]],
      ['囤牌 vs 每手都出最大', (r) => [limited(withMain(r, 'hoard')), greedy]],
      ['平衡 vs 每手都出最大', (r) => [limited(withMain(r, 'balance')), greedy]],
      ['快配人機 新放牌 vs 舊放牌(同出牌)', (r) => { const rt = casualRt(r); return [limited(rt), oldPlace({ ...rt })] }],
      ['強攻 vs 平衡', (r) => [limited(withMain(r, 'attack')), limited(withMain(r, 'balance'))]],
      ['強攻 vs 囤牌', (r) => [limited(withMain(r, 'attack')), limited(withMain(r, 'hoard'))]],
      ['平衡 vs 囤牌', (r) => [limited(withMain(r, 'balance')), limited(withMain(r, 'hoard'))]],
    ]
    const out: string[] = ['| 對局 | 前者勝率 |', '|---|---|']
    rows.forEach(([name, mk], k) => {
      let w = 0
      for (let i = 0; i < N; i++) {
        const [a, b] = mk(mulberry32(50_000 * (k + 1) + i))
        if (play(900_000 * (k + 1) + i, a, b)) w++
      }
      out.push(`| ${name} | ${Math.round((w / N) * 100)}% |`)
    })
    console.log('\n' + out.join('\n'))
  }, 1_800_000)

  // 各打法每一手「過渡 / 棄一格」(1 張正牌 + 最多 1 鬼)的比例,看三種打法有沒有分開(§11.3)
  it('過渡比例(vs 每手都出最大)', () => {
    const out: string[] = []
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      const t = Array.from({ length: 7 }, () => [0, 0])
      for (let i = 0; i < N; i++) {
        const rt = withMain(mulberry32(60_000 + i), main)
        const rng = mulberry32(600_000 + i)
        const brains: Record<PlayerId, Brain> = { p1: limited(rt), p2: greedy }
        let g = createGame(600_000 + i, rng() < 0.5 ? 'p1' : 'p2', 'p2', 'ghost')
        for (let k = 0; k < 500 && g.phase !== 'ended'; k++) {
          if (g.phase === 'pick') {
            const me = g.turn
            const ids = brains[me].pick(g, me, rng)
            if (me === 'p1') {
              const cards = g.hands[me].filter((c) => ids.includes(c.id))
              const reals = cards.filter((c) => !isJoker(c) && c.kind !== 'blank').length
              t[g.placementsDone[me]][0]++
              if (reals === 1 && cards.length <= 2) t[g.placementsDone[me]][1]++
            }
            g = applyPick(g, me, ids)
          } else if (g.phase === 'place') {
            const placer = otherPlayer(g.pendingPick!.by)
            g = applyPlace(g, placer, brains[placer].place(g, placer, rng))
          } else if (g.phase === 'showdown') g = resolveShowdown(g)
          else if (g.phase === 'draw') g = applyDraw(g)
        }
      }
      out.push(`${main} 第 1~7 手過渡%: ${t.map(([n, k]) => Math.round((k / Math.max(1, n)) * 100)).join(' / ')}`)
    }
    console.log('\n' + out.join('\n'))
  }, 1_800_000)
})
