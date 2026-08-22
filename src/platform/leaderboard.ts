import {
  getDatabase,
  ref,
  get,
  update,
  query,
  orderByChild,
  limitToLast,
  startAt,
  type Database,
} from 'firebase/database'
import { getFirebaseApp } from '../firebaseApp'

/**
 * Leaderboard persistence (portable). See docs/PLATFORM-SPEC.md / #7.
 *
 * Four world-readable boards under `leaderboard/`, each keyed by uid and holding
 * a DENORMALIZED snapshot (displayName + avatarId + score + since) so the list
 * renders without a second read per row. Only registered accounts with a display
 * name are written; anonymous guests never appear. Scores are monotonic
 * (everything only ever goes up), so entries never need deleting.
 *   - byStage        score = furthest sub-stage reached (order+1); since = clearedAt
 *   - byWins         score = pvp wins
 *   - byAchievements score = Σ achievement tiers (0..21)
 *   - byDiamonds     score = LIFETIME diamonds collected (never reduced by spending)
 *
 * `since` = when the current score was first reached (tie-break: earliest wins).
 * It's preserved across syncs while the score is unchanged; only bumped when the
 * score actually increases. So replaying / renaming never loses your tie-break.
 */

export type Board = 'byStage' | 'byWins' | 'byAchievements' | 'byDiamonds'
export const BOARDS: Board[] = ['byStage', 'byWins', 'byAchievements', 'byDiamonds']

export interface LbRow {
  uid: string
  displayName: string
  avatarId: string
  score: number
  /** when the current score was first reached (tie-break: earliest ranks higher) */
  since: number
  /** byStage only: the furthest sub-stage id (for the「第 X-Y 關」label). */
  subId?: string
  updatedAt: number
}

/** A denormalized snapshot of one player, reconciled against every board on a
 *  sync. Each board is written only when its score > 0. */
export interface LbSnapshot {
  displayName: string
  avatarId: string
  stage: { score: number; subId: string; clearedAt: number } | null
  wins: number
  achievements: number
  diamonds: number
}

let _db: Database | null = null
function db(): Database {
  if (!_db) _db = getDatabase(getFirebaseApp())
  return _db
}

type Existing = { score: number; since: number; displayName: string; avatarId: string } | null

/** Reconcile the player's snapshot against their existing entries and write only
 *  what changed (a higher score, or a renamed / re-avatared account). Preserves
 *  `since` while the score is unchanged so the tie-break stays "earliest reach". */
export async function writeLeaderboard(uid: string, snap: LbSnapshot): Promise<void> {
  const now = Date.now()
  // Current entries (to preserve `since` and skip unchanged boards).
  const prev: Partial<Record<Board, Existing>> = {}
  await Promise.all(
    BOARDS.map(async (b) => {
      const s = await get(ref(db(), `leaderboard/${b}/${uid}`))
      prev[b] = s.exists() ? (s.val() as Existing) : null
    }),
  )

  const patch: Record<string, unknown> = {}
  const reconcile = (board: Board, score: number, extra?: Record<string, unknown>, forcedSince?: number) => {
    if (score <= 0) return
    const p = prev[board]
    const grew = !p || score > p.score
    const renamed = !!p && (p.displayName !== snap.displayName || p.avatarId !== snap.avatarId)
    if (!grew && !renamed) return // nothing changed on this board
    const since = grew ? (forcedSince ?? now) : (p!.since ?? now)
    patch[`${board}/${uid}`] = {
      displayName: snap.displayName,
      avatarId: snap.avatarId,
      score,
      since,
      updatedAt: now,
      ...extra,
    }
  }

  if (snap.stage) reconcile('byStage', snap.stage.score, { subId: snap.stage.subId }, snap.stage.clearedAt)
  reconcile('byWins', snap.wins)
  reconcile('byAchievements', snap.achievements)
  reconcile('byDiamonds', snap.diamonds)

  if (Object.keys(patch).length === 0) return
  await update(ref(db(), 'leaderboard'), patch)
}

/** How many rows the board shows. */
export const TOP_N = 20

function rowFrom(uid: string, v: Partial<LbRow>): LbRow {
  return {
    uid,
    displayName: v.displayName ?? '?',
    avatarId: v.avatarId ?? 'cat',
    score: v.score ?? 0,
    since: v.since ?? v.updatedAt ?? 0,
    subId: v.subId,
    updatedAt: v.updatedAt ?? 0,
  }
}

const byScoreThenSince = (a: LbRow, b: LbRow) => (b.score !== a.score ? b.score - a.score : a.since - b.since)

/** Top-N only. Uses an indexed range query (`orderByChild('score')` +
 *  `limitToLast`) so the client downloads ~N rows, not the whole board — the fix
 *  for both the leaderboard's bandwidth/perf (#3) and the main-thread stall that
 *  was swallowing the tab click sound (#2). Needs `.indexOn: ["score"]` on each
 *  board in the DB rules. */
export async function fetchTop(board: Board, n = TOP_N): Promise<LbRow[]> {
  const snap = await get(query(ref(db(), `leaderboard/${board}`), orderByChild('score'), limitToLast(n)))
  if (!snap.exists()) return []
  const rows: LbRow[] = []
  snap.forEach((child) => {
    rows.push(rowFrom(child.key as string, (child.val() ?? {}) as Partial<LbRow>))
  })
  return rows.sort(byScoreThenSince)
}

export interface MyRank {
  rank: number
  row: LbRow
}

/** My exact rank + row, for the frozen "我的排名" bar when I'm not in the top-N.
 *  Reads my own entry, then range-queries only the entries scoring at-or-above me
 *  (indexed) and counts how many outrank me — far lighter than pulling the board.
 *  Returns null if I have no entry on this board. */
export async function fetchMyRank(board: Board, uid: string): Promise<MyRank | null> {
  const mine = await get(ref(db(), `leaderboard/${board}/${uid}`))
  if (!mine.exists()) return null
  const row = rowFrom(uid, (mine.val() ?? {}) as Partial<LbRow>)
  const snap = await get(query(ref(db(), `leaderboard/${board}`), orderByChild('score'), startAt(row.score)))
  let above = 0
  snap.forEach((child) => {
    if (child.key === uid) return
    const v = (child.val() ?? {}) as Partial<LbRow>
    const s = v.score ?? 0
    const since = v.since ?? v.updatedAt ?? 0
    // strictly higher score, or equal score reached earlier → ranks above me
    if (s > row.score || (s === row.score && since < row.since)) above++
  })
  return { rank: above + 1, row }
}
