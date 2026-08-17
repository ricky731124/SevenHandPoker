import { describe, expect, it } from 'vitest'
import { isBlank, isJoker, isSpecial } from './cards'
import {
  applyDraw,
  applyPick,
  applyPlace,
  checkWin,
  countCoins,
  createGame,
  emptySlotsFor,
  otherPlayer,
  resolveShowdown,
  type GameState,
  type PlayerId,
  type SlotOwner,
} from './state'

function fresh(): GameState {
  return createGame(12345, 'p1')
}

describe('createGame', () => {
  it('deals 12 to each (10 from deck + blank + joker) and leaves 32 in the deck', () => {
    const g = fresh()
    expect(g.hands.p1).toHaveLength(12)
    expect(g.hands.p2).toHaveLength(12)
    expect(g.deck).toHaveLength(32)
    expect(g.turn).toBe('p1')
    expect(g.phase).toBe('pick')
  })
  it('gives each player exactly one off-deck blank and one joker; deck stays 52 normal cards', () => {
    const g = fresh()
    for (const p of ['p1', 'p2'] as PlayerId[]) {
      expect(g.hands[p].filter(isBlank)).toHaveLength(1)
      expect(g.hands[p].filter(isJoker)).toHaveLength(1)
    }
    // The 52-deck (all non-special cards across hands + deck) is distinct and complete.
    const reals = [...g.hands.p1, ...g.hands.p2, ...g.deck].filter((c) => !isSpecial(c)).map((c) => c.id)
    expect(reals).toHaveLength(52)
    expect(new Set(reals).size).toBe(52)
  })
})

describe('pick + place + draw flow (sequential)', () => {
  it('pick moves cards to pendingPick and enters place phase', () => {
    const g = fresh()
    const ids = g.hands.p1.slice(0, 3).map((c) => c.id)
    const g2 = applyPick(g, 'p1', ids)
    expect(g2.phase).toBe('place')
    expect(g2.pendingPick?.cards).toHaveLength(3)
    expect(g2.hands.p1).toHaveLength(9) // 12 - 3
  })

  it('place defers the draw; applyDraw then draws and passes the turn', () => {
    const g = fresh()
    const ids = g.hands.p1.slice(0, 2).map((c) => c.id)
    let s = applyPick(g, 'p1', ids)
    s = applyPlace(s, 'p2', 0)
    expect(s.slots[0].p1).toHaveLength(2)
    expect(s.phase).toBe('draw') // no showdown yet
    expect(s.hands.p1).toHaveLength(10) // 12 - 2, NOT drawn yet — sequential
    s = applyDraw(s)
    expect(s.hands.p1).toHaveLength(13) // 10 + 3
    expect(s.turn).toBe('p2')
    expect(s.phase).toBe('pick')
  })

  it('rejects picking out of turn', () => {
    const g = fresh()
    expect(() => applyPick(g, 'p2', [g.hands.p2[0].id])).toThrow()
  })
})

describe('showdown', () => {
  it('resolves a coin, then draw, when both sides are filled', () => {
    const g = fresh()
    let s = applyPick(g, 'p1', [g.hands.p1[0].id])
    s = applyPlace(s, 'p2', 0)
    s = applyDraw(s) // p1 drew, now p2's pick
    s = applyPick(s, 'p2', [s.hands.p2[0].id])
    s = applyPlace(s, 'p1', 0) // completes slot 0 -> showdown (or ended)
    expect(['p1', 'p2']).toContain(s.slots[0].owner)
    expect(s.lastShowdown?.slot).toBe(0)
    if (s.phase === 'showdown') {
      const s2 = resolveShowdown(s)
      expect(s2.phase).toBe('draw')
      const s3 = applyDraw(s2)
      expect(s3.phase).toBe('pick')
    }
  })
})

describe('checkWin', () => {
  function withOwners(owners: (SlotOwner | undefined)[], tieBreakWinner: PlayerId = 'p2'): GameState {
    const g = createGame(12345, 'p1', tieBreakWinner)
    g.slots.forEach((s, i) => (s.owner = owners[i] ?? null))
    return g
  }
  it('4 coins wins', () => {
    expect(checkWin(withOwners(['p1', null, 'p1', null, 'p1', null, 'p1']))).toEqual({ winner: 'p1', reason: 'coins4' })
  })
  it('3-in-a-row wins even with fewer total', () => {
    expect(checkWin(withOwners(['p2', 'p2', 'p2', null, null, null, null]))).toEqual({ winner: 'p2', reason: 'line3' })
  })
  it('non-adjacent 3 does not win by line', () => {
    expect(checkWin(withOwners(['p1', null, 'p1', null, 'p1', null, null]))).toBeNull()
  })

  // --- ties / shared slots (SPEC §2.3) ---
  it('a tied slot counts toward both players', () => {
    const g = withOwners(['both', 'p1', 'p1', null, null, null, null])
    expect(countCoins(g, 'p1')).toBe(3)
    expect(countCoins(g, 'p2')).toBe(1)
  })
  it('a tied slot can complete both players’ lines', () => {
    // shared 0,1,2 → both have a 3-line; neither has 4 coins → same type → mode tiebreak
    expect(checkWin(withOwners(['both', 'both', 'both', null, null, null, null]))).toEqual({ winner: 'p2', reason: 'line3' })
    // online → host (p1) wins the same scenario
    expect(checkWin(withOwners(['both', 'both', 'both', null, null, null, null], 'p1'))).toEqual({ winner: 'p1', reason: 'line3' })
  })
  it('四幣 > 三連: a 4-coin win outranks a simultaneous line win', () => {
    // p1 owns 0,1,2,3 → 4 coins (and a line); p2 shares 0,1,2 → a line only (3 coins)
    expect(checkWin(withOwners(['both', 'both', 'both', 'p1', null, null, null]))).toEqual({ winner: 'p1', reason: 'coins4' })
  })
  it('both reach 4 coins on the same showdown → same type → mode tiebreak', () => {
    // four shared slots → both at 4 coins → coins4 tie → computer (p2) by default
    expect(checkWin(withOwners(['both', 'both', 'both', 'both', null, null, null]))).toEqual({ winner: 'p2', reason: 'coins4' })
  })
})

describe('full game simulation reaches a winner', () => {
  it('random legal play always terminates with a winner', () => {
    let s = createGame(999, 'p1')
    let guard = 0
    while (s.phase !== 'ended' && guard++ < 300) {
      if (s.phase === 'showdown') s = resolveShowdown(s)
      else if (s.phase === 'draw') s = applyDraw(s)
      else if (s.phase === 'pick') {
        const hand = s.hands[s.turn]
        const take = Math.max(1, Math.min(hand.length, (guard % 5) + 1))
        s = applyPick(s, s.turn, hand.slice(0, take).map((c) => c.id))
      } else if (s.phase === 'place') {
        const placer = otherPlayer(s.pendingPick!.by)
        s = applyPlace(s, placer, emptySlotsFor(s, s.pendingPick!.by)[0])
      }
    }
    expect(s.phase).toBe('ended')
    expect(['p1', 'p2']).toContain(s.winner)
  })
})
