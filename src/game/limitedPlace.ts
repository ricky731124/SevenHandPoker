/**
 * 限定房放牌(LIMITED-ROOM-SPEC §11.9)。百鬼夜行 / 空城計 / 撲朔迷離共用,只差「張數 → 牌型分布表」。
 * 原本 boss 放牌用張數猜牌力(4 張 ≈ 兩對、5 張 ≈ 同花),每格 2 鬼的百鬼完全不對,所以限定房改走這裡;
 * bossAI.ts 一行都不改。
 *
 * 四塊:① 分布表 ② 我每格的牌贏 / 輸對方這疊的機率 ③ 位置價值(連線、擋殺、留著的價值)④ 打法權重。
 */

import type { Card } from './cards'
import { isBlank, isJoker } from './cards'
import { CATEGORY, compareHands, evaluate } from './evaluate'
import type { BossRuntime } from './bossAI'
import type { LimitedMode } from './limited'
import { SLOT_COUNT, countCoins, emptySlotsFor, otherPlayer, ownsSlot, type GameState, type PlayerId } from './state'

type Rng = () => number

/** 一種可能:[牌型 CATEGORY, 最大點數, 用幾張鬼, 機率, 真牌張數(空城計才有,算牌用)]。 */
type Entry = readonly [number, number, number, number, number?]

/**
 * 百鬼夜行(每格 2 鬼):對手出 N 張時的分布,index = 張數 − 1。
 * 由 `GEN=1 npx vitest run src/game/limited.sim.test.ts` 產生(快配人機互打 3000 場);出牌邏輯改了要重產。
 * 2026-10-28(強攻棄一格 / 平衡看比分版):1 張 = 高牌、2 張 = 對子、3 張 = 三條、4 張 = 鐵支 99%、5 張 = 同花順 61%。
 */
const GHOST_TABLE: readonly (readonly Entry[])[] = [
  [[0,14,0,0.441], [0,13,0,0.232], [0,12,0,0.130], [0,11,0,0.065], [0,10,0,0.048], [0,9,0,0.045], [0,8,0,0.028], [0,7,0,0.011]],
  [[1,14,1,0.333], [1,13,1,0.196], [1,12,1,0.127], [1,11,1,0.073], [1,10,1,0.051], [1,14,0,0.036], [1,9,1,0.035], [1,8,1,0.028], [1,7,1,0.018], [1,7,0,0.018], [1,13,0,0.016], [1,8,0,0.016], [1,12,0,0.015], [1,9,0,0.015], [1,11,0,0.014], [1,10,0,0.012]],
  [[3,14,2,0.316], [3,13,2,0.202], [3,12,2,0.119], [3,11,2,0.066], [3,7,1,0.049], [3,8,1,0.034], [3,10,2,0.031], [3,9,1,0.026], [3,10,1,0.023], [3,11,1,0.023], [3,13,1,0.023], [3,9,2,0.021], [3,14,1,0.020], [3,12,1,0.020], [3,8,2,0.012], [3,7,2,0.006], [3,8,0,0.004], [3,7,0,0.004]],
  [[7,13,2,0.118], [7,14,2,0.111], [7,12,2,0.109], [7,9,2,0.107], [7,8,2,0.105], [7,11,2,0.104], [7,7,2,0.102], [7,10,2,0.100], [7,7,1,0.027], [7,8,1,0.021], [7,9,1,0.015], [7,12,1,0.015], [7,10,1,0.013], [7,13,1,0.013], [7,14,1,0.012], [7,11,1,0.011], [2,12,0,0.004], [2,13,0,0.003], [2,11,0,0.003], [2,10,0,0.002], [1,14,1,0.002], [0,14,0,0.002]],
  [[8,14,2,0.195], [8,11,2,0.157], [8,12,2,0.130], [8,13,2,0.128], [1,14,1,0.020], [4,14,1,0.016], [6,12,1,0.014], [4,11,1,0.014], [6,13,1,0.014], [4,12,1,0.013], [6,14,1,0.013], [1,13,1,0.013], [6,11,1,0.012], [4,13,1,0.011], [8,14,1,0.009], [4,12,2,0.009], [1,12,1,0.009], [3,13,2,0.008], [4,14,2,0.008], [6,10,1,0.008], [3,14,2,0.008], [4,11,2,0.008], [0,14,0,0.007], [8,11,1,0.007], [4,13,2,0.007], [6,9,1,0.007], [3,7,1,0.007], [7,7,2,0.006], [0,13,0,0.006], [3,9,1,0.005], [8,12,1,0.005], [5,14,1,0.005], [4,14,0,0.005], [7,8,2,0.005], [3,8,1,0.005], [1,7,0,0.005], [3,12,2,0.005], [1,8,0,0.005], [3,11,1,0.004], [4,11,0,0.004], [8,13,1,0.004], [1,11,0,0.004], [3,10,1,0.004], [6,8,1,0.004], [4,12,0,0.004], [1,10,0,0.004], [3,11,2,0.004], [3,13,1,0.004], [3,10,2,0.004], [3,12,1,0.004], [4,13,0,0.004], [7,9,2,0.004], [1,12,0,0.003], [1,11,1,0.003], [3,9,2,0.003], [3,14,1,0.003], [1,9,0,0.003], [7,10,2,0.003], [6,7,0,0.003], [5,14,2,0.002], [6,8,0,0.002], [0,12,0,0.002], [7,12,2,0.002], [1,14,0,0.002]],
]
/** 各張數出現的比例(1~5 張),拿來混成「隨便一疊」的分布(估一疊牌多強)。 */
const GHOST_COUNT_MIX = [0.02, 0.07, 0.22, 0.42, 0.27]

