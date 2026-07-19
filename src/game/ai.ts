import type { Card, Rank, Suit } from './cards'
import { compareValue, evaluate } from './evaluate'
import {
  applyPick,
  applyPlace,
  emptySlotsFor,
  otherPlayer,
  type GameState,
  type PlayerId,
} from './state'

/**
 * Single reasonable-difficulty AI.
 *  - Pick: send the strongest coherent pile it can form (made hands first).
 *  - Place: put the human's incoming pile where it hurts least — steal a coin
 *    if possible, otherwise defer without handing one away, while nudging
 *    toward its own 3-in-a-row and away from the human's.
 */

function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const x of arr) {
    const k = key(x)
    const g = m.get(k)
    if (g) g.push(x)
    else m.set(k, [x])
  }
  return m
}

/** Candidate piles (made hands) the AI could pick from its hand. */
function candidatePiles(hand: Card[]): Card[][] {
  const out: Card[][] = []
  const byRank = groupBy(hand, (c) => c.rank)
  const bySuit = groupBy(hand, (c) => c.suit)

  const groups = [...byRank.values()]
  const pairs = groups.filter((g) => g.length >= 2).sort((a, b) => b[0].rank - a[0].rank)
  const trips = groups.filter((g) => g.length >= 3).sort((a, b) => b[0].rank - a[0].rank)
  const quads = groups.filter((g) => g.length >= 4)

  // quads / trips / pairs
  for (const q of quads) out.push(q.slice(0, 4))
  for (const t of trips) out.push(t.slice(0, 3))
  for (const p of pairs) out.push(p.slice(0, 2))

  // two pair
  if (pairs.length >= 2) out.push([...pairs[0].slice(0, 2), ...pairs[1].slice(0, 2)])

  // full house: a trip + a different pair
  if (trips.length >= 1) {
    const otherPair = pairs.find((p) => p[0].rank !== trips[0][0].rank)
    if (otherPair) out.push([...trips[0].slice(0, 3), ...otherPair.slice(0, 2)])
  }

  // flush: 5 of a suit (highest)
  for (const cards of bySuit.values()) {
    if (cards.length >= 5) {
      out.push([...cards].sort((a, b) => b.rank - a.rank).slice(0, 5))
    }
  }

  // straight: any 5 consecutive distinct ranks (Ace high or wheel)
  const straight = findStraight(hand)
  if (straight) out.push(straight)

  return out
}

function findStraight(hand: Card[]): Card[] | null {
  const byRank = groupBy(hand, (c) => c.rank)
  const has = (r: number) => byRank.get(r as Rank)?.[0]
  // Ace can be high (14) or low (1) — check windows 10..14 down to A2345
  const windows: number[][] = []
  for (let hi = 14; hi >= 5; hi--) windows.push([hi, hi - 1, hi - 2, hi - 3, hi - 4])
  windows.push([5, 4, 3, 2, 14]) // wheel
  for (const w of windows) {
    const cards = w.map((r) => has(r === 1 ? 14 : r)).filter(Boolean) as Card[]
    if (cards.length === 5) return cards
  }
  return null
}

export function aiPick(state: GameState, me: PlayerId): string[] {
  const hand = state.hands[me]
  const cands = candidatePiles(hand)
  if (cands.length > 0) {
    let best = cands[0]
    for (const c of cands) {
      if (compareValue(evaluate(c), evaluate(best)) > 0) best = c
    }
    return best.map((c) => c.id)
  }
  // Fallback: the two highest cards as a high-card pile (1 if only one left).
  const sorted = [...hand].sort((a, b) => b.rank - a.rank || suitRank(b.suit) - suitRank(a.suit))
  return sorted.slice(0, Math.min(2, sorted.length)).map((c) => c.id)
}

function suitRank(s: Suit): number {
  return { C: 0, D: 1, H: 2, S: 3 }[s]
}

export function aiPlace(state: GameState, me: PlayerId): number {
  // BLIND placement: the AI must not peek at the incoming pile's values
  // (the human places blind too). It routes the enemy pile toward slots where
  // its OWN pile is strong (likely to win the showdown), defers into empty
  // slots otherwise, and watches line-building on both sides.
  const picker = state.pendingPick!.by // the human (foe)
  const empties = emptySlotsFor(state, picker)

  let best = empties[0]
  let bestScore = -Infinity
  for (const i of empties) {
    const myPile = state.slots[i][me]
    let score = 0

    if (myPile.length > 0) {
      // Strong own pile → routing the enemy here likely wins AI a coin.
      score += pileStrength(myPile) * 40
      // If winning here would advance the AI's own line, nudge higher.
      if (adjacency(state, me, i) > 0) score += 120
    } else {
      // Deferred showdown: safe baseline, hands no coin over now.
      score += 150
    }

    // Prefer central slots (more line flexibility), mild.
    score -= Math.abs(3 - i)
    // Discourage clustering the human's coins toward a line.
    score -= adjacency(state, picker, i) * 20

    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/** Coarse strength 0..~8.9 for routing decisions. */
function pileStrength(pile: Card[]): number {
  const v = evaluate(pile)
  return v.category + (v.rankSeq[0] ?? 0) / 15
}

/** Count of `owner`'s owned coins adjacent to slot i (line-building signal). */
function adjacency(state: GameState, owner: PlayerId, i: number): number {
  let n = 0
  if (state.slots[i - 1]?.owner === owner) n++
  if (state.slots[i + 1]?.owner === owner) n++
  return n
}

/** Convenience: apply one full AI turn action given the current phase. */
export function aiStep(state: GameState, me: PlayerId): GameState {
  if (state.phase === 'pick' && state.turn === me) {
    return applyPick(state, me, aiPick(state, me))
  }
  if (state.phase === 'place' && state.pendingPick && otherPlayer(state.pendingPick.by) === me) {
    return applyPlace(state, me, aiPlace(state, me))
  }
  return state
}
