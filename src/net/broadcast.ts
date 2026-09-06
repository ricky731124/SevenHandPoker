import { onValue, onDisconnect, ref, remove, set as dbSet } from 'firebase/database'
import { getDb } from './firebase'
import { serializeForSpectator, type SpecExtras } from './sync'
import { writeLiveEntry, flipLiveEnded, writeSpectatorCount, removeLiveEntry, type LivePlayer } from './liveIndex'
import type { GameState } from '../game/state'

/**
 * Broadcaster for a spectatable match (§4.2). Mirrors the全開 engine to
 * `spectate/{code}/spec` — but only while at least one watcher is present (省流量).
 * Also owns the `liveIndex/{code}` lifecycle (§5.4) and the spectator count (§4.4).
 *
 * Two callers, one implementation:
 *  - **casual-bot** (`startBroadcast` with no `code`): a 100% local AI match; the
 *    local player broadcasts under a generated `spec_…` code (avoids the 3-digit
 *    room space — a casual game is only watched, never `join`ed). Driven by gameStore.
 *  - **real-human host** (`startBroadcast` with the room `code`): the host already
 *    writes a guest-view to `rooms/{code}/game`; here it additionally writes the全開
 *    spec. Driven by netgame's `_attachHost`.
 */

export interface Broadcaster {
  code: string
  /** Call on every engine change (mirror to spec if watched). */
  onEngine: (engine: GameState) => void
  /** Call when broadcaster-side UI state changes (推牌選取/排序/特殊牌通知) — re-writes
   *  the spec (with the latest engine) so spectators see the push-out/sort/notice live. */
  onExtras: (extras: SpecExtras) => void
  /** Natural end → flip the Live card to ended (kept 24h), leave the final spec up. */
  end: (winner: 'p1' | 'p2') => void
  /** Abandon/leave → tear the live+spectate nodes down (unless already ended). */
  stop: () => void
}

const randomCode = () => `spec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

export function startBroadcast(opts: {
  code?: string
  p1: LivePlayer
  p2: LivePlayer
  initial: GameState
  /** 觀戰人數變動回呼(#7:讓廣播端玩家知道自己被幾個人監控)。 */
  onWatchers?: (n: number) => void
}): Broadcaster {
  const code = opts.code ?? randomCode()
  const db = getDb()
  const liveNode = ref(db, `liveIndex/${code}`)
  const specNode = ref(db, `spectate/${code}/spec`)
  const watchNode = ref(db, `spectate/${code}/watch`)
  const spectateNode = ref(db, `spectate/${code}`)

  let watchers = 0
  let lastEngine = opts.initial
  let lastExtras: SpecExtras = {}
  let ended = false
  let stopped = false

  const writeSpec = (engine: GameState) => {
    if (stopped) return
    void dbSet(specNode, serializeForSpectator(engine, lastExtras)).catch(() => {})
  }

  // Create the Live card + arm crash cleanup (a hard-closed tab won't run end()/stop()).
  void writeLiveEntry(code, opts.p1, opts.p2)
  void onDisconnect(liveNode).remove().catch(() => {})
  void onDisconnect(spectateNode).remove().catch(() => {})

  // Count watchers; on the 0→1 cold start, immediately push a snapshot so the first
  // spectator isn't staring at an empty board until the next move (§4.2).
  const unsubWatch = onValue(
    watchNode,
    (snap) => {
      const n = snap.size
      if (n > 0 && watchers === 0) writeSpec(lastEngine)
      watchers = n
      opts.onWatchers?.(n) // #7:通知廣播端玩家目前觀戰人數
      void writeSpectatorCount(code, n)
    },
    () => {},
  )

  return {
    code,
    onEngine: (engine) => {
      lastEngine = engine
      if (watchers > 0) writeSpec(engine)
    },
    onExtras: (extras) => {
      lastExtras = extras
      if (watchers > 0) writeSpec(lastEngine)
    },
    end: (winner) => {
      if (ended || stopped) return
      ended = true
      if (watchers > 0) writeSpec(lastEngine) // final全開 state for anyone still watching
      void flipLiveEnded(code, winner)
      // Keep the ended card (24h sweep) → cancel the crash-cleanup onDisconnect.
      void onDisconnect(liveNode).cancel().catch(() => {})
      void onDisconnect(spectateNode).cancel().catch(() => {})
      unsubWatch()
    },
    stop: () => {
      if (stopped) return
      stopped = true
      unsubWatch()
      void onDisconnect(liveNode).cancel().catch(() => {})
      void onDisconnect(spectateNode).cancel().catch(() => {})
      if (!ended) {
        // Abandoned before a natural end → don't leave a zombie 'live' card.
        void removeLiveEntry(code)
        void remove(spectateNode).catch(() => {})
      }
    },
  }
}
