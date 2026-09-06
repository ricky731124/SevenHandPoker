import type { Card } from '../game/cards'
import { SLOT_COUNT } from '../game/state'
import type { GameState, PlayerId, Phase, Showdown, SlotOwner, WinReason } from '../game/state'
import type { SpecialCardId } from '../game/specialCards'
import type { SortMode, SortDir } from '../game/sort'

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

/* ---- Spectator view (§4.1): everything face-up -----------------------------
 * A THIRD serialization, alongside the guest view. Spectators see the whole table
 * open: both hands, both sides of every slot pile — only the deck stays a count.
 * The broadcaster (real-human host, or the local player in a casual-bot match)
 * writes this to `spectate/{code}/spec` whenever a watcher is present (§4.2). No
 * hidden info to protect here (accepted v1 limitation, see §1.3), so cards go raw. */
export interface SpecView {
  phase: Phase
  turn: PlayerId
  postPicker: PlayerId | null
  winner: PlayerId | null
  winReason: WinReason | null
  firstPicker: PlayerId
  deckCount: number
  p1Hand: Card[] // full (broadcaster side)
  p2Hand: Card[] // full (opponent — real guest or bot)
  slots: { owner: SlotOwner; p1: Card[]; p2: Card[] }[] // both sides revealed
  pending: { by: PlayerId; count: number } | null
  /** 觀戰全開:已選但未放的牌(真牌)→ 觀戰把它們插回 picker 手牌、lift 顯示 + 喊「N 張」。 */
  pendCards?: Card[]
  lastShowdown: Showdown | null
  specialUsed: Record<PlayerId, boolean>
  // ---- live extras (§ 推牌 / 特殊牌) — broadcaster-side UI state the engine doesn't hold ----
  /** 廣播端(p1)當前推出(已選)的牌 id → 觀戰下方手牌即時 lift(和玩家看到的一致)。 */
  p1Sel?: string[]
  /** 廣播端(p1)當前排序 → 觀戰下方手牌用同排序渲染,推牌位置才對得上。 */
  p1Sort?: { mode: SortMode; dir: SortDir }
  /** 剛用出的特殊牌通知:誰、哪張、n(去重用)→ 觀戰跳 toast(牌變了才不會莫名其妙)。 */
  fx?: { by: PlayerId; card: SpecialCardId; n: number } | null
  /** 玩家暫停中 → 觀戰也顯示「暫停中」(#6)。 */
  paused?: boolean
  /** 玩家送出的貼圖:誰(p1/p2)、貼圖 id、n(去重)→ 觀戰也吃到貼圖效果(#6)。 */
  emote?: { by: PlayerId; id: string; n: number } | null
}

/** Broadcaster-side live UI state that isn't in the engine (§ 推牌/特殊牌/暫停/貼圖). */
export interface SpecExtras {
  p1Sel?: string[]
  p1Sort?: { mode: SortMode; dir: SortDir }
  fx?: { by: PlayerId; card: SpecialCardId; n: number } | null
  paused?: boolean
  emote?: { by: PlayerId; id: string; n: number } | null
}

/** Engine → spectator view. All values real; only the deck is reduced to a count.
 *  `extras` carries live UI state (推牌選取/排序/特殊牌通知) the engine doesn't hold. */
export function serializeForSpectator(engine: GameState, extras?: SpecExtras): SpecView {
  const v: SpecView = {
    phase: engine.phase,
    turn: engine.turn,
    postPicker: engine.postPicker,
    winner: engine.winner,
    winReason: engine.winReason,
    firstPicker: engine.firstPicker,
    deckCount: engine.deck.length,
    p1Hand: engine.hands.p1,
    p2Hand: engine.hands.p2,
    slots: engine.slots.map((s) => ({ owner: s.owner, p1: s.p1, p2: s.p2 })),
    pending: engine.pendingPick ? { by: engine.pendingPick.by, count: engine.pendingPick.cards.length } : null,
    lastShowdown: engine.lastShowdown ? cleanShowdown(engine.lastShowdown) : null,
    specialUsed: engine.specialUsed,
  }
  // 已選未放的牌(真牌)→ 觀戰把它們插回 picker 手牌 lift(否則觀戰看到 picker 的牌憑空消失)。
  if (engine.pendingPick && engine.pendingPick.cards.length) v.pendCards = engine.pendingPick.cards
  // 只塞有值的:RTDB 拒收 undefined;空陣列它會丟掉,讀端已用 ?? [] 防呆。
  if (extras?.p1Sel && extras.p1Sel.length) v.p1Sel = extras.p1Sel
  if (extras?.p1Sort) v.p1Sort = extras.p1Sort
  if (extras?.fx) v.fx = extras.fx
  if (extras?.paused) v.paused = true
  if (extras?.emote) v.emote = extras.emote
  return v
}

/** Spectator view → a GameState the existing GameBoard can render (in spectator
 *  viewMode, which forces every card face-up). RTDB drops empty arrays / all-false
 *  objects, so every field is read defensively (mirrors deserializeForGuest). */
export function deserializeForSpectator(v: SpecView): GameState {
  return {
    seed: 0,
    hands: { p1: v.p1Hand ?? [], p2: v.p2Hand ?? [] },
    deck: hidden(v.deckCount, 'dk'),
    drawsDone: { p1: 0, p2: 0 },
    placementsDone: { p1: 0, p2: 0 },
    // ⚠️ 一定要補滿 7 格:空 slot(owner:null、p1/p2 空陣列)會被 RTDB 整個丟掉,讀回來
    //    v.slots 會變短/稀疏 → 七格對決區只畫出「有牌的」那幾格、擠在一邊。用 index 補回。
    slots: Array.from({ length: SLOT_COUNT }, (_, i) => {
      const s = (v.slots ?? [])[i] as { owner?: SlotOwner; p1?: Card[]; p2?: Card[] } | undefined
      return { owner: s?.owner ?? null, p1: s?.p1 ?? [], p2: s?.p2 ?? [] }
    }),
    turn: v.turn,
    phase: v.phase,
    // 觀戰全開:pending 用真牌(pendCards)還原,觀戰才能把它們插回 picker 手牌 lift;沒有才退回暗牌。
    pendingPick: v.pending
      ? { by: v.pending.by, cards: v.pendCards?.length ? v.pendCards : hidden(v.pending.count, 'pp') }
      : null,
    lastShowdown: v.lastShowdown ?? null,
    postPicker: v.postPicker ?? null,
    firstPicker: v.firstPicker,
    winner: v.winner ?? null,
    winReason: v.winReason ?? null,
    tieBreakWinner: 'p1',
    specialUsed: v.specialUsed ?? { p1: false, p2: false },
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
