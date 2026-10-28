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
import { defaultLimitedBrain, limitedPick, limitedPlace } from './limitedAI'
import { isJoker } from './cards'
import { evaluate } from './evaluate'
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

function play(seed: number, a: Brain, b: Brain): boolean {
  const rng = mulberry32(seed)
  const brains: Record<PlayerId, Brain> = { p1: a, p2: b }
  let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2', 'p2', 'ghost')
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
