import type { Card, Rank, Suit } from './cards'
import { SUIT_ORDER, isBlank, isJoker } from './cards'

/**
 * Poker hand evaluation for a pile of 1–5 cards (the pile IS the hand — no
 * "best 5 of 7"). Straights/flushes require exactly 5 cards; fewer cards can
 * only make quads/trips/pairs/high-card. Ties broken by suit
 * (Spades > Hearts > Diamonds > Clubs).
 */

export const CATEGORY = {
  EMPTY: -1, // no scoring cards at all (a pile of only blanks) — loses to any real hand
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  THREE_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8,
} as const

export const CATEGORY_NAME_ZH: Record<number, string> = {
  8: '同花順',
  7: '鐵支',
  6: '葫蘆',
  5: '同花',
  4: '順子',
  3: '三條',
  2: '兩對',
  1: '對子',
  0: '高牌',
  [-1]: '無牌型',
}

export interface HandValue {
  category: number
  /** group-ordered rank sequence used for comparison */
  rankSeq: number[]
  /** matching suit-order sequence for the final tiebreak */
  suitSeq: number[]
  name: string
  /** if the pile held a joker, the concrete card it became (for showdown reveal) */
  wildAs?: Card
  /** 限定房一格多張鬼牌時,每張鬼牌各變成什麼(依序)。只有 ≥2 張鬼牌才有;1 張照舊看 wildAs。 */
  wildsAs?: Card[]
}

// Every concrete card the joker may become (all 52; duplicates of in-play cards
// ARE allowed — that's what makes true ties possible, SPEC §2.2/§2.3).
const ALL_SUITS: Suit[] = ['S', 'H', 'D', 'C']
const ALL_RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]

/**
 * Evaluate a pile (SPEC §3.2). Blanks are removed (ignored in comparison but
 * they still padded the visible count elsewhere); a joker is resolved to the
 * single card that maximises the pile's hand, recorded in `wildAs`. A pile with
 * no scoring cards (all blanks) evaluates to CATEGORY.EMPTY.
 */
export function evaluate(cards: Card[]): HandValue {
  const reals = cards.filter((c) => !isBlank(c) && !isJoker(c))
  const jokers = cards.filter(isJoker).length // 一般房最多一張;限定房(百鬼夜行/撲朔迷離)可以好幾張

  if (jokers === 0) return evaluateConcrete(reals)
  if (jokers >= 2) return evaluateMultiWild(reals, jokers)

  let best: HandValue | null = null
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      const wildAs: Card = { id: `wild${suit}${rank}`, suit, rank }
      const hv = evaluateConcrete([...reals, wildAs])
      if (best === null || compareValue(hv, best) > 0) best = { ...hv, wildAs }
    }
  }
  return best!
}

/** 鬼牌變成 suit+rank 的那張牌(id 只是佔位,不會跟真牌撞)。 */
const wildCard = (suit: Suit, rank: Rank): Card => ({ id: `wild${suit}${rank}`, suit, rank })

/**
 * 一格 ≥2 張鬼牌(限定房 LIMITED-ROOM-SPEC §4.1):每張鬼牌各自變成讓這格最大的牌,可以重複。
 * 不暴力窮舉 52^k,而是只試「有用的」值,結果跟窮舉一樣(測試有對拍):
 *  - 5 張牌時,每個順子窗口都試一次(正牌點數不重複、都落在窗口內 → 鬼牌補缺)。
 *  - 其餘牌型(鐵支/葫蘆/同花/三條/兩對/對子)鬼牌只會想變成「正牌有的點數」或 A、K
 *    (K 是鐵支 A 的踢腳:五張同點數不是牌型)。
 *  - 花色只影響同花:正牌全同一花色 X → 試 X 和 ♠;否則只試 ♠。
 */
