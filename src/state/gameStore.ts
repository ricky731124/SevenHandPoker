import { create } from 'zustand'
import type { Card } from '../game/cards'
import { evaluate } from '../game/evaluate'
import { randomSeed } from '../game/rng'
import { sortHand, type SortDir, type SortMode } from '../game/sort'
import {
  applyDraw,
  applyPick,
  applyPlace,
  applySuit,
  applySwap,
  createGame,
  emptySlotsFor,
  markSpecialUsed,
  otherPlayer,
  peekNextDraw,
  resolveShowdown,
  suitTargets,
  swapTargets,
  type GameState,
  type PlayerId,
} from '../game/state'
import type { Suit } from '../game/cards'
import type { GameMode } from './appStore'
import type { Role } from '../net/room'
import type { Intent, LiveSel } from '../net/sync'
import { getSpecialCard, type SpecialCardId } from '../game/specialCards'
import { aiChooseSpecial } from '../game/ai'
import { bossChooseSpecial, type BossRuntime } from '../game/bossAI'
import { useToastStore } from './toastStore'
import { usePlatformStore } from './platformStore'
import { matchHandTypeCounts, handTypeOf, isSfDuel } from '../game/achievements'
import { sfx } from '../audio/sfx'

/**
 * Tally a finished match into 戰績 + 連勝/場次/勝場成就 (once per match). 線上 →
 * pvp bucket; 自由對戰電腦 + 主線 boss → solo. Fire-and-forget (never blocks UI).
 * 牌型成就在送出當下即時判定(reportHandPlayed),不在這裡。
 */
function recordMatchStat(online: boolean, won: boolean): void {
  void usePlatformStore.getState().recordMatchResult(online ? 'pvp' : 'solo', won)
}

/**
 * When I commit a pile (送出), if it's a tracked hand type, report its single-
 * match running count (already-placed of mine + this one) so a crossed 牌型
 * achievement tier pops the instant I send it (使用者:送出即彈,不等結算).
 */
function reportPickHandType(state: GameState, me: PlayerId, pileIds: string[]): void {
  const pile = state.hands[me].filter((c) => pileIds.includes(c.id))
  const metric = handTypeOf(pile)
  if (!metric) return
  const count = matchHandTypeCounts(state, me)[metric] + 1 // prior placed + this send
  void usePlatformStore.getState().reportHandPlayed(metric, count)
}

/** On a fresh showdown, if it's 同花順 vs 同花順 (both piles revealed), tally the
 *  狹路相逢 achievement. Fires once per showdown on each client (own tally). */
function reportShowdownDuel(engine: GameState): void {
  const sd = engine.lastShowdown
  if (!sd) return
  const slot = engine.slots[sd.slot]
  if (slot && isSfDuel(slot.p1, slot.p2)) void usePlatformStore.getState().reportSfDuel()
}

export type Status = 'coinToss' | 'playing' | 'ended'

const SUIT_ZH: Record<Suit, string> = { C: '梅花', D: '方塊', H: '紅心', S: '黑桃' }

/**
 * The special-card loadout the single-player AI opponent carries (SPEC §15 "選 3
 * 用 1"). A generic mix — a swap plus two suit-bloom colours — so the AI has
 * something to use against most hands. Per-boss loadouts arrive with Phase E.
 */
const AI_LOADOUT: SpecialCardId[] = ['swap', 'clubs', 'hearts']

/** Result of a peek/spy activation, shown in an info modal. */
export interface SpecialInfo {
  kind: 'peek' | 'spy'
  cards: Card[]
}

export interface HostSnapshot {
  engine: GameState
  coinFirstPicker: PlayerId | null
  foeSelForGuest: LiveSel | null
  /** room config, so a host reload keeps the special-card room + timer alive */
  special: boolean
  loadout: SpecialCardId[]
  timeLimit: number
}

export interface OnlineInfo {
  role: Role
  code: string
  /** guest → host intent sender (no-op for host) */
  send: (i: Intent) => void
  /** throttled live-selection writer (情報戰 preview) */
  sendLive: (s: LiveSel | null) => void
  /** signal "I agree to a rematch" */
  sendRematch: () => void
  /** signal "I've confirmed my pre-match loadout" (special-room B barrier) */
  sendReady: () => void
  /** host → guest: a foe-facing special-card notice to toast (guest = no-op) */
  sendFx: (msg: string) => void
  /** write the shared pause state (both sides read it back) */
  sendPause: (p: PauseState) => void
  /** broadcast a sticker (貼圖) to the opponent — cosmetic, off the engine */
  sendEmote: (e: EmoteMsg) => void
  /** tear down listeners + presence when leaving */
  teardown: () => void
}

/** A sticker broadcast over the online side-channel (rooms/{code}/emote). `by`
 *  identifies the sender so each client shows it from the SENDER's avatar; `n`
 *  forces a change even when the same sticker is sent twice. */
