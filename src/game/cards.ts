/** Core card model shared by engine and UI. */

export type Suit = 'S' | 'H' | 'D' | 'C' // Spades > Hearts > Diamonds > Clubs
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 // 11=J 12=Q 13=K 14=A

export interface Card {
  id: string // e.g. 'S14'
  suit: Suit
  rank: Rank
}

/** Suit precedence for the final tiebreak (higher index = stronger). */
export const SUIT_ORDER: Record<Suit, number> = { C: 0, D: 1, H: 2, S: 3 }

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
export const SUIT_IS_RED: Record<Suit, boolean> = { S: false, H: true, D: true, C: false }

const RANK_LABEL: Record<number, string> = {
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
}
export function rankLabel(rank: Rank): string {
  return RANK_LABEL[rank] ?? String(rank)
}

export function cardId(suit: Suit, rank: Rank): string {
  return `${suit}${rank}`
}

/** Full ordered 52-card deck. */
export function makeDeck(): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C']
  const deck: Card[] = []
  for (const suit of suits) {
    for (let r = 2 as number; r <= 14; r++) {
      const rank = r as Rank
      deck.push({ id: cardId(suit, rank), suit, rank })
    }
  }
  return deck
}
