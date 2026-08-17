import { describe, expect, it } from 'vitest'
import { isSpecial } from './cards'
import {
  applyClubs,
  applySuit,
  applySwap,
  clubsTargets,
  createGame,
  markSpecialUsed,
  peekNextDraw,
  suitTargets,
  swapTargets,
  type GameState,
} from './state'
import { aiChooseSpecial } from './ai'
import type { Card, Rank, Suit } from './cards'

function fresh(): GameState {
  return createGame(12345, 'p1')
}

const card = (suit: Suit, rank: Rank): Card => ({ id: `${suit}${rank}`, suit, rank })

/** A fresh game with p2 (the AI) given a controlled hand and the pick turn. */
function aiGame(hand: Card[]): GameState {
  const g = fresh()
  return { ...g, turn: 'p2', hands: { ...g.hands, p2: hand } }
}

/** A deterministic rng: yields the given values in order, then repeats the last. */
function seq(...vals: number[]): () => number {
  let i = 0
  return () => vals[Math.min(i++, vals.length - 1)]
}

describe('specialUsed budget', () => {
  it('starts unspent for both players', () => {
    const g = fresh()
    expect(g.specialUsed).toEqual({ p1: false, p2: false })
  })
  it('markSpecialUsed spends only the given player', () => {
    const g = markSpecialUsed(fresh(), 'p1')
    expect(g.specialUsed).toEqual({ p1: true, p2: false })
  })
})

describe('applySwap (偷天換日)', () => {
  it('keeps hand size, removes the target, adds a card from the deck, and spends the budget', () => {
    const g = fresh()
    const target = g.hands.p1.find((c) => !isSpecial(c))!
    const before = g.hands.p1.length
    const deckBefore = g.deck.length
    // rng: first draw index 0, then insert at 0.
    const n = applySwap(g, 'p1', target.id, seq(0, 0))
    expect(n.hands.p1).toHaveLength(before)
    expect(n.deck).toHaveLength(deckBefore) // one out, one in
    expect(n.hands.p1.some((c) => c.id === target.id)).toBe(false)
    expect(n.deck.some((c) => c.id === target.id)).toBe(true)
    expect(n.specialUsed.p1).toBe(true)
  })
  it('never draws back the same card it discarded', () => {
    const g = fresh()
    const target = g.hands.p1.find((c) => !isSpecial(c))!
    const drawnId = g.deck[0].id
    const n = applySwap(g, 'p1', target.id, seq(0, 0.5))
    // We draw before reinserting, so the new card is a real deck card, not the discard.
    const gained = n.hands.p1.find((c) => !g.hands.p1.some((o) => o.id === c.id))!
    expect(gained.id).toBe(drawnId)
    expect(gained.id).not.toBe(target.id)
  })
  it('refuses to swap a blank/joker (off-deck cards are untouchable)', () => {
    const g = fresh()
    const joker = g.hands.p1.find(isSpecial)!
    expect(applySwap(g, 'p1', joker.id, seq(0))).toBe(g) // unchanged
  })
  it('swapTargets excludes the blank and joker', () => {
    const g = fresh()
    expect(swapTargets(g, 'p1')).toHaveLength(10)
    expect(swapTargets(g, 'p1').every((c) => !isSpecial(c))).toBe(true)
  })
})

describe('applyClubs (踏雪尋梅)', () => {
  it('re-suits a non-club card to clubs, keeping id + rank, and spends the budget', () => {
    const g = fresh()
    const target = clubsTargets(g, 'p1')[0]
    const n = applyClubs(g, 'p1', target.id)
    const changed = n.hands.p1.find((c) => c.id === target.id)!
    expect(changed.suit).toBe('C')
    expect(changed.rank).toBe(target.rank)
    expect(n.specialUsed.p1).toBe(true)
  })
  it('is a no-op on an already-club card or a special card', () => {
    const g = fresh()
    // Force a club into the hand for the test.
    const club = { id: 'C9', suit: 'C' as const, rank: 9 as const }
    const g2: GameState = { ...g, hands: { ...g.hands, p1: [...g.hands.p1, club] } }
    expect(applyClubs(g2, 'p1', 'C9')).toBe(g2)
    const joker = g.hands.p1.find(isSpecial)!
    expect(applyClubs(g, 'p1', joker.id)).toBe(g)
  })
  it('clubsTargets excludes clubs and special cards', () => {
    const g = fresh()
    expect(clubsTargets(g, 'p1').every((c) => c.suit !== 'C' && !isSpecial(c))).toBe(true)
  })
})

