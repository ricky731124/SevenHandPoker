import { get, onValue, onDisconnect, ref, remove, runTransaction, serverTimestamp, set as dbSet } from 'firebase/database'
import { getDb } from './firebase'
import { useNetStore } from '../state/netStore'
import type { RoomType } from './room'

/**
 * Free-match ("自由匹配") queue. Two humans searching the same room type get
 * paired into a real online room; if none appears within the timeout, the caller
 * falls back to a bot (see casualBots).
 *
 * Pairing race: both sides could claim each other and open two rooms. We break the
 * symmetry with a strict order — only the NEWER entry claims an OLDER one (ts, uid
 * tiebreak); the older side just waits to be claimed. A transaction on the target
 * guarantees a single claimer even under bursts. The claimer creates the room
 * (via netStore, so its state is wired for OnlineGame) and writes the code into
 * the claimed peer's entry; the peer sees it and joins.
 */

const TIMEOUT_MS = 30_000
const FREE_MATCH_TIME_LIMIT = 99 // fixed (使用者定案:自由匹配不選秒數)

interface QueueEntry {
  uid: string
  name: string
  avatar: string
  ts: number
  claimedBy?: string | null
  room?: string | null
}

export interface MatchmakingHandlers {
  /** paired with a human → an online room is wired in netStore, ready to launch */
  onMatched: (role: 'host' | 'guest', code: string) => void
  /** no human within the timeout → caller should start a bot match */
  onTimeout: () => void
  /** room creation/join failed → caller should bail (back to menu) */
  onError?: (msg: string) => void
}

/** Join the queue for a room type. Returns a cancel fn (removes the entry + stops). */
export function joinMatchmaking(
  roomType: RoomType,
  me: { uid: string; name: string; avatar: string },
  handlers: MatchmakingHandlers,
): () => void {
  const db = getDb()
  const myRef = ref(db, `matchmaking/${roomType}/${me.uid}`)
  const listRef = ref(db, `matchmaking/${roomType}`)
  let done = false
  let unsubList: (() => void) | null = null
  let unsubMine: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const stop = () => {
    unsubList?.()
    unsubMine?.()
    unsubList = unsubMine = null
    if (timer) clearTimeout(timer)
    timer = null
  }
  const leaveQueue = () => void remove(myRef).catch(() => {})

  // 1) Enqueue, and auto-remove if this tab dies while still searching.
  void dbSet(myRef, { uid: me.uid, name: me.name, avatar: me.avatar, ts: serverTimestamp() })
    .then(() => onDisconnect(myRef).remove().catch(() => {}))
    .catch(() => {})

  // 2) As the CLAIMED side: when a claimer writes a room code onto my entry, join it.
  unsubMine = onValue(myRef, (snap) => {
    if (done) return
    const e = snap.val() as QueueEntry | null
    if (!e?.room) return
    done = true
    stop()
    leaveQueue()
    void useNetStore
      .getState()
      .join(e.room)
      .then(() => handlers.onMatched('guest', e.room!))
      .catch(() => handlers.onError?.('加入房間失敗'))
  }, () => {})

  // 3) As the CLAIMER: scan for an older, unclaimed entry and claim it.
  const tryClaim = async () => {
    if (done) return
    try {
      await tryClaimInner()
    } catch {
      /* permission / network hiccup — the 30s timeout still falls back to a bot */
    }
  }
  const tryClaimInner = async () => {
    const snap = await get(listRef)
    const all = (snap.val() ?? {}) as Record<string, QueueEntry>
    const mine = all[me.uid]
    if (typeof mine?.ts !== 'number') return // my serverTimestamp not resolved yet — wait
    const myTs = mine.ts
    const older = Object.values(all)
      .filter((e) => e && e.uid !== me.uid && !e.claimedBy && !e.room && typeof e.ts === 'number')
      .filter((e) => e.ts < myTs || (e.ts === myTs && e.uid < me.uid))
      .sort((a, b) => a.ts - b.ts)
    for (const target of older) {
      if (done) return
      const tRef = ref(db, `matchmaking/${roomType}/${target.uid}`)
      const res = await runTransaction(tRef, (cur: QueueEntry | null) => {
        if (!cur || cur.claimedBy || cur.room) return // already taken → abort
        cur.claimedBy = me.uid
        return cur
      })
      if (!res.committed || res.snapshot.val()?.claimedBy !== me.uid) continue
      // Claimed! I'm the host: create the room, hand the code to the peer.
      done = true
      stop()
      try {
        await useNetStore.getState().create(roomType, FREE_MATCH_TIME_LIMIT)
        const code = useNetStore.getState().code
        if (!code) throw new Error('no code')
        await dbSet(ref(db, `matchmaking/${roomType}/${target.uid}/room`), code)
        leaveQueue()
        handlers.onMatched('host', code)
      } catch {
        leaveQueue()
        handlers.onError?.('建立房間失敗')
      }
      return
    }
  }

  // Re-scan whenever the queue changes (someone new joined / freed up).
  unsubList = onValue(listRef, () => void tryClaim(), () => {})

  // 4) Timeout → fall back to a bot.
  timer = setTimeout(() => {
    if (done) return
    done = true
    stop()
    leaveQueue()
    handlers.onTimeout()
  }, TIMEOUT_MS)

  // Cancel handle.
  return () => {
    if (done) return
    done = true
    stop()
    leaveQueue()
  }
}
