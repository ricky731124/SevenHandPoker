import { ref, onValue, onDisconnect, set, remove, push, serverTimestamp, type DatabaseReference } from 'firebase/database'
import { getDb } from './firebase'
import { BOTS_ONLINE } from '../game/bots'

/**
 * 心跳式 presence（見 docs/SPECTATE-REPLAY-SPEC.md §2）。
 *
 * 每個分頁（連線）在 `presence/{uid}/{connId}` 下掛一個子節點 `{ lastActive }`，
 * 並在「分頁可見」時每 4 分鐘更新 lastActive；`onDisconnect().remove()` 讓乾淨關分頁
 * 秒清。在線人數 = 「任一連線 lastActive 在最近 10 分鐘內」的 distinct uid 數 + BOTS_ONLINE。
 *
 * 為什麼用「每連線一個子節點」而非「每 uid 一個 lastActive」：雙開時關掉其中一個分頁，
 * 只會移除那個分頁的子節點，另一個分頁的子節點仍在 → 該 uid 不會短暫消失（無閃退）。
 *
 * 這純粹是「計數」：不登出、不斷線、不重發 uid。切背景 → 停止心跳 → 過期後自動退出計數；
 * 回到前景 → 立即補寫。cards/{uid}/lastOnline 維持（名片離線時間，#5）。
 */

/** 任一連線 lastActive 在此窗口內即算在線（也給 cards.fetchIsOnline 用）。 */
export const ONLINE_WINDOW_MS = 10 * 60 * 1000 // 10 分鐘
/** 心跳更新間隔（僅在分頁可見時觸發）。窗口 10 分鐘 → 4 分鐘一次可容忍漏跳。 */
const HEARTBEAT_MS = 4 * 60 * 1000 // 4 分鐘
/** 在線人數重算節奏：純本地計算（無 DB/網路），過期不觸發 DB 事件故輪詢重算。 */
const RECOUNT_MS = 60 * 1000 // 60 秒

/** The currently-running tracker's cleanup (there's only ever one — App owns it).
 *  Lets the logout flow STOP the tracker before removing presence, so it can't
 *  re-assert the entry on the signOut reconnect blip. */
let _activeCleanup: (() => void) | null = null

/**
 * Remove this uid's presence NOW. Call from the logout flow BEFORE signOut —
 * while still authenticated — so everyone sees −1 immediately (after signOut the
 * client is unauthenticated and couldn't delete its own presence, leaving it to
 * expire over ~10 min).
 *
 * ⚠️ Must STOP the live tracker first: signOut makes RTDB re-authenticate, which
 * blips `.info/connected` and would make a still-running trackPresence re-write
 * the entry (the「−1 又馬上 +1」bug). Stopping it unsubscribes that handler, so the
 * remove sticks. Best-effort.
 */
export async function clearPresence(uid: string): Promise<void> {
  _activeCleanup?.() // stop heartbeat + connected-handler so it can't re-add
  try {
    await remove(ref(getDb(), `presence/${uid}`))
  } catch {
    /* best-effort — a failed remove just falls back to window expiry */
  }
}

/** Start reporting this uid as online (heartbeat); returns a cleanup. */
export function trackPresence(uid: string): () => void {
  const db = getDb()
  const connectedRef = ref(db, '.info/connected')
  const cardLastOnline = ref(db, `cards/${uid}/lastOnline`)
  let connRef: DatabaseReference | null = null

  const visible = () =>
    typeof document === 'undefined' || document.visibilityState === 'visible'
  const beat = () => {
    if (!connRef || !visible()) return
    void set(connRef, { lastActive: serverTimestamp() })
  }

  const unsubConnected = onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return
    // Fresh child per (re)connection; auto-removed on disconnect.
    connRef = push(ref(db, `presence/${uid}`))
    void onDisconnect(connRef).remove()
    void set(connRef, { lastActive: serverTimestamp() })
    // card lastOnline (#5): stamp now + on disconnect.
    void onDisconnect(cardLastOnline).set(serverTimestamp())
    void set(cardLastOnline, serverTimestamp())
  })

  const timer = setInterval(beat, HEARTBEAT_MS)
  const onVis = () => beat() // becoming visible → beat immediately (hidden → guarded no-op)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis)

  let stopped = false
  const cleanup = () => {
    if (stopped) return // idempotent — logout's clearPresence and the App effect may both call it
    stopped = true
    unsubConnected()
    clearInterval(timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis)
    if (connRef) void remove(connRef)
    if (_activeCleanup === cleanup) _activeCleanup = null
  }
  _activeCleanup = cleanup
  return cleanup
}

/**
 * Subscribe to the count of online people (distinct uids with ≥1 connection
 * active within the window) + BOTS_ONLINE. Recomputes on every presence change
 * AND on a timer — entries expire silently (no DB event), so a change alone isn't
 * enough. The recompute is a pure in-memory pass over the cached snapshot (no DB
 * reads), so its cost is negligible regardless of interval.
 */
export function subscribeOnlineCount(cb: (n: number) => void, onError?: () => void): () => void {
  const db = getDb()
  type Conn = { lastActive?: number } | true
  let entries: Record<string, Record<string, Conn>> = {}
  let offset = 0

  const recount = () => {
    const now = Date.now() + offset
    let live = 0
    for (const conns of Object.values(entries)) {
      let recent = false
      for (const c of Object.values(conns ?? {})) {
        // Only NEW-shape heartbeat entries count. Legacy `true` (pre-heartbeat,
        // the old「只增不減」garbage) is ignored so the count stays clean and
        // self-correcting; those entries vanish on disconnect / on reload.
        if (c === true) continue
        const t = typeof c?.lastActive === 'number' ? c.lastActive : 0
        if (t > 0 && now - t < ONLINE_WINDOW_MS) {
          recent = true
          break
        }
      }
      if (recent) live++
    }
    cb(live + BOTS_ONLINE)
  }

  const unsubPresence = onValue(
    ref(db, 'presence'),
    (snap) => {
      entries = (snap.val() as typeof entries) ?? {}
      recount()
    },
    () => onError?.(), // permission denied (logged out / presence not public) → let the caller hide
  )
  const unsubOffset = onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    offset = (snap.val() as number) ?? 0
    recount()
  })
  const timer = setInterval(recount, RECOUNT_MS)

  return () => {
    unsubPresence()
    unsubOffset()
    clearInterval(timer)
  }
}