function evaluateMultiWild(reals: Card[], k: number): HandValue {
  const n = reals.length + k
  const suitsOfReals = new Set(reals.map((c) => c.suit))
  const onlySuit = suitsOfReals.size === 1 ? reals[0].suit : null
  const suits: Suit[] = onlySuit && onlySuit !== 'S' ? [onlySuit, 'S'] : ['S']

  const top: { hv: HandValue | null; wilds: Card[] } = { hv: null, wilds: [] }
  const tryHand = (wilds: Card[]) => {
    const hv = evaluateConcrete([...reals, ...wilds])
    if (top.hv === null || compareValue(hv, top.hv) > 0) {
      top.hv = hv
      top.wilds = wilds
    }
  }

  // 順子 / 同花順:每個窗口(A 高到 A 低)
  if (n === 5) {
    const realRanks = reals.map((c) => c.rank as number)
    if (new Set(realRanks).size === realRanks.length) {
      for (let hi = 14; hi >= 5; hi--) {
        const window = hi === 5 ? [14, 2, 3, 4, 5] : [hi, hi - 1, hi - 2, hi - 3, hi - 4]
        if (!realRanks.every((r) => window.includes(r))) continue
        const missing = window.filter((r) => !realRanks.includes(r)) as Rank[]
        for (const s of suits) tryHand(missing.map((r) => wildCard(s, r)))
      }
    }
  }

  // 其他牌型:鬼牌值從候選裡挑(可重複,鬼牌彼此等價 → 只列不遞減的組合)
  const ranks = [...new Set<Rank>([...reals.map((c) => c.rank), 14, 13])]
  const values: Card[] = []
  for (const s of suits) for (const r of ranks) values.push(wildCard(s, r))
  const pick: Card[] = []
  const walk = (from: number) => {
    if (pick.length === k) return tryHand([...pick])
    for (let i = from; i < values.length; i++) {
      pick.push(values[i])
      walk(i)
      pick.pop()
    }
  }
  walk(0)

  return { ...top.hv!, wildAs: top.wilds[0], wildsAs: top.wilds }
}

/** 限定房比牌是在第幾步分出勝負的(攤牌多跳一行說明用)。 */
export type LimitedTieStep = 'jokers' | 'rank' | 'suit' | 'tie'

/**
 * 限定房(百鬼夜行 / 撲朔迷離)的比牌,LIMITED-ROOM-SPEC §4.2 決勝五步:
 *  1 牌型 → 2 點數(含踢腳,張數多的贏)→ 3 鬼牌少的贏 → 4 正牌點數由大到小 →
 *  5 正牌花色(依牌型順序)→ 平手。
 * 回傳 cmp(>0 = a 贏)和 by:由第 3 步之後分出的才有(= 「牌一樣大」)。
 * 一般房 / 特殊房仍用 compareValue,這支只在限定房用。
 */
export function compareLimited(a: Card[], b: Card[]): { cmp: number; by?: LimitedTieStep } {
  return compareLimitedWith(a, evaluate(a), b, evaluate(b))
}
/** 同 compareLimited,但兩邊已經 evaluate 過(人機模擬同一疊要比很多次,鬼牌估值很貴)。 */
export function compareLimitedWith(a: Card[], va: HandValue, b: Card[], vb: HandValue): { cmp: number; by?: LimitedTieStep } {
  if (va.category !== vb.category) return { cmp: va.category - vb.category }
  const len = Math.min(va.rankSeq.length, vb.rankSeq.length)
  for (let i = 0; i < len; i++) {
    if (va.rankSeq[i] !== vb.rankSeq[i]) return { cmp: va.rankSeq[i] - vb.rankSeq[i] }
  }
  if (va.rankSeq.length !== vb.rankSeq.length) return { cmp: va.rankSeq.length - vb.rankSeq.length }

  // 一樣大 → 鬼牌少的贏
  const ja = a.filter(isJoker).length
  const jb = b.filter(isJoker).length
  if (ja !== jb) return { cmp: jb - ja, by: 'jokers' }

  // 鬼牌一樣多 → 比正牌:點數由大到小,再比花色(依牌型順序)
  const ra = realOrder(a, va)
  const rb = realOrder(b, vb)
  const da = [...ra.map((x) => x.r)].sort((x, y) => y - x)
  const db = [...rb.map((x) => x.r)].sort((x, y) => y - x)
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] !== db[i]) return { cmp: da[i] - db[i], by: 'rank' }
  }
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    if (ra[i].s !== rb[i].s) return { cmp: ra[i].s - rb[i].s, by: 'suit' }
  }
  return { cmp: 0, by: 'tie' }
}

/** 一格裡的正牌,照它在牌型裡的順序排(同點數多的群在前 → 點數大 → 花色大;順子照順序),
 *  r = 它在牌型裡的點數(A2345 的 A 算 1)、s = 花色大小。 */
function realOrder(cards: Card[], v: HandValue): { r: number; s: number }[] {
  const reals = cards.filter((c) => !isBlank(c) && !isJoker(c))
  const straight = v.category === CATEGORY.STRAIGHT || v.category === CATEGORY.STRAIGHT_FLUSH
  const wheel = straight && v.rankSeq[0] === 5
  const sr = (r: number) => (wheel && r === 14 ? 1 : r)
  const count = new Map<number, number>()
  for (const r of v.rankSeq) count.set(r, (count.get(r) ?? 0) + 1)
  return reals
    .map((c) => ({ r: sr(c.rank), s: SUIT_ORDER[c.suit] }))
    .sort((x, y) => (straight ? 0 : (count.get(y.r) ?? 0) - (count.get(x.r) ?? 0)) || y.r - x.r || y.s - x.s)
}

