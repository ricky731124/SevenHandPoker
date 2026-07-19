import type { Card } from './cards'
import { SUIT_ORDER } from './cards'

export type SortMode = 'rank' | 'suit'
export type SortDir = 'desc' | 'asc'

/** Stable sort of a hand for display. Does not mutate the input. */
export function sortHand(cards: Card[], mode: SortMode, dir: SortDir): Card[] {
  const sign = dir === 'desc' ? 1 : -1
  const out = [...cards]
  out.sort((a, b) => {
    if (mode === 'suit') {
      if (a.suit !== b.suit) return sign * (SUIT_ORDER[b.suit] - SUIT_ORDER[a.suit])
      return sign * (b.rank - a.rank)
    }
    // rank
    if (a.rank !== b.rank) return sign * (b.rank - a.rank)
    return sign * (SUIT_ORDER[b.suit] - SUIT_ORDER[a.suit])
  })
  return out
}
