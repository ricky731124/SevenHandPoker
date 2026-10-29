/**
 * 限定房人機(LIMITED-ROOM-SPEC §11)。只在限定房被呼叫(ai.ts 依 state.mode 分派);
 * bossAI.ts 一行都不改 —— 這裡只「唯讀呼叫」它的 bossPlace / rollMain。
 *
 * 目前做了:百鬼夜行(§11.4)出牌 + 限定房放牌(§11.9,limitedPlace.ts)。空城計 / 撲朔迷離 / 火力全開之後一種一種加。
 *
 * 公平:限定房對手只看得到張數(推牌位置隨機),所以 boss 的「看破」一律當 0(§11.2)。
 */

import type { Card } from './cards'
import { isBlank, isJoker } from './cards'
import { CATEGORY, compareHands, compareLimited, evaluate } from './evaluate'
import { groupBy } from './aiCore'
import { bossPlace, type BossProfile, type BossRuntime } from './bossAI'
import { LIMITED_EXECUTION, LIMITED_JOKER_CAP, jokerCapOf, makeLimitedDeck, type LimitedMode } from './limited'
import { mulberry32 } from './rng'
import { blankBoardScores, blankStrength, hasPlaceTable, placeByTable, winsIfOwns } from './limitedPlace'
import { DRAW_SCHEDULE, SLOT_COUNT, countCoins, otherPlayer, type GameState, type PlayerId } from './state'

type Rng = () => number

/** 對戰電腦(沒有 boss 個性)在限定房用的預設個性:平衡、中等詐唬、中等執行力(§11.1;百鬼 0.5,§11.4a)。 */
export const DEFAULT_LIMITED_PROFILE: BossProfile = {
  pickMain: { attack: 0, hoard: 0, balance: 100 },
  bluff: 50,
  draw: 0,
  jokerTiming: 0,
  insight: 0,
}
export function defaultLimitedBrain(mode?: LimitedMode): BossRuntime {
  return { profile: DEFAULT_LIMITED_PROFILE, main: 'balance', execution: (mode && LIMITED_EXECUTION[mode]?.vsComputer) || 0.75 }
}

/** 看破關掉的 boss(只讀張數)。不改原 profile,複製一份傳下去。 */
const noInsight = (rt: BossRuntime): BossRuntime => ({ ...rt, profile: { ...rt.profile, insight: 0 } })

/** 模擬 / 產分布表用的開關(遊戲裡不傳)。 */
export interface LimitedPickOpts {
  /** 空城計:不墊空白(模擬比較用) */
  noPad?: boolean
}

export function limitedPick(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng = Math.random, opts: LimitedPickOpts = {}): string[] {
  if (state.mode === 'blank') return blankPick(state, me, rt, rng, opts).map((c) => c.id)
  // 撲朔迷離 / 火力全開上線時在這裡分派
  return ghostPick(state, me, rt, rng).map((c) => c.id)
}

export function limitedPlace(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng = Math.random): number {
  // 有分布表的玩法走限定房放牌(§11.9);火力全開是一般牌組,照原本 boss 放牌(看破 = 0)
  if (hasPlaceTable(state.mode)) return placeByTable(state, me, rt, rng)
  return bossPlace(state, me, noInsight(rt), rng)
}

// ---- 百鬼夜行(§11.4a,每格最多 2 鬼) ----------------------------------------
//
// 每格最多 2 鬼後牌型重新變多元,不再只是「大牌 / 送 1 張」二選一。每手的分數 =
//   這手的價值 + 看未來比重 × 留下來的牌之後還能湊出的價值 − 鬼牌浪費
// 主策略只是「看未來比重」與幾條前期 / 後期的守則不同(§11.3)。

/**
 * 這手的價值:大概代表「這疊拿下一格的機會」(初值,用模擬看各牌型實際拿下格子的比例調過)。
 * 同花順、鐵支最高;葫蘆 / 同花常撞到鐵支;三條堪用;強對子(A/K + 鬼)拿來過渡;順子最差。
 */
// 2026-10-28 模擬(每格 2 鬼):拿下格子比例 同花順 85%、鐵支 55%、葫蘆 33%、三條 33%、對子 29%、
// 同花 22%、兩對 9% → 葫蘆 / 同花 / 順子往下調(常撞到鐵支,又耗 5 張牌)。
const CAT_VALUE: Record<number, number> = {
  [CATEGORY.STRAIGHT_FLUSH]: 10,
  [CATEGORY.FOUR_KIND]: 8.5,
  [CATEGORY.FULL_HOUSE]: 5,
  [CATEGORY.FLUSH]: 3.5,
  [CATEGORY.THREE_KIND]: 4.5,
  [CATEGORY.STRAIGHT]: 3,
  [CATEGORY.TWO_PAIR]: 2.5,
  [CATEGORY.PAIR]: 2,
  [CATEGORY.HIGH_CARD]: 0.5,
  [CATEGORY.EMPTY]: 0,
}
function catValue(cat: number, top: number): number {
  const big = cat === CATEGORY.STRAIGHT_FLUSH || cat === CATEGORY.FOUR_KIND || cat === CATEGORY.PAIR
  return CAT_VALUE[cat] + top / (big ? 14 : 28)
}
/** 一手(牌型, 最大點數)的價值;百鬼 / 空城計各一張表。 */
type ValueFn = (cat: number, top: number) => number

/** 還沒有主的格子裡,有沒有一格 `who` 拿到就贏。 */
function atMatchPoint(state: GameState, who: PlayerId): boolean {
  return state.slots.some((s, i) => s.owner === null && winsIfOwns(state, who, i))
}

