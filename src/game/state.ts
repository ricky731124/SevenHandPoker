import type { Card, Suit } from './cards'
import { isSpecial, isStarterSpecial, makeBlank, makeJoker } from './cards'
import { compareLimited, compareValue, evaluate, type LimitedTieStep } from './evaluate'
import { makeLimitedDeck, usesLimitedCompare, type LimitedMode } from './limited'
import { mulberry32, shuffle } from './rng'

export type PlayerId = 'p1' | 'p2'
export type Phase = 'coinToss' | 'pick' | 'place' | 'showdown' | 'draw' | 'ended'
export type WinReason = 'coins4' | 'line3' | 'boardFull'

export const SLOT_COUNT = 7
export const INITIAL_HAND = 10
export const MAX_PICK = 5
export const DRAW_SCHEDULE = [3, 3, 3, 3, 2, 2] as const // per placement, 6 draws

/** A slot's coin owner. `'both'` = the two piles tied (joker collision, SPEC §2.3) → each side gets the coin. */
export type SlotOwner = PlayerId | 'both' | null

export interface Slot {
  p1: Card[] // bottom side (p1's pile, placed by p2)
  p2: Card[] // top side (p2's pile, placed by p1)
  owner: SlotOwner
}

export interface Showdown {
  slot: number
  winner: PlayerId | 'both' // 'both' = tie, both sides win the coin
  p1Name: string
  p2Name: string
  /** if a side's pile held a joker, the concrete card it became (for the reveal) */
  p1WildAs?: Card
  p2WildAs?: Card
  /** 限定房一格多張鬼牌:每張鬼牌各變成什麼(只有 ≥2 張才有) */
  p1Wilds?: Card[]
  p2Wilds?: Card[]
  /** 限定房「牌一樣大」時是哪一步分出的(攤牌多跳一行說明);一般房沒有 */
  note?: LimitedTieStep
}

/** True if `player` holds the coin for this slot (including a shared tie). */
export const ownsSlot = (slot: Slot, player: PlayerId): boolean =>
  slot.owner === player || slot.owner === 'both'

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
  /**
   * Who wins a same-type simultaneous win or a board-full coin tie (SPEC §2.3).
   * Only reachable via a joker tie. Single-player → the computer (p2); online → the host (p1).
   */
  tieBreakWinner: PlayerId
  /**
   * Special-card (ability) activation budget: each player may activate exactly
   * one carried card per match (SPEC §15). `true` once they've spent it. The
   * *which-cards-carried* loadout lives outside the engine (gameStore); the
   * engine only tracks the one-shot budget and applies the concrete effects.
   */
  specialUsed: Record<PlayerId, boolean>
  /**
   * 死神之眼:被翻開的格子。exposed[p] = p 的牌堆被對手看光的格子 index(對決前都保持翻開,
   * 雙方都看得到)。選填:舊快照/回放/測試造的 state 沒有這欄 = 沒有被翻開的牌堆。
   */
  exposed?: Record<PlayerId, number[]>
  /**
   * 限定房玩法(LIMITED-ROOM-SPEC §12)。沒有 = 一般房 / 特殊房 / 主線 / 舊快照 / 舊回放,
   * 一切照舊。發牌、比牌都看這個欄位。
   */
  mode?: LimitedMode
}

export const otherPlayer = (p: PlayerId): PlayerId => (p === 'p1' ? 'p2' : 'p1')

/**
 * @param tieBreakWinner who wins a same-type simultaneous win / board-full coin
 * tie. Single-player defaults to the computer (p2); online passes the host (p1).
 */
export function createGame(
  seed: number,
  firstPicker: PlayerId,
  tieBreakWinner: PlayerId = 'p2',
  mode: LimitedMode | null = null,
): GameState {
  const rng = mulberry32(seed)
  // 沒有限定房玩法 → makeLimitedDeck 給的就是原本的 52 張(洗牌結果跟以前一模一樣)
  const deck = shuffle(makeLimitedDeck(seed, mode), rng)
  const hands: Record<PlayerId, Card[]> = { p1: [], p2: [] }
  // Deal 10 each from the 52-deck, alternating (p1, p2, ...) for determinism.
  for (let i = 0; i < INITIAL_HAND; i++) {
    hands.p1.push(deck.shift()!)
    hands.p2.push(deck.shift()!)
  }
  // Each player also gets 1 off-deck blank + 1 off-deck joker → 12-card start
  // (SPEC §2.2). These don't come from (or return to) the 52-deck.
  hands.p1.push(makeBlank('p1'), makeJoker('p1'))
  hands.p2.push(makeBlank('p2'), makeJoker('p2'))
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
    tieBreakWinner,
    specialUsed: { p1: false, p2: false },
    ...(mode ? { mode } : {}), // RTDB/快照不收 undefined 欄位 → 有才寫
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
  return state.slots.filter((s) => ownsSlot(s, player)).length
}

