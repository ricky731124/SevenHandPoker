import { create } from 'zustand'
import type { Card } from '../game/cards'
import { evaluate } from '../game/evaluate'
import { randomSeed } from '../game/rng'
import { sortHand, type SortDir, type SortMode } from '../game/sort'
import {
  applyDraw,
  applyPick,
  applyPlace,
  createGame,
  otherPlayer,
  resolveShowdown,
  type GameState,
  type PlayerId,
} from '../game/state'
import type { GameMode } from './appStore'
import type { Role } from '../net/room'
import type { Intent, LiveSel } from '../net/sync'
import { sfx } from '../audio/sfx'

export type Status = 'coinToss' | 'playing' | 'ended'

export interface HostSnapshot {
  engine: GameState
  coinFirstPicker: PlayerId | null
  foeSelForGuest: LiveSel | null
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
  /** tear down listeners + presence when leaving */
  teardown: () => void
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
  startSinglePlayer: () => void
  finishCoinToss: () => void
  finishCoinTossOnline: () => void
  reset: () => void
  nextGame: () => void
  startOnlineHost: (o: Omit<OnlineInfo, 'role'>) => void
  startOnlineGuest: (o: Omit<OnlineInfo, 'role'>, reconnect?: boolean) => void
  restoreOnlineHost: (o: Omit<OnlineInfo, 'role'>, snap: HostSnapshot) => void
  setFoeWantsRematch: (v: boolean) => void
  applyGuestView: (v: { engine: GameState; foeSel: LiveSel | null }) => void
  leaveOnline: () => void
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
  online: null,
  foeSelForGuest: null,
  foeLive: null,
  guestAckSlot: null,
  acks: { p1: false, p2: false },
  rematchPending: false,
  foeWantsRematch: false,

  startSinglePlayer: () => {
    const firstPicker: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2'
    set({
      mode: 'ai',
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
    })
  },

  finishCoinToss: () => {
    const first = get().coinFirstPicker ?? 'p1'
    const engine = createGame(randomSeed(), first)
    set({ engine, status: 'playing' })
  },

  reset: () => set({ engine: null, status: 'coinToss', selected: [], confirm: null, showdownOpen: false, endOpen: false, magnifier: null }),

  nextGame: () => {
    get().startSinglePlayer()
  },

  // ----- Online (Phase 2 / 3) -----
  // Host owns the engine and runs it locally (like single-player but the
  // opponent's moves arrive as intents instead of from the AI). Both sides play
  // the coin-toss ritual off the same randomised first picker.
  startOnlineHost: (o) => {
    const firstPicker: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2'
    const engine = createGame(randomSeed(), firstPicker)
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
    })
  },

  // Guest holds no engine of its own — it renders whatever the host syncs and
  // sends intents for its moves. On reconnect (mid-game) skip the coin toss.
  startOnlineGuest: (o, reconnect = false) => {
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
    }
    if (endOpen && !prev.endOpen) {
      engine.winner === prev.me ? sfx.win() : sfx.lose()
    }
    // foeSelection = the submitted pick (place phase); the LIVE preview during a
    // pick lives in foeLive and is set by the live listener — don't clobber it.
    set({
      engine,
      foeSelection: v.foeSel,
      showdownOpen,
      endOpen,
      coinFirstPicker: engine.firstPicker,
      ...(newGame
        ? {
            status: 'coinToss',
            endOpen: false,
            showdownOpen: false,
            rematchPending: false,
            foeWantsRematch: false,
            guestAckSlot: null,
            foeLive: null,
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

  rematchStart: () => {
    if (!get().online) return
    const firstPicker: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2'
    const engine = createGame(randomSeed(), firstPicker)
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
      }
      setTimeout(() => {
        if (get().engine === next && next.phase === 'showdown') set({ showdownOpen: true })
      }, 550)
    } else if (next.phase === 'draw') {
      // Discrete draw step: pause so the deal animation reads, then draw.
      setTimeout(() => {
        if (get().engine === next && next.phase === 'draw') get().doDraw()
      }, 480)
    } else if (next.phase === 'ended') {
      setTimeout(() => set({ endOpen: true }), 550)
      next.winner === get().me ? sfx.win() : sfx.lose()
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
}))

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __game: typeof useGameStore }).__game = useGameStore
}
