import { get, onValue, ref, remove, set as dbSet } from 'firebase/database'
import { getDb } from './firebase'
import {
  clearSession,
  getClientId,
  leaveRoom,
  markAbandoned,
  readGuestLoadout,
  readHostSnapshot,
  readSession,
  saveGuestLoadout,
  saveHostSnapshot,
  readOpenMatch,
  clearOpenMatch,
  isMatchSettled,
  markMatchSettled,
  type Role,
  type Room,
} from './room'
import { useAppStore } from '../state/appStore'
import { useNetStore } from '../state/netStore'
import { usePlatformStore } from '../state/platformStore'
import { useGameStore, specExtrasOf, type HostSnapshot, type PauseState, type EmoteMsg } from '../state/gameStore'
import { serializeForGuest, deserializeForGuest, type Intent, type LiveSel, type SyncGame } from './sync'
import { startBroadcast, type Broadcaster } from './broadcast'
import { patchLivePlayerRecord, type LivePlayer } from './liveIndex'
import { fetchCard } from '../platform/cards'
import { applySuit, applySwap, markSpecialUsed, peekNextDraw } from '../game/state'
import type { GameState } from '../game/state'
import { getSpecialCard, type SpecialCardId } from '../game/specialCards'
import type { Card } from '../game/cards'

/**
 * Phase-2/3 orchestrator: bridges the RTDB room and the local gameStore.
 * Host writes a sanitized guest-view after every engine change and consumes the
 * guest's intents; guest renders the guest-view and sends intents. Extra small
 * channels: `live/{host,guest}` (throttled selection preview) and
 * `rematch/{host,guest}`. Only one online game is active at a time (module-level
 * `active`), which also makes attachOnline idempotent under StrictMode.
 */

const P = (code: string, path: string) => ref(getDb(), `rooms/${code}/${path}`)
const gameRef = (code: string) => P(code, 'game')
const intentRef = (code: string) => P(code, 'intent')
const liveRef = (code: string, role: Role) => P(code, `live/${role}`)
const rematchRef = (code: string, role: Role) => P(code, `rematch/${role}`)
const readyRef = (code: string, role: Role) => P(code, `ready/${role}`)
const fxRef = (code: string) => P(code, 'fx')
const infoRef = (code: string, role: Role) => P(code, `info/${role}`)
const pauseRef = (code: string) => P(code, 'pause')
const emoteRef = (code: string) => P(code, 'emote')
const NO_PAUSE: PauseState = { active: false }

/** RTDB rejects `undefined`; a normal card's `kind` is undefined → strip it. */
function cleanCards(cards: Card[]): Card[] {
  return cards.map((c) => (c.kind ? { id: c.id, suit: c.suit, rank: c.rank, kind: c.kind } : { id: c.id, suit: c.suit, rank: c.rank }))
}

/** Read the local player's saved loadout to seed the pre-match pick (B). */
function myLoadout(): SpecialCardId[] {
  return (usePlatformStore.getState().profile?.equipped.specialCards ?? []) as SpecialCardId[]
}

function writeGame(code: string, view: SyncGame) {
  void dbSet(gameRef(code), view)
}

/** Guard against RTDB dropping empty arrays: a live node with no/empty idx = null. */
function normalizeLive(v: unknown): LiveSel | null {
  const s = v as LiveSel | null
  if (!s || !Array.isArray(s.idx) || s.idx.length === 0) return null
  return { total: s.total ?? 0, idx: s.idx }
}

/** ≤1 live write per 700ms (latest wins); clears fire immediately. */
function makeThrottledLive(code: string, role: Role) {
  let pending: LiveSel | null = null
  let hasPending = false
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    if (!hasPending) return
    hasPending = false
    last = Date.now()
    void dbSet(liveRef(code, role), pending)
  }
  return (sel: LiveSel | null) => {
    if (sel === null) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      hasPending = false
      last = Date.now()
      void dbSet(liveRef(code, role), null)
      return
    }
    pending = sel
    hasPending = true
    if (!timer) timer = setTimeout(flush, Math.max(0, 700 - (Date.now() - last)))
  }
}

export interface AttachOpts {
  reconnect?: boolean
  hostSnapshot?: HostSnapshot
  /** reconnect: room config from the fetched room (guest has no local snapshot) */
  special?: boolean
  timeLimit?: number
}

let active: { code: string; detach: () => void } | null = null

/** Intentional leave: mark the room abandoned (so the peer stops waiting) and
 *  clear the reconnect marker, then tear everything down. */
