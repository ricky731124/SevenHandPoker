import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { makeBlank, makeJoker } from './cards'
import { CATEGORY, compareHands, compareValue, evaluate } from './evaluate'

// Parse shorthand like "SA" "H10" "D2" "CK" -> Card
function c(s: string): Card {
  const suit = s[0] as Suit
  const r = s.slice(1)
  const rank = (r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r)) as Rank
  return { id: `${suit}${rank}`, suit, rank }
}
const h = (...ss: string[]) => ss.map(c)
const blank = () => makeBlank('t')
const joker = () => makeJoker('t')

describe('category detection by pile size', () => {
  it('single card = high card', () => {
    expect(evaluate(h('SA')).category).toBe(CATEGORY.HIGH_CARD)
  })
  it('two same rank = pair', () => {
    expect(evaluate(h('SA', 'HA')).category).toBe(CATEGORY.PAIR)
  })
  it('three same rank = three of a kind', () => {
    expect(evaluate(h('SA', 'HA', 'DA')).category).toBe(CATEGORY.THREE_KIND)
  })
  it('two pairs (4 cards) = two pair', () => {
    expect(evaluate(h('SA', 'HA', 'DK', 'CK')).category).toBe(CATEGORY.TWO_PAIR)
  })
  it('four same rank = four of a kind', () => {
    expect(evaluate(h('SA', 'HA', 'DA', 'CA')).category).toBe(CATEGORY.FOUR_KIND)
  })
  it('full house needs 5 cards (3+2)', () => {
    expect(evaluate(h('SA', 'HA', 'DA', 'CK', 'SK')).category).toBe(CATEGORY.FULL_HOUSE)
  })
})

describe('straight & flush require exactly 5 cards', () => {
  it('4 consecutive same suit is NOT a straight/flush → high card', () => {
    expect(evaluate(h('S5', 'S6', 'S7', 'S8')).category).toBe(CATEGORY.HIGH_CARD)
  })
  it('3 same suit is NOT a flush → high card', () => {
    expect(evaluate(h('S5', 'S9', 'SK')).category).toBe(CATEGORY.HIGH_CARD)
  })
  it('5 consecutive mixed suits = straight', () => {
    expect(evaluate(h('S5', 'H6', 'D7', 'C8', 'S9')).category).toBe(CATEGORY.STRAIGHT)
  })
  it('5 same suit non-consecutive = flush', () => {
    expect(evaluate(h('S2', 'S5', 'S9', 'SJ', 'SK')).category).toBe(CATEGORY.FLUSH)
  })
  it('5 same suit consecutive = straight flush', () => {
    expect(evaluate(h('S5', 'S6', 'S7', 'S8', 'S9')).category).toBe(CATEGORY.STRAIGHT_FLUSH)
  })
  it('wheel A-2-3-4-5 is a straight', () => {
    expect(evaluate(h('SA', 'H2', 'D3', 'C4', 'S5')).category).toBe(CATEGORY.STRAIGHT)
  })
})

describe('comparisons', () => {
  it('higher category wins regardless of ranks', () => {
    // pair of 2s beats ace-high
    expect(compareHands(h('S2', 'H2'), h('SA'))).toBeGreaterThan(0)
  })
  it('pair rank matters, not raw high card', () => {
    // pair of 3s beats pair of 2s + Ace kicker
    expect(compareHands(h('S3', 'H3'), h('S2', 'H2', 'DA'))).toBeGreaterThan(0)
  })
  it('more kickers win on equal prefix', () => {
    // pair of K with a kicker beats a lone pair of K
    expect(compareHands(h('SK', 'HK', 'D3'), h('DK', 'CK'))).toBeGreaterThan(0)
  })
  it('wheel loses to 6-high straight', () => {
    expect(compareHands(h('SA', 'H2', 'D3', 'C4', 'S5'), h('S2', 'H3', 'D4', 'C5', 'S6'))).toBeLessThan(0)
  })
  it('suit breaks an otherwise-equal pair (spades highest)', () => {
    // both pair of 7s + K kicker; A's 7-pair contains spades, B's does not
    const a = h('S7', 'H7', 'DK')
    const b = h('D7', 'C7', 'CK')
    expect(compareHands(a, b)).toBeGreaterThan(0)
  })
  it('high-card suit tiebreak on top card', () => {
    expect(compareHands(h('SK'), h('HK'))).toBeGreaterThan(0) // spade K > heart K
  })
  it('straight flush beats four of a kind', () => {
    expect(compareHands(h('S5', 'S6', 'S7', 'S8', 'S9'), h('SA', 'HA', 'DA', 'CA', 'S2'))).toBeGreaterThan(0)
  })
  it('full house beats flush', () => {
    expect(compareHands(h('SA', 'HA', 'DA', 'CK', 'SK'), h('S2', 'S5', 'S9', 'SJ', 'SK'))).toBeGreaterThan(0)
  })
})