export interface EmoteMsg {
  by: Role
  id: string
  n: number
}

/** Shared online pause (SPEC §15 / #14 Stage C): a single shared flag. Either
 *  player may pause or resume, unlimited times (anyone can interrupt anyone). */
export interface PauseState {
  active: boolean
}

interface GameStore {
  mode: GameMode
  me: PlayerId
  engine: GameState | null
  status: Status
  coinFirstPicker: PlayerId | null

  // UI
  selected: string[]
  confirm: { cards: Card[]; name: string } | null
  showdownOpen: boolean
  endOpen: boolean
  magnifier: { side: PlayerId; slot: number } | null
  sortMode: SortMode
  sortDir: SortDir
  /** the opponent's picked-but-unplaced selection, shown pushed out */
  foeSelection: { total: number; idx: number[] } | null

  // ----- special cards (Phase C, single-player) -----
  /** this match is a special-card room (loadout + pre-match pick + in-game tray) */
  special: boolean
  /** the ≤3 cards carried into THIS match (from the pre-match pick screen) */
  loadout: SpecialCardId[]
  /** the single-player AI opponent's carried loadout (empty unless a special AI room) */
  aiLoadout: SpecialCardId[]
  /** campaign boss brain for the AI opponent (null = default AI / non-campaign) */
  aiBoss: BossRuntime | null
  /** campaign: called once when a match ends, with whether the human won (drives the BO series) */
  onMatchEnd: ((winnerIsMe: boolean) => void) | null
  /** the pre-match pick (B) has been confirmed → proceed to the coin toss */
  loadoutReady: boolean
  /** online: I confirmed my loadout and am waiting for the opponent (B barrier) */
  loadoutWaiting: boolean
  /** the in-game activation tray (the 3 carried cards) is open */
  specialTrayOpen: boolean
  /** a target-needing card was chosen → now picking a hand card to target */
  specialTargeting: SpecialCardId | null
  /** result of a peek/spy activation, shown in a modal */
  specialInfo: SpecialInfo | null
  /** per-turn time limit (seconds) chosen in the create-match config (#9) */
  timeLimit: number
  /** online shared pause state (Stage C) */
  onlinePause: PauseState
  /** latest sticker the OPPONENT sent (shown from their avatar); null = none */
  incomingEmote: EmoteMsg | null
  /** transient center-status override (e.g. "你已使用了「偷天換日」"); auto-clears */
  statusOverride: string | null

  // online (Phase 2 / 3)
  online: OnlineInfo | null
  /** host's pushed-out pick, captured at pick time so the guest can render it */
  foeSelForGuest: LiveSel | null
  /** the opponent's LIVE pick preview (情報戰); takes precedence over foeSelection */
  foeLive: LiveSel | null
  /** slot of the showdown the guest already dismissed (so sync won't reopen it) */
  guestAckSlot: number | null
  /** host-side showdown acknowledgements; both must ack before advancing */
  acks: { p1: boolean; p2: boolean }
  /** I have agreed to a rematch and am waiting for the opponent */
  rematchPending: boolean
  /** the opponent has agreed to a rematch (shown on my end screen) */
  foeWantsRematch: boolean

  // lifecycle
  startSinglePlayer: (special?: boolean, loadout?: SpecialCardId[], ready?: boolean, timeLimit?: number) => void
  /** campaign: start one match vs a boss (BossRuntime), reporting the result to the series. */
  startCampaignMatch: (opts: {
    special: boolean
    timeLimit: number
    loadout: SpecialCardId[]
    aiLoadout: SpecialCardId[]
    boss: BossRuntime
    onMatchEnd: (winnerIsMe: boolean) => void
  }) => void
  finishCoinToss: () => void
  finishCoinTossOnline: () => void
  reset: () => void
  nextGame: () => void
  startOnlineHost: (o: Omit<OnlineInfo, 'role'>, special?: boolean, timeLimit?: number, loadout?: SpecialCardId[]) => void
  startOnlineGuest: (o: Omit<OnlineInfo, 'role'>, reconnect?: boolean, special?: boolean, timeLimit?: number, loadout?: SpecialCardId[]) => void
  restoreOnlineHost: (o: Omit<OnlineInfo, 'role'>, snap: HostSnapshot) => void
  setFoeWantsRematch: (v: boolean) => void
  applyGuestView: (v: { engine: GameState; foeSel: LiveSel | null }) => void
  leaveOnline: () => void
  /** Record a 中離 result for an online match (iWon = opponent left/timed-out).
   *  No-op unless the match actually started and hasn't ended (開局前不計). Call
   *  right before leaveOnline. */
  forfeitOnline: (iWon: boolean) => void
  rematchStart: () => void
  agreeRematch: () => void

