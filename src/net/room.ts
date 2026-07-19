import {
  get,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  update,
} from 'firebase/database'
import { getDb } from './firebase'

export type RoomStatus = 'waiting' | 'playing' | 'ended'
export type Role = 'host' | 'guest'

export interface PlayerPresence {
  connected: boolean
  lastSeen: number
}

/**
 * Phase-1 room shape. Phase 2 adds the game-state fields from SPEC §6.1
 * (seed, turn, phase, coinResult, slots, hands, lastMove, rematch).
 */
export interface Room {
  status: RoomStatus
  createdAt: number
  hostId: string
  guestId: string | null
  players: { host: PlayerPresence; guest?: PlayerPresence }
  /** set to the role that intentionally left ("離開遊戲") → the other side stops
   *  waiting to reconnect and shows "opponent left". Distinct from a mere drop. */
  abandoned?: Role
}

export class RoomError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'FULL' | 'CONFIG' | 'CODE_EXHAUSTED',
    message: string,
  ) {
    super(message)
    this.name = 'RoomError'
  }
}

/**
 * Per-TAB client id (sessionStorage, not localStorage) so two tabs in the same
 * browser get distinct ids — essential for testing host vs guest locally, and
 * it still survives a same-tab reload for reconnect.
 */
const CLIENT_KEY = 'shp.clientId'
export function getClientId(): string {
  let id = sessionStorage.getItem(CLIENT_KEY)
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    sessionStorage.setItem(CLIENT_KEY, id)
  }
  return id
}

const roomRef = (code: string) => ref(getDb(), `rooms/${code}`)
const random3 = () => String(Math.floor(Math.random() * 1000)).padStart(3, '0')

/**
 * Create a room under a free 3-digit code. Uses a transaction so two people
 * creating at once can never claim the same code (the loser retries).
 */
export async function createRoom(): Promise<{ code: string }> {
  const me = getClientId()
  for (let i = 0; i < 15; i++) {
    const code = random3()
    const res = await runTransaction(roomRef(code), (cur) => {
      if (cur !== null) return // occupied → abort, retry a new code
      const room: Room = {
        status: 'waiting',
        createdAt: serverTimestamp() as unknown as number,
        hostId: me,
        guestId: null,
        players: { host: { connected: true, lastSeen: serverTimestamp() as unknown as number } },
      }
      return room
    })
    if (res.committed) {
      // Flip host presence offline if this client disconnects.
      await onDisconnect(ref(getDb(), `rooms/${code}/players/host`)).update({
        connected: false,
        lastSeen: serverTimestamp(),
      })
      return { code }
    }
  }
  throw new RoomError('CODE_EXHAUSTED', '房號一時都被占用了，請再試一次')
}

/** Join an existing waiting room by code. Throws RoomError on not-found / full. */
export async function joinRoom(code: string): Promise<void> {
  const me = getClientId()
  const snap = await get(roomRef(code))
  if (!snap.exists()) throw new RoomError('NOT_FOUND', `找不到房號 ${code}`)
  const room = snap.val() as Room
  const alreadyMine = room.guestId === me || room.hostId === me
  if (room.guestId && !alreadyMine) throw new RoomError('FULL', '這個房間已經滿了')

  await update(roomRef(code), {
    guestId: me,
    status: 'playing',
    'players/guest': { connected: true, lastSeen: serverTimestamp() },
  })
  await onDisconnect(ref(getDb(), `rooms/${code}/players/guest`)).update({
    connected: false,
    lastSeen: serverTimestamp(),
  })
}

/** Subscribe to a room; callback fires with the latest snapshot (null if gone). */
export function subscribeRoom(code: string, cb: (room: Room | null) => void): () => void {
  return onValue(roomRef(code), (snap) => cb(snap.exists() ? (snap.val() as Room) : null))
}

/**
 * Mark this client offline; if the host leaves an empty waiting room, delete it.
 * Guarded by an existence check so it never CREATES a room (an `update` on a
 * missing path would otherwise write a phantom room).
 */
export async function leaveRoom(code: string, role: Role): Promise<void> {
  try {
    const snap = await get(roomRef(code))
    if (!snap.exists()) return
    const room = snap.val() as Room
    if (role === 'host' && room.status === 'waiting' && !room.guestId) {
      await remove(roomRef(code))
      return
    }
    await update(roomRef(code), {
      [`players/${role}/connected`]: false,
      [`players/${role}/lastSeen`]: serverTimestamp(),
    })
  } catch {
    /* best-effort */
  }
}

/** Build the shareable deep link for a room code. */
export function roomLink(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?room=${code}`
}

/** Mark a room as intentionally abandoned by `role` (see Room.abandoned). */
export async function markAbandoned(code: string, role: Role): Promise<void> {
  try {
    await update(roomRef(code), { abandoned: role })
  } catch {
    /* best-effort */
  }
}

// ---- Reconnect session (sessionStorage; same-TAB reload) ----
// A tiny cards-free pointer so an ACCIDENTAL reload reconnects. Stored in
// sessionStorage (NOT localStorage) for two reasons: (1) it's per-tab, so a
// host tab and a guest tab in the same browser don't overwrite each other's
// marker; (2) it matches clientId (also sessionStorage) and survives a reload
// but clears on tab close. It is cleared on an intentional "離開遊戲", so its
// presence == "not a deliberate leave → reconnect me". The host also keeps its
// full engine snapshot here; the guest stores no game state (reads RTDB).

const SESSION_KEY = 'shp.session'
const hostSnapKey = (code: string) => `shp.host.${code}`

export interface Session {
  code: string
  role: Role
}

export function saveSession(code: string, role: Role): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, role }))
  } catch {
    /* ignore */
  }
}

export function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (s && typeof s.code === 'string' && (s.role === 'host' || s.role === 'guest')) return s
  } catch {
    /* ignore */
  }
  return null
}

export function clearSession(): void {
  try {
    const s = readSession()
    sessionStorage.removeItem(SESSION_KEY)
    if (s?.role === 'host') sessionStorage.removeItem(hostSnapKey(s.code))
  } catch {
    /* ignore */
  }
}

/** Host-only: persist/restore the full authoritative game snapshot (per-tab). */
export function saveHostSnapshot(code: string, snap: unknown): void {
  try {
    sessionStorage.setItem(hostSnapKey(code), JSON.stringify(snap))
  } catch {
    /* ignore */
  }
}

export function readHostSnapshot<T = unknown>(code: string): T | null {
  try {
    const raw = sessionStorage.getItem(hostSnapKey(code))
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/**
 * Keep this client's presence alive across reconnects. On every (re)connect it
 * re-asserts connected=true and re-arms the onDisconnect handler. Must run from
 * the moment you create/join (not only in-game), otherwise a background-tab drop
 * can leave presence stuck false. Returns an unsubscribe.
 */
export function maintainPresence(code: string, role: Role): () => void {
  return onValue(ref(getDb(), '.info/connected'), (snap) => {
    if (snap.val() !== true) return
    const pRef = ref(getDb(), `rooms/${code}/players/${role}`)
    void update(pRef, { connected: true, lastSeen: serverTimestamp() })
    void onDisconnect(pRef).update({ connected: false, lastSeen: serverTimestamp() })
  })
}
