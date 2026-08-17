import type { Card } from '../game/cards'
import type { GameState, PlayerId, Phase, Showdown, SlotOwner, WinReason } from '../game/state'
import type { SpecialCardId } from '../game/specialCards'

/**
 * Networked game (Phase 2). The HOST owns the authoritative GameState and writes
 * a GUEST-VIEW to RTDB that hides everything the guest must not see:
 *  - the host's hand (count only),
 *  - the deck (count only),
 *  - face-down piles on the host's side (count only until a showdown reveals them).
 * The guest's own hand and its own placed piles are sent in full (it picked them).
 * This preserves the hidden-information game (SPEC §2.9 / §6.3). Host-sees-all is
 * the accepted v1 limitation.
 */

export type LiveSel = { total: number; idx: number[] }

export type Intent =
  // `sel` carries the picker's SORTED pushed-out positions so the placer's view
  // matches the live preview exactly (no jump when the pick is submitted).
  | { type: 'pick'; ids: string[]; sel?: LiveSel }
  | { type: 'place'; slot: number }
  | { type: 'continue' }
  // guest activates a special card; host arbitrates. targetId only for swap/suit.
  | { type: 'special'; card: SpecialCardId; targetId?: string }

export interface SyncSlot {
  owner: SlotOwner // includes 'both' for a joker tie
  p1Count: number
  /** host-side (p1) real cards — only once the slot is revealed (owner set) */
  p1Cards: Card[] | null
  /** guest-side (p2) real cards — always (the guest picked them) */
  p2: Card[]
}

export interface SyncGame {
  phase: Phase
  turn: PlayerId
  postPicker: PlayerId | null
  winner: PlayerId | null
  winReason: WinReason | null
  firstPicker: PlayerId
  deckCount: number
  hostHandCount: number
  guestHand: Card[]
  slots: SyncSlot[]
  pending: { by: PlayerId; count: number } | null
  /** host's pushed-out selection (indices) so the guest can render it; only while the host has a pending pick */
  foeSel: { total: number; idx: number[] } | null
  lastShowdown: Showdown | null
  /** one-shot special-card budget per player, so the guest can grey its button */
  specialUsed: Record<PlayerId, boolean>
}

const HIDDEN: Card = { id: '_', suit: 'S', rank: 2 }
function hidden(n: number, prefix: string): Card[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => ({ ...HIDDEN, id: `${prefix}${i}` }))
}

/**
 * RTDB rejects `undefined` anywhere in a `set()`. A Showdown's p1WildAs/p2WildAs
 * are undefined whenever that side had no joker (i.e. almost every showdown), so
 * strip the undefined keys before writing — otherwise the whole guest-view write
 * throws and the guest freezes at the showdown.
 */
function cleanShowdown(sd: Showdown): Showdown {
  const out: Showdown = { slot: sd.slot, winner: sd.winner, p1Name: sd.p1Name, p2Name: sd.p2Name }
  if (sd.p1WildAs) out.p1WildAs = sd.p1WildAs
  if (sd.p2WildAs) out.p2WildAs = sd.p2WildAs
  return out
}

/** Host → RTDB. `foeSel` is the host's pushed-out pick (only meaningful while the host has a pending pick). */
export function serializeForGuest(engine: GameState, foeSel: { total: number; idx: number[] } | null): SyncGame {
  return {
    phase: engine.phase,
    turn: engine.turn,
    postPicker: engine.postPicker,
    winner: engine.winner,
    winReason: engine.winReason,
    firstPicker: engine.firstPicker,
    deckCount: engine.deck.length,
    hostHandCount: engine.hands.p1.length,
    guestHand: engine.hands.p2,
    slots: engine.slots.map((s) => ({
      owner: s.owner,
      p1Count: s.p1.length,
      p1Cards: s.owner ? s.p1 : null,
      p2: s.p2,
    })),
    pending: engine.pendingPick ? { by: engine.pendingPick.by, count: engine.pendingPick.cards.length } : null,
    foeSel: engine.pendingPick?.by === 'p1' ? foeSel : null,
    lastShowdown: engine.lastShowdown ? cleanShowdown(engine.lastShowdown) : null,
    specialUsed: engine.specialUsed,
  }
}

/**
 * Guest reconstructs a GameState (with placeholder cards where values are hidden)
 * that the existing GameBoard can render as-is. Face-down cards only ever render
 * as backs, so their placeholder values are never shown.
 */
export function deserializeForGuest(g: SyncGame): { engine: GameState; foeSel: { total: number; idx: number[] } | null } {
  const engine: GameState = {
    seed: 0,
    hands: {
      p1: hidden(g.hostHandCount, 'hh'),
      p2: g.guestHand ?? [],
    },
    deck: hidden(g.deckCount, 'dk'),
    drawsDone: { p1: 0, p2: 0 },
    placementsDone: { p1: 0, p2: 0 },
    slots: (g.slots ?? []).map((s, i) => ({
      owner: s.owner ?? null,
      p1: s.owner ? (s.p1Cards ?? []) : hidden(s.p1Count, `s${i}p1_`),
      p2: s.p2 ?? [],
    })),
    turn: g.turn,
    phase: g.phase,
    pendingPick: g.pending ? { by: g.pending.by, cards: hidden(g.pending.count, 'pp') } : null,
    lastShowdown: g.lastShowdown ?? null,
    postPicker: g.postPicker ?? null,
    firstPicker: g.firstPicker,
    winner: g.winner ?? null,
    winReason: g.winReason ?? null,
    // Guest never runs checkWin (host is authoritative); host is p1 online.
    tieBreakWinner: 'p1',
    // Host-arbitrated special-card budget (RTDB may drop an all-false object).
    specialUsed: g.specialUsed ?? { p1: false, p2: false },
  }
  // RTDB drops empty arrays, so a foeSel that was {total, idx:[]} reads back
  // without idx — normalise so the UI never touches idx.length on undefined.
  const foeSel = g.foeSel && Array.isArray(g.foeSel.idx) && g.foeSel.idx.length ? g.foeSel : null
  return { engine, foeSel }
}