/** Evaluate a pile of 0–5 concrete cards (no blanks, no jokers). */
export function evaluateConcrete(cards: Card[]): HandValue {
  if (cards.length === 0) {
    return { category: CATEGORY.EMPTY, rankSeq: [], suitSeq: [], name: CATEGORY_NAME_ZH[CATEGORY.EMPTY] }
  }
  const n = cards.length
  const counts = new Map<number, number>()
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1)
  const distinctDesc = [...counts.keys()].sort((a, b) => b - a)

  const isFlush = n === 5 && cards.every((c) => c.suit === cards[0].suit)

  let isStraight = false
  let wheel = false // A-2-3-4-5, Ace plays low
  if (n === 5 && distinctDesc.length === 5) {
    const max = distinctDesc[0]
    const min = distinctDesc[4]
    if (max - min === 4) {
      isStraight = true
    } else if (distinctDesc[0] === 14 && distinctDesc[1] === 5 && distinctDesc[4] === 2) {
      isStraight = true
      wheel = true
    }
  }

  const countVals = [...counts.values()].sort((a, b) => b - a)

  let category: number = CATEGORY.HIGH_CARD
  if (isStraight && isFlush) category = CATEGORY.STRAIGHT_FLUSH
  else if (countVals[0] === 4) category = CATEGORY.FOUR_KIND
  else if (countVals[0] === 3 && countVals[1] === 2) category = CATEGORY.FULL_HOUSE
  else if (isFlush) category = CATEGORY.FLUSH
  else if (isStraight) category = CATEGORY.STRAIGHT
  else if (countVals[0] === 3) category = CATEGORY.THREE_KIND
  else if (countVals[0] === 2 && countVals[1] === 2) category = CATEGORY.TWO_PAIR
  else if (countVals[0] === 2) category = CATEGORY.PAIR

  // Straight rank helper (wheel Ace counts as 1).
  const srank = (r: number) => (wheel && r === 14 ? 1 : r)

  let ordered: Card[]
  if (category === CATEGORY.STRAIGHT || category === CATEGORY.STRAIGHT_FLUSH) {
    ordered = [...cards].sort(
      (a, b) => srank(b.rank) - srank(a.rank) || SUIT_ORDER[b.suit] - SUIT_ORDER[a.suit],
    )
  } else {
    ordered = [...cards].sort(
      (a, b) =>
        (counts.get(b.rank)! - counts.get(a.rank)!) ||
        b.rank - a.rank ||
        SUIT_ORDER[b.suit] - SUIT_ORDER[a.suit],
    )
  }

  const rankSeq = ordered.map((c) => srank(c.rank))
  const suitSeq = ordered.map((c) => SUIT_ORDER[c.suit])

  return { category, rankSeq, suitSeq, name: CATEGORY_NAME_ZH[category] }
}

/**
 * Compare two HandValues. >0 → a wins, <0 → b wins, 0 → exact tie.
 * Without jokers a single deck never ties (suit breaks it); a joker can
 * represent an already-in-play card, so 0 (a true tie) is now reachable — the
 * caller awards the coin to BOTH sides (SPEC §2.3).
 */
export function compareValue(a: HandValue, b: HandValue): number {
  if (a.category !== b.category) return a.category - b.category
  const len = Math.min(a.rankSeq.length, b.rankSeq.length)
  for (let i = 0; i < len; i++) {
    if (a.rankSeq[i] !== b.rankSeq[i]) return a.rankSeq[i] - b.rankSeq[i]
  }
  // Equal prefix but different length: the hand with more cards has extra
  // kickers and wins (a longer pile can only add, never subtract, value).
  if (a.rankSeq.length !== b.rankSeq.length) return a.rankSeq.length - b.rankSeq.length
  // Everything equal in rank → break by suit of the most significant cards.
  for (let i = 0; i < len; i++) {
    if (a.suitSeq[i] !== b.suitSeq[i]) return a.suitSeq[i] - b.suitSeq[i]
  }
  return 0
}

/** Compare two piles directly. >0 → a wins. */
export function compareHands(a: Card[], b: Card[]): number {
  return compareValue(evaluate(a), evaluate(b))
}