/**
 * 空城計(§11.5c):手寫的「玩家模型」分布表(使用者 10/30 認可的起始比例),index = 張數 − 1。
 * 不用電腦自己打自己的資料(第一版那樣,電腦以為「3 張多半是對子 + 空白」,結果拿詐唬去撞三條)。
 * 每種寫法 [牌型, 機率, 真牌數, 點數分布];點數分布攤開成表。
 */
const RANKS_ALL: [number, number][] = [7, 8, 9, 10, 11, 12, 13, 14].map((r) => [r, 1 / 8])
const RANKS_HIGH: [number, number][] = [[14, 0.42], [13, 0.3], [12, 0.15], [11, 0.08], [10, 0.03], [9, 0.01], [8, 0.005], [7, 0.005]]
const RANKS_STRONG: [number, number][] = [[14, 0.3], [13, 0.27], [12, 0.24], [11, 0.19]]
const RANKS_WEAK: [number, number][] = [[10, 0.32], [9, 0.27], [8, 0.23], [7, 0.18]]
const RANKS_TOP: [number, number][] = [[11, 0.25], [12, 0.25], [13, 0.25], [14, 0.25]] // 順子 / 同花的頭
const RANKS_TWO_PAIR: [number, number][] = [8, 9, 10, 11, 12, 13, 14].map((r) => [r, 1 / 7])
const NONE: [number, number][] = [[0, 1]]
const E = CATEGORY.EMPTY
type Way = [cat: number, p: number, reals: number, ranks: [number, number][]]
const BLANK_PLAYER_WAYS: Way[][] = [
  // 1 張:全空白 4 成、單張 6 成(多半 K / A)
  [[E, 0.4, 0, NONE], [0, 0.6, 1, RANKS_HIGH]],
  // 2 張:對子 7 成(強對多)、全空白或單張 + 空白 3 成
  [[1, 0.45, 2, RANKS_STRONG], [1, 0.25, 2, RANKS_WEAK], [E, 0.18, 0, NONE], [0, 0.12, 1, RANKS_HIGH]],
  // 3 張:三條 5.5 成、弱對 + 空白 2.5 成、全空白 2 成
  [[3, 0.55, 3, RANKS_ALL], [1, 0.25, 2, RANKS_WEAK], [E, 0.2, 0, NONE]],
  // 4 張:兩對 3.5 成、三條 + 空白 3 成、鐵支 1 成、詐唬 2.5 成
  [[2, 0.35, 4, RANKS_TWO_PAIR], [3, 0.3, 3, RANKS_ALL], [7, 0.1, 4, RANKS_ALL], [E, 0.12, 0, NONE], [0, 0.06, 1, RANKS_HIGH], [1, 0.07, 2, RANKS_WEAK]],
  // 5 張:詐唬 5 成、大牌 3 成、三條 / 兩對墊空白 2 成
  [
    [E, 0.2, 0, NONE], [0, 0.18, 1, RANKS_HIGH], [1, 0.06, 2, RANKS_STRONG], [1, 0.06, 2, RANKS_WEAK],
    [4, 0.1, 5, RANKS_TOP], [5, 0.06, 5, RANKS_TOP], [6, 0.1, 5, RANKS_ALL], [7, 0.04, 4, RANKS_ALL],
    [3, 0.1, 3, RANKS_ALL], [2, 0.1, 4, RANKS_TWO_PAIR],
  ],
]
const BLANK_PLAYER_TABLE: readonly (readonly Entry[])[] = BLANK_PLAYER_WAYS.map((ways) =>
  ways.flatMap(([cat, p, reals, ranks]) => ranks.map(([top, q]) => [cat, top, 0, p * q, reals] as const)),
)
/** 各張數出現的比例(估一疊牌多強用;玩家模型大概的出牌張數)。 */
const BLANK_COUNT_MIX: readonly number[] = [0.15, 0.3, 0.3, 0.15, 0.1]

