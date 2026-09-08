import { get, onValue, ref, remove, serverTimestamp, update, set as dbSet } from 'firebase/database'
import { getDb } from './firebase'
import { currentUser } from '../platform/auth'

/**
 * `liveIndex`/`spectate` 的寫入規則要求 `auth != null`。若沒有 Firebase 登入(在主畫面閒置的純訪客 /
 * 剛登出),寫入必被伺服器拒(permission_denied),而 RTDB 會把這種被拒的 pending write **留在佇列裡
 * 一直重送** → console 洪水 + 空轉吃效能(2026-09-08 使用者回報)。所以這裡所有 liveIndex 變更(全由
 * **廣播端**呼叫)先 gate:沒 auth 就跳過。
 * ⚠️ 這**不影響**任何正常流程:①進對局(快配/開房)本來就先 ensureAccount → 廣播端一定已登入 → 照常
 *   廣播、照常被觀戰;②觀戰者點「加入觀戰」會先 ensureAccount(見 spectate.ts) → 也已登入;純看(讀
 *   spec)是 .read=true 公開,訪客直接看。gate 到的只有「閒置/殘留狀態下注定失敗又狂重送」的寫入。
 */
const authed = (): boolean => !!currentUser()

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
// 一場對局最多幾分鐘(含暫停);超過這麼久還是 live = 廣播端當機/soft-nav 沒觸發 onDisconnect →
// 殘留的假 live 卡(永遠不會翻 ended、也不會被 24h sweep)→ 視為死掉,清掉。給足餘裕免誤殺真對局。
const LIVE_TTL_MS = 60 * 60 * 1000 // 1 小時

/** Create/overwrite a live entry (status:'live'). Called when a match's cards are dealt. */
export async function writeLiveEntry(
  code: string,
  p1: LivePlayer,
  p2: LivePlayer,
): Promise<void> {
  if (!authed()) return // 沒 auth → 必被拒且會卡佇列重送,直接跳過(§洪水修正)
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
  if (!authed()) return
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
  if (!authed()) return
  try {
    await update(liveRef(code), { [`${side}/wins`]: wins, [`${side}/games`]: games })
  } catch {
    /* best-effort */
  }
}

/** Write the current spectator count (broadcaster only). */
export async function writeSpectatorCount(code: string, n: number): Promise<void> {
  if (!authed()) return
  try {
    await update(liveRef(code), { spectators: n })
  } catch {
    /* best-effort */
  }
}

/** Remove a live entry outright (crash cleanup via onDisconnect; NOT normal end). */
export async function removeLiveEntry(code: string): Promise<void> {
  if (!authed()) return
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
      const entries = Object.entries(all)
      const valid = (e: Omit<LiveEntry, 'code'>) => e && e.p1 && e.p2 && (e.status === 'live' || e.status === 'ended')
      const list: LiveEntry[] = entries
        // 濾掉殘缺 entry(當機/onDisconnect race 留下、只有 code 沒 p1/p2 的殘骸)→ 不然 UI 讀 p.avatar 會炸。
        .filter(([, e]) => valid(e))
        .map(([code, e]) => ({ ...e, code }))
      // 殘缺 zombie(缺 p1/p2 或缺 status,永遠不會被顯示也不會被 24h sweep)→ 直接清掉,避免長期堆積。
      const zombies = entries.filter(([, e]) => !valid(e)).map(([code]) => code)
      void sweepStaleLive(list, zombies) // lazy cleanup, never blocks render
      cb(sortLiveEntries(list, limit))
    },
    () => cb([]),
  )
  return unsub
}

/** Lazy sweep (比照 sweepStaleRooms): delete ended entries older than 24h + 殘缺 zombie,
 *  連同其 spectate/ 子樹。給已讀到的 list/zombie codes,不多花讀取。沒 auth 就不做(寫不進、
 *  且會卡佇列重送 → 洪水)。 */
async function sweepStaleLive(list: LiveEntry[], zombies: string[] = []): Promise<void> {
  if (!authed()) return
  const now = Date.now()
  const deadEnded = list
    .filter((e) => e.status === 'ended' && typeof e.endedAt === 'number' && now - e.endedAt > ENDED_TTL_MS)
    .map((e) => e.code)
  // 殘留假 live(startedAt 超過 1 小時還沒結束)→ 廣播端早死、onDisconnect 沒清 → 一起掃。
  const deadLive = list
    .filter((e) => e.status === 'live' && typeof e.startedAt === 'number' && now - e.startedAt > LIVE_TTL_MS)
    .map((e) => e.code)
  const codes = [...new Set([...deadEnded, ...deadLive, ...zombies])]
  for (const code of codes) {
    try {
      await remove(liveRef(code))
      await remove(ref(getDb(), `spectate/${code}`))
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