  // live selection (情報戰)
  emitLive: () => void
  setFoeLive: (s: LiveSel | null) => void

  // showdown ack (online)
  hostGuestContinue: () => void

  // hand / pick
  toggleCard: (id: string) => void
  clearSelection: () => void
  openConfirm: () => void
  cancelConfirm: () => void
  confirmPick: () => void

  // place
  placeAt: (slot: number) => void
  doDraw: () => void

  // showdown / magnifier
  dismissShowdown: () => void
  openMagnifier: (side: PlayerId, slot: number) => void
  closeMagnifier: () => void

  // sort
  toggleSortMode: () => void
  toggleSortDir: () => void

  // special cards (Phase C)
  confirmLoadout: (ids: SpecialCardId[]) => void
  /** online B barrier: both sides confirmed → advance to the coin toss */
  setLoadoutReady: () => void
  /** online pause (Stage C): apply synced state / toggle my pause */
  applyPause: (p: PauseState) => void
  togglePauseOnline: () => void
  /** sticker: broadcast mine to the opponent (online); apply one they sent */
  sendEmote: (id: string) => void
  applyEmote: (e: EmoteMsg) => void
  /** briefly show a message in the center status area (5s), then revert */
  flashStatus: (msg: string) => void
  /** guest: show a peek/spy result pushed from the host's private info channel */
  showSpecialInfo: (info: SpecialInfo) => void
  openSpecialTray: () => void
  closeSpecialTray: () => void
  /** pick one of the carried cards: target-needing → targeting; info → resolve now */
  chooseSpecial: (id: SpecialCardId) => void
  /** apply a target-needing card (swap/clubs) to the chosen hand card */
  activateSpecialTarget: (cardId: string) => void
  cancelSpecialTarget: () => void
  closeSpecialInfo: () => void

  /** single-player: AI opponent may activate one carried special before its
   *  pick (#13). Applies the effect to the engine; returns true if it acted. */
  aiMaybeSpecial: () => boolean

  /** per-turn timer ran out on my turn → auto-play a legal move (#9, single-player) */
  timeoutAutoPlay: () => void

  // engine internals
  submitPick: (ids: string[]) => void
  applyEngine: (next: GameState) => void
}