interface ModeTable {
  byCount: readonly (readonly Entry[])[]
  countMix: readonly number[]
  /** 空城計:張數不可靠 → 讀人 + 算牌重新配比(§11.5c) */
  readBluff?: boolean
  /** 比牌第三步「鬼少的贏」(百鬼 / 撲朔迷離);空城計照一般房,一樣大就當五五波 */
  jokerTie: boolean
}
/** 有表的玩法才走這裡;撲朔迷離做到時補一張(§11.6)。 */
const TABLES: Partial<Record<LimitedMode, ModeTable>> = {
  ghost: { byCount: GHOST_TABLE, countMix: GHOST_COUNT_MIX, jokerTie: true },
  blank: { byCount: BLANK_PLAYER_TABLE, countMix: BLANK_COUNT_MIX, readBluff: true, jokerTie: false },
}
export const hasPlaceTable = (mode: LimitedMode | undefined): boolean => !!mode && !!TABLES[mode]

interface Key {
  cat: number
  top: number
  j: number
}
const keyOf = (pile: Card[]): Key => {
  const v = evaluate(pile)
  return { cat: v.category, top: v.rankSeq[0] ?? 0, j: pile.filter(isJoker).length }
}
/** 牌型 → 點數 → 鬼少的贏(§4.2 前三步,空城計沒有第三步);再往下要看正牌點數 / 花色,當五五波。 */
function cmpKey(a: Key, b: Key, jokerTie: boolean): number {
  if (a.cat !== b.cat) return a.cat - b.cat
  if (a.top !== b.top) return a.top - b.top
  return jokerTie ? b.j - a.j : 0
}
/** `mine` 對上分布裡的一疊:贏 / 輸的機率(分不出來的各算一半)。 */
function vsDist(mine: Key, dist: readonly Entry[], jokerTie = true): { win: number; lose: number } {
  let win = 0
  let lose = 0
  for (const [cat, top, j, p] of dist) {
    const c = cmpKey(mine, { cat, top, j }, jokerTie)
    if (c > 0) win += p
    else if (c < 0) lose += p
    else {
      win += p / 2
      lose += p / 2
    }
  }
  return { win, lose }
}

/** 「隨便一疊」的分布(各張數照比例混在一起)。 */
function mixOf(t: ModeTable): Entry[] {
  return t.byCount.flatMap((dist, k) => dist.map(([c, top, j, p]) => [c, top, j, p * t.countMix[k]] as const))
}
const mixCache = new Map<ModeTable, Entry[]>()
const mix = (t: ModeTable) => mixCache.get(t) ?? mixCache.set(t, mixOf(t)).get(t)!
/** 一疊牌的強弱:贏「隨便一疊」的機率。 */
const strengthCache = new Map<ModeTable, Map<string, number>>()
const strength = (k: Key, t: ModeTable): number => {
  let m = strengthCache.get(t)
  if (!m) strengthCache.set(t, (m = new Map()))
  const id = `${k.cat},${k.top},${k.j}`
  let v = m.get(id)
  if (v === undefined) m.set(id, (v = vsDist(k, mix(t), t.jokerTie).win))
  return v
}
/** 對手出 N 張的平均強弱。 */
function distStrength(dist: readonly Entry[], t: ModeTable): number {
  return dist.reduce((s, [cat, top, j, p]) => s + p * strength({ cat, top, j }, t), 0)
}

