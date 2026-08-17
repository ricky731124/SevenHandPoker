import { getDatabase, ref, get, update, type Database } from 'firebase/database'
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

/** Read a whole board and return it sorted best-first (score desc; ties broken by
 *  earliest reach — `since` asc). Player counts are small, so pulling the whole
 *  board client-side is fine (add an index later if it grows). */
export async function fetchBoard(board: Board): Promise<LbRow[]> {
  const snap = await get(ref(db(), `leaderboard/${board}`))
  if (!snap.exists()) return []
  const rows: LbRow[] = []
  snap.forEach((child) => {
    const v = (child.val() ?? {}) as Partial<LbRow>
    rows.push({
      uid: child.key as string,
      displayName: v.displayName ?? '?',
      avatarId: v.avatarId ?? 'cat',
      score: v.score ?? 0,
      since: v.since ?? v.updatedAt ?? 0,
      subId: v.subId,
      updatedAt: v.updatedAt ?? 0,
    })
  })
  rows.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.since - b.since))
  return rows
}
