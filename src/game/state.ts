import type { Card } from './cards'
import { makeDeck } from './cards'
import { compareHands, evaluate } from './evaluate'
import { mulberry32, shuffle } from './rng'

export type PlayerId = 'p1' | 'p2'
export type Phase = 'coinToss' | 'pick' | 'place' | 'showdown' | 'draw' | 'ended'
export type WinReason = 'coins4' | 'line3' | 'boardFull'

export const SLOT_COUNT = 7
export const INITIAL_HAND = 10
export const MAX_PICK = 5
export const DRAW_SCHEDULE = [3, 3, 3, 3, 2, 2] as const // per placement, 6 draws

export interface Slot {
  p1: Card[] // bottom side (p1's pile, placed by p2)
  p2: Card[] // top side (p2's pile, placed by p1)
  owner: PlayerId | null
}

export interface Showdown {
  slot: number
  winner: PlayerId
  p1Name: string
  p2Name: string
}

export interface GameState {
  seed: number
  hands: Record<PlayerId, Card[]>
  deck: Card[]
  drawsDone: Record<PlayerId, number>
  placementsDone: Record<PlayerId, number>
  slots: Slot[]
  turn: PlayerId // whose turn to PICK
  phase: Phase
  pendingPick: { by: PlayerId; cards: Card[] } | null
  lastShowdown: Showdown | null
  /** who must draw (and pass the turn) once the current place/showdown settles */
  postPicker: PlayerId | null
  firstPicker: PlayerId
  winner: PlayerId | null
  winReason: WinReason | null
}

export const otherPlayer = (p: PlayerId): PlayerId => (p === 'p1' ? 'p2' : 'p1')

export function createGame(seed: number, firstPicker: PlayerId): GameState {
  const rng = mulberry32(seed)
  const deck = shuffle(makeDeck(), rng)
  const hands: Record<PlayerId, Card[]> = { p1: [], p2: [] }
  // Deal 10 each, alternating (p1, p2, p1, p2, ...) for determinism.
  for (let i = 0; i < INITIAL_HAND; i++) {
    hands.p1.push(deck.shift()!)
    hands.p2.push(deck.shift()!)
  }
  const slots: Slot[] = Array.from({ length: SLOT_COUNT }, () => ({ p1: [], p2: [], owner: null }))
  return {
    seed,
    hands,
    deck,
    drawsDone: { p1: 0, p2: 0 },
    placementsDone: { p1: 0, p2: 0 },
    slots,
    turn: firstPicker,
    phase: 'pick',
    pendingPick: null,
    lastShowdown: null,
    postPicker: null,
    firstPicker,
    winner: null,
    winReason: null,
  }
}

/** Slots where `player`'s side is still empty (valid placement targets for them). */
export function emptySlotsFor(state: GameState, player: PlayerId): number[] {
  const out: number[] = []
  state.slots.forEach((s, i) => {
    if (s[player].length === 0) out.push(i)
  })
  return out
}

export function countCoins(state: GameState, player: PlayerId): number {
  return state.slots.filter((s) => s.owner === player).length
}

/** Returns winner if a win condition is met, else null. */
export function checkWin(state: GameState): { winner: PlayerId; reason: WinReason } | null {
  for (const p of ['p1', 'p2'] as PlayerId[]) {
    if (countCoins(state, p) >= 4) return { winner: p, reason: 'coins4' }
  }
  // 3-in-a-row
  for (let i = 0; i <= SLOT_COUNT - 3; i++) {
    const o = state.slots[i].owner
    if (o && state.slots[i + 1].owner === o && state.slots[i + 2].owner === o) {
      return { winner: o, reason: 'line3' }
    }
  }
  // board full
  if (state.slots.every((s) => s.owner !== null)) {
    const c1 = countCoins(state, 'p1')
    const c2 = countCoins(state, 'p2')
    if (c1 !== c2) return { winner: c1 > c2 ? 'p1' : 'p2', reason: 'boardFull' }
  }
  return null
}

/** Validate a pick without mutating. Returns error message or null. */
export function validatePick(state: GameState, player: PlayerId, cardIds: string[]): string | null {
  if (state.phase !== 'pick') return '現在不是選牌階段'
  if (state.turn !== player) return '還沒輪到你選牌'
  if (cardIds.length < 1 || cardIds.length > MAX_PICK) return '一次只能選 1~5 張'
  const hand = new Set(state.hands[player].map((c) => c.id))
  if (!cardIds.every((id) => hand.has(id))) return '選到不在手牌中的牌'
  if (emptySlotsFor(state, player).length === 0) return '你已經沒有空格可放置'
  return null
}