/** 放牌可調參數(模擬比較用):rankCount = 算點數;readPrior = 讀人時表的預設比例當幾疊牌的份量。 */
export const PLACE_TUNE = { rankCount: true, readPrior: 3 }

const choose = (n: number, k: number): number => (k < 0 || k > n ? 0 : k === 0 ? 1 : (choose(n - 1, k - 1) * n) / k)
/**
 * 算牌(點數):每個點數還沒看到幾張(全場各 4 張,2 張鬼可以補)→ 這疊是「某牌型 + 某點數」的機會
 * 照「還湊得出的組合數 ÷ 四張都在時的組合數」打折;湊不出來的 = 0(例:A 看到 3 張、鬼也都看到了 → 不會是 A 三條)。
 */
function rankOdds(seen: Card[]): (cat: number, top: number) => number {
  if (!PLACE_TUNE.rankCount) return () => 1
  const unseen = new Map<number, number>()
  for (let r = 7; r <= 14; r++) unseen.set(r, 4)
  for (const c of seen) if (!isBlank(c) && !isJoker(c)) unseen.set(c.rank, (unseen.get(c.rank) ?? 0) - 1)
  const wild = Math.max(0, 2 - seen.filter(isJoker).length)
  const of = (r: number, k: number) => choose(Math.min(4, Math.max(0, unseen.get(r) ?? 0) + wild), k) / choose(4, k)
  return (cat, top) => {
    switch (cat) {
      case CATEGORY.HIGH_CARD:
        return of(top, 1)
      case CATEGORY.PAIR:
      case CATEGORY.TWO_PAIR:
        return of(top, 2)
      case CATEGORY.THREE_KIND:
      case CATEGORY.FULL_HOUSE:
        return of(top, 3)
      case CATEGORY.FOUR_KIND:
        return of(top, 4)
      case CATEGORY.STRAIGHT:
      case CATEGORY.STRAIGHT_FLUSH: {
        let x = 1
        for (let r = top - 4; r <= top; r++) x *= r >= 7 ? of(r, 1) : 1
        return x
      }
      default:
        return 1
    }
  }
}

/** 一個張數的表裡「有墊空白」(真牌數 < 張數)的比例。 */
const paddedShare = (dist: readonly Entry[], n: number) => dist.reduce((s, [, , , p, reals = n]) => s + (reals < n ? p : 0), 0)

/**
 * 空城計:對手這疊(N 張)的分布(§11.5c)。
 *  - 讀人:翻開過的對手牌堆裡有墊空白的比例,跟表的預設比例加權(預設佔 PLACE_TUNE.readPrior 疊),
 *    再把這個張數的表「有墊 / 沒墊」兩邊照比例重新配。
 *  - 算牌:全場 22 張空白,扣掉看得到的,剩下的才可能在這疊裡 → 真牌至少 N − 還沒看到的空白;
 *    點數也算(rankOdds):看光的點數不會出現、看到一半的機會變小。
 */
function blankDist(state: GameState, me: PlayerId, t: ModeTable, n: number): Entry[] {
  const base = t.byCount[n - 1]
  const foe = otherPlayer(me)
  const shown = state.slots.filter((s) => s.owner !== null && s[foe].length > 0).map((s) => s[foe])
  const prior = t.byCount.reduce((s, d, k) => s + paddedShare(d, k + 1) * t.countMix[k], 0)
  const read = (PLACE_TUNE.readPrior * prior + shown.filter((p) => p.some(isBlank)).length) / (PLACE_TUNE.readPrior + shown.length)
  const share = paddedShare(base, n)
  const want = Math.min(0.95, Math.max(0.05, share * (read / prior)))
  const seen = [...state.hands[me], ...state.slots.flatMap((s) => s[me]), ...shown.flat()]
  const minReals = n - Math.max(0, 22 - seen.filter(isBlank).length)
  const odds = rankOdds(seen)
  const out: Entry[] = []
  for (const [cat, top, j, p, reals = n] of base) {
    if (reals < minReals) continue
    const w = share <= 0 || share >= 1 ? 1 : reals < n ? want / share : (1 - want) / (1 - share)
    const q = p * w * odds(cat, top)
    if (q > 0) out.push([cat, top, j, q, reals])
  }
  const tot = out.reduce((s, e) => s + e[3], 0)
  if (!tot) return [...base]
  return out.map(([c, top, j, p, r]) => [c, top, j, p / tot, r])
}