/** 自己看得到的牌:手牌 + 自己的牌堆 + 對手翻開的牌堆(公開資訊)。 */
function seenCards(state: GameState, me: PlayerId): Card[] {
  const foe = otherPlayer(me)
  return [...state.hands[me], ...state.slots.flatMap((s) => s[me]), ...state.slots.filter((s) => s.owner !== null).flatMap((s) => s[foe])]
}
/** 還沒看到的某種牌(全場 total 張)有幾張。算牌用,只用公開資訊。 */
export function unseenOf(state: GameState, me: PlayerId, is: (c: Card) => boolean, total: number): number {
  return Math.max(0, total - seenCards(state, me).filter(is).length)
}
/** 之後還會補幾張牌,以及其中大概幾張是某種牌(只用公開資訊:牌堆 + 對手手牌 + 沒翻開的對手牌堆)。 */
function futureOf(state: GameState, me: PlayerId, is: (c: Card) => boolean, total: number): { cards: number; hits: number } {
  const cards = DRAW_SCHEDULE.slice(state.drawsDone[me]).reduce((s, n) => s + n, 0)
  const foe = otherPlayer(me)
  const unseenCards = state.deck.length + state.hands[foe].length + state.slots.filter((s) => s.owner === null).reduce((n, s) => n + s[foe].length, 0)
  const rate = unseenCards > 0 ? Math.min(1, unseenOf(state, me, is, total) / unseenCards) : 0
  return { cards, hits: cards * rate }
}
/** 之後還會補幾張牌,以及其中大概幾張是鬼(20 張牌組鬼 + 兩張開局鬼)。 */
function futureDraws(state: GameState, me: PlayerId): { cards: number; jokers: number } {
  const f = futureOf(state, me, isJoker, 22)
  return { cards: f.cards, jokers: f.hits }
}

/**
 * 下一次補牌的幾種可能(從還沒看到的牌裡抽;只用公開資訊:牌組組成 − 自己手牌 / 牌堆 − 對手翻開的牌堆)。
 * 強攻判斷「棄一格後下一手有沒有機會出大牌」用。
 */
