import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { CATEGORY, compareHands, evaluate } from './evaluate'

// Parse shorthand like "SA" "H10" "D2" "CK" -> Card
function c(s: string): Card {
  const suit = s[0] as Suit
  const r = s.slice(1)
  const rank = (r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r)) as Rank
  return { id: `${suit}${rank}`, suit, rank }
}
const h = (...ss: string[]) => ss.map(c)

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