/** `who` 拿下格子 i 會不會直接贏(4 幣或湊成 3 連)?公開資訊。 */
export function winsIfOwns(state: GameState, who: PlayerId, i: number): boolean {
  if (countCoins(state, who) + (ownsSlot(state.slots[i], who) ? 0 : 1) >= 4) return true
  for (let s = 0; s <= SLOT_COUNT - 3; s++) {
    let ok = true
    for (let k = s; k < s + 3; k++) if (!(k === i || ownsSlot(state.slots[k], who))) ok = false
    if (ok) return true
  }
  return false
}
const adjacent = (state: GameState, who: PlayerId, i: number) =>
  [i - 1, i + 1].filter((k) => state.slots[k] && ownsSlot(state.slots[k], who)).length

/** 打法權重(§11.9 第 4 塊)。 */
const STYLE: Record<BossRuntime['main'], { keep: number; adj: number; loss: number; defer: number }> = {
  attack: { keep: 0.6, adj: 0.6, loss: 1, defer: 0 }, // 爭格子:敢用大牌、連線加成高
  balance: { keep: 1, adj: 0.4, loss: 1, defer: 0 }, // CP 值:大牌留著的價值照算
  hoard: { keep: 1, adj: 0.3, loss: 1.25, defer: 0.15 }, // 能避戰就避、輸的代價算重
}
const WIN_SLOT = 12 // 拿了就直接贏的格子
const LATER_EDGE = 0.15 // 對方這疊留著等,之後由對方挑我哪疊去接 → 對方多一點優勢
const LATER_DISCOUNT = 0.9 // 之後的事不一定發生

