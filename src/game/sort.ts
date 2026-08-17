import type { Card } from './cards'
import { SUIT_ORDER, isBlank, isJoker } from './cards'

export type SortMode = 'rank' | 'suit'
export type SortDir = 'desc' | 'asc'

/**
 * Placement keys for the off-deck blank/joker so their position never leaks what
 * they are (SPEC §2.2): the opponent can't see your sort mode, and the two cards
 * land in different spots under each mode.
 *  - by rank: blank = smallest (below 2), joker = largest (above A); flips with dir.
 *  - by suit: 梅C → 空白 → 方D → 心H → 鬼 → 桃S.
 */
function rankKey(c: Card): number {
  if (isBlank(c)) return 1 // below rank 2
  if (isJoker(c)) return 15 // above rank 14 (A)
  return c.rank
}
const SUIT_SORT_KEY: Record<string, number> = { C: 0, D: 2, H: 3, S: 5 }
function suitKey(c: Card): number {
  if (isBlank(c)) return 1 // between 梅C(0) and 方D(2)
  if (isJoker(c)) return 4 // between 心H(3) and 桃S(5)
  return SUIT_SORT_KEY[c.suit]
}

/** Stable sort of a hand for display. Does not mutate the input. */
export function sortHand(cards: Card[], mode: SortMode, dir: SortDir): Card[] {
  const sign = dir === 'desc' ? 1 : -1
  const out = [...cards]
  out.sort((a, b) => {
    if (mode === 'suit') {
      const sa = suitKey(a)
      const sb = suitKey(b)
      if (sa !== sb) return sign * (sb - sa)
      // same suit bucket (only normals reach here — specials have unique keys)
      return sign * (b.rank - a.rank)
    }
    // rank
    const ra = rankKey(a)
    const rb = rankKey(b)
    if (ra !== rb) return sign * (rb - ra)
    return sign * (SUIT_ORDER[b.suit] - SUIT_ORDER[a.suit])
  })
  return out
}