/** Player picks 1..5 cards; they move to pendingPick, awaiting opponent placement. */
export function applyPick(state: GameState, player: PlayerId, cardIds: string[]): GameState {
  const err = validatePick(state, player, cardIds)
  if (err) throw new Error(err)
  const idSet = new Set(cardIds)
  const picked = state.hands[player].filter((c) => idSet.has(c.id))
  const rest = state.hands[player].filter((c) => !idSet.has(c.id))
  return {
    ...state,
    hands: { ...state.hands, [player]: rest },
    pendingPick: { by: player, cards: picked },
    phase: 'place',
  }
}

export function validatePlace(state: GameState, player: PlayerId, slotIndex: number): string | null {
  if (state.phase !== 'place' || !state.pendingPick) return '現在不是放置階段'
  const picker = state.pendingPick.by
  if (player !== otherPlayer(picker)) return '應由對手放置'
  if (slotIndex < 0 || slotIndex >= SLOT_COUNT) return '格子不存在'
  if (state.slots[slotIndex][picker].length !== 0) return '此格已被使用'
  return null
}

/**
 * Opponent places the picked cards into `slotIndex` on the picker's side, then
 * resolves a showdown if both sides are now filled. Events are strictly
 * sequential: the draw and turn-swap happen later (applyDraw), only after any
 * showdown has been dismissed — nothing runs simultaneously.
 */
export function applyPlace(state: GameState, player: PlayerId, slotIndex: number): GameState {
  const err = validatePlace(state, player, slotIndex)
  if (err) throw new Error(err)
  const picker = state.pendingPick!.by
  const cards = state.pendingPick!.cards

  const slots = state.slots.map((s) => ({ ...s, p1: [...s.p1], p2: [...s.p2] }))
  slots[slotIndex][picker] = cards

  const next: GameState = {
    ...state,
    slots,
    pendingPick: null,
    placementsDone: { ...state.placementsDone, [picker]: state.placementsDone[picker] + 1 },
    lastShowdown: null,
    postPicker: picker, // draw is owed to the picker, later
    phase: 'draw', // default: no showdown → go straight to the draw step
  }

  // Showdown if both sides present.
  const slot = slots[slotIndex]
  if (slot.p1.length > 0 && slot.p2.length > 0 && slot.owner === null) {
    const cmp = compareHands(slot.p1, slot.p2)
    const winner: PlayerId = cmp >= 0 ? 'p1' : 'p2'
    slot.owner = winner
    next.lastShowdown = { slot: slotIndex, winner, p1Name: evaluate(slot.p1).name, p2Name: evaluate(slot.p2).name }
    next.phase = 'showdown'
  }

  // Win check. Record the winner, but if this placement also formed a showdown,
  // let that showdown play out first — the end screen only appears once it's
  // dismissed (resolveShowdown). A win can only arise from a slot gaining an
  // owner, which happens in the showdown branch above, so in practice a win
  // always coincides with a showdown; the non-showdown branch is a safeguard.
  const win = checkWin(next)
  if (win) {
    next.winner = win.winner
    next.winReason = win.reason
    next.postPicker = null
    if (next.phase !== 'showdown') next.phase = 'ended'
  }

  return next
}

/**
 * After a showdown popup is dismissed, move on. If that showdown clinched the
 * game, go straight to the end screen; otherwise continue to the draw step.
 */
export function resolveShowdown(state: GameState): GameState {
  if (state.phase !== 'showdown') return state
  if (state.winner) return { ...state, phase: 'ended', lastShowdown: null }
  return { ...state, phase: 'draw', lastShowdown: null }
}

/** Draw for the picker (per schedule) and pass the turn to the placer. */
export function applyDraw(state: GameState): GameState {
  if (state.phase !== 'draw' || !state.postPicker) return state
  const picker = state.postPicker
  const drawn = drawFor(state, picker)
  return { ...drawn, turn: otherPlayer(picker), phase: 'pick', postPicker: null }
}

function drawFor(state: GameState, player: PlayerId): GameState {
  const k = state.drawsDone[player]
  if (k >= DRAW_SCHEDULE.length) return state
  const n = Math.min(DRAW_SCHEDULE[k], state.deck.length)
  if (n <= 0) return { ...state, drawsDone: { ...state.drawsDone, [player]: k + 1 } }
  const deck = state.deck.slice()
  const drawn = deck.splice(0, n)
  return {
    ...state,
    deck,
    hands: { ...state.hands, [player]: [...state.hands[player], ...drawn] },
    drawsDone: { ...state.drawsDone, [player]: k + 1 },
  }
}