function sampleNextDraws(state: GameState, me: PlayerId, rng: Rng, times: number): Card[][] {
  const k = DRAW_SCHEDULE[state.drawsDone[me]] ?? 0
  if (!k) return [[]]
  const foe = otherPlayer(me)
  const seen = new Set([
    ...state.hands[me],
    ...state.slots.flatMap((s) => s[me]),
    ...state.slots.filter((s) => s.owner !== null).flatMap((s) => s[foe]),
  ].map((c) => c.id))
  const unseen = makeLimitedDeck(state.seed, state.mode).filter((c) => !seen.has(c.id))
  return Array.from({ length: times }, () => {
    const pool = [...unseen]
    const out: Card[] = []
    for (let i = 0; i < k && pool.length; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
    return out
  })
}
/** 「有機會」= 模擬下一次補牌,至少這個比例湊得出鐵支 / 同花順。 */
const BIG_NEXT_CHANCE = 0.4

/** 過渡 / 棄一格的牌堆:只有 1 張正牌、最多 1 張鬼(§11.3)。 */
const isTransition = (c: { reals: Card[]; jokers: number }) => c.reals.length === 1 && c.jokers <= 1
/** 桌上自己已經過渡幾次(看牌堆算,重整 / 接手也一樣)。 */
function transitionsDone(state: GameState, me: PlayerId): number {
  return state.slots.filter((s) => {
    const p = s[me]
    const reals = p.filter((c) => !isJoker(c) && !isBlank(c)).length
    return p.length > 0 && p.length <= 2 && reals === 1 && p.filter(isJoker).length <= 1
  }).length
}

/** 同一點數的牌排一下:跟同花色別張牌「沒關係」的先用(把能湊同花順的留著)。 */
function spareFirst(group: Card[], reals: Card[]): Card[] {
  const ties = (c: Card) => reals.filter((x) => x !== c && x.suit === c.suit && Math.abs(x.rank - c.rank) <= 4).length
  return [...group].sort((a, b) => ties(a) - ties(b))
}

const WINDOW_TOPS = [11, 12, 13, 14] // 正牌只有 7~A → 5 格窗 7-J、8-Q、9-K、10-A

/** 一個組法:正牌 reals + 補 jokers 張鬼;組的時候就知道牌型(cat)和最大點數(top),不用再估值。 */
interface Cand {
  reals: Card[]
  jokers: number
  cat: number
  top: number
  value: number
}

const SAME_RANK_CAT = [CATEGORY.EMPTY, CATEGORY.HIGH_CARD, CATEGORY.PAIR, CATEGORY.THREE_KIND, CATEGORY.FOUR_KIND]

/** 所有 ≤ cap 鬼的組法(同花順、鐵支、葫蘆、同花、順子、三條、兩對、對子、單張)。 */
function candidates(reals: Card[], J: number, cap: number, val: ValueFn = catValue): Cand[] {
  const maxJ = Math.min(cap, J)
  const byKey = new Map<string, Cand>()
  const add = (rs: Card[], j: number, cat: number, top: number) => {
    if (j < 0 || j > maxJ || rs.length + j === 0 || rs.length + j > 5) return
    const key = rs.map((c) => c.id).sort().join(',') + '|' + j
    const value = val(cat, top)
    const old = byKey.get(key)
    if (!old || old.value < value) byKey.set(key, { reals: rs, jokers: j, cat, top, value })
  }
  const groups = [...groupBy(reals, (c) => c.rank).values()].map((g) => spareFirst(g, reals))
  // 同點數:單張 / 對子 / 三條 / 鐵支(補鬼,鬼都變成同點數)
  for (const g of groups) {
    for (let t = 1; t <= Math.min(4, g.length); t++) {
      for (let j = 0; j <= maxJ && t + j <= 4; j++) add(g.slice(0, t), j, SAME_RANK_CAT[t + j], g[0].rank)
    }
  }
  // 每張單張都列(送哪張由「留下來的價值」決定)
  for (const c of reals) add([c], 0, CATEGORY.HIGH_CARD, c.rank)
  // 兩種點數:葫蘆(三條那組補鬼)、天然兩對(補鬼的兩對不如同樣鬼數的三條,不列)
  for (const a of groups) {
    for (const b of groups) {
      if (a === b) continue
      for (let ta = 1; ta <= Math.min(3, a.length); ta++) {
        for (let tb = 1; tb <= Math.min(2, b.length); tb++) {
          add([...a.slice(0, ta), ...b.slice(0, tb)], 3 - ta + (2 - tb), CATEGORY.FULL_HOUSE, a[0].rank)
        }
      }
      if (a.length >= 2 && b.length >= 2 && a[0].rank > b[0].rank) add([...a.slice(0, 2), ...b.slice(0, 2)], 0, CATEGORY.TWO_PAIR, a[0].rank)
    }
  }
  // 同花順(鬼補滿窗,頭 = 窗頂)/ 同花(鬼當 A、K…)
  for (const suited of groupBy(reals, (c) => c.suit).values()) {
    for (const top of WINDOW_TOPS) {
      const inWin = suited.filter((c) => c.rank <= top && c.rank > top - 5)
      add(inWin, 5 - inWin.length, CATEGORY.STRAIGHT_FLUSH, top)
    }
    const best = [...suited].sort((a, b) => b.rank - a.rank).slice(0, 5)
    add(best, 5 - best.length, CATEGORY.FLUSH, best.length < 5 ? 14 : best[0].rank)
  }
  // 順子(每個點數挑一張閒的)
  for (const top of WINDOW_TOPS) {
    const rs: Card[] = []
    for (const g of groups) if (g[0].rank <= top && g[0].rank > top - 5) rs.push(g[0])
    add(rs, 5 - rs.length, CATEGORY.STRAIGHT, top)
  }
  return [...byKey.values()]
}

/**
 * 留下來的牌之後還能湊出的價值(只看結構、不窮舉,很快):每次挑「這些牌 + 鬼」能湊出最大的一手,
 * 拿掉再挑,最多挑 piles 手;湊不出東西的手算 0.5(送單張)。
 */
function potential(reals: Card[], jokers: number, piles: number, cap: number, val: ValueFn = catValue): number {
  let rs = reals
  let j = jokers
  let total = 0
  for (let p = 0; p < piles; p++) {
    const maxJ = Math.min(cap, Math.floor(j))
    let best: { v: number; used: Card[]; j: number } | null = null
    const take = (v: number, used: Card[], need: number) => {
      if (need > maxJ) return
      if (!best || v > best.v || (v === best.v && need < best.j)) best = { v, used, j: need }
    }
    const groups = [...groupBy(rs, (c) => c.rank).values()]
    for (const suited of groupBy(rs, (c) => c.suit).values()) {
      for (const top of WINDOW_TOPS) {
        const inWin = suited.filter((c) => c.rank <= top && c.rank > top - 5)
        if (inWin.length) take(val(CATEGORY.STRAIGHT_FLUSH, top), inWin, 5 - inWin.length)
      }
    }
    for (const g of groups) {
      const r = g[0].rank
      take(val(CATEGORY.FOUR_KIND, r), g.slice(0, 4), 4 - Math.min(4, g.length))
      take(val(CATEGORY.THREE_KIND, r), g.slice(0, 3), 3 - Math.min(3, g.length))
      take(val(CATEGORY.PAIR, r), g.slice(0, 2), 2 - Math.min(2, g.length))
    }
    for (const a of groups) {
      for (const b of groups) {
        if (a !== b) take(val(CATEGORY.FULL_HOUSE, a[0].rank), [...a.slice(0, 3), ...b.slice(0, 2)], 3 - Math.min(3, a.length) + (2 - Math.min(2, b.length)))
      }
    }
    if (!rs.length && maxJ >= 2) take(val(CATEGORY.PAIR, 14), [], 2) // 只剩鬼:兩張鬼 = 一對 A
    const b = best as { v: number; used: Card[]; j: number } | null
    if (!b) {
      if (rs.length) {
        total += 0.5
        rs = rs.slice(1)
      }
      continue
    }
    total += b.v
    j -= b.j
    rs = rs.filter((c) => !b.used.includes(c))
  }
  return total
}

/** 手牌裡最大的一疊(≤ 5 張、≤ cap 鬼;張數多的踢腳贏,所以剩的牌也會塞進去)。最後一手用。 */
function biggestPile(hand: Card[], cap: number, cmp: (a: Card[], b: Card[]) => number = (a, b) => compareLimited(a, b).cmp): Card[] {
  let best: Card[] = [hand[0]]
  const rec = (start: number, cur: Card[], j: number) => {
    if (cur.length && cmp(cur, best) > 0) best = [...cur]
    if (cur.length === 5) return
    for (let i = start; i < hand.length; i++) {
      const jk = isJoker(hand[i]) ? 1 : 0
      if (j + jk <= cap) rec(i + 1, [...cur, hand[i]], j + jk)
    }
  }
  rec(0, [], 0)
  return best
}

/** 主策略的「看未來」比重(§11.3):強攻看眼前、平衡中等、囤牌最看未來。 */
const FUTURE_WEIGHT: Record<BossRuntime['main'], number> = { attack: 0.55, balance: 0.8, hoard: 0.95 }
/** 鬼牌浪費一張扣幾分(剩下手數 × 上限 裝不下的鬼)。 */
const WASTE_COST = 1.2

function ghostPick(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng): Card[] {
  const hand = state.hands[me]
  const cap = jokerCapOf(state.mode) ?? LIMITED_JOKER_CAP
  const reals = hand.filter((c) => !isJoker(c) && !isBlank(c))
  const jokers = hand.filter(isJoker)
  const blanks = hand.filter(isBlank)
  const pd = state.placementsDone[me]
  const left = SLOT_COUNT - pd // 含這一手

  // 最後一手:留牌沒用 → 出整副手牌裡最大的一疊(含踢腳)
  if (left <= 1) return biggestPile(hand, cap)

  // 手上沒有正牌:只剩鬼就出鬼(每格最多 cap 張),連鬼都沒有就墊空白
  if (!reals.length) {
    if (!jokers.length) return blanks.slice(0, 1)
    return jokers.slice(0, Math.min(cap, jokers.length))
  }

  const J = jokers.length
  const foe = otherPlayer(me)
  const cands = candidates(reals, J, cap)
  const pileOf = (c: Cand) => [...c.reals, ...jokers.slice(0, c.jokers)]
  // 這手最大的:價值高的;一樣就鬼少的(§4.2 鬼少的贏)
  const biggest = () => cands.reduce((b, c) => (c.value > b.value || (c.value === b.value && c.jokers < b.jokers) ? c : b), cands[0])

  // 差一格就贏(誰都一樣):不管打法,出這手最大的
  if (atMatchPoint(state, foe) || atMatchPoint(state, me)) return pileOf(biggest())

  // 執行力失手:只看這手、不看未來
  if (rng() >= rt.execution) return pileOf(biggest())

  const future = futureDraws(state, me)
  const after = left - 1
  let w = FUTURE_WEIGHT[rt.main]
  let pool = cands
  const BIG = CAT_VALUE[CATEGORY.FOUR_KIND] // 鐵支 / 同花順才算大牌;三條以下在百鬼都是差牌
  const prefer = (xs: Cand[]) => (xs.length ? xs : cands)
  // 過渡 / 棄一格:「單張 + 1 鬼」,沒鬼才出純單張(§11.3)
  const transitions = cands.filter((c) => isTransition(c) && c.jokers === Math.min(1, J))
  const plays = prefer(cands.filter((c) => !isTransition(c)))
  const done = transitionsDone(state, me)

  if (pd >= SLOT_COUNT - 2) {
    // 後期:不送 —— 還有別的出法就不出單張、也不出「單張 + 鬼」過渡
    pool = plays
  } else if (rt.main === 'attack') {
    // 強攻:有牌就出;前期湊得出三條以上就不出小牌。中期這手湊不出大牌(三條以下都算差)、而棄一格後
    // 下一手有機會出鐵支 / 同花順 → 棄一格(整局最多 1 次)
    const weak = !cands.some((c) => c.value >= BIG)
    let drop: Cand[] = []
    if (pd >= 2 && done < 1 && weak && transitions.length) {
      const draws = sampleNextDraws(state, me, rng, 24)
      const chance = (t: Cand) => {
        const rest = reals.filter((x) => !t.reals.includes(x))
        const hits = draws.filter((d) => {
          const nj = Math.min(cap, J - t.jokers + d.filter(isJoker).length)
          return potential([...rest, ...d.filter((c) => !isJoker(c) && !isBlank(c))], nj, 1, cap) >= BIG
        }).length
        return hits / draws.length
      }
      // 棄哪張:下一手出大牌機會最高的那種棄法(不拆三條 / 同花順核心)
      const scored = transitions.map((t) => ({ t, p: chance(t) }))
      const bestP = Math.max(...scored.map((s) => s.p))
      if (bestP >= BIG_NEXT_CHANCE) drop = scored.filter((s) => s.p === bestP).map((s) => s.t)
    }
    if (drop.length) pool = drop
    else if (pd < 2) pool = prefer(cands.filter((c) => c.value >= CAT_VALUE[CATEGORY.THREE_KIND]))
    else pool = plays
  } else if (rt.main === 'balance') {
    // 平衡:有好牌就出、沒好牌就過渡(整局最多 2 次);好牌看比分(§11.3)
    const mine = countCoins(state, me)
    const theirs = countCoins(state, foe)
    const good = (c: Cand) =>
      mine < theirs
        ? c.value >= CAT_VALUE[CATEGORY.THREE_KIND]
        : mine === theirs
          ? c.value >= BIG
          : c.cat === CATEGORY.STRAIGHT_FLUSH || (c.cat === CATEGORY.FOUR_KIND && c.top >= 13)
    const goods = cands.filter((c) => !isTransition(c) && good(c))
    if (goods.length) pool = goods
    else if (done < 2 && transitions.length) pool = transitions
    else pool = plays
  } else if (pd === 0) {
    // 囤牌第 1 手:預設送「單張 + 1 鬼」,除非牌很好(1 鬼內就有鐵支 / 同花順)
    const great = cands.some((c) => c.jokers <= 1 && c.value >= BIG)
    if (!great && transitions.length) {
      pool = transitions
      w = 1.2
    }
  }
  // 手上有鬼就不出純單張(白送一格);真的只剩單張可出才出
  const noBare = pool.filter((c) => !(c.reals.length === 1 && c.jokers === 0))
  if (J > 0 && noBare.length) pool = noBare

  const score = (c: Cand) => {
    const restReals = reals.filter((x) => !c.reals.includes(x))
    const restJ = J - c.jokers + future.jokers
    const waste = Math.max(0, restJ - cap * after)
    return c.value + w * potential(restReals, Math.min(restJ, cap * after), after, cap) - WASTE_COST * waste
  }
  let pick = pool[0]
  let top = -Infinity
  for (const c of pool) {
    const s = score(c)
    if (s > top) {
      top = s
      pick = c
    }
  }
  return pileOf(pick)
}

// ---- 空城計(§11.5c 第二版) ----------------------------------------------------
//
// 真牌只有 7~A、一人約 16 張分 7 手 → 真牌是稀缺資源,要講 CP 值:三條最划算、對子堪用、
// 鐵支 / 5 張大牌除非不得已都算浪費(撞到一張空白就虧大)。空白只拿來送格和墊張數詐唬。
// 手牌先拆成「資產」(三條 / 對子 / 鐵支),沒資產就送全空白;墊空白看這手的強弱。

/** 強對子 = J~A;弱對子 = 7~10(§11.5c)。 */
const STRONG_PAIR = 11

/**
 * 空城計各牌型的價值(排序 / 合併 / 最後兩手比較用):跟比牌大小同順序,三條以下照 CP 拉開;
 * 單張只有 K / A 有一點用,全空白 0。
 */
const blankValue: ValueFn = (cat, top) => {
  switch (cat) {
    case CATEGORY.STRAIGHT_FLUSH:
      return 10
    case CATEGORY.FOUR_KIND:
      return 9.5 + (top - 7) * 0.03
    case CATEGORY.FULL_HOUSE:
      return 9.3
    case CATEGORY.FLUSH:
      return 9.1
    case CATEGORY.STRAIGHT:
      return 8.9
    case CATEGORY.THREE_KIND:
      return 8 + (top - 7) * 0.1
    case CATEGORY.TWO_PAIR:
      return 7 + (top - 7) * 0.05
    case CATEGORY.PAIR:
      return top >= STRONG_PAIR ? 5 + (top - STRONG_PAIR) * 0.4 : 3 + (top - 7) * 0.4
    case CATEGORY.HIGH_CARD:
      return top >= 13 ? 1 + (top - 13) * 0.5 : 0.1 * Math.max(0, top - 6)
    default:
      return 0
  }
}

/** 一個資產:這疊牌(含補上的鬼)與它的牌型。 */
export interface BlankAsset {
  cards: Card[]
  cat: number
  top: number
  value: number
}
const assetOf = (cards: Card[]): BlankAsset => {
  const v = evaluate(cards)
  const top = v.rankSeq[0] ?? 0
  return { cards, cat: v.category, top, value: blankValue(v.category, top) }
}

/** 鐵支怎麼處理(使用者習慣:留 50% / 拆三條 30% / 拆兩個對子 20%);同一局同一組只決定一次(用 seed)。 */
function quadsPlan(seed: number, rank: number): 'keep' | 'trips' | 'pairs' {
  const r = mulberry32((seed ^ Math.imul(rank, 0x9e3779b1)) >>> 0)()
  return r < 0.5 ? 'keep' : r < 0.8 ? 'trips' : 'pairs'
}

/**
 * 手牌拆成資產(§11.5c 第 1 點):三條 / 對子 / 鐵支;鬼補最弱的對子成三條,沒對子就留著;
 * 資產比剩下的手數多(真牌多到用不完)→ 最弱的兩個併起來(兩對、葫蘆)。
 */
export function blankAssets(seed: number, hand: Card[], handsLeft: number): { assets: BlankAsset[]; singles: Card[]; spare: Card[] } {
  const reals = hand.filter((c) => !isJoker(c) && !isBlank(c))
  const spare = hand.filter(isJoker)
  let assets: BlankAsset[] = []
  const singles: Card[] = []
  for (const g of groupBy(reals, (c) => c.rank).values()) {
    if (g.length >= 4) {
      const plan = quadsPlan(seed, g[0].rank)
      if (plan === 'keep') assets.push(assetOf(g.slice(0, 4)))
      else if (plan === 'trips') {
        assets.push(assetOf(g.slice(0, 3)))
        singles.push(g[3])
      } else assets.push(assetOf(g.slice(0, 2)), assetOf(g.slice(2, 4)))
    } else if (g.length >= 2) assets.push(assetOf(g))
    else singles.push(g[0])
  }
  while (spare.length) {
    const pairs = assets.filter((a) => a.cat === CATEGORY.PAIR)
    if (!pairs.length) break
    const to = pairs.reduce((b, a) => (T.jokerTo === 'weakest' ? a.value < b.value : a.value > b.value) ? a : b)
    assets = assets.map((a) => (a === to ? assetOf([...a.cards, spare.shift()!]) : a))
  }
  // 真牌多到用不完:最弱的兩個(≤ 3 張的)併起來,超過 5 張的挑最大的 5 張、其餘變單張
  while (assets.length > handsLeft) {
    const small = assets.filter((a) => a.cards.length <= 3).sort((a, b) => a.value - b.value)
    if (small.length < 2) break
    const cards = [...small[0].cards, ...small[1].cards]
    const keep = cards.length > 5 ? biggestPile(cards, 5, compareHands) : cards
    singles.push(...cards.filter((c) => !keep.includes(c)))
    assets = [...assets.filter((a) => a !== small[0] && a !== small[1]), assetOf(keep)]
  }
  return { assets, singles: singles.sort((a, b) => a.rank - b.rank), spare }
}

/** 送格:全空白(或「最小落單單張 + 空白」裝大)。桌上自己已經送了幾格(看牌堆算)。 */
function sacrificesDone(state: GameState, me: PlayerId): number {
  return state.slots.filter((s) => {
    const p = s[me]
    return p.length > 0 && !p.some(isJoker) && p.filter((c) => !isBlank(c)).length <= 1
  }).length
}

/**
 * 空城計可調參數(§11.5c;2026-10-30 模擬 BLANK=1 調過:先出弱的資產 −4%、不墊 −3%、三條 / 弱對多墊 +2%,
 * 強對子墊不墊差不到 1% → 照使用者直覺少墊)。集中在這裡,模擬可以暫時改來比較。
 *  - order:主策略先出強的 / 中間 / 弱的資產
 *  - realsPerAsset:之後補牌大概能湊出幾個資產 =(之後補到的真牌 + 落單單張 × 0.5)÷ 這個數
 *  - sacNeed:差額 ≥ 這個數才先送格(強攻 Infinity = 有資產就出)
 *  - maxSac:整局最多送幾格(7 格要拿 4 格)
 *  - jokerTo:鬼補最弱 / 最強的對子
 *  - pad*:墊空白機率表 [不墊, 墊 1, 墊 2];sacCount:全空白送格 1~5 張的機率
 *  - bigBluff:送格改用「最小落單單張 + 3~4 空白」裝大的機率;stylePad:三條墊空白機率再乘這個
 */
export const BLANK_TUNE = {
  order: { attack: 'strong', balance: 'strong', hoard: 'mid' } as Record<BossRuntime['main'], 'strong' | 'mid' | 'weak'>,
  realsPerAsset: 2.5,
  sacNeed: { attack: Infinity, balance: 1, hoard: 0.5 } as Record<BossRuntime['main'], number>,
  maxSac: 3,
  jokerTo: 'weakest' as 'weakest' | 'strongest',
  padTrips: [0.3, 0.5, 0.2],
  padTwoPair: [0.8, 0.2],
  padStrongPair: [0.85, 0.15],
  padWeakPair: [0.3, 0.7],
  sacCount: [0.35, 0.3, 0.25, 0.07, 0.03],
  bigBluff: { attack: 0.08, balance: 0.1, hoard: 0.15 } as Record<BossRuntime['main'], number>,
  stylePad: { attack: 1.3, balance: 1, hoard: 0.9 } as Record<BossRuntime['main'], number>,
  /** 前 hands 手、還沒送過格時,每手有 p 的機率先送 2~3 張全空白(§11.5e) */
  earlySac: { hands: 2, p: { attack: 0.25, balance: 0.2, hoard: 0.2 } as Record<BossRuntime['main'], number> },
  /** 最好的資產只是弱對子 / 沒有,又湊得出順子以上時,直接出那手的機率(§11.5e) */
  smallBig: { attack: 0.75, balance: 0.65, hoard: 0.55 } as Record<BossRuntime['main'], number>,
  // 看棋盤(§11.5d)
  board: true,
  /** 看未來比重(強攻低、囤牌高;2026-10-30 模擬:×0.6 → −4%、×1.4 → +1%) */
  gamma: { attack: 0.98, balance: 1.19, hoard: 1.4 } as Record<BossRuntime['main'], number>,
  /** 模擬對手放牌抽幾次 */
  samples: 12,
  /** 每用一張空白扣的分(空白也是之後詐唬的本錢) */
  blankCost: 0.03,
  /** 分數加一點隨機,不要每次同一個局面都出一樣的 */
  noise: 0.05,
  /** 送格那手之後大概拿下格子的機率(算「這格送掉」的價值) */
  sacWin: 0.04,
}
const T = BLANK_TUNE

/** 這手怎麼出(第一層);honest = 照實出、不墊(失手)。 */
type BlankPlan = { core: Card[]; kind: 'asset' | 'sacrifice' | 'bluff' | 'last' | 'board'; honest?: boolean }

function blankPick(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng, opts: LimitedPickOpts): Card[] {
  const hand = state.hands[me]
  const blanks = hand.filter(isBlank)
  const plan = blankPlan(state, me, rt, rng)
  if (!plan.core.length && !blanks.length) return [lowestReal(hand)] // 只剩真牌時才會走到(理論上不會)
  if (plan.honest || opts.noPad) return plan.core.filter((c) => !isBlank(c)).length ? plan.core.filter((c) => !isBlank(c)) : blanks.slice(0, 1)
  if (plan.kind === 'board') return plan.core // 看棋盤已經連空白一起挑好
  return padBlanks(state, me, plan, blanks, rt, rng)
}
const lowestReal = (hand: Card[]): Card => [...hand].sort((a, b) => (isBlank(a) ? 1 : 0) - (isBlank(b) ? 1 : 0) || a.rank - b.rank)[0]

/** 第一層:真牌(含鬼)出哪幾張;core 空 = 全空白送格。 */
function blankPlan(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng): BlankPlan {
  const hand = state.hands[me]
  const reals = hand.filter((c) => !isJoker(c) && !isBlank(c))
  const jokers = hand.filter(isJoker)
  const hasBlank = hand.some(isBlank)
  const J = jokers.length
  const pd = state.placementsDone[me]
  const left = SLOT_COUNT - pd
  const foe = otherPlayer(me)
  const nonBlank = [...reals, ...jokers]

  // 最後一手:真牌全部塞進最大的一疊(張數多的踢腳贏)
  if (left <= 1) return { core: nonBlank.length ? biggestPile(nonBlank, 5, compareHands) : [], kind: 'last' }
  if (!nonBlank.length) return { core: [], kind: 'sacrifice' }

  const cands = (rs: Card[], j: number) => candidates(rs, j, j, blankValue)
  const pileOf = (c: Cand) => [...c.reals, ...jokers.slice(0, c.jokers)]
  const biggest = (cs: Cand[]) => cs.reduce((b, c) => (c.value > b.value ? c : b), cs[0])
  const { assets, singles } = blankAssets(state.seed, hand, left)
  const sacrifice = (): BlankPlan => {
    if (!hasBlank) return { core: [singles[0] ?? lowestReal(nonBlank)], kind: 'sacrifice' }
    // 偶爾「最小的落單單張 + 空白」裝大(§11.5c 第 3 點);只用沒用的單張
    if (singles.length && rng() < T.bigBluff[rt.main]) return { core: [singles[0]], kind: 'bluff' }
    return { core: [], kind: 'sacrifice' }
  }

  // 差一格就分勝負(誰都一樣):真牌出最強的(大牌也可以),空白照墊
  if (atMatchPoint(state, foe) || atMatchPoint(state, me)) {
    const all = cands(reals, J)
    let pick = biggest(all)
    // 最大是兩對 → 改出最大的一對(使用者 10/30:4 張容易被三條撞、被詐唬棄掉,之後就無力了)
    if (pick.cat === CATEGORY.TWO_PAIR) pick = biggest(all.filter((c) => c.cat === CATEGORY.PAIR))
    return { core: pileOf(pick), kind: 'asset' }
  }

  // 執行力失手:照實出最划算的一手 —— 最強的資產,不墊、不看以後;沒資產就 1 張空白
  if (rng() >= rt.execution) {
    if (!assets.length) return { core: hasBlank ? [] : [singles[0] ?? lowestReal(nonBlank)], kind: 'sacrifice', honest: true }
    return { core: assets.reduce((b, a) => (a.value > b.value ? a : b)).cards, kind: 'asset', honest: true }
  }

  // 最後兩手:大牌可以出 —— 窮舉這手 + 下一手最大的組合,總價值最高的(空白送格也算一種)
  if (left === 2) {
    const all = cands(reals, J)
    if (hasBlank) all.push({ reals: [], jokers: 0, cat: CATEGORY.EMPTY, top: 0, value: 0 })
    const total = (c: Cand) => {
      const rest = cands(reals.filter((x) => !c.reals.includes(x)), J - c.jokers)
      return c.value + (rest.length ? biggest(rest).value : 0)
    }
    let pick = all[0]
    let top = -Infinity
    for (const c of all) {
      const s = total(c)
      if (s > top || (s === top && c.reals.length + c.jokers < pick.reals.length + pick.jokers)) {
        top = s
        pick = c
      }
    }
    return pick.reals.length + pick.jokers ? { core: pileOf(pick), kind: 'asset' } : sacrifice()
  }

  // 前期偶爾先送 2~3 張全空白,把真牌留到後面(使用者 10/30:強攻也不是第一手就攻,加點輪替)
  const blanks = hand.filter(isBlank)
  if (pd < T.earlySac.hands && blanks.length >= 3 && !sacrificesDone(state, me) && rng() < T.earlySac.p[rt.main]) {
    return { core: blanks.slice(0, Math.min(blanks.length - 1, rng() < 0.5 ? 2 : 3)), kind: 'board' }
  }
  // 最好的資產只是弱對子(或沒有),手上又湊得出順子以上 → 大機率直接出,確保拿一格(使用者 10/30:7 8 8 9 10 J)
  const bestAsset = assets.reduce((m, a) => Math.max(m, a.value), 0)
  if (bestAsset < blankValue(CATEGORY.PAIR, STRONG_PAIR)) {
    const big = cands(reals, J).filter((c) => c.cat >= CATEGORY.STRAIGHT && c.reals.length + c.jokers === 5)
    if (big.length && rng() < T.smallBig[rt.main]) return { core: pileOf(big.reduce((b, c) => (c.value < b.value ? c : b))), kind: 'board' }
  }

  if (T.board) return boardPlan(state, me, rt, rng, assets, singles, left)
  if (!assets.length) return sacrifice()

  // 夠不夠出滿剩下的手數:不夠的差額 = 要送幾格;什麼時候送看主策略
  const futureReals = futureOf(state, me, (c) => !isBlank(c), 34).hits
  const need = left - assets.length - (futureReals + singles.length * 0.5) / T.realsPerAsset
  const done = sacrificesDone(state, me)
  const canSac = done < T.maxSac
  const strong = assets.some((a) => a.cat >= CATEGORY.THREE_KIND)
  // 平衡:領先 / 平手又沒三條以上才送;囤牌:前五手差額夠就送;強攻:有資產就出
  let sac = canSac && need >= T.sacNeed[rt.main] && pd < SLOT_COUNT - 2
  if (rt.main === 'balance') sac &&= countCoins(state, me) >= countCoins(state, foe) && !strong
  if (sac) return sacrifice()

  const sorted = [...assets].sort((a, b) => b.value - a.value)
  const order = T.order[rt.main]
  const pick = order === 'strong' ? sorted[0] : order === 'weak' ? sorted[sorted.length - 1] : sorted[Math.floor((sorted.length - 1) / 2)]
  return { core: pick.cards, kind: 'asset' }
}

/**
 * 看棋盤(§11.5d):每個候選(資產 × 墊 0~2、送格 1~3 張全空白、單張 + 3 空白裝大)
 * → 模擬對手會把它放哪格、這手期望多少 + 看未來 × 剩下資產之後的價值 − 空白成本,挑最高的。
 */
function boardPlan(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng, assets: BlankAsset[], singles: Card[], left: number): BlankPlan {
  const hand = state.hands[me]
  const blanks = hand.filter(isBlank)
  const quota = (blanks.length + futureOf(state, me, isBlank, 22).hits) / left
  const budget = Math.min(blanks.length, Math.max(1, Math.ceil(quota * 2)))
  const opts: { pile: Card[]; used: BlankAsset | null; spent: number }[] = []
  for (const a of assets) {
    // 鐵支 / 5 張大牌不墊;強對子最多墊 1(使用者 10/30)
    const strongPair = a.cat === CATEGORY.PAIR && a.top >= STRONG_PAIR
    const maxPad = a.cards.length >= 4 ? 0 : Math.min(budget, strongPair ? 1 : 2, 5 - a.cards.length)
    for (let p = 0; p <= maxPad; p++) opts.push({ pile: [...a.cards, ...blanks.slice(0, p)], used: a, spent: p })
  }
  if (blanks.length && (sacrificesDone(state, me) < T.maxSac || !assets.length)) {
    for (let k = 1; k <= Math.min(3, budget); k++) opts.push({ pile: blanks.slice(0, k), used: null, spent: k })
    // 裝大(單張 + 3 空白)只偶爾列進候選(使用者:可保留,但不要常出)
    if (singles.length && budget >= 3 && rng() < T.bigBluff[rt.main]) opts.push({ pile: [singles[0], ...blanks.slice(0, 3)], used: null, spent: 3 })
  }
  if (!opts.length) return { core: [singles[0] ?? lowestReal(hand)], kind: 'sacrifice' }

  // 之後補牌大概會多出幾個資產 → 現有資產只要撐剩下的格子
  const futureAssets = futureOf(state, me, (c) => !isBlank(c), 34).hits / T.realsPerAsset
  const slotsForRest = Math.max(0, Math.round(left - 1 - futureAssets))
  const wp = new Map(assets.map((a) => [a, blankStrength(a.cards)]))
  const future = (used: BlankAsset | null) =>
    assets
      .filter((a) => a !== used)
      .map((a) => wp.get(a)!)
      .sort((x, y) => y - x)
      .slice(0, slotsForRest)
      .reduce((s, p) => s + 2 * (p - T.sacWin), 0)
  const now = blankBoardScores(state, me, opts.map((o) => o.pile), T.samples, rng)
  let best = 0
  let top = -Infinity
  opts.forEach((o, k) => {
    const s = now[k] + T.gamma[rt.main] * future(o.used) - T.blankCost * o.spent + rng() * T.noise
    if (s > top) {
      top = s
      best = k
    }
  })
  return { core: opts[best].pile, kind: 'board' }
}
/** 照機率表抽墊幾張;k 放大「有墊」的機率(boss 詐唬個性 / 主策略)。 */
function rollPad(table: number[], k: number, rng: Rng): number {
  const p = table.map((x, i) => (i ? x * k : 0))
  p[0] = Math.max(0, 1 - p.slice(1).reduce((s, x) => s + x, 0))
  let u = rng() * p.reduce((s, x) => s + x, 0)
  for (let i = 0; i < p.length; i++) if ((u -= p[i]) < 0) return i
  return 0
}

/**
 * 第二層:墊幾張空白(§11.5c 第 5 點)。三條 / 對子照機率表,鐵支和 5 張大牌不墊;
 * 送格出 1~5 張全空白;空白有預算:一次最多花平均配額的 2 倍(最後一手不限)。
 */
function padBlanks(state: GameState, me: PlayerId, plan: BlankPlan, blanks: Card[], rt: BossRuntime, rng: Rng): Card[] {
  const core = plan.core
  const pd = state.placementsDone[me]
  const left = SLOT_COUNT - pd
  const room = 5 - core.length
  const quota = (blanks.length + futureOf(state, me, isBlank, 22).hits) / left
  const maxSpend = Math.min(blanks.length, room, left <= 1 ? 5 : Math.max(1, Math.ceil(quota * 2)))
  const bluffK = 0.7 + (0.6 * rt.profile.bluff) / 100 // boss 詐唬個性高的多墊一點
  let want: number
  if (plan.kind === 'bluff') want = rng() < 0.5 ? 3 : 4
  else if (!core.length) want = 1 + rollPad(T.sacCount, 1, rng)
  else {
    const v = evaluate(core)
    const cat = v.category
    const top = v.rankSeq[0] ?? 0
    if (cat === CATEGORY.THREE_KIND) want = rollPad(T.padTrips, bluffK * T.stylePad[rt.main], rng)
    else if (cat === CATEGORY.TWO_PAIR) want = rollPad(T.padTwoPair, bluffK, rng)
    else if (cat === CATEGORY.PAIR) want = rollPad(top >= STRONG_PAIR ? T.padStrongPair : T.padWeakPair, bluffK, rng)
    else want = 0
  }
  const spend = Math.max(core.length ? 0 : 1, Math.min(want, maxSpend))
  return [...core, ...blanks.slice(0, spend)]
}