/** 限定房放牌:把對手剛出的牌放進哪一格(對手那邊還空著的格子)。 */
export function placeByTable(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng): number {
  const t = TABLES[state.mode!]!
  const foe = otherPlayer(me)
  const empties = emptySlotsFor(state, foe)
  if (empties.length <= 1) return empties[0] ?? 0
  const n = Math.min(5, Math.max(1, state.pendingPick!.cards.length))
  const dist = t.readBluff ? blankDist(state, me, t, n) : t.byCount[n - 1]

  // 執行力失手:不看打法和位置,只挑勝率最高的格子(沒有可以對決的格子就放中間)
  if (rng() >= rt.execution) {
    let best = -1
    let top = -Infinity
    for (const i of empties) {
      const mine = state.slots[i][me]
      if (!mine.length) continue
      const { win, lose } = vsDist(keyOf(mine), dist, t.jokerTie)
      if (win - lose > top) {
        top = win - lose
        best = i
      }
    }
    if (best >= 0) return best
    return empties.reduce((b, i) => (Math.abs(i - 3) < Math.abs(b - 3) ? i : b), empties[0])
  }

  const w = STYLE[rt.main]
  const value = (who: PlayerId, i: number) => (winsIfOwns(state, who, i) ? WIN_SLOT : 1 + (who === me ? w.adj : 0.4) * adjacent(state, who, i))
  const later = Math.min(1, distStrength(dist, t) + LATER_EDGE)

  let best = empties[0]
  let bestScore = -Infinity
  for (const i of empties) {
    const mine = state.slots[i][me]
    let score: number
    if (mine.length) {
      // 現在就對決:贏的價值 − 輸的代價 − 這疊本來留著的價值
      const k = keyOf(mine)
      const { win, lose } = vsDist(k, dist, t.jokerTie)
      const keep = 2 * strength(k, t) - 1
      score = win * value(me, i) - lose * value(foe, i) * w.loss - w.keep * keep
    } else {
      // 我這格還空著:對方這疊留在這裡等
      score = LATER_DISCOUNT * ((1 - later) * value(me, i) - later * value(foe, i) * w.loss) + w.defer
    }
    score -= Math.abs(i - (SLOT_COUNT - 1) / 2) * 0.02 // 一點點偏好中間
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

// ---- 空城計看棋盤(§11.5d):出牌前模擬對手會把這疊放哪 ----------------------------

let synthId = 0
/** 照分布表的一種可能合成一疊具體的牌(只給模擬用;牌型 + 點數對就好,花色隨便)。 */
function synthPile([cat, top]: Entry, n: number): Card[] {
  const card = (rank: number, suit: Card['suit'] = 'S'): Card => ({ id: `SYN${++synthId}`, suit, rank: rank as Card['rank'] })
  const blank = (): Card => ({ id: `SYNB${++synthId}`, suit: 'C', rank: 2, kind: 'blank' })
  const low = top > 7 ? top - 1 : top + 1
  const suits: Card['suit'][] = ['S', 'H', 'D', 'C']
  let cards: Card[]
  switch (cat) {
    case CATEGORY.HIGH_CARD: cards = [card(top)]; break
    case CATEGORY.PAIR: cards = [card(top, 'S'), card(top, 'H')]; break
    case CATEGORY.TWO_PAIR: cards = [card(top, 'S'), card(top, 'H'), card(low, 'D'), card(low, 'C')]; break
    case CATEGORY.THREE_KIND: cards = [0, 1, 2].map((k) => card(top, suits[k])); break
    case CATEGORY.FOUR_KIND: cards = suits.map((s) => card(top, s)); break
    case CATEGORY.FULL_HOUSE: cards = [...[0, 1, 2].map((k) => card(top, suits[k])), card(low, 'S'), card(low, 'H')]; break
    case CATEGORY.STRAIGHT: cards = [0, 1, 2, 3, 4].map((k) => card(top - k, suits[k % 2])); break
    case CATEGORY.FLUSH: cards = [top, top - 2, top - 3, top - 5, top - 6].map((r) => card(Math.max(7, r), 'H')); break
    case CATEGORY.STRAIGHT_FLUSH: cards = [0, 1, 2, 3, 4].map((k) => card(top - k, 'H')); break
    default: cards = []
  }
  while (cards.length < n) cards.push(blank())
  return cards.slice(0, Math.max(n, 1))
}
function drawEntry(dist: readonly Entry[], rng: Rng): Entry {
  let u = rng() * dist.reduce((s, e) => s + e[3], 0)
  for (const e of dist) if ((u -= e[3]) < 0) return e
  return dist[dist.length - 1]
}

/** 空城計:這疊牌的強弱(贏「隨便一疊」的機率),出牌看未來用。 */
export const blankStrength = (cards: Card[]): number => (cards.length ? strength(keyOf(cards), TABLES.blank!) : 0)

/**
 * 空城計看棋盤(§11.5d):每個候選出牌 → 對手會放哪格 → 我這手的期望(格子價值為單位)。
 * 對手等著的牌只知道張數,照分布表抽 samples 次;對手用同一套放牌、站在他那邊挑(他只看得到張數)。
 */
export function blankBoardScores(state: GameState, me: PlayerId, options: Card[][], samples: number, rng: Rng): number[] {
  const t = TABLES.blank!
  const foe = otherPlayer(me)
  const targets = emptySlotsFor(state, me)
  const waiting = targets.filter((i) => state.slots[i][foe].length > 0)
  const foeRt: BossRuntime = { profile: { pickMain: { attack: 0, hoard: 0, balance: 100 }, bluff: 50, draw: 0, jokerTiming: 0, insight: 0 }, main: 'balance', execution: 1 }
  const value = (who: PlayerId, i: number) => (winsIfOwns(state, who, i) ? WIN_SLOT : 1 + 0.4 * adjacent(state, who, i))
  const totals = options.map(() => 0)
  const dists = new Map(waiting.map((i) => [i, blankDist(state, me, t, Math.min(5, state.slots[i][foe].length))]))
  for (let k = 0; k < samples; k++) {
    const slots = state.slots.map((s, i) => (dists.has(i) ? { ...s, [foe]: synthPile(drawEntry(dists.get(i)!, rng), s[foe].length) } : s))
    const hyp: GameState = { ...state, slots, hands: { ...state.hands, [foe]: [] }, phase: 'place' }
    options.forEach((pile, o) => {
      const i = targets.length <= 1 ? targets[0] : placeByTable({ ...hyp, pendingPick: { by: me, cards: pile } }, foe, foeRt, () => 0)
      const theirs = slots[i][foe]
      if (theirs.length) {
        const c = compareHands(pile, theirs)
        totals[o] += c > 0 ? value(me, i) : c < 0 ? -value(foe, i) : 0
      } else {
        const s = Math.max(0, strength(keyOf(pile), t) - LATER_EDGE)
        totals[o] += LATER_DISCOUNT * (s * value(me, i) - (1 - s) * value(foe, i))
      }
    })
  }
  return totals.map((x) => x / samples)
}