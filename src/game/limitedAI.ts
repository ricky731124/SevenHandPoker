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
import { hasPlaceTable, placeByTable, winsIfOwns } from './limitedPlace'
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
  /** 空城計:不墊空白(「不墊」分布表、直覺玩家基準) */
  noPad?: boolean
  /**
   * 空城計送格用哪種:全空白(預設;手上沒空白才送單張)/ 最小單張 / 兩種都列由分數決定。
   * 2026-10-29 模擬:只送全空白 vs 分數決定 55%(單張 7~9 拿下格子 0%、10~Q 9%,混小真牌幾乎偷不到)。
   */
  sacrifice?: 'score' | 'blank' | 'single'
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

// ---- 空城計(§11.5a) ----------------------------------------------------------
//
// 真牌只有 7~A、一人約 16 張分 7 手 → 真牌是稀缺資源;空白不用急著出,只拿來墊張數詐唬。
// 兩層:① 真牌出哪幾張(跟百鬼同一套:這手價值 + 看未來,價值表換空城計的)② 墊幾張空白。

/**
 * 空城計各牌型的價值 = 拿下一格的比例 × 10(2026-10-29 模擬 300 場):同花順 100%、鐵支 91%、葫蘆 89%、
 * 兩對 88%、三條 78%、同花 71%、順子 68%、對子 7~9 51% / 10~Q 58% / K、A 71%、
 * 單張 K、A 31% / 10~Q 7% / 7~9 1%、全空白 0%。
 */
const BLANK_CAT_VALUE: Record<number, number> = {
  [CATEGORY.STRAIGHT_FLUSH]: 10,
  [CATEGORY.FOUR_KIND]: 9.1,
  [CATEGORY.FULL_HOUSE]: 8.9,
  [CATEGORY.FLUSH]: 7.1,
  [CATEGORY.STRAIGHT]: 6.8,
  [CATEGORY.THREE_KIND]: 7.8,
  [CATEGORY.TWO_PAIR]: 8.8,
  [CATEGORY.PAIR]: 5.1,
  [CATEGORY.HIGH_CARD]: 0,
  [CATEGORY.EMPTY]: 0,
}
/** 單張幾乎只有 K、A 拿得到格子 */
const BLANK_HIGH = [0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 2.5, 3.5] // 7~A
const blankValue: ValueFn = (cat, top) =>
  cat === CATEGORY.EMPTY
    ? 0
    : cat === CATEGORY.HIGH_CARD
      ? BLANK_HIGH[Math.max(0, top - 7)]
      : BLANK_CAT_VALUE[cat] + ((top - 7) / 7) * (cat === CATEGORY.PAIR ? 2 : 0.5)

/** 送格:最多 1 張真牌、不帶鬼(最小單張 + 空白,或全空白)。 */
const isSacrifice = (c: { reals: Card[]; jokers: number }) => c.reals.length <= 1 && c.jokers === 0
/** 桌上自己已經送了幾格(看牌堆算)。 */
function sacrificesDone(state: GameState, me: PlayerId): number {
  return state.slots.filter((s) => {
    const p = s[me]
    return p.length > 0 && !p.some(isJoker) && p.filter((c) => !isBlank(c)).length <= 1
  }).length
}

/** 詐唬比例(§11.3):強牌墊滿(真大裝大)的機率、弱牌墊到 4~5 張(小牌裝大)的機率。 */
const P_BIG_PAD: Record<BossRuntime['main'], number> = { attack: 0.62, balance: 0.5, hoard: 0.5 }
const pSmallBig = (main: BossRuntime['main'], pd: number) => (main === 'attack' ? 0.3 : main === 'balance' ? 0.5 : pd < 2 ? 0.75 : 0.5)

function blankPick(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng, opts: LimitedPickOpts): Card[] {
  const hand = state.hands[me]
  const blanks = hand.filter(isBlank)
  const core = blankCore(state, me, rt, rng, opts)
  return padBlanks(state, me, core, blanks, rt, rng, opts)
}

