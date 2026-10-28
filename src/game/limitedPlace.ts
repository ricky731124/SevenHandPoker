/**
 * 限定房放牌(LIMITED-ROOM-SPEC §11.9)。百鬼夜行 / 空城計 / 撲朔迷離共用,只差「張數 → 牌型分布表」。
 * 原本 boss 放牌用張數猜牌力(4 張 ≈ 兩對、5 張 ≈ 同花),每格 2 鬼的百鬼完全不對,所以限定房改走這裡;
 * bossAI.ts 一行都不改。
 *
 * 四塊:① 分布表 ② 我每格的牌贏 / 輸對方這疊的機率 ③ 位置價值(連線、擋殺、留著的價值)④ 打法權重。
 */

import type { Card } from './cards'
import { isJoker } from './cards'
import { evaluate } from './evaluate'
import type { BossRuntime } from './bossAI'
import type { LimitedMode } from './limited'
import { SLOT_COUNT, countCoins, emptySlotsFor, otherPlayer, ownsSlot, type GameState, type PlayerId } from './state'

type Rng = () => number

/** 一種可能:[牌型 CATEGORY, 最大點數, 用幾張鬼, 機率]。 */
type Entry = readonly [number, number, number, number]

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

interface ModeTable {
  byCount: readonly (readonly Entry[])[]
  countMix: readonly number[]
}
/** 有表的玩法才走這裡;空城計 / 撲朔迷離做到時各補一張(§11.5 / §11.6)。 */
const TABLES: Partial<Record<LimitedMode, ModeTable>> = {
  ghost: { byCount: GHOST_TABLE, countMix: GHOST_COUNT_MIX },
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
/** 牌型 → 點數 → 鬼少的贏(§4.2 前三步);再往下要看正牌點數 / 花色,當五五波。 */
function cmpKey(a: Key, b: Key): number {
  if (a.cat !== b.cat) return a.cat - b.cat
  if (a.top !== b.top) return a.top - b.top
  return b.j - a.j
}
/** `mine` 對上分布裡的一疊:贏 / 輸的機率(分不出來的各算一半)。 */
function vsDist(mine: Key, dist: readonly Entry[]): { win: number; lose: number } {
  let win = 0
  let lose = 0
  for (const [cat, top, j, p] of dist) {
    const c = cmpKey(mine, { cat, top, j })
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
const strength = (k: Key, t: ModeTable) => vsDist(k, mix(t)).win
/** 對手出 N 張的平均強弱。 */
function distStrength(dist: readonly Entry[], t: ModeTable): number {
  return dist.reduce((s, [cat, top, j, p]) => s + p * strength({ cat, top, j }, t), 0)
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
  const dist = t.byCount[n - 1]

  // 執行力失手:不看打法和位置,只挑勝率最高的格子(沒有可以對決的格子就放中間)
  if (rng() >= rt.execution) {
    let best = -1
    let top = -Infinity
    for (const i of empties) {
      const mine = state.slots[i][me]
      if (!mine.length) continue
      const { win, lose } = vsDist(keyOf(mine), dist)
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
      const { win, lose } = vsDist(k, dist)
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
