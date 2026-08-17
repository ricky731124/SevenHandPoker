import { compareValue, evaluate } from './evaluate'
import {
  applyPick,
  applyPlace,
  emptySlotsFor,
  isTargetable,
  otherPlayer,
  ownsSlot,
  suitTargets,
  swapTargets,
  type GameState,
  type PlayerId,
} from './state'
import { getSpecialCard, type SpecialCardId } from './specialCards'
import { candidatePiles, fallbackPile, pileStrength } from './aiCore'
import { bossPick, bossPlace, type BossRuntime } from './bossAI'

/**
 * The default single-difficulty AI (used by 對戰電腦 and non-campaign play).
 *  - Pick: send the strongest coherent pile it can form (made hands first).
 *  - Place: put the human's incoming pile where it hurts least.
 *
 * Campaign bosses pass a `boss` runtime to aiPick/aiPlace, which delegates to
 * bossAI.ts (profile-driven strategies/skills). Without it, behaviour is exactly
 * as before — existing callers and tests are unaffected.
 */

export function aiPick(state: GameState, me: PlayerId, boss?: BossRuntime): string[] {
  if (boss) return bossPick(state, me, boss)
  const hand = state.hands[me]
  const cands = candidatePiles(hand)
  if (cands.length > 0) {
    let best = cands[0]
    for (const c of cands) {
      if (compareValue(evaluate(c), evaluate(best)) > 0) best = c
    }
    return best.map((c) => c.id)
  }
  return fallbackPile(hand).map((c) => c.id)
}

export function aiPlace(state: GameState, me: PlayerId, boss?: BossRuntime): number {
  if (boss) return bossPlace(state, me, boss)
  // BLIND placement: the AI must not peek at the incoming pile's values (the
  // human places blind too). It routes the enemy pile toward slots where its
  // OWN pile is strong, defers into empty slots otherwise, watching both lines.
  const picker = state.pendingPick!.by
  const empties = emptySlotsFor(state, picker)

  let best = empties[0]
  let bestScore = -Infinity
  for (const i of empties) {
    const myPile = state.slots[i][me]
    let score = 0

    if (myPile.length > 0) {
      score += pileStrength(myPile) * 40
      if (adjacency(state, me, i) > 0) score += 120
    } else {
      score += 150
    }

    score -= Math.abs(3 - i)
    score -= adjacency(state, picker, i) * 20

    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/** Count of `owner`'s owned coins adjacent to slot i (line-building signal). */
export function adjacency(state: GameState, owner: PlayerId, i: number): number {
  let n = 0
  const prev = state.slots[i - 1]
  const nextS = state.slots[i + 1]
  if (prev && ownsSlot(prev, owner)) n++
  if (nextS && ownsSlot(nextS, owner)) n++
  return n
}

/**
 * Should the AI activate one of its carried special cards this pick turn?
 * Returns the card + target to use, or null to hold. (Default policy; campaign
 * bosses get richer per-boss special use in a later phase.)
 *
 * Minimal-but-real policy (SPEC §15 "選 3 用 1", one activation per match): the
 * AI only spends its one-shot on cards that change the BOARD in its favour —
 * suit-bloom toward a real flush cluster, or swap dumping a low dead card. Info
 * cards (偷窺/讓我看看) give it nothing to act on, so it never wastes the one-shot.
 */
export function aiChooseSpecial(
  state: GameState,
  me: PlayerId,
  loadout: SpecialCardId[],
): { card: SpecialCardId; targetId: string } | null {
  if (state.specialUsed[me]) return null
  const hand = state.hands[me]

  let best: { card: SpecialCardId; targetId: string; cluster: number } | null = null
  for (const id of loadout) {
    const def = getSpecialCard(id)
    if (!def?.suit) continue
    const targets = suitTargets(state, me, def.suit)
    if (targets.length === 0) continue
    const have = hand.filter((c) => isTargetable(c) && c.suit === def.suit).length
    const cluster = have + 1
    if (cluster >= 3 && (!best || cluster > best.cluster)) {
      const victim = targets.reduce((lo, c) => (c.rank < lo.rank ? c : lo), targets[0])
      best = { card: id, targetId: victim.id, cluster }
    }
  }
  if (best) return { card: best.card, targetId: best.targetId }

  if (loadout.includes('swap') && state.deck.length > 0) {
    const targets = swapTargets(state, me)
    const rankCount = new Map<number, number>()
    for (const c of targets) rankCount.set(c.rank, (rankCount.get(c.rank) ?? 0) + 1)
    const deadLows = targets.filter((c) => c.rank <= 6 && (rankCount.get(c.rank) ?? 0) === 1)
    if (deadLows.length) {
      const victim = deadLows.reduce((lo, c) => (c.rank < lo.rank ? c : lo), deadLows[0])
      return { card: 'swap', targetId: victim.id }
    }
  }
  return null
}

/** Convenience: apply one full AI turn action given the current phase. */
export function aiStep(state: GameState, me: PlayerId, boss?: BossRuntime): GameState {
  if (state.phase === 'pick' && state.turn === me) {
    return applyPick(state, me, aiPick(state, me, boss))
  }
  if (state.phase === 'place' && state.pendingPick && otherPlayer(state.pendingPick.by) === me) {
    return applyPlace(state, me, aiPlace(state, me, boss))
  }
  return state
}
