/**
 * 限定房人機(LIMITED-ROOM-SPEC §11)。只在限定房被呼叫(ai.ts 依 state.mode 分派);
 * bossAI.ts 一行都不改 —— 這裡只「唯讀呼叫」它的 bossPlace / rollMain。
 *
 * 目前做了:百鬼夜行(§11.4)。空城計 / 撲朔迷離 / 火力全開之後一種一種加。
 *
 * 公平:限定房對手只看得到張數(推牌位置隨機),所以 boss 的「看破」一律當 0(§11.2)。
 */

import type { Card } from './cards'
import { isBlank, isJoker } from './cards'
import { CATEGORY, evaluate } from './evaluate'
import { candidatePiles, groupBy } from './aiCore'
import { bossPlace, type BossProfile, type BossRuntime } from './bossAI'
import { SLOT_COUNT, countCoins, ownsSlot, otherPlayer, type GameState, type PlayerId } from './state'

type Rng = () => number

/** 對戰電腦(沒有 boss 個性)在限定房用的預設個性:平衡、中等詐唬、中等執行力(§11.1)。 */
export const DEFAULT_LIMITED_PROFILE: BossProfile = {
  pickMain: { attack: 0, hoard: 0, balance: 100 },
  bluff: 50,
  draw: 0,
  jokerTiming: 0,
  insight: 0,
}
export function defaultLimitedBrain(): BossRuntime {
  return { profile: DEFAULT_LIMITED_PROFILE, main: 'balance', execution: 0.75 }
}

/** 看破關掉的 boss(只讀張數)。不改原 profile,複製一份傳下去。 */
const noInsight = (rt: BossRuntime): BossRuntime => ({ ...rt, profile: { ...rt.profile, insight: 0 } })

export function limitedPick(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng = Math.random): string[] {
  // 步驟 1 只有百鬼夜行;其他玩法上線時在這裡分派
  return ghostPick(state, me, rt, rng).map((c) => c.id)
}

export function limitedPlace(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng = Math.random): number {
  // 百鬼夜行:原本的 boss 放牌,看破 = 0(§11.4)
  return bossPlace(state, me, noInsight(rt), rng)
}

// ---- 百鬼夜行(§11.4) ------------------------------------------------------

/** 這格牌力(牌型 + 最大點數),跟 aiCore.pileStrength 同一把尺。 */
function power(pile: Card[]): number {
  const v = evaluate(pile)
  return v.category + (v.rankSeq[0] ?? 0) / 15
}

const jokersIn = (pile: Card[]) => pile.filter(isJoker).length

/** 正牌的「留著的價值」:大牌比較值錢(之後還能湊大的),7~9 小牌便宜。 */
function realCost(c: Card): number {
  return c.rank >= 14 ? 0.35 : c.rank >= 13 ? 0.3 : c.rank >= 12 ? 0.25 : c.rank >= 11 ? 0.2 : c.rank >= 10 ? 0.15 : 0.08
}

/** `who` 拿下格子 i 會不會直接贏(4 幣或湊成 3 連)?公開資訊。 */
function winsIfOwns(state: GameState, who: PlayerId, i: number): boolean {
  if (countCoins(state, who) + (ownsSlot(state.slots[i], who) ? 0 : 1) >= 4) return true
  for (let s = 0; s <= SLOT_COUNT - 3; s++) {
    let ok = true
    for (let k = s; k < s + 3; k++) if (!(k === i || ownsSlot(state.slots[k], who))) ok = false
    if (ok) return true
  }
  return false
}
/** 還沒有主的格子裡,有沒有一格 `who` 拿到就贏。 */
function atMatchPoint(state: GameState, who: PlayerId): boolean {
  return state.slots.some((s, i) => s.owner === null && winsIfOwns(state, who, i))
}

/**
 * 這回合可以花幾張鬼牌(§11.4 鬼牌預算):手上鬼牌 ÷ 剩幾手 × 主策略係數。
 * 都要溫和:強攻第一手最多 3 張;囤牌第一手手上有像樣的正牌就不花;
 * 快連成三格 / 差一枚金幣 / 要擋對手 → 多花;最後一手全部用掉。
 */
function jokerBudget(state: GameState, me: PlayerId, rt: BossRuntime, hand: Card[]): number {
  const j = hand.filter(isJoker).length
  if (!j) return 0
  const left = SLOT_COUNT - state.placementsDone[me] // 含這一手
  if (left <= 1) return j
  const foe = otherPlayer(me)
  const cashOut = countCoins(state, foe) >= 2 || state.placementsDone[me] >= 3
  const factor = rt.main === 'attack' ? 1.35 : rt.main === 'hoard' ? (cashOut ? 1.15 : 0.75) : 1
  let b = Math.round((j / left) * factor)
  const first = state.placementsDone[me] === 0
  if (first && rt.main === 'attack') b = Math.min(b, 3)
  if (first && rt.main === 'hoard') {
    // 第一回合真有需要可以不花鬼(手上已經有對子以上的正牌)
    const reals = hand.filter((c) => !isJoker(c) && !isBlank(c))
    const hasMade = candidatePiles(reals).some((p) => evaluate(p).category >= CATEGORY.PAIR)
    b = Math.min(b, hasMade ? 0 : 1)
  }
  if (atMatchPoint(state, foe) || atMatchPoint(state, me) || left <= 2) b = Math.max(b + 1, 3)
  return Math.max(0, Math.min(b, 4, j))
}