function teardownFor(code: string, role: Role): () => void {
  return () => {
    void markAbandoned(code, role)
    clearSession()
    detachOnline()
    void leaveRoom(code, role)
    useNetStore.getState().leave()
  }
}

function _attachHost(code: string, opts?: AttachOpts): () => void {
  const g = useGameStore.getState()
  const online = {
    code,
    send: () => {},
    sendLive: makeThrottledLive(code, 'host'),
    sendRematch: () => void dbSet(rematchRef(code, 'host'), true),
    sendReady: () => void dbSet(readyRef(code, 'host'), true),
    sendFx: (msg: string) => void dbSet(fxRef(code), { msg, id: Date.now() }),
    sendPause: (p: PauseState) => void dbSet(pauseRef(code), p),
    sendEmote: (e: EmoteMsg) => void dbSet(emoteRef(code), e),
    teardown: teardownFor(code, 'host'),
  }
  const room0 = useNetStore.getState().room
  const special = room0?.roomType === 'special'
  const timeLimit = room0?.timeLimit ?? 50
  if (opts?.reconnect && opts.hostSnapshot) {
    g.restoreOnlineHost(online, opts.hostSnapshot)
  } else if (!(g.online?.role === 'host' && g.online.code === code && g.engine)) {
    g.startOnlineHost(online, special, timeLimit, myLoadout())
  }
  const s0 = useGameStore.getState()
  if (s0.engine) {
    writeGame(code, serializeForGuest(s0.engine, s0.foeSelForGuest))
    saveHostSnapshot(code, snapOf(s0))
  }

  // §4.2/§5.4 spectator broadcast (真人局): the host also mirrors a全開 spec view and
  // owns this room's `liveIndex` card. Created lazily on the first DEALT (playing)
  // frame — not during the coin toss (host engine exists early) — and re-created on
  // a rematch (same room code overwrites the spent card). Driven off the same engine
  // ticks as writeGame; spec is only actually written when a watcher is present.
  let bc: Broadcaster | null = null
  let bcEnded = false
  const startLive = (engine: GameState) => {
    bc?.stop()
    const room = useNetStore.getState().room
    const hostMeta = room?.players?.host
    const guestMeta = room?.players?.guest
    const ps = usePlatformStore.getState()
    const p1: LivePlayer = {
      name: hostMeta?.name || ps.displayName || '玩家',
      avatar: hostMeta?.avatarId || ps.profile?.equipped?.avatar || 'cat',
      uid: hostMeta?.uid ?? ps.uid ?? null,
      wins: ps.profile?.stats?.pvpWins ?? 0,
      games: ps.profile?.stats?.pvpGames ?? 0,
    }
    const p2: LivePlayer = {
      name: guestMeta?.name || '玩家',
      avatar: guestMeta?.avatarId || 'cat',
      uid: guestMeta?.uid ?? null,
      wins: 0,
      games: 0,
    }
    bc = startBroadcast({ code, p1, p2, initial: engine, onWatchers: (n) => useGameStore.setState({ broadcastWatchers: n }) })
    bcEnded = false
    useGameStore.setState({ broadcastCode: code, broadcastWatchers: 0 }) // #8:host 也是廣播端;#7:觀戰人數
    const guestUid = guestMeta?.uid
    if (guestUid) void fetchCard(guestUid).then((c) => c && patchLivePlayerRecord(code, 'p2', c.pvp.wins, c.pvp.games))
  }
  const liveTick = (status: string, engine: GameState) => {
    if (status !== 'playing') return
    if (!bc || (bcEnded && engine.phase !== 'ended')) startLive(engine) // first deal, or a fresh rematch
    bc?.onEngine(engine)
    if (engine.phase === 'ended' && engine.winner && !bcEnded) {
      bc?.end(engine.winner)
      bcEnded = true
    }
  }
  if (s0.engine) liveTick(s0.status, s0.engine)

  const unsubStore = useGameStore.subscribe((s, prev) => {
    if (s.online?.role !== 'host' || !s.engine) return
    if (s.engine !== prev.engine || s.foeSelForGuest !== prev.foeSelForGuest) {
      writeGame(code, serializeForGuest(s.engine, s.foeSelForGuest))
      saveHostSnapshot(code, snapOf(s)) // persist locally so a reload can restore
    }
    if (s.engine !== prev.engine || s.status !== prev.status) liveTick(s.status, s.engine)
    // §推牌/特殊牌:host 的推牌選取/排序/特殊牌通知變動 → 鏡射給觀戰(spec 只在有觀眾時才真寫)。
    if (
      s.selected !== prev.selected ||
      s.sortMode !== prev.sortMode ||
      s.sortDir !== prev.sortDir ||
      s.specFx !== prev.specFx ||
      s.onlinePause !== prev.onlinePause ||
      s.specEmote !== prev.specEmote
    ) {
      bc?.onExtras(specExtrasOf(s))
    }
  })

  const unsubIntent = onValue(intentRef(code), (snap) => {
    if (!snap.exists()) return
    const intent = snap.val() as Intent
    void remove(intentRef(code)) // consume
    const gs = useGameStore.getState()
    const e = gs.engine
    if (!e) return
    if (intent.type === 'pick') {
      if (e.phase === 'pick' && e.turn === 'p2') {
        gs.submitPick(intent.ids ?? [])
        if (intent.sel) useGameStore.setState({ foeSelection: intent.sel }) // sorted positions from the guest
      }
    } else if (intent.type === 'place') {
      if (e.phase === 'place' && e.pendingPick?.by === 'p1') gs.placeAt(intent.slot)
    } else if (intent.type === 'continue') {
      gs.hostGuestContinue()
    } else if (intent.type === 'special') {
      // Guest activates a special; host arbitrates. Only during the guest's own
      // pick turn, before submitting, and only once.
      if (!(e.phase === 'pick' && e.turn === 'p2') || e.specialUsed.p2) return
      const def = getSpecialCard(intent.card)
      if (!def) return
      if (def.needsTarget) {
        const next = def.suit
          ? applySuit(e, 'p2', intent.targetId ?? '', def.suit)
          : applySwap(e, 'p2', intent.targetId ?? '')
        if (next === e) return // illegal target
        // §特殊牌:記通知(by:p2 guest)→ subscribe 會把 specFx 廣播給觀戰;engine 變動也鏡射新牌面。
        useGameStore.setState({ engine: next, specFx: { by: 'p2', card: intent.card, n: Date.now() } })
        useGameStore.getState().flashStatus('對方似乎使用了特殊牌') // host is the foe
      } else {
        // peek/spy: compute the guest's private result + push to its info channel.
        const cards = intent.card === 'peek' ? peekNextDraw(e, 'p2') : e.hands.p1
        void dbSet(infoRef(code, 'guest'), {
          kind: intent.card === 'peek' ? 'peek' : 'spy',
          cards: cleanCards(cards),
          id: Date.now(),
        })
        useGameStore.setState({ engine: markSpecialUsed(e, 'p2'), specFx: { by: 'p2', card: intent.card, n: Date.now() } })
        useGameStore.getState().flashStatus(intent.card === 'spy' ? '對手正在查看你的手牌' : '對方似乎使用了特殊牌')
      }
    }
  })

  // pre-match pick barrier (special room): advance to the coin once BOTH ready.
  const unsubReady = onValue(P(code, 'ready'), (snap) => {
    const r = (snap.val() as { host?: boolean; guest?: boolean } | null) ?? {}
    if (r.host && r.guest) useGameStore.getState().setLoadoutReady()
  })

  // shared pause state (Stage C).
  const unsubPause = onValue(pauseRef(code), (snap) => {
    useGameStore.getState().applyPause((snap.val() as PauseState | null) ?? NO_PAUSE)
  })

  // sticker (貼圖) broadcast — show the opponent's; ignore my own echo.
  // Skip the initial snapshot so a leftover sticker in the node isn't replayed on attach.
  let emoteInit = true
  const unsubEmote = onValue(emoteRef(code), (snap) => {
    if (emoteInit) {
      emoteInit = false
      return
    }
    const e = snap.val() as EmoteMsg | null
    if (e && e.id) useGameStore.getState().applyEmote(e)
  })

  // guest's live selection (情報戰)
  const unsubLive = onValue(liveRef(code, 'guest'), (snap) => {
    useGameStore.getState().setFoeLive(normalizeLive(snap.val()))
  })

  // rematch: reflect the guest's intent on my end screen; when BOTH agree, restart.
  const unsubRematch = onValue(P(code, 'rematch'), (snap) => {
    const r = (snap.val() as { host?: boolean; guest?: boolean } | null) ?? {}
    useGameStore.getState().setFoeWantsRematch(!!r.guest)
    if (r.host && r.guest) {
      void remove(P(code, 'rematch'))
      void dbSet(liveRef(code, 'host'), null)
      void dbSet(liveRef(code, 'guest'), null)
      void remove(P(code, 'ready')) // fresh B barrier for the next match
      void dbSet(fxRef(code), null)
      void dbSet(emoteRef(code), null) // don't replay last sticker into the next match
      void dbSet(infoRef(code, 'guest'), null)
      void dbSet(pauseRef(code), null) // reset pauses for the next match
      useGameStore.getState().rematchStart()
    }
  })

  return () => {
    unsubStore()
    unsubIntent()
    unsubLive()
    unsubRematch()
    unsubReady()
    unsubPause()
    unsubEmote()
    bc?.stop() // §5.4 host detach → tear down the Live/spectate nodes (ended cards stay 24h)
  }
}

