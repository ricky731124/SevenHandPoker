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
import { BLANK_TUNE, blankAssets, defaultLimitedBrain, limitedPick, limitedPlace, type LimitedPickOpts } from './limitedAI'
import { PLACE_TUNE, winsIfOwns } from './limitedPlace'
import { isBlank, isJoker, type Card } from './cards'
import { CATEGORY, CATEGORY_NAME_ZH, compareHands, evaluate } from './evaluate'
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

// ---- 空城計(§11.5c)----------------------------------------------------------
// BLANK=1 npx vitest run src/game/limited.sim.test.ts  → 執行力 × 勝率表(打玩家模型)+ 出牌樣態 + 拿下格子比例
const blankBrain = (rt: BossRuntime, opts: LimitedPickOpts = {}): Brain => ({
  pick: (g, me, rng) => limitedPick(g, me, rt, rng, opts),
  place: (g, me, rng) => limitedPlace(g, me, rt, rng),
})
// 直覺玩家(第一版的基準):不墊空白、每手出最大,放牌用原本 boss 放牌
const blankGreedy: Brain = {
  pick: (g, me) => {
    const reals = g.hands[me].filter((c) => !isBlank(c))
    if (!reals.length) return [g.hands[me][0].id]
    return biggestOf(reals).map((c) => c.id)
  },
  place: (g, me, rng) => bossPlace(g, me, greedyRt, rng),
}
const biggestOf = (cards: Card[]): Card[] => {
  let best: Card[] = [cards[0]]
  const rec = (start: number, cur: Card[]) => {
    if (cur.length && compareHands(cur, best) > 0) best = [...cur]
    if (cur.length === 5) return
    for (let i = start; i < cards.length; i++) rec(i + 1, [...cur, cards[i]])
  }
  rec(0, [])
  return best
}

/**
 * 玩家模型(§11.5c,照使用者的打法寫):拆資產;沒資產送全空白 1~3 張;三條照實或墊 1;強對照出;
 * 弱對常墊 1 裝三條;兩對只在對子多到用不完時出(blankAssets 合併);大牌只在最後兩手;鐵支 50 / 30 / 20。
 * 先出哪個資產隨機。放牌用同一套放牌(平衡、執行力 1),但只算空白、不算點數(真人不會每張都記)。
 */
const playerRt: BossRuntime = { ...defaultLimitedBrain('blank'), execution: 1 }
const playerModel: Brain = {
  pick: (g, me, rng) => {
    const hand = g.hands[me]
    const blanks = hand.filter(isBlank)
    const left = 7 - g.placementsDone[me]
    const foe = otherPlayer(me)
    const point = g.slots.some((s, i) => s.owner === null && (winsIfOwns(g, me, i) || winsIfOwns(g, foe, i)))
    if (left <= 2 || point) return limitedPick(g, me, playerRt, rng, { noPad: true })
    const { assets } = blankAssets(g.seed, hand, left)
    if (!assets.length) {
      if (!blanks.length) return [lowest(hand).id]
      return blanks.slice(0, 1 + Math.floor(rng() * 3)).map((c) => c.id)
    }
    const a = assets[Math.floor(rng() * assets.length)]
    const v = evaluate(a.cards)
    const top = v.rankSeq[0] ?? 0
    const pad = v.category === CATEGORY.THREE_KIND ? (rng() < 0.5 ? 1 : 0) : v.category === CATEGORY.PAIR && top <= 10 ? (rng() < 0.5 ? 1 : 0) : 0
    return [...a.cards, ...blanks.slice(0, pad)].map((c) => c.id)
  },
  place: (g, me, rng) => {
    PLACE_TUNE.rankCount = false
    try {
      return limitedPlace(g, me, playerRt, rng)
    } finally {
      PLACE_TUNE.rankCount = true
    }
  },
}
const lowest = (hand: Card[]) => [...hand].sort((a, b) => a.rank - b.rank)[0]

/** 一場空城計,每一疊出牌交給 onPile;回傳 p1 贏沒。 */
function playBlank(seed: number, a: Brain, b: Brain, onPile?: (cards: Card[], by: PlayerId, g: GameState) => void, onSlot?: (mine: Card[], won: boolean | null, who: PlayerId) => void): boolean {
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
  if (onSlot) for (const s of g.slots) for (const who of ['p1', 'p2'] as const) if (s[who].length && s.owner !== null) onSlot(s[who], s.owner === 'both' ? null : s.owner === who, who)
  return g.winner === 'p1'
}

/** 出牌分類(使用者的講法):全空白 / 高牌 / 弱對 / 強對 / 兩對 / 三條 / 鐵支 / 5 張大牌,加「墊 N」。 */
function shapeOf(cards: Card[]): string {
  const reals = cards.filter((c) => !isBlank(c))
  if (!reals.length) return `全空白 ${cards.length} 張`
  const v = evaluate(cards)
  const top = v.rankSeq[0]
  const pad = cards.length - reals.length
  const name =
    v.category === CATEGORY.HIGH_CARD ? `高牌${top >= 13 ? ' K/A' : top >= 10 ? ' 10~Q' : ' 7~9'}`
    : v.category === CATEGORY.PAIR ? (top >= 11 ? '強對' : '弱對')
    : v.category === CATEGORY.FOUR_KIND || v.category >= CATEGORY.STRAIGHT ? (reals.length >= 5 ? '5 張大牌' : CATEGORY_NAME_ZH[v.category])
    : CATEGORY_NAME_ZH[v.category]
  return `${name}${reals.some(isJoker) ? '(含鬼)' : ''}${pad ? ` 墊${pad}` : ''}`
}