/** True if `player` has 3 adjacent slots (shared/tied slots count for both). */
function hasLine(state: GameState, player: PlayerId): boolean {
  for (let i = 0; i <= SLOT_COUNT - 3; i++) {
    if (ownsSlot(state.slots[i], player) && ownsSlot(state.slots[i + 1], player) && ownsSlot(state.slots[i + 2], player)) {
      return true
    }
  }
  return false
}

/**
 * Returns winner if a win condition is met, else null. A joker tie shares a slot
 * (both sides own it), so both players can hit a win condition on the same
 * showdown; §2.3 resolves it: 四幣 > 三連, then same-type / board-full coin ties
 * go to `state.tieBreakWinner` (single → computer p2, online → host p1).
 */
export function checkWin(state: GameState): { winner: PlayerId; reason: WinReason } | null {
  const c1 = countCoins(state, 'p1')
  const c2 = countCoins(state, 'p2')
  const p1Coins4 = c1 >= 4
  const p2Coins4 = c2 >= 4
  const p1Win = p1Coins4 || hasLine(state, 'p1')
  const p2Win = p2Coins4 || hasLine(state, 'p2')
  const tb = state.tieBreakWinner

  if (p1Win && p2Win) {
    // 四幣 > 三連: whoever holds the 4-coin win outranks a line-only win.
    if (p1Coins4 !== p2Coins4) return { winner: p1Coins4 ? 'p1' : 'p2', reason: 'coins4' }
    // Same win type → mode tiebreak.
    return { winner: tb, reason: p1Coins4 ? 'coins4' : 'line3' }
  }
  if (p1Win) return { winner: 'p1', reason: p1Coins4 ? 'coins4' : 'line3' }
  if (p2Win) return { winner: 'p2', reason: p2Coins4 ? 'coins4' : 'line3' }

  // Board full with no win condition met → decide by coin count; an equal count
  // is only possible via a shared tie slot, resolved by the mode tiebreak.
  if (state.slots.every((s) => s.owner !== null)) {
    if (c1 !== c2) return { winner: c1 > c2 ? 'p1' : 'p2', reason: 'boardFull' }
    return { winner: tb, reason: 'boardFull' }
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
    const v1 = evaluate(slot.p1)
    const v2 = evaluate(slot.p2)
    // 限定房百鬼夜行 / 撲朔迷離:決勝五步(鬼牌少的贏…);其他照原本比法
    const lim = usesLimitedCompare(state.mode) ? compareLimited(slot.p1, slot.p2) : null
    const cmp = lim ? lim.cmp : compareValue(v1, v2)
    // A joker can copy an in-play card → exact tie possible → both own the slot (§2.3).
    const winner: PlayerId | 'both' = cmp > 0 ? 'p1' : cmp < 0 ? 'p2' : 'both'
    slot.owner = winner
    next.lastShowdown = {
      slot: slotIndex,
      winner,
      p1Name: v1.name,
      p2Name: v2.name,
      p1WildAs: v1.wildAs,
      p2WildAs: v2.wildAs,
    }
    if (v1.wildsAs) next.lastShowdown.p1Wilds = v1.wildsAs
    if (v2.wildsAs) next.lastShowdown.p2Wilds = v2.wildsAs
    if (lim?.by) next.lastShowdown.note = lim.by
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

// ---- Special cards (SPEC §15). Each is a pure effect on the engine; the one-
// shot budget is state.specialUsed[player]. Callers must gate on canUseSpecial. ----

/** A card that a special effect may target: a normal (52-deck) card only. The
 *  off-deck blank/joker can never be swapped, re-suited, or discarded (§2.1). */
export const isTargetable = (c: Card): boolean => !isSpecial(c)

/** Valid targets for a suit-change card: normal hand cards not already that suit. */
export function suitTargets(state: GameState, player: PlayerId, suit: Suit): Card[] {
  return state.hands[player].filter((c) => isTargetable(c) && c.suit !== suit)
}

/** Valid `clubs` targets: normal, non-club hand cards. (Back-compat helper.) */
export function clubsTargets(state: GameState, player: PlayerId): Card[] {
  return suitTargets(state, player, 'C')
}

/** Valid `swap` targets: any normal hand card (blank/joker excluded). */
export function swapTargets(state: GameState, player: PlayerId): Card[] {
  return state.hands[player].filter(isTargetable)
}

/** The cards `player` will draw on their NEXT draw (peek). Read-only. */
export function peekNextDraw(state: GameState, player: PlayerId): Card[] {
  const k = state.drawsDone[player]
  if (k >= DRAW_SCHEDULE.length) return []
  const n = Math.min(DRAW_SCHEDULE[k], state.deck.length)
  return state.deck.slice(0, n)
}

/** Mark the one-shot special budget as spent (peek/spy have no board effect). */
export function markSpecialUsed(state: GameState, player: PlayerId): GameState {
  return { ...state, specialUsed: { ...state.specialUsed, [player]: true } }
}

/**
 * 偷天換日 (swap): discard one hand card back into the deck and draw a random
 * undealt card in its place — a net one-card exchange. We draw first, then
 * reinsert the discard at a random spot, so you can never draw the same card
 * straight back. `rng` defaults to Math.random (pass a seeded one in tests).
 */
export function applySwap(
  state: GameState,
  player: PlayerId,
  cardId: string,
  rng: () => number = Math.random,
): GameState {
  const hand = state.hands[player]
  const idx = hand.findIndex((c) => c.id === cardId)
  if (idx < 0) return state
  const card = hand[idx]
  if (!isTargetable(card) || state.deck.length === 0) return state
  const deck = state.deck.slice()
  const drawn = deck.splice(Math.floor(rng() * deck.length), 1)[0]
  deck.splice(Math.floor(rng() * (deck.length + 1)), 0, card) // discard re-enters the pool
  const nextHand = hand.slice()
  nextHand[idx] = drawn
  return {
    ...state,
    deck,
    hands: { ...state.hands, [player]: nextHand },
    specialUsed: { ...state.specialUsed, [player]: true },
  }
}

/**
 * Suit-bloom cards (踏雪尋梅 / 鑽石永恆 / 正中紅心 / 黑桃鴨): re-suit one hand
 * card to `suit`, keeping its rank and id. If that produces a card identical to
 * one already in play, the eventual showdown ties via the existing `'both'` path
 * (§2.3) — no new mechanism needed. The off-deck blank/joker can't be re-suited.
 */
export function applySuit(state: GameState, player: PlayerId, cardId: string, suit: Suit): GameState {
  const hand = state.hands[player]
  const idx = hand.findIndex((c) => c.id === cardId)
  if (idx < 0) return state
  const card = hand[idx]
  if (!isTargetable(card) || card.suit === suit) return state
  const nextHand = hand.slice()
  // Keep id + rank; remember the original suit so the showdown can reveal the
  // change (e.g. ♣A→♠A). Only one special per match, so a card is never
  // re-suited twice — the first original suit is the one that matters.
  nextHand[idx] = { ...card, suit, resuitFrom: card.resuitFrom ?? card.suit }
  return {
    ...state,
    hands: { ...state.hands, [player]: nextHand },
    specialUsed: { ...state.specialUsed, [player]: true },
  }
}

/** 踏雪尋梅: re-suit a card to clubs. (Back-compat wrapper over applySuit.) */
/** 強迫更新 可用嗎:對手手上要有普通牌(空白/鬼牌不算)、牌堆不能是空的(空的話洗回去抽到的還是同一批)。 */
export function canRefresh(state: GameState, player: PlayerId): boolean {
  return state.deck.length > 0 && state.hands[otherPlayer(player)].some(isTargetable)
}

/**
 * 強迫更新 (refresh): the FOE's normal hand cards go back into the deck, the whole
 * deck is reshuffled, and the foe draws the same number back off the top — so both
 * the foe's hand and the deck order change. The off-deck blank/joker stay in hand
 * (they never belong to the 52-deck). A re-suited card (踏雪尋梅…) returns with its
 * ORIGINAL suit — its id is still the original card's, and keeping the new suit
 * would put a duplicate (e.g. two ♠A) into the deck.
 * Only ONE rng() call (→ a shuffle seed), so a replay records a single number.
 */
export function applyRefresh(state: GameState, player: PlayerId, rng: () => number = Math.random): GameState {
  if (!canRefresh(state, player)) return state
  const foe = otherPlayer(player)
  const hand = state.hands[foe]
  const back = hand.filter(isTargetable).map(restoreSuit)
  const keep = hand.filter((c) => !isTargetable(c))
  const seed = Math.floor(rng() * 0x100000000) >>> 0
  const deck = shuffle([...state.deck, ...back], mulberry32(seed))
  const drawn = deck.splice(0, back.length)
  return {
    ...state,
    deck,
    hands: { ...state.hands, [foe]: [...drawn, ...keep] },
    specialUsed: { ...state.specialUsed, [player]: true },
  }
}

/** 爆破可以炸的牌:對手手上除了開局給的空白/鬼牌以外的牌。 */
export function explodeTargets(state: GameState, player: PlayerId): Card[] {
  return state.hands[otherPlayer(player)].filter((c) => !isStarterSpecial(c))
}

export function canExplode(state: GameState, player: PlayerId): boolean {
  return explodeTargets(state, player).length > 0
}

/**
 * 爆破 (explode): blow up ONE random card in the foe's hand (never their starter
 * blank/joker). The card leaves the game for good — not back into the deck, not
 * onto the board — so later effects that pull from the deck or the played piles
 * can never bring it back. One rng() call → which target, so a replay records one
 * number.
 */
export function applyExplode(state: GameState, player: PlayerId, rng: () => number = Math.random): GameState {
  const targets = explodeTargets(state, player)
  if (!targets.length) return state
  const victim = targets[Math.min(targets.length - 1, Math.floor(rng() * targets.length))]
  const foe = otherPlayer(player)
  return {
    ...state,
    hands: { ...state.hands, [foe]: state.hands[foe].filter((c) => c.id !== victim.id) },
    specialUsed: { ...state.specialUsed, [player]: true },
  }
}

/** 前後兩個手牌比對,找出被拿掉的那張(爆破後用來顯示「炸掉了 ♠K」)。 */
export function removedCard(before: Card[], after: Card[]): Card | undefined {
  const left = new Set(after.map((c) => c.id))
  return before.find((c) => !left.has(c.id))
}

/** `player` 放在決鬥區、被對手用死神之眼翻開的格子(對決前都保持翻開)。 */
export function exposedSlots(state: GameState, player: PlayerId): number[] {
  return state.exposed?.[player] ?? []
}

/** 死神之眼能翻的格子:對手已放、還沒對決、還沒被翻過的牌堆。 */
export function deathEyeSlots(state: GameState, player: PlayerId): number[] {
  const foe = otherPlayer(player)
  const seen = exposedSlots(state, foe)
  const out: number[] = []
  state.slots.forEach((s, i) => {
    if (s[foe].length > 0 && s.owner === null && !seen.includes(i)) out.push(i)
  })
  return out
}

export function canDeathEye(state: GameState, player: PlayerId): boolean {
  return deathEyeSlots(state, player).length > 0
}

/**
 * 死神之眼 (deathEye, 使用者 2026-10-15 定案): flip every pile the foe has on the
 * board that hasn't dueled yet. Those piles stay face-up — to BOTH players — until
 * their showdown; piles the foe places afterwards stay face-down as usual. Pure
 * information, no card moves and no randomness (replay needs no rng).
 */
export function applyDeathEye(state: GameState, player: PlayerId): GameState {
  const slots = deathEyeSlots(state, player)
  if (!slots.length) return state
  const foe = otherPlayer(player)
  const exposed = { p1: exposedSlots(state, 'p1'), p2: exposedSlots(state, 'p2') }
  exposed[foe] = [...exposed[foe], ...slots]
  return { ...state, exposed, specialUsed: { ...state.specialUsed, [player]: true } }
}

/** 被花色卡改過的牌 → 變回原花色(不留 undefined 欄位,RTDB set() 才不會出錯)。 */
function restoreSuit(c: Card): Card {
  if (!c.resuitFrom) return c
  const { resuitFrom, ...rest } = c
  return { ...rest, suit: resuitFrom }
}

export function applyClubs(state: GameState, player: PlayerId, cardId: string): GameState {
  return applySuit(state, player, cardId, 'C')
}