describe('applySuit (方塊/紅心/黑桃/梅花 通用)', () => {
  for (const suit of ['D', 'H', 'S', 'C'] as Suit[]) {
    it(`re-suits a target card to ${suit}, keeping id + rank`, () => {
      const g = fresh()
      const target = suitTargets(g, 'p1', suit)[0]
      const n = applySuit(g, 'p1', target.id, suit)
      const changed = n.hands.p1.find((c) => c.id === target.id)!
      expect(changed.suit).toBe(suit)
      expect(changed.rank).toBe(target.rank)
      expect(n.specialUsed.p1).toBe(true)
    })
    it(`suitTargets(${suit}) excludes cards already that suit and specials`, () => {
      const g = fresh()
      expect(suitTargets(g, 'p1', suit).every((c) => c.suit !== suit && !isSpecial(c))).toBe(true)
    })
  }
  it('applyClubs is applySuit(…,"C")', () => {
    const g = fresh()
    const t = clubsTargets(g, 'p1')[0]
    expect(applyClubs(g, 'p1', t.id).hands.p1.find((c) => c.id === t.id)!.suit).toBe('C')
  })
})

describe('aiChooseSpecial (#13 AI 發動特殊牌)', () => {
  it('re-suits toward a flush when it builds a ≥3 cluster (lowest off-suit victim)', () => {
    // Two clubs already → converting one more makes 3. Off-suit targets: D9, H3.
    const g = aiGame([card('C', 5), card('C', 9), card('D', 9), card('H', 3)])
    const d = aiChooseSpecial(g, 'p2', ['clubs', 'hearts'])
    expect(d).toEqual({ card: 'clubs', targetId: 'H3' }) // lowest off-suit card
  })

  it('holds the suit-bloom when it would not build a cluster (<3)', () => {
    // Only one club; converting makes 2 → not worth it. No low singleton either.
    const g = aiGame([card('C', 9), card('D', 9), card('S', 12), card('H', 11)])
    expect(aiChooseSpecial(g, 'p2', ['clubs'])).toBeNull()
  })

  it('swaps a low unpaired card when carrying swap and nothing better', () => {
    const g = aiGame([card('D', 3), card('S', 11), card('H', 12), card('C', 13)])
    expect(aiChooseSpecial(g, 'p2', ['swap'])).toEqual({ card: 'swap', targetId: 'D3' })
  })

  it('never spends the one-shot on info-only cards (peek/spy)', () => {
    const g = aiGame([card('D', 3), card('S', 11), card('H', 12)])
    expect(aiChooseSpecial(g, 'p2', ['peek', 'spy'])).toBeNull()
  })

  it('returns null once the budget is already spent', () => {
    const g = markSpecialUsed(aiGame([card('C', 5), card('C', 9), card('H', 3)]), 'p2')
    expect(aiChooseSpecial(g, 'p2', ['clubs'])).toBeNull()
  })
})

describe('peekNextDraw (偷窺)', () => {
  it('returns the next 3 deck cards on the first draw and does not mutate', () => {
    const g = fresh()
    const peek = peekNextDraw(g, 'p1')
    expect(peek).toHaveLength(3) // DRAW_SCHEDULE[0]
    expect(peek).toEqual(g.deck.slice(0, 3))
    expect(g.deck).toHaveLength(32) // unchanged
  })
})