function _attachGuest(code: string, opts?: AttachOpts): () => void {
  const g = useGameStore.getState()
  const room0 = useNetStore.getState().room
  // On reconnect the room subscription may not have populated yet, so prefer the
  // config passed from tryReconnect's room fetch (else fall back to the store).
  const special = opts?.special ?? room0?.roomType === 'special'
  const timeLimit = opts?.timeLimit ?? room0?.timeLimit ?? 50
  if (!(g.online?.role === 'guest' && g.online.code === code)) {
    g.startOnlineGuest(
      {
        code,
        send: (intent) => void dbSet(intentRef(code), intent),
        sendLive: makeThrottledLive(code, 'guest'),
        sendRematch: () => void dbSet(rematchRef(code, 'guest'), true),
        sendReady: () => void dbSet(readyRef(code, 'guest'), true),
        sendFx: () => {}, // guest never pushes fx; the host is authoritative
        sendPause: (p: PauseState) => void dbSet(pauseRef(code), p),
        sendEmote: (e: EmoteMsg) => void dbSet(emoteRef(code), e),
        teardown: teardownFor(code, 'guest'),
      },
      !!opts?.reconnect,
      special,
      timeLimit,
      // Reconnect: restore the loadout the guest COMMITTED to in B (persisted per-tab),
      // not the profile's equipped deck — otherwise a mid-match reload silently hands
      // the guest its full preset deck instead of the cards it picked (#7).
      opts?.reconnect ? (readGuestLoadout(code) as SpecialCardId[] | null) ?? myLoadout() : myLoadout(),
    )
  }
  const unsubGame = onValue(gameRef(code), (snap) => {
    if (!snap.exists()) return
    useGameStore.getState().applyGuestView(deserializeForGuest(snap.val() as SyncGame))
  })
  // host's live selection (情報戰)
  const unsubLive = onValue(liveRef(code, 'host'), (snap) => {
    useGameStore.getState().setFoeLive(normalizeLive(snap.val()))
  })
  // rematch: reflect the host's intent on my end screen (host does the restart)
  const unsubRematch = onValue(P(code, 'rematch'), (snap) => {
    const r = (snap.val() as { host?: boolean; guest?: boolean } | null) ?? {}
    useGameStore.getState().setFoeWantsRematch(!!r.host)
  })
  // pre-match pick barrier: advance to the coin once BOTH ready.
  const unsubReady = onValue(P(code, 'ready'), (snap) => {
    const r = (snap.val() as { host?: boolean; guest?: boolean } | null) ?? {}
    if (r.host && r.guest) {
      useGameStore.getState().setLoadoutReady()
      // Persist the loadout the guest just committed to, so a mid-match reload
      // restores THESE cards instead of the profile's equipped deck (#7).
      saveGuestLoadout(code, useGameStore.getState().loadout)
    }
  })
  // shared pause state (Stage C).
  const unsubPause = onValue(pauseRef(code), (snap) => {
    useGameStore.getState().applyPause((snap.val() as PauseState | null) ?? NO_PAUSE)
  })
  // sticker (貼圖) broadcast — show the opponent's; ignore my own echo.
  // Skip the initial snapshot so a leftover sticker isn't replayed on attach/reconnect.
  let emoteInit = true
  const unsubEmote = onValue(emoteRef(code), (snap) => {
    if (emoteInit) {
      emoteInit = false
      return
    }
    const e = snap.val() as EmoteMsg | null
    if (e && e.id) useGameStore.getState().applyEmote(e)
  })
  // host → guest special-card notices ("似乎使用了" / "正在查看你的手牌").
  // Skip the initial snapshot (stale/none); fire on each subsequent write.
  let fxInit = true
  const unsubFx = onValue(fxRef(code), (snap) => {
    if (fxInit) {
      fxInit = false
      return
    }
    const fx = snap.val() as { msg?: string } | null
    if (fx?.msg) useGameStore.getState().flashStatus(fx.msg)
  })
  // host → guest private peek/spy result.
  let infoInit = true
  const unsubInfo = onValue(infoRef(code, 'guest'), (snap) => {
    if (infoInit) {
      infoInit = false
      return
    }
    const info = snap.val() as { kind?: 'peek' | 'spy'; cards?: Card[] } | null
    if (info?.kind && Array.isArray(info.cards)) {
      useGameStore.getState().showSpecialInfo({ kind: info.kind, cards: info.cards })
    }
  })
  // guest 也是這場的一員:設 broadcastCode = 房號 → ①選單有「觀眾彈幕」開關 ②BroadcasterDanmaku
  // 訂 spectate/{房號}/danmaku 收觀眾彈幕(觀戰彈幕推在房號的 spectate 樹,host/guest 同一棵,#guest)。
  useGameStore.setState({ broadcastCode: code })
  // #4:guest 端也要知道被幾個人觀戰(只 host 廣播算得到,guest 讀 liveIndex.spectators)→ 顯示 👁 數。
  const unsubWatchers = onValue(ref(getDb(), `liveIndex/${code}/spectators`), (snap) => {
    useGameStore.setState({ broadcastWatchers: (snap.val() as number | null) ?? 0 })
  })
  return () => {
    unsubGame()
    unsubLive()
    unsubRematch()
    unsubReady()
    unsubPause()
    unsubEmote()
    unsubFx()
    unsubInfo()
    unsubWatchers()
    useGameStore.setState({ broadcastWatchers: 0, broadcastCode: null })
  }
}

