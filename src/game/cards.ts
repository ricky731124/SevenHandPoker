/** Core card model shared by engine and UI. */

export type Suit = 'S' | 'H' | 'D' | 'C' // Spades > Hearts > Diamonds > Clubs
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 // 11=J 12=Q 13=K 14=A

/**
 * Card kind. `normal` = one of the 52-deck cards. `blank` / `joker` are the
 * two off-deck cards each player holds at the start (SPEC §2.2): a blank pads
 * the visible count but is ignored when comparing hands; a joker is a pure wild
 * that, at showdown, becomes whatever single card maximises its pile's hand
 * type (a lone joker = ♠A). Their `suit`/`rank` are dummy placeholders that must
 * never be read — always branch on `kind` (or use isBlank/isJoker) first.
 */
export type CardKind = 'normal' | 'blank' | 'joker'

export interface Card {
  id: string // e.g. 'S14', or 'BLANK_p1' / 'JOKER_p2' for off-deck cards
  suit: Suit
  rank: Rank
  kind?: CardKind // undefined ⇒ 'normal'
  /**
   * If a suit-bloom special (踏雪尋梅/永恆鑽石/正中紅心/塊桃鴨) changed this
   * card's suit, the ORIGINAL suit before the change — so the showdown can reveal
   * "♣A→♠A" the same way a joker reveals "鬼牌→♠A" (SPEC §15). Absent otherwise
   * (never written as an undefined-valued key, so RTDB set() stays happy).
   */
  resuitFrom?: Suit
}

export const isBlank = (c: Card): boolean => c.kind === 'blank'
export const isJoker = (c: Card): boolean => c.kind === 'joker'
export const isSpecial = (c: Card): boolean => c.kind === 'blank' || c.kind === 'joker'

/** The off-deck blank/joker for a given player. Owner-tagged so ids stay unique game-wide. */
export function makeBlank(owner: string): Card {
  return { id: `BLANK_${owner}`, suit: 'C', rank: 2, kind: 'blank' }
}
export function makeJoker(owner: string): Card {
  return { id: `JOKER_${owner}`, suit: 'S', rank: 14, kind: 'joker' }
}

/** 開局發給玩家的那張空白/鬼牌(看 id,不看 kind)。之後若有模式把一般牌換成鬼牌/空白,
 *  那些牌 kind 也是 joker/blank,但不是「預設型」——爆破這類效果要能打到它們,所以用 id 判斷。 */
export const isStarterSpecial = (c: Card): boolean => /^(BLANK|JOKER)_p[12]$/.test(c.id)

/** 提示用的牌面文字:「♠K」「鬼牌」「空白牌」;沒有牌 → 「一張牌」。 */
export function cardFaceText(c: Card | undefined): string {
  if (!c) return '一張牌'
  if (c.kind === 'joker') return '鬼牌'
  if (c.kind === 'blank') return '空白牌'
  return `${SUIT_SYMBOL[c.suit]}${rankLabel(c.rank)}`
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