/** 第一層:真牌(含鬼)出哪幾張;回傳空陣列 = 全空白送格。 */
function blankCore(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng, opts: LimitedPickOpts): Card[] {
  const hand = state.hands[me]
  const reals = hand.filter((c) => !isJoker(c) && !isBlank(c))
  const jokers = hand.filter(isJoker)
  const hasBlank = hand.some(isBlank)
  const J = jokers.length
  const pd = state.placementsDone[me]
  const left = SLOT_COUNT - pd
  const foe = otherPlayer(me)

  // 最後一手:真牌全部塞進最大的一疊(張數多的踢腳贏)
  if (left <= 1) return reals.length || J ? biggestPile([...reals, ...jokers], 5, compareHands) : []
  // 沒有真牌:有鬼出鬼(單張鬼 = A),沒有就全空白
  if (!reals.length) return J ? jokers.slice(0, 1) : []

  const cands = candidates(reals, J, J, blankValue)
  if (hasBlank && opts.sacrifice !== 'single') cands.push({ reals: [], jokers: 0, cat: CATEGORY.EMPTY, top: 0, value: 0 })
  const pileOf = (c: Cand) => [...c.reals, ...jokers.slice(0, c.jokers)]
  const nonSac = cands.filter((c) => !isSacrifice(c))
  const biggest = () => cands.reduce((b, c) => (c.value > b.value || (c.value === b.value && c.jokers < b.jokers) ? c : b), cands[0])

  // 差一格就贏(誰都一樣)/ 執行力失手:真牌出這手最大的(空白照墊,第二層處理)
  if (atMatchPoint(state, foe) || atMatchPoint(state, me)) return pileOf(biggest())
  if (rng() >= rt.execution) return pileOf(biggest())

  const sacMode = opts.sacrifice ?? 'blank'
  const allSacs = cands.filter(isSacrifice)
  const blankSacs = allSacs.filter((c) => c.reals.length === 0)
  const sacs = sacMode === 'blank' && blankSacs.length ? blankSacs : allSacs
  const plays = nonSac.length ? nonSac : cands
  const done = sacrificesDone(state, me)
  const strong = (c: Cand) => c.cat >= CATEGORY.THREE_KIND
  let w = FUTURE_WEIGHT[rt.main]
  let pool = cands

  if (pd >= SLOT_COUNT - 2) {
    pool = plays // 後期不送
  } else if (rt.main === 'attack') {
    pool = plays // 強攻:有牌就出
  } else if (rt.main === 'balance') {
    // 平衡:有好牌就出、沒好牌就送(最多 2 次);好牌看比分
    const mine = countCoins(state, me)
    const theirs = countCoins(state, foe)
    const good = (c: Cand) => (mine < theirs ? c.cat >= CATEGORY.PAIR : mine === theirs ? strong(c) || (c.cat === CATEGORY.PAIR && c.top >= 12) : strong(c))
    const goods = nonSac.filter(good)
    if (goods.length) pool = goods
    else if (done < 2 && sacs.length) pool = sacs
    else pool = plays
  } else {
    // 囤牌:第 1 手沒強牌就送;之後看分數(最多送 3 格)
    if (pd === 0 && !cands.some(strong) && sacs.length) {
      pool = sacs
      w = 1.2
    } else if (done >= 3) pool = plays
    else pool = [...nonSac, ...sacs]
  }
  if (!pool.length) pool = cands

  const after = left - 1
  const score = (c: Cand) => c.value + w * potential(reals.filter((x) => !c.reals.includes(x)), J - c.jokers, after, J, blankValue)
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

/**
 * 第二層:墊幾張空白(§11.5a)。強牌 → 真大裝大(墊到 5)/ 真大裝小(不墊);對子 → 隨機 0~2;
 * 弱牌 / 全空白 → 小牌裝大(墊到 4~5)/ 照實(0~1)。空白有預算:一次最多花平均配額的 2 倍。
 */
function padBlanks(state: GameState, me: PlayerId, core: Card[], blanks: Card[], rt: BossRuntime, rng: Rng, opts: LimitedPickOpts): Card[] {
  if (!blanks.length) return core
  if (opts.noPad) return core.length ? core : blanks.slice(0, 1)
  const pd = state.placementsDone[me]
  const left = SLOT_COUNT - pd
  const room = 5 - core.length
  const quota = (blanks.length + futureOf(state, me, isBlank, 22).hits) / left
  const maxSpend = Math.min(blanks.length, room, left <= 1 ? 5 : Math.max(1, Math.ceil(quota * 2)))
  const cat = core.length ? evaluate(core).category : CATEGORY.EMPTY
  const bluffK = 0.7 + (0.6 * rt.profile.bluff) / 100 // boss 詐唬個性高的多墊一點
  let want: number
  if (cat >= CATEGORY.THREE_KIND) want = rng() < P_BIG_PAD[rt.main] ? room : 0
  else if (cat >= CATEGORY.PAIR) want = Math.floor(rng() * 3)
  else if (rng() < Math.min(0.9, pSmallBig(rt.main, pd) * bluffK)) want = (rng() < 0.5 ? 4 : 5) - core.length
  else want = rng() < 0.5 ? 0 : 1
  const spend = Math.max(core.length ? 0 : 1, Math.min(want, maxSpend))
  return [...core, ...blanks.slice(0, spend)]
}