function snapOf(s: ReturnType<typeof useGameStore.getState>): HostSnapshot {
  return {
    engine: s.engine!,
    coinFirstPicker: s.coinFirstPicker,
    foeSelForGuest: s.foeSelForGuest,
    special: s.special,
    loadout: s.loadout,
    timeLimit: s.timeLimit,
  }
}

/** Start (or no-op if already running) the online game for this room. */
export function attachOnline(code: string, mode: 'host' | 'guest', opts?: AttachOpts): void {
  if (active?.code === code) return
  active?.detach()
  const detach = mode === 'host' ? _attachHost(code, opts) : _attachGuest(code, opts)
  active = { code, detach }
}

/** Stop listeners for the active online game (does not touch presence). */
export function detachOnline(): void {
  active?.detach()
  active = null
}

/**
 * On app load: if a reconnect marker exists (an ACCIDENTAL drop, not a
 * deliberate "離開遊戲"), rejoin the same room. Host restores its engine from the
 * local snapshot; guest re-reads the guest-view. Returns true if it reconnected.
 */
/**
 * #8: on boot, settle an abandoned online match as a loss — ONCE. Call this only
 * AFTER tryReconnect() returned false (i.e. we did NOT resume the game): if a
 * STARTED match is still marked open, it means I left/closed and can't rejoin, so
 * the opponent will (or already did) take the win → record my single loss. The
 * settled-set makes this idempotent (flaky reconnects never double-count).
 */
