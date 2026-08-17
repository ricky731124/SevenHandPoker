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
/** Room type (SPEC §15 / Phase C #9). `special` = special-card room. */
export type RoomType = 'normal' | 'special'

export interface PlayerPresence {
  connected: boolean
  lastSeen: number
  /** display identity, written after join (see setPlayerMeta). */
  name?: string | null
  avatarId?: string
  /** special-card ids this player has unlocked — used for the PvP intersection pool. */
  specials?: string[]
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
  /**
   * Host's ACCOUNT uid (cross-tab, unlike the per-tab hostId/clientId). Used to
   * reject a player joining their own room — a person can't play themselves.
   */
  hostUid?: string | null
  /** Host-chosen room type; absent (legacy rooms) ⇒ 'normal'. */
  roomType?: RoomType
  /** Host-chosen per-turn seconds; absent ⇒ default. */
  timeLimit?: number
  players: { host: PlayerPresence; guest?: PlayerPresence }
  /** set to the role that intentionally left ("離開遊戲") → the other side stops
   *  waiting to reconnect and shows "opponent left". Distinct from a mere drop. */
  abandoned?: Role
}

export class RoomError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'FULL' | 'CONFIG' | 'CODE_EXHAUSTED' | 'SELF',
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

/** A game lasts minutes; any room older than this is dead junk (crash / closed
 *  tab / drop that never ran the clean-up path). RTDB has no native TTL, so we
 *  reap lazily instead of running a paid scheduled function. */
const ROOM_TTL_MS = 6 * 60 * 60 * 1000 // 6h

/**
 * Best-effort sweep of abandoned rooms (createdAt older than the TTL). Fired
 * (and forgotten) from createRoom, so ordinary play keeps the 000–999 code space
 * clean without any backend. Reads the whole `rooms` node — fine at this scale
 * (≤1000 tiny entries) — and removes the stale ones.
 */
export async function sweepStaleRooms(ttlMs = ROOM_TTL_MS): Promise<void> {
  try {
    const snap = await get(ref(getDb(), 'rooms'))
    if (!snap.exists()) return
    const now = Date.now()
    const rooms = snap.val() as Record<string, Room>
    const dead = Object.entries(rooms).filter(([, r]) => {
      // Only act on a resolved numeric createdAt — never nuke a room mid-creation
      // (serverTimestamp not yet committed) or a legacy room without the field.
      const t = typeof r?.createdAt === 'number' ? r.createdAt : 0
      return t > 0 && now - t > ttlMs
    })
    await Promise.all(dead.map(([code]) => remove(roomRef(code)).catch(() => {})))
  } catch {
    /* best-effort — never block room creation on cleanup */
  }
}

/**
 * Create a room under a free 3-digit code. Uses a transaction so two people
 * creating at once can never claim the same code (the loser retries).
 */
export async function createRoom(
  hostUid: string | null = null,
  roomType: RoomType = 'normal',
  timeLimit = 50,
): Promise<{ code: string }> {
  const me = getClientId()
  void sweepStaleRooms() // reap dead rooms opportunistically; don't await
  for (let i = 0; i < 15; i++) {
    const code = random3()
    const res = await runTransaction(roomRef(code), (cur) => {
      if (cur !== null) return // occupied → abort, retry a new code
      const room: Room = {
        status: 'waiting',
        createdAt: serverTimestamp() as unknown as number,
        hostId: me,
        hostUid: hostUid ?? null,
        roomType,
        timeLimit,
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

/** Join an existing waiting room by code. Throws RoomError on not-found / full / self-join. */
export async function joinRoom(code: string, myUid: string | null = null): Promise<void> {
  const me = getClientId()
  const snap = await get(roomRef(code))
  if (!snap.exists()) throw new RoomError('NOT_FOUND', `找不到房號 ${code}`)
  const room = snap.val() as Room
  const alreadyMine = room.guestId === me || room.hostId === me
  // Same ACCOUNT as the host → block (a person can't play themselves). Only when
  // both uids are known; anonymous-not-yet-created (null) never falsely matches.
  if (!alreadyMine && myUid && room.hostUid && room.hostUid === myUid) {
    throw new RoomError('SELF', '不能加入自己建立的房間（請用另一個帳號，或另一個瀏覽器測試）')
  }
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

export interface RoomInfo {
  exists: boolean
  roomType: RoomType
  timeLimit: number
  /** host's display name (for the join-confirm popup), if published yet */
  hostName: string | null
  /** already full (a guest joined) — can't join */
  full: boolean
}

/** Peek a room's public config before joining (type + time + host + full). Read-only. */
export async function getRoomInfo(code: string): Promise<RoomInfo> {
  const miss: RoomInfo = { exists: false, roomType: 'normal', timeLimit: 50, hostName: null, full: false }
  try {
    const snap = await get(roomRef(code))
    if (!snap.exists()) return miss
    const r = snap.val() as Room
    return {
      exists: true,
      roomType: r.roomType ?? 'normal',
      timeLimit: r.timeLimit ?? 50,
      hostName: r.players?.host?.name ?? null,
      full: !!r.guestId,
    }
  } catch {
    return miss
  }
}

/** Subscribe to a room; callback fires with the latest snapshot (null if gone). */
export function subscribeRoom(code: string, cb: (room: Room | null) => void): () => void {
  return onValue(roomRef(code), (snap) => cb(snap.exists() ? (snap.val() as Room) : null))
}

/**
 * Intentional leave ("離開遊戲"). If this client is the last one out — nobody ever
 * joined, or the peer is already gone — delete the whole room so it doesn't
 * linger as garbage; otherwise just flip this client offline (the peer may still
 * be around, e.g. to see the result or rematch). Crash/closed-tab drops don't
 * come through here — sweepStaleRooms reaps those later. Guarded by an existence
 * check so it never CREATES a room (an `update` on a missing path would write a
 * phantom room).
 */
export async function leaveRoom(code: string, role: Role): Promise<void> {
  try {
    const snap = await get(roomRef(code))
    if (!snap.exists()) return
    const room = snap.val() as Room
    const other: Role = role === 'host' ? 'guest' : 'host'
    const peerHere = !!room.guestId && !!room.players?.[other]?.connected
    if (!peerHere) {
      // Empty waiting room, or the peer has already left/dropped → I'm the last
      // one here, so tear the whole room down instead of leaving a husk behind.
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

/** Build the shareable deep link for a room code. The joiner peeks the room's
 *  config (getRoomInfo) at confirm time, so the link only needs the code. */
export function roomLink(code: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?room=${code}`
}

/**
 * Write this client's display identity (name + avatar) to its player slot.
 * A partial update so it never clobbers the presence fields (connected/lastSeen).
 */
export async function setPlayerMeta(
  code: string,
  role: Role,
  meta: { name: string | null; avatarId: string; specials?: string[] },
): Promise<void> {
  try {
    const patch: Record<string, unknown> = { name: meta.name, avatarId: meta.avatarId }
    if (meta.specials) patch.specials = meta.specials // RTDB rejects undefined — include only when known
    await update(ref(getDb(), `rooms/${code}/players/${role}`), patch)
  } catch {
    /* best-effort */
  }
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
