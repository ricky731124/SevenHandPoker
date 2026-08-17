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
  const hasJoker = cards.some(isJoker) // invariant: at most one (each player holds one)

  if (!hasJoker) return evaluateConcrete(reals)

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
