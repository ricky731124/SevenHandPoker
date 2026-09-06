import { get, onValue, ref, remove, serverTimestamp, update, set as dbSet } from 'firebase/database'
import { getDb } from './firebase'

/**
 * `liveIndex/{code}` — the Live 版 card metadata (§1.1, §5). Both real-human and
 * casual-bot matches publish here; the menu's LiveBoard subscribes to the whole
 * node and shows the top few (§5.3). Kept tiny (~80 bytes/entry) so subscribing to
 * the whole node is cheap. Spectator count is written back by the broadcaster (§4.4).
 *
 * `code`: real-human match reuses the 3-digit room code; casual-bot match uses a
 * `spec_…` key (broadcast.ts) that avoids the 3-digit room space.
 */

export interface LivePlayer {
  name: string
  avatar: string
  uid: string | null
  wins: number // 真人勝場 (bot: its accumulated wins)
  games: number // for win-rate; 0 → show "—"
  isBot?: boolean
}

export interface LiveEntry {
  code: string // the node key (filled in by the subscription, not stored redundantly)
  p1: LivePlayer // 廣播端玩家 (real human)
  p2: LivePlayer // 對手 (real human or bot)
  status: 'live' | 'ended'
  startedAt: number
  endedAt: number | null
  winner: 'p1' | 'p2' | null
  spectators: number
}

const liveRef = (code: string) => ref(getDb(), `liveIndex/${code}`)
const ENDED_TTL_MS = 24 * 60 * 60 * 1000 // 結束後保留 24h 再由清潔工刪

/** Create/overwrite a live entry (status:'live'). Called when a match's cards are dealt. */
export async function writeLiveEntry(
  code: string,
  p1: LivePlayer,
  p2: LivePlayer,
): Promise<void> {
  try {
    await dbSet(liveRef(code), {
      p1,
      p2,
      status: 'live',
      startedAt: serverTimestamp(),
      endedAt: null,
      winner: null,
      spectators: 0,
    })
  } catch {
    /* best-effort — rules not published yet, or offline */
  }
}

/** Flip a live entry to 'ended' with the winner (kept 24h as a spent card, then swept). */
export async function flipLiveEnded(code: string, winner: 'p1' | 'p2'): Promise<void> {
  try {
    await update(liveRef(code), { status: 'ended', winner, endedAt: serverTimestamp() })
  } catch {
    /* best-effort */
  }
}

/** Fill in a card's win record after the async bot/card read resolves (§5.2). */
export async function patchLivePlayerRecord(
  code: string,
  side: 'p1' | 'p2',
  wins: number,
  games: number,
): Promise<void> {
  try {
    await update(liveRef(code), { [`${side}/wins`]: wins, [`${side}/games`]: games })
  } catch {
    /* best-effort */
  }
}

/** Write the current spectator count (broadcaster only). */
export async function writeSpectatorCount(code: string, n: number): Promise<void> {
  try {
    await update(liveRef(code), { spectators: n })
  } catch {
    /* best-effort */
  }
}

/** Remove a live entry outright (crash cleanup via onDisconnect; NOT normal end). */
export async function removeLiveEntry(code: string): Promise<void> {
  try {
    await remove(liveRef(code))
  } catch {
    /* best-effort */
  }
}

/**
 * Display order (§5.3, front-end only — never deletes rows): live group before
 * ended group; within each, newest first (live by startedAt desc, ended by endedAt
 * desc); then keep only the top `limit` (default 5). Rows past the cut are simply
 * not drawn — the data stays put.
 */
export function sortLiveEntries(entries: LiveEntry[], limit = 5): LiveEntry[] {
  const rank = (e: LiveEntry) => (e.status === 'live' ? 0 : 1)
  const key = (e: LiveEntry) => (e.status === 'live' ? e.startedAt : e.endedAt ?? e.startedAt) || 0
  return [...entries]
    .sort((a, b) => rank(a) - rank(b) || key(b) - key(a))
    .slice(0, limit)
}

/**
 * Subscribe to the whole `liveIndex` node → sorted top-N entries. Returns an
 * unsubscribe. Opportunistically sweeps stale ended entries on each update.
 */
export function subscribeLiveIndex(cb: (entries: LiveEntry[]) => void, limit = 5): () => void {
  const node = ref(getDb(), 'liveIndex')
  const unsub = onValue(
    node,
    (snap) => {
      const all = (snap.val() ?? {}) as Record<string, Omit<LiveEntry, 'code'>>
      const list: LiveEntry[] = Object.entries(all)
        // 濾掉殘缺 entry(當機/onDisconnect race 留下、只有 code 沒 p1/p2 的殘骸)→ 不然 UI 讀 p.avatar 會炸。
        .filter(([, e]) => e && e.p1 && e.p2 && (e.status === 'live' || e.status === 'ended'))
        .map(([code, e]) => ({ ...e, code }))
      void sweepStaleLive(list) // lazy cleanup, never blocks render
      cb(sortLiveEntries(list, limit))
    },
    () => cb([]),
  )
  return unsub
}

/** Lazy sweep (比照 sweepStaleRooms): delete ended entries older than 24h, and their
 *  spectate/ subtree. Given the already-read list so it costs no extra read. */
async function sweepStaleLive(list: LiveEntry[]): Promise<void> {
  const now = Date.now()
  const dead = list.filter((e) => e.status === 'ended' && typeof e.endedAt === 'number' && now - e.endedAt > ENDED_TTL_MS)
  for (const e of dead) {
    try {
      await remove(liveRef(e.code))
      await remove(ref(getDb(), `spectate/${e.code}`))
    } catch {
      /* best-effort */
    }
  }
}

/** One-shot fetch (e.g. to seed a card's win record). Best-effort, never throws. */
export async function fetchBotRecord(botId: string): Promise<{ wins: number; games: number }> {
  try {
    const snap = await get(ref(getDb(), `bots/${botId}`))
    const v = (snap.val() ?? {}) as { wins?: number; games?: number }
    return { wins: v.wins ?? 0, games: v.games ?? 0 }
  } catch {
    return { wins: 0, games: 0 }
  }
}