describe('blank card (SPEC §2.2 / §3.2)', () => {
  it('is ignored in evaluation — [K,K,blank] is just a pair of K', () => {
    const v = evaluate([...h('SK', 'HK'), blank()])
    expect(v.category).toBe(CATEGORY.PAIR)
    expect(v.rankSeq).toEqual([13, 13]) // blank contributes no rank
  })
  it('does not create a hand — [K,K,blank] ties [K,K] with matching suits', () => {
    expect(compareValue(evaluate([...h('SK', 'HK'), blank()]), evaluate(h('SK', 'HK')))).toBe(0)
  })
  it('never turns four cards into a 5-card straight/flush', () => {
    // 4 to a straight flush + a blank is NOT a straight flush (only 4 real cards)
    const v = evaluate([...h('S3', 'S4', 'S5', 'S6'), blank()])
    expect(v.category).toBeLessThan(CATEGORY.STRAIGHT)
  })
  it('a lone blank pile loses to any real card', () => {
    expect(compareValue(evaluate([blank()]), evaluate(h('C2')))).toBeLessThan(0)
    expect(evaluate([blank()]).category).toBe(CATEGORY.EMPTY)
  })
  it('two lone-blank piles tie (both empty)', () => {
    expect(compareValue(evaluate([blank()]), evaluate([blank()]))).toBe(0)
  })
})

describe('joker / wild (SPEC §2.2 / §3.2)', () => {
  it('a lone joker becomes ♠A (highest single card)', () => {
    const v = evaluate([joker()])
    expect(v.category).toBe(CATEGORY.HIGH_CARD)
    expect(v.wildAs).toMatchObject({ suit: 'S', rank: 14 })
  })
  it('completes trips: [K,K,joker] → three of a kind', () => {
    expect(evaluate([...h('SK', 'HK'), joker()]).category).toBe(CATEGORY.THREE_KIND)
  })
  it('completes a straight flush: [♦3,4,5,6,joker] → becomes ♦7', () => {
    const v = evaluate([...h('D3', 'D4', 'D5', 'D6'), joker()])
    expect(v.category).toBe(CATEGORY.STRAIGHT_FLUSH)
    expect(v.wildAs).toMatchObject({ suit: 'D', rank: 7 })
  })
  it('maximises category — [K,K,joker] beats plain [A,A]', () => {
    expect(compareValue(evaluate([...h('SK', 'HK'), joker()]), evaluate(h('SA', 'HA')))).toBeGreaterThan(0)
  })
  it('a blank + joker together: blank ignored, lone joker → ♠A', () => {
    const v = evaluate([blank(), joker()])
    expect(v.category).toBe(CATEGORY.HIGH_CARD)
    expect(v.wildAs).toMatchObject({ suit: 'S', rank: 14 })
  })
})

describe('true tie via joker collision (SPEC §2.3)', () => {
  it('joker copies an in-play card → exact tie (compareValue 0)', () => {
    // one side plays ♠A, the other plays a joker (→ ♠A) → identical best hand
    expect(compareValue(evaluate(h('SA')), evaluate([joker()]))).toBe(0)
  })
  it('two lone jokers tie', () => {
    expect(compareValue(evaluate([joker()]), evaluate([joker()]))).toBe(0)
  })
})
