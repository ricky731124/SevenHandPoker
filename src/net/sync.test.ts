import { describe, expect, it } from 'vitest'
import { makeBlank, type Card } from '../game/cards'
import { createGame, type GameState, type Showdown } from '../game/state'
import { serializeForGuest, deserializeForGuest } from './sync'

/** Deep-scan for any `undefined` value — RTDB set() throws on these. */
function hasUndefined(v: unknown): boolean {
  if (v === undefined) return true
  if (v === null || typeof v !== 'object') return false
  return Object.values(v as Record<string, unknown>).some(hasUndefined)
}

function withShowdown(sd: Showdown, p1: Card[], p2: Card[]): GameState {
  const g = createGame(1, 'p1')
  g.slots[sd.slot] = { p1, p2, owner: sd.winner }
  g.phase = 'showdown'
  g.lastShowdown = sd
  return g
}

describe('serializeForGuest is RTDB-safe (no undefined)', () => {
  it('a normal showdown (no joker) carries no undefined wildAs', () => {
    const sd: Showdown = { slot: 0, winner: 'p1', p1Name: '對子', p2Name: '高牌' }
    const view = serializeForGuest(withShowdown(sd, [], []), null)
    expect(hasUndefined(view)).toBe(false)
    expect('p1WildAs' in (view.lastShowdown as object)).toBe(false)
  })

  it('a double-blank tie round-trips with owner "both" and no undefined', () => {
    const b1 = makeBlank('p1')
    const b2 = makeBlank('p2')
    const sd: Showdown = { slot: 2, winner: 'both', p1Name: '無牌型', p2Name: '無牌型' }
    const view = serializeForGuest(withShowdown(sd, [b1], [b2]), null)
    expect(hasUndefined(view)).toBe(false)
    const { engine } = deserializeForGuest(view)
    expect(engine.slots[2].owner).toBe('both')
    expect(engine.lastShowdown?.winner).toBe('both')
  })
})

describe('specialUsed sync (Phase C #14 online)', () => {
  it('round-trips the per-player special budget to the guest', () => {
    const g = createGame(1, 'p1')
    g.specialUsed = { p1: true, p2: false }
    const view = serializeForGuest(g, null)
    expect(view.specialUsed).toEqual({ p1: true, p2: false })
    expect(hasUndefined(view)).toBe(false)
    expect(deserializeForGuest(view).engine.specialUsed).toEqual({ p1: true, p2: false })
  })
  it('tolerates a missing specialUsed branch (RTDB drops all-false objects)', () => {
    const g = createGame(1, 'p1')
    const view = serializeForGuest(g, null)
    // simulate RTDB having dropped the node
    const stripped = { ...view, specialUsed: undefined as unknown as typeof view.specialUsed }
    expect(deserializeForGuest(stripped).engine.specialUsed).toEqual({ p1: false, p2: false })
  })
})