const EXECS = [1, 0.8, 0.65, 0.5, 0.35]
/** 同一個大腦但出牌不看棋盤(§11.5d 前的第二版),比較用。 */
const boardOff = (b: Brain): Brain => ({
  ...b,
  pick: (g, me, rng) => {
    BLANK_TUNE.board = false
    try {
      return b.pick(g, me, rng)
    } finally {
      BLANK_TUNE.board = true
    }
  },
})
const withExec = (rng: Rng, ex: number, main?: BossRuntime['main']): BossRuntime => ({ ...casualRt(rng), execution: ex, ...(main ? { main } : {}) })

describe.skipIf(!process.env.BLANK)('空城計模擬(BLANK=1 才跑)', () => {
  it(`勝率 × ${N} 場(對手 = 玩家模型)`, () => {
    const rows: [string, (r: Rng) => [Brain, Brain]][] = [
      ...EXECS.map((ex): [string, (r: Rng) => [Brain, Brain]] => [`快配人機 執行力 ${ex} vs 玩家模型`, (r) => [blankBrain(withExec(r, ex)), playerModel]]),
      ...EXECS.map((ex): [string, (r: Rng) => [Brain, Brain]] => [`對戰電腦 執行力 ${ex} vs 玩家模型`, () => [blankBrain({ ...defaultLimitedBrain('blank'), execution: ex }), playerModel]]),
      ['快配人機 0.5/0.65/0.8 隨機抽(現在線上) vs 玩家模型', (r) => [blankBrain(withExec(r, [0.5, 0.65, 0.8][Math.floor(r() * 3)])), playerModel]],
      ...(['attack', 'balance', 'hoard'] as const).flatMap((m) =>
        [1, 0.8, 0.65, 0.5, 0].map((ex): [string, (r: Rng) => [Brain, Brain]] => {
          const name = m === 'attack' ? '強攻' : m === 'balance' ? '平衡' : '囤牌'
          // ex = 0 這列代表線上快配:0.5 / 0.65 / 0.8 隨機抽
          return ex
            ? [`${name} 執行力 ${ex} vs 玩家模型`, (r) => [blankBrain(withExec(r, ex, m)), playerModel]]
            : [`${name} 0.5/0.65/0.8 隨機抽 vs 玩家模型`, (r) => [blankBrain(withExec(r, [0.5, 0.65, 0.8][Math.floor(r() * 3)], m)), playerModel]]
        }),
      ),
      ['不看棋盤(第二版) 執行力 1 vs 玩家模型', (r) => [boardOff(blankBrain(withExec(r, 1))), playerModel]],
      ['快配人機 執行力 1 vs 直覺玩家(第一版基準)', (r) => [blankBrain(withExec(r, 1)), blankGreedy]],
      ['玩家模型 vs 直覺玩家', () => [playerModel, blankGreedy]],
      ['有墊 vs 不墊(同個性,執行力 1)', (r) => { const rt = withExec(r, 1); return [blankBrain(rt), blankBrain({ ...rt }, { noPad: true })] }],
      ['玩家模型 vs 玩家模型(先後手基準)', () => [playerModel, playerModel]],
      ['強攻 vs 平衡(執行力 1)', (r) => [blankBrain(withExec(r, 1, 'attack')), blankBrain(withExec(r, 1, 'balance'))]],
      ['強攻 vs 囤牌(執行力 1)', (r) => [blankBrain(withExec(r, 1, 'attack')), blankBrain(withExec(r, 1, 'hoard'))]],
      ['平衡 vs 囤牌(執行力 1)', (r) => [blankBrain(withExec(r, 1, 'balance')), blankBrain(withExec(r, 1, 'hoard'))]],
    ]
    const out: string[] = ['| 對局 | 前者勝率 |', '|---|---|']
    // ROW=正規式 → 只跑名字符合的列
    const only = process.env.ROW ? new RegExp(process.env.ROW) : null
    rows.forEach(([name, mk], k) => {
      if (only && !only.test(name)) return
      let w = 0
      for (let i = 0; i < N; i++) {
        const [a, b] = mk(mulberry32(70_000 * (k + 1) + i))
        if (playBlank(910_000 * (k + 1) + i, a, b)) w++
      }
      out.push(`| ${name} | ${Math.round((w / N) * 100)}% |`)
    })
    console.log('\n' + out.join('\n'))
  }, 1_800_000)

  it('出牌樣態 + 拿下格子比例(快配人機 vs 玩家模型)', () => {
    for (const ex of [1, 0.5]) {
      const shapes = new Map<string, [number, number, number]>() // 次數, 拿下, 有結果
      let total = 0
      for (let i = 0; i < N; i++) {
        const r = mulberry32(80_000 + i)
        playBlank(800_000 + i, blankBrain(withExec(r, ex)), playerModel, (cards, by) => {
          if (by !== 'p1') return
          const k = shapeOf(cards)
          const t = shapes.get(k) ?? [0, 0, 0]
          t[0]++
          shapes.set(k, t)
          total++
        }, (mine, won, who) => {
          if (who !== 'p1') return
          const t = shapes.get(shapeOf(mine))
          if (!t) return
          t[1] += won === null ? 0.5 : won ? 1 : 0
          t[2]++
        })
      }
      const rows = [...shapes.entries()].sort((a, b) => b[1][0] - a[1][0]).filter(([, [n]]) => n / total >= 0.005)
      console.log(`\n執行力 ${ex}:出牌樣態(佔所有手數 / 拿下格子)\n` + rows.map(([k, [n, w, d]]) => `${k}: ${((n / total) * 100).toFixed(1)}% / ${d ? Math.round((w / d) * 100) : '-'}%`).join('\n'))
    }
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
