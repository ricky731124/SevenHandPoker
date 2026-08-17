import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { makeBlank, makeJoker } from './cards'
import { sortHand } from './sort'

function c(s: string): Card {
  const suit = s[0] as Suit
  const r = s.slice(1)
  const rank = (r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r)) as Rank
  return { id: `${suit}${rank}`, suit, rank }
}
const ids = (cards: Card[]) => cards.map((x) => (x.kind === 'blank' ? '空' : x.kind === 'joker' ? '鬼' : x.id))

const blank = makeBlank('t')
const joker = makeJoker('t')

describe('sort placement of blank/joker (SPEC §2.2 anti-leak)', () => {
  const hand = [c('H7'), joker, c('S2'), blank, c('CK')]

  it('by rank ascending: blank first (smallest), joker last (largest)', () => {
    const out = sortHand(hand, 'rank', 'asc')
    expect(ids(out)[0]).toBe('空')
    expect(ids(out)[out.length - 1]).toBe('鬼')
    // real cards in between, ascending: 2 < 7 < K (ids are suit+rank number)
    expect(ids(out)).toEqual(['空', 'S2', 'H7', 'C13', '鬼'])
  })

  it('by rank descending: order flips — joker first, blank last', () => {
    const out = sortHand(hand, 'rank', 'desc')
    expect(ids(out)[0]).toBe('鬼')
    expect(ids(out)[out.length - 1]).toBe('空')
  })

  it('by suit ascending: 梅C → 空白 → 方D → 心H → 鬼 → 桃S', () => {
    const out = sortHand([c('S2'), c('H7'), c('D9'), c('CK'), blank, joker], 'suit', 'asc')
    expect(ids(out)).toEqual(['C13', '空', 'D9', 'H7', '鬼', 'S2'])
  })
})