/**
 * 候選牌堆(§11.4 組牌):先看正牌能組什麼,再用最少的鬼牌補到目標牌型。
 *  - 對子 / 三條 / 鐵支 / 葫蘆:同點數的正牌 + 鬼牌補齊(小牌 7~9 主要用在這裡)。
 *  - 同花順只湊 10~A(同花色的 10/J/Q/K/A 當核心),小牌不塞進同花順(例 #12)。
 *  - 同花(同花色 ≥3 張)、10~A 的順子。
 *  - 正牌本身的成牌、最小的單張(墊牌)。
 * 不產生「整格全鬼」的候選(只有手上沒正牌時才出鬼,見 ghostPick)。
 */
function ghostCandidates(reals: Card[], jokers: Card[]): Card[][] {
  const out: Card[][] = []
  const J = jokers.length
  const add = (cards: Card[], j: number) => {
    if (j > J || cards.length + j > 5 || cards.length + j === 0) return
    out.push([...cards, ...jokers.slice(0, j)])
  }
  const byRank = [...groupBy(reals, (c) => c.rank).values()]
  for (const g of byRank) {
    const top = [...g].sort((a, b) => b.suit.localeCompare(a.suit))
    for (const t of [2, 3, 4]) {
      const use = top.slice(0, Math.min(t, top.length))
      add(use, t - use.length)
    }
  }
  // 葫蘆:一組補到三條、另一組補到對子
  for (const a of byRank) {
    for (const b of byRank) {
      if (a === b) continue
      const ta = a.slice(0, 3)
      const tb = b.slice(0, 2)
      add([...ta, ...tb], 3 - ta.length + (2 - tb.length))
    }
  }
  // 同花順(只湊 10~A)與同花
  for (const suited of groupBy(reals, (c) => c.suit).values()) {
    const high = suited.filter((c) => c.rank >= 10)
    if (high.length) add(high.slice(0, 5), 5 - Math.min(5, high.length))
    if (suited.length >= 3) {
      const best = [...suited].sort((a, b) => b.rank - a.rank).slice(0, 5)
      add(best, 5 - best.length)
    }
  }
  // 10~A 的順子(不同花色)
  const broadway: Card[] = []
  for (let r = 10; r <= 14; r++) {
    const c = reals.find((x) => x.rank === r)
    if (c) broadway.push(c)
  }
  if (broadway.length >= 2) add(broadway, 5 - broadway.length)
  // 正牌本身的成牌 + 最小單張(墊牌 / 囤牌時丟)
  for (const p of candidatePiles(reals)) add(p, 0)
  const low = [...reals].sort((a, b) => a.rank - b.rank)[0]
  if (low) add([low], 0)
  // 同花候選配上鬼牌也可能變成低的同花順(♣789+2 鬼)→ 一律拿掉:小牌不進同花順
  return out.filter((p) => !(evaluate(p).category === CATEGORY.STRAIGHT_FLUSH && p.some((c) => !isJoker(c) && c.rank < 10)))
}

function ghostPick(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng): Card[] {
  const hand = state.hands[me]
  const reals = hand.filter((c) => !isJoker(c) && !isBlank(c))
  const jokers = hand.filter(isJoker)
  const blanks = hand.filter(isBlank)
  const left = SLOT_COUNT - state.placementsDone[me]

  // 手上沒有正牌:只剩鬼牌才出鬼(分散用,最後一手才全出);連鬼都沒有就墊空白
  if (!reals.length) {
    if (!jokers.length) return blanks.slice(0, 1)
    const n = left <= 1 ? jokers.length : Math.ceil(jokers.length / left)
    return jokers.slice(0, Math.max(1, Math.min(5, n)))
  }

  const budget = jokerBudget(state, me, rt, hand)
  const cands = ghostCandidates(reals, jokers)
  const within = cands.filter((p) => jokersIn(p) <= budget)
  const pool = within.length ? within : cands.filter((p) => jokersIn(p) === 0)

  // 失手(執行力沒發揮):直接出預算內最強的,不算成本
  if (rng() >= rt.execution) return pool.reduce((b, p) => (power(p) > power(b) ? p : b), pool[0])

  // CP 值:牌力 − 鬼牌成本 − 正牌成本。鬼牌越多(相對剩下手數)越便宜;
  // 同樣大時鬼牌少的贏(§4.2),成本自然讓「正牌多、鬼牌少」的組法勝出。
  const J = jokers.length
  const jokerCost = Math.max(0.25, Math.min(2, (1.2 * left) / (J + 1))) * (rt.main === 'attack' ? 0.8 : rt.main === 'hoard' ? 1.25 : 1)
  const score = (p: Card[]) =>
    power(p) - jokersIn(p) * jokerCost - p.filter((c) => !isJoker(c)).reduce((s, c) => s + realCost(c), 0)
  return pool.reduce((b, p) => (score(p) > score(b) ? p : b), pool[0])
}