export const useGameStore = create<GameStore>((set, get) => ({
  mode: 'ai',
  me: 'p1',
  engine: null,
  status: 'coinToss',
  coinFirstPicker: null,

  selected: [],
  confirm: null,
  showdownOpen: false,
  endOpen: false,
  magnifier: null,
  sortMode: 'rank',
  sortDir: 'asc',
  foeSelection: null,
  special: false,
  loadout: [],
  aiLoadout: [],
  aiBoss: null,
  onMatchEnd: null,
  loadoutReady: false,
  loadoutWaiting: false,
  specialTrayOpen: false,
  specialTargeting: null,
  specialInfo: null,
  timeLimit: 50,
  onlinePause: { active: false },
  incomingEmote: null,
  statusOverride: null,
  online: null,
  foeSelForGuest: null,
  foeLive: null,
  guestAckSlot: null,
  acks: { p1: false, p2: false },
  rematchPending: false,
  foeWantsRematch: false,

  startSinglePlayer: (special = false, loadout = [], ready = false, timeLimit = 50) => {
    const firstPicker: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2'
    set({
      mode: 'ai',
      timeLimit,
      me: 'p1',
      engine: null,
      status: 'coinToss',
      coinFirstPicker: firstPicker,
      selected: [],
      confirm: null,
      showdownOpen: false,
      endOpen: false,
      magnifier: null,
      foeSelection: null,
      sortMode: 'rank',
      sortDir: 'asc',
      special,
      loadout,
      aiLoadout: special ? AI_LOADOUT : [],
      aiBoss: null,
      onMatchEnd: null,
      // Normal room never shows the pre-match pick; a special room shows it once
      // per fresh game (rematch passes ready=true to reuse the same loadout).
      loadoutReady: special ? ready : true,
      specialTrayOpen: false,
      specialTargeting: null,
      specialInfo: null,
    })
  },

  startCampaignMatch: ({ special, timeLimit, loadout, aiLoadout, boss, onMatchEnd }) => {
    const firstPicker: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2'
    set({
      mode: 'ai',
      timeLimit,
      me: 'p1',
      engine: null,
      status: 'coinToss',
      coinFirstPicker: firstPicker,
      selected: [],
      confirm: null,
      showdownOpen: false,
      endOpen: false,
      magnifier: null,
      foeSelection: null,
      sortMode: 'rank',
      sortDir: 'asc',
      special,
      loadout,
      aiLoadout,
      aiBoss: boss,
      onMatchEnd,
      // special room → show the pre-match pick (B) each match; normal → skip.
      loadoutReady: !special,
      specialTrayOpen: false,
      specialTargeting: null,
      specialInfo: null,
    })
  },

  finishCoinToss: () => {
    const first = get().coinFirstPicker ?? 'p1'
    const engine = createGame(randomSeed(), first)
    set({ engine, status: 'playing' })
  },

  reset: () => set({ engine: null, status: 'coinToss', selected: [], confirm: null, showdownOpen: false, endOpen: false, magnifier: null }),

  nextGame: () => {
    // Rematch: a special room STILL shows the pre-match pick (after the VS
    // intro), but pre-filled with LAST match's loadout — not the profile
    // default (that only seeds the very first match). ready=false → B shows;
    // startSinglePlayer seeds `loadout` with the carried-over selection.
    const { special, loadout, timeLimit } = get()
    get().startSinglePlayer(special, loadout, false, timeLimit)
  },

  // ----- Online (Phase 2 / 3) -----
  // Host owns the engine and runs it locally (like single-player but the
  // opponent's moves arrive as intents instead of from the AI). Both sides play
  // the coin-toss ritual off the same randomised first picker.
  startOnlineHost: (o, special = false, timeLimit = 50, loadout = []) => {
    const firstPicker: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2'
    // Online: a same-type simultaneous win / board-full coin tie goes to the host (p1).
    const engine = createGame(randomSeed(), firstPicker, 'p1')
    set({
      mode: 'host',
      online: { ...o, role: 'host' },
      me: 'p1',
      engine,
      status: 'coinToss',
      coinFirstPicker: firstPicker,
      selected: [],
      confirm: null,
      showdownOpen: false,
      endOpen: false,
      magnifier: null,
      foeSelection: null,
      foeSelForGuest: null,
      foeLive: null,
      guestAckSlot: null,
      acks: { p1: false, p2: false },
      rematchPending: false,
      foeWantsRematch: false,
      sortMode: 'rank',
      sortDir: 'asc',
      // Carry room config; a special room shows the pre-match pick B (both must
      // confirm before the coin) — normal room skips it.
      special,
      timeLimit,
      loadout,
      loadoutReady: !special,
      loadoutWaiting: false,
      specialTrayOpen: false,
      specialTargeting: null,
      specialInfo: null,
    })
  },

  // Guest holds no engine of its own — it renders whatever the host syncs and
  // sends intents for its moves. On reconnect (mid-game) skip the coin toss.
  startOnlineGuest: (o, reconnect = false, special = false, timeLimit = 50, loadout = []) => {
    set({
      mode: 'guest',
      online: { ...o, role: 'guest' },
      me: 'p2',
      engine: null,
      status: reconnect ? 'playing' : 'coinToss',
      coinFirstPicker: null,
      selected: [],
      confirm: null,
      showdownOpen: false,
      endOpen: false,
      magnifier: null,
      foeSelection: null,
      foeSelForGuest: null,
      foeLive: null,
      guestAckSlot: null,
      acks: { p1: false, p2: false },
      rematchPending: false,
      foeWantsRematch: false,
      sortMode: 'rank',
      sortDir: 'asc',
      // Carry room config; special room shows B (reconnect skips it — mid-game).
      special,
      timeLimit,
      loadout,
      loadoutReady: !special || reconnect,
      loadoutWaiting: false,
      specialTrayOpen: false,
      specialTargeting: null,
      specialInfo: null,
    })
  },

  // Host reconnect: restore the authoritative engine from the local snapshot and
  // resume — no reshuffle, no coin toss (already past it).
  restoreOnlineHost: (o, snap) => {
    set({
      mode: 'host',
      online: { ...o, role: 'host' },
      me: 'p1',
      engine: snap.engine,
      status: 'playing',
      coinFirstPicker: snap.coinFirstPicker,
      selected: [],
      confirm: null,
      showdownOpen: snap.engine.phase === 'showdown',
      endOpen: snap.engine.phase === 'ended',
      magnifier: null,
      foeSelection: null,
      foeSelForGuest: snap.foeSelForGuest ?? null,
      foeLive: null,
      guestAckSlot: null,
      acks: { p1: false, p2: false },
      rematchPending: false,
      foeWantsRematch: false,
      sortMode: 'rank',
      sortDir: 'asc',
      // Restore the room config so the special-card button + timer survive a
      // reload; we're mid-game so the pre-match pick B is already done.
      special: snap.special,
      loadout: snap.loadout,
      timeLimit: snap.timeLimit,
      loadoutReady: true,
      loadoutWaiting: false,
      specialTrayOpen: false,
      specialTargeting: null,
      specialInfo: null,
    })
  },

  setFoeWantsRematch: (v) => set({ foeWantsRematch: v }),

  finishCoinTossOnline: () => set({ status: 'playing' }),

  applyGuestView: (v) => {
    const prev = get()
    const engine = v.engine
    // A fresh engine after we'd already ended = the host started a rematch.
    const newGame = prev.endOpen && engine.winner === null && engine.phase !== 'ended'
    let showdownOpen = false
    if (engine.phase === 'showdown' && engine.lastShowdown) {
      showdownOpen = prev.guestAckSlot !== engine.lastShowdown.slot
    }
    const endOpen = engine.phase === 'ended'
    // one-shot sounds on transitions
    if (showdownOpen && !prev.showdownOpen) {
      engine.lastShowdown?.winner === prev.me ? sfx.coin() : sfx.showdown()
      reportShowdownDuel(engine) // 同花順 vs 同花順 → 狹路相逢
    }
    if (endOpen && !prev.endOpen) {
      const won = engine.winner === prev.me
      won ? sfx.win() : sfx.lose()
      recordMatchStat(true, won) // guest side of online → pvp 戰績
    }
    // foeSelection = the submitted pick (place phase); the LIVE preview during a
    // pick lives in foeLive and is set by the live listener — don't clobber it.
    // Drop any selected card that's no longer in my hand (e.g. after the host
    // applied my swap) so the 送出 count stays correct.
    const myIds = new Set(engine.hands[prev.me].map((c) => c.id))
    set({
      engine,
      foeSelection: v.foeSel,
      showdownOpen,
      endOpen,
      coinFirstPicker: engine.firstPicker,
      selected: prev.selected.filter((id) => myIds.has(id)),
      ...(newGame
        ? {
            status: 'coinToss',
            endOpen: false,
            showdownOpen: false,
            rematchPending: false,
            foeWantsRematch: false,
            guestAckSlot: null,
            foeLive: null,
            // Special rematch → show B again (carry my loadout); normal → skip.
            loadoutReady: !prev.special,
            loadoutWaiting: false,
            specialTrayOpen: false,
            specialTargeting: null,
            specialInfo: null,
          }
        : {}),
    })
  },

  leaveOnline: () => {
    const { online } = get()
    online?.teardown?.()
    set({
      online: null,
      engine: null,
      status: 'coinToss',
      selected: [],
      confirm: null,
      showdownOpen: false,
      endOpen: false,
      magnifier: null,
      foeSelection: null,
      foeSelForGuest: null,
      foeLive: null,
      guestAckSlot: null,
      acks: { p1: false, p2: false },
      rematchPending: false,
      foeWantsRematch: false,
    })
  },

  forfeitOnline: (iWon) => {
    const { online, engine } = get()
    if (!online || !engine || engine.phase === 'ended') return
    // 開局前(還沒送出第一張牌)離開 → 雙方不計。用「已放進格子的牌」判定開局:
    // guest 的鏡像 placementsDone 恆為 0(見 sync.deserializeForGuest),但 slots
    // 兩端都有真實張數,所以 host 中離時 guest 才能正確拿到判勝 + 真人鑽石。
    const anyPlaced = engine.slots.some((s) => s.p1.length > 0 || s.p2.length > 0)
    const started = anyPlaced || engine.placementsDone.p1 + engine.placementsDone.p2 > 0 || !!engine.pendingPick
    if (!started) return
    void usePlatformStore.getState().recordMatchResult('pvp', iWon)
  },

  rematchStart: () => {
    const { online, special, loadout } = get()
    if (!online) return
    const firstPicker: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2'
    // Online rematch is host-run too → host (p1) wins ties.
    const engine = createGame(randomSeed(), firstPicker, 'p1')
    set({
      engine,
      status: 'coinToss',
      coinFirstPicker: firstPicker,
      selected: [],
      confirm: null,
      showdownOpen: false,
      endOpen: false,
      magnifier: null,
      foeSelection: null,
      foeSelForGuest: null,
      foeLive: null,
      guestAckSlot: null,
      acks: { p1: false, p2: false },
      rematchPending: false,
      foeWantsRematch: false,
      sortMode: 'rank',
      sortDir: 'asc',
      // Special rematch → show B again, pre-filled with last match's loadout.
      loadout,
      loadoutReady: !special,
      loadoutWaiting: false,
      specialTrayOpen: false,
      specialTargeting: null,
      specialInfo: null,
    })
  },

  agreeRematch: () => {
    const { online } = get()
    if (!online) return
    set({ rematchPending: true })
    online.sendRematch()
  },

  emitLive: () => {
    const { engine, me, selected, sortMode, sortDir, online } = get()
    if (!online || !engine) return
    if (!(engine.phase === 'pick' && engine.turn === me)) return
    const ordered = sortHand(engine.hands[me], sortMode, sortDir)
    const idSet = new Set(selected)
    const idx = ordered.map((c, i) => (idSet.has(c.id) ? i : -1)).filter((i) => i >= 0)
    // Empty selection → clear the live node (null). Never write an empty array:
    // RTDB drops empty arrays, so the peer would read {total} with idx undefined.
    online.sendLive(idx.length ? { total: ordered.length, idx } : null)
  },

  setFoeLive: (s) => set({ foeLive: s }),

  hostGuestContinue: () => {
    const { engine } = get()
    if (!engine || engine.phase !== 'showdown') return
    const acks = { ...get().acks, p2: true }
    set({ acks })
    if (acks.p1) get().applyEngine(resolveShowdown(engine))
  },

  toggleCard: (id) => {
    const { engine, me, selected } = get()
    if (!engine || engine.phase !== 'pick' || engine.turn !== me) return
    if (selected.includes(id)) {
      set({ selected: selected.filter((x) => x !== id) })
      sfx.select()
    } else {
      if (selected.length >= 5) return
      set({ selected: [...selected, id] })
      sfx.select()
    }
    get().emitLive() // 情報戰: broadcast my live selection (throttled downstream)
  },

  clearSelection: () => set({ selected: [] }),

  openConfirm: () => {
    const { engine, me, selected } = get()
    if (!engine || selected.length === 0) return
    const cards = engine.hands[me].filter((c) => selected.includes(c.id))
    set({ confirm: { cards, name: evaluate(cards).name } })
    sfx.click()
  },

  cancelConfirm: () => set({ confirm: null }),

  confirmPick: () => {
    const { selected, online, engine, sortMode, sortDir, me } = get()
    // 牌型成就:我送出這疊的當下就判定(送出即彈,不等結算)。
    if (engine) reportPickHandType(engine, me, selected)
    // Pushed-out positions in MY current sorted order, so the opponent's view
    // matches the live preview exactly (no jump on submit).
    let sortedSel: LiveSel | null = null
    if (engine) {
      const ordered = sortHand(engine.hands[me], sortMode, sortDir)
      const idSet = new Set(selected)
      const idx = ordered.map((c, i) => (idSet.has(c.id) ? i : -1)).filter((i) => i >= 0)
      sortedSel = { total: ordered.length, idx }
    }
    if (online?.role === 'guest') {
      online.send({ type: 'pick', ids: selected, sel: sortedSel ?? undefined })
      online.sendLive(null)
      set({ confirm: null, selected: [] })
      return
    }
    if (online?.role === 'host') {
      set({ foeSelForGuest: sortedSel })
      online.sendLive(null)
    }
    get().submitPick(selected)
    set({ confirm: null, selected: [] })
  },

  submitPick: (ids) => {
    const { engine, me } = get()
    if (!engine) return
    const picker = engine.turn
    try {
      // If the opponent (not me) is picking, record which cards were pulled so
      // the UI can push them out at their real positions until I place them.
      let foeSelection = get().foeSelection
      if (picker !== me) {
        const order = engine.hands[picker]
        const idSet = new Set(ids)
        const idx = order.map((c, i) => (idSet.has(c.id) ? i : -1)).filter((i) => i >= 0)
        foeSelection = { total: order.length, idx }
      }
      const next = applyPick(engine, picker, ids)
      sfx.deal()
      set({ foeSelection })
      get().applyEngine(next)
    } catch (e) {
      console.warn('pick rejected', e)
    }
  },

  placeAt: (slot) => {
    const { engine, online } = get()
    if (!engine) return
    if (online?.role === 'guest') {
      online.send({ type: 'place', slot })
      return
    }
    if (!engine.pendingPick) return
    const placer = otherPlayer(engine.pendingPick.by)
    try {
      const next = applyPlace(engine, placer, slot)
      sfx.deal()
      set({ foeSelection: null })
      get().applyEngine(next)
    } catch (e) {
      console.warn('place rejected', e)
    }
  },

  doDraw: () => {
    const { engine } = get()
    if (!engine || engine.phase !== 'draw') return
    get().applyEngine(applyDraw(engine))
  },

  applyEngine: (next) => {
    set({ engine: next })
    if (next.phase === 'showdown') {
      // new showdown → require both players to acknowledge before advancing
      set({ acks: { p1: false, p2: false } })
      // Let the coin topple / placement land first, then reveal the showdown.
      if (next.lastShowdown) {
        next.lastShowdown.winner === get().me ? sfx.coin() : sfx.showdown()
        reportShowdownDuel(next) // 同花順 vs 同花順 → 狹路相逢
      }
      // Let the placement land and read before the showdown popup — new players
      // need a beat to see WHERE the opponent placed their cards (SPEC §14).
      setTimeout(() => {
        if (get().engine === next && next.phase === 'showdown') set({ showdownOpen: true })
      }, 800)
    } else if (next.phase === 'draw') {
      // Discrete draw step: pause so the deal animation reads, then draw.
      setTimeout(() => {
        if (get().engine === next && next.phase === 'draw') get().doDraw()
      }, 480)
    } else if (next.phase === 'ended') {
      setTimeout(() => set({ endOpen: true }), 550)
      const won = next.winner === get().me
      won ? sfx.win() : sfx.lose()
      // 戰績:host + 單機在此結算一次(guest 走 applyGuestView 的 ended transition)。
      recordMatchStat(!!get().online, won)
      // campaign: fold this match into the BO series (the end screen then shows
      // series status / result — wired with the campaign UI).
      get().onMatchEnd?.(won)
    }
  },

  dismissShowdown: () => {
    const { engine, online } = get()
    if (!engine) return
    if (online?.role === 'guest') {
      // guest can't advance the engine; ack the host and don't reopen this one.
      // The board now shows the revealed cards; a "waiting" pill shows until the
      // host confirms too (derived in the UI from phase==='showdown' & modal closed).
      online.send({ type: 'continue' })
      set({ showdownOpen: false, guestAckSlot: engine.lastShowdown?.slot ?? get().guestAckSlot })
      return
    }
    if (engine.phase !== 'showdown') return // guard against a double 'continue'
    if (online?.role === 'host') {
      // both sides must confirm before advancing
      const acks = { ...get().acks, p1: true }
      set({ showdownOpen: false, acks })
      if (acks.p2) get().applyEngine(resolveShowdown(engine))
      return
    }
    // single-player
    set({ showdownOpen: false })
    get().applyEngine(resolveShowdown(engine)) // -> draw step (or ended)
  },

  openMagnifier: (side, slot) => {
    sfx.click()
    set({ magnifier: { side, slot } })
  },
  closeMagnifier: () => set({ magnifier: null }),

  toggleSortMode: () => {
    sfx.hover()
    set({ sortMode: get().sortMode === 'rank' ? 'suit' : 'rank' })
    get().emitLive() // re-sort moves my pushed cards → opponent sees it
  },
  toggleSortDir: () => {
    sfx.hover()
    set({ sortDir: get().sortDir === 'desc' ? 'asc' : 'desc' })
    get().emitLive()
  },

  // ----- special cards (Phase C) -----
  confirmLoadout: (ids) => {
    sfx.click()
    const { online } = get()
    const loadout = ids.slice(0, 3)
    if (online) {
      // B barrier: tell the peer I'm ready; advance only when BOTH are (setLoadoutReady).
      set({ loadout, loadoutWaiting: true })
      online.sendReady()
    } else {
      set({ loadout, loadoutReady: true })
    }
  },

  setLoadoutReady: () => set({ loadoutReady: true, loadoutWaiting: false }),

  flashStatus: (msg) => {
    set({ statusOverride: msg })
    setTimeout(() => {
      if (get().statusOverride === msg) set({ statusOverride: null })
    }, 3000)
  },

  applyPause: (p) => set({ onlinePause: p }),
  togglePauseOnline: () => {
    const { online, onlinePause } = get()
    if (!online) return
    online.sendPause({ active: !onlinePause.active }) // unlimited; either side toggles
  },

  sendEmote: (id) => {
    const { online } = get()
    if (!online) return // single-player: local float only (handled in the control)
    online.sendEmote({ by: online.role, id, n: Date.now() })
  },
  applyEmote: (e) => {
    // Only surface stickers the OPPONENT sent (ignore my own echo off the ref).
    const { online } = get()
    if (!online || e.by === online.role) return
    set({ incomingEmote: e })
  },

  showSpecialInfo: (info) => set({ specialInfo: info, specialTrayOpen: false }),

  openSpecialTray: () => {
    sfx.click()
    set({ specialTrayOpen: true })
  },
  closeSpecialTray: () => set({ specialTrayOpen: false }),

  chooseSpecial: (id) => {
    const { engine, me, online } = get()
    const def = getSpecialCard(id)
    if (!engine || !def) return
    if (def.needsTarget) {
      // swap / suit-bloom — only enter targeting if a legal target exists.
      const targets = def.suit ? suitTargets(engine, me, def.suit) : swapTargets(engine, me)
      if (targets.length === 0) {
        useToastStore.getState().show(def.suit ? `手上沒有可變${SUIT_ZH[def.suit]}的牌` : '手上沒有可換的牌')
        return
      }
      sfx.click()
      set({ specialTargeting: id, specialTrayOpen: false })
    } else if (online?.role === 'guest') {
      // peek / spy online: the host holds the truth → ask it; the result comes
      // back on the private info channel (netgame → showSpecialInfo).
      sfx.click()
      online.send({ type: 'special', card: id })
      set({ specialTrayOpen: false })
    } else {
      // peek / spy (host or single-player): resolve the info now + spend the budget.
      const foe = otherPlayer(me)
      const cards = (id === 'peek' ? peekNextDraw(engine, me) : engine.hands[foe]).slice()
      sfx.click()
      set({
        engine: markSpecialUsed(engine, me),
        specialTrayOpen: false,
        specialInfo: { kind: id as 'peek' | 'spy', cards },
      })
      get().flashStatus(`你已使用了「${def.name}」`)
      // host: tell the guest (the foe) what happened.
      if (online?.role === 'host') online.sendFx(id === 'spy' ? '對手正在查看你的手牌' : '對方似乎使用了特殊牌')
    }
  },

  activateSpecialTarget: (cardId) => {
    const { engine, me, specialTargeting, online } = get()
    if (!engine || !specialTargeting) return
    const def = getSpecialCard(specialTargeting)
    if (online?.role === 'guest') {
      // host applies it and syncs the result back (hand + specialUsed).
      online.send({ type: 'special', card: specialTargeting, targetId: cardId })
      sfx.deal()
      set({ specialTargeting: null })
      get().flashStatus(`你已使用了「${def?.name}」`)
      return
    }
    const next = def?.suit ? applySuit(engine, me, cardId, def.suit) : applySwap(engine, me, cardId)
    if (next === engine) return // illegal target → ignore
    sfx.deal()
    // Swap removes the target and draws a new card → drop the now-gone card from
    // the pick selection so the 送出 count stays correct (clubs keeps the id).
    const validIds = new Set(next.hands[me].map((c) => c.id))
    set({ engine: next, specialTargeting: null, selected: get().selected.filter((id) => validIds.has(id)) })
    get().flashStatus(`你已使用了「${def?.name}」`)
    // host: swap/suit don't affect the opponent → generic notice.
    if (online?.role === 'host') online.sendFx('對方似乎使用了特殊牌')
  },

  cancelSpecialTarget: () => set({ specialTargeting: null }),
  closeSpecialInfo: () => set({ specialInfo: null }),

  aiMaybeSpecial: () => {
    const { engine, me, special, aiLoadout, aiBoss, online } = get()
    // Single-player only; the AI is whoever's turn it is (the non-me player).
    if (!engine || online || !special || engine.phase !== 'pick') return false
    const ai = engine.turn
    if (ai === me || engine.specialUsed[ai]) return false
    // Campaign bosses use bossChooseSpecial (handles their signature incl. peek/
    // spy); the plain single-player AI keeps the default value-only policy.
    const decision = aiBoss ? bossChooseSpecial(engine, ai, aiLoadout, aiBoss.profile) : aiChooseSpecial(engine, ai, aiLoadout)
    if (!decision) return false
    const def = getSpecialCard(decision.card)
    let next: GameState
    if (def?.suit && decision.targetId) next = applySuit(engine, ai, decision.targetId, def.suit)
    else if (decision.card === 'swap' && decision.targetId) next = applySwap(engine, ai, decision.targetId)
    else next = markSpecialUsed(engine, ai) // peek / spy: no board change, just the one-shot
    if (next === engine) return false // effect was a no-op (illegal target) → don't stall
    sfx.deal()
    // 資訊卡強化打法 (#5): record what the boss legitimately learned so its later
    // picks/placements can act on it (spy → true-strength reads; peek → sure draw-hold).
    if (aiBoss && decision.card === 'spy') set({ aiBoss: { ...aiBoss, spySeen: true, spyHand: next.hands[otherPlayer(ai)] } })
    else if (aiBoss && decision.card === 'peek') set({ aiBoss: { ...aiBoss, peekDraw: peekNextDraw(next, ai) } })
    set({ engine: next })
    // Visibility (SPEC §15): spy affects me (I'm told); others → a generic notice.
    get().flashStatus(decision.card === 'spy' ? '對手正在查看你的手牌' : '對方似乎使用了特殊牌')
    return true
  },

  timeoutAutoPlay: () => {
    const { engine, me, selected, sortMode, sortDir } = get()
    if (!engine) return
    // Works online too: confirmPick/placeAt already route through the guest's
    // intent channel (host) so the auto-move syncs like a manual one.
    if (engine.phase === 'pick' && engine.turn === me) {
      // Submit the current selection; if nothing is selected, force the first
      // (left-most) hand card so the turn always advances.
      let ids = selected
      if (ids.length === 0) {
        const ordered = sortHand(engine.hands[me], sortMode, sortDir)
        if (ordered.length) ids = [ordered[0].id]
      }
      if (ids.length === 0) return
      set({ specialTrayOpen: false, specialTargeting: null, specialInfo: null, confirm: null, selected: ids })
      get().confirmPick()
    } else if (engine.phase === 'place' && engine.pendingPick && otherPlayer(engine.pendingPick.by) === me) {
      const empty = emptySlotsFor(engine, engine.pendingPick.by)[0]
      if (empty != null) get().placeAt(empty)
    }
  },
}))

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __game: typeof useGameStore }).__game = useGameStore
}