export async function reconcileAbandonedMatch(): Promise<void> {
  const code = readOpenMatch()
  if (!code) return
  clearOpenMatch()
  if (isMatchSettled(code)) return
  markMatchSettled(code)
  await usePlatformStore.getState().recordMatchResult('pvp', false, { silentDaily: true }) // 補判不發每日獎/toast
}

export async function tryReconnect(): Promise<boolean> {
  const session = readSession()
  if (!session) return false
  const { code, role } = session
  try {
    const snap = await get(ref(getDb(), `rooms/${code}`))
    const room = snap.val() as Room | null
    const me = getClientId()
    const iAmMember = !!room && (room.hostId === me || room.guestId === me)
    if (!room || room.abandoned || !iAmMember) {
      clearSession()
      return false
    }
    let hostSnapshot: HostSnapshot | undefined
    if (role === 'host') {
      hostSnapshot = readHostSnapshot<HostSnapshot>(code) ?? undefined
      if (!hostSnapshot) {
        clearSession() // no local snapshot → can't restore the deck
        return false
      }
    }
    useNetStore.getState().reconnect(code, role)
    attachOnline(code, role, {
      reconnect: true,
      hostSnapshot,
      special: room.roomType === 'special',
      timeLimit: room.timeLimit ?? 50,
    })
    useAppStore.getState().launchGame({ mode: role, roomId: code })
    return true
  } catch {
    return false
  }
}
