import { getDatabase, ref, onValue, type Database } from 'firebase/database'
import { getFirebaseApp, isFirebaseConfigured } from '../firebaseApp'

/**
 * Realtime Database handle. The app instance itself lives in ../firebaseApp so
 * that Auth (platform/) and RTDB (net/) share one Firebase app.
 *
 * Lazily resolved so single-player / menu flows never touch Firebase until the
 * player actually creates or joins a room.
 */
export { isFirebaseConfigured }

let database: Database | null = null

export function getDb(): Database {
  if (!database) database = getDatabase(getFirebaseApp())
  return database
}

/** Subscribe once and resolve `true` when `.info/connected` is true, or `false`
 *  after `timeoutMs`. (⚠️ `.info/connected`'s onValue fires SYNCHRONOUSLY with the
 *  current state — finish() may run before `unsub` is assigned, so it must not
 *  touch it then; we clean the listener right after instead.) */
function onceConnected(timeoutMs: number): Promise<boolean> {
  const connectedRef = ref(getDb(), '.info/connected')
  return new Promise<boolean>((resolve) => {
    let done = false
    let unsub: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      if (unsub) unsub()
      resolve(ok)
    }
    timer = setTimeout(() => finish(false), timeoutMs)
    unsub = onValue(connectedRef, (snap) => {
      if (snap.val() === true) finish(true)
    })
    if (done && unsub) unsub() // synchronous fire → tidy the listener now
  })
}

/**
 * Resolve `true` once the RTDB websocket is connected, else `false` after
 * `timeoutMs`. Callers issue DB ops only after this, and treat a `false` result as
 * "connection not ready — take the offline fallback rather than hang".
 *
 * (Earlier this also force-reconnected via goOffline/goOnline, on the theory that a
 * reopened tab inherits a dead socket. That theory was wrong — the real "配對卡 23 秒"
 * cause was an `applyLocally:false` transaction stalling behind a pending write, see
 * profile.ts ensureProfile. goOffline/goOnline is a global hammer that aborts
 * in-flight writes, so it's removed; the per-op `withTimeout` belts below are the
 * real safety net against any residual hang.)
 */
export function waitForConnected(timeoutMs = 5000): Promise<boolean> {
  return onceConnected(timeoutMs)
}

/**
 * Race a Firebase op against a timeout so a stuck socket can't hang the flow.
 * Resolves to the op's value, or `fallback` if it neither resolves nor rejects
 * within `ms` (and also on rejection). Pass a sentinel `fallback` the caller can
 * distinguish (e.g. `null`) to detect the timeout/failure and take a safe path.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false
    const settle = (v: T) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => settle(fallback), ms)
    p.then((v) => settle(v), () => settle(fallback))
  })
}
