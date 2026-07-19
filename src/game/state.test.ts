import { describe, expect, it } from 'vitest'
import {
  applyDraw,
  applyPick,
  applyPlace,
  checkWin,
  createGame,
  emptySlotsFor,
  otherPlayer,
  resolveShowdown,
  type GameState,
  type PlayerId,
} from './state'

function fresh(): GameState {
  return createGame(12345, 'p1')
}

describe('createGame', () => {
  it('deals 10 to each and leaves 32 in the deck', () => {
    const g = fresh()
    expect(g.hands.p1).toHaveLength(10)
    expect(g.hands.p2).toHaveLength(10)
    expect(g.deck).toHaveLength(32)
    expect(g.turn).toBe('p1')
    expect(g.phase).toBe('pick')
  })
  it('deals 52 distinct cards', () => {
    const g = fresh()
    const all = [...g.hands.p1, ...g.hands.p2, ...g.deck].map((c) => c.id)
    expect(new Set(all).size).toBe(52)
  })
})

describe('pick + place + draw flow (sequential)', () => {
  it('pick moves cards to pendingPick and enters place phase', () => {
    const g = fresh()
    const ids = g.hands.p1.slice(0, 3).map((c) => c.id)
    const g2 = applyPick(g, 'p1', ids)
    expect(g2.phase).toBe('place')
    expect(g2.pendingPick?.cards).toHaveLength(3)
    expect(g2.hands.p1).toHaveLength(7)
  })

  it('place defers the draw; applyDraw then draws and passes the turn', () => {
    const g = fresh()
    const ids = g.hands.p1.slice(0, 2).map((c) => c.id)
    let s = applyPick(g, 'p1', ids)
    s = applyPlace(s, 'p2', 0)
    expect(s.slots[0].p1).toHaveLength(2)
    expect(s.phase).toBe('draw') // no showdown yet
    expect(s.hands.p1).toHaveLength(8) // NOT drawn yet — sequential
    s = applyDraw(s)
    expect(s.hands.p1).toHaveLength(11) // 8 + 3
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
  function withOwners(owners: (PlayerId | null)[]): GameState {
    const g = fresh()
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
