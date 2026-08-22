import {
  getDatabase,
  ref,
  get,
  update,
  onValue,
  runTransaction,
  increment,
  type Database,
} from 'firebase/database'
import { getFirebaseApp } from '../firebaseApp'
import { normalizeUsername } from './auth'

/**
 * Player profile persistence (portable). See docs/PLATFORM-SPEC.md §3.
 * All fields are game-agnostic; the concrete values of cardId / achievementKey /
 * stageId are defined by each game's content.
 */

// 基底特殊牌:Phase A 讓所有帳號預設解鎖 1 張(原訂「過教學解鎖」,教學做好再改)。
export const BASELINE_SPECIAL_CARD = 'swap'
export const DEFAULT_AVATAR = 'cat'

/** An in-progress BO series, persisted so it resumes across sessions (only for
 *  logged-in/anonymous accounts — the point of the account). Opaque to the
 *  platform; the game (campaign.ts) defines the shape. */
export interface ActiveSeries {
  subId: string
  bestOf: number
  winsNeeded: number
  results: string[]
}

export interface Profile {
  /** Login account name (ASCII, unique) — password accounts only; null for
   *  Google/anonymous. Maps to the synthetic email; NOT what's shown in-game. */
  username: string | null
  /** Free-form name shown in-game / leaderboards (can be Chinese, not unique). */
  displayName: string | null
  isAnonymous: boolean
  createdAt: number
  lastActive: number
  progress: {
    maxStageCleared: string | null
    stageClearedAt: Record<string, number>
    activeSeries: ActiveSeries | null
  }
  /** Has the player entered the tutorial? Until then only 新手教學 is unlocked
   *  (第1關 stays locked). Set on first tutorial entry. */
  tutorialSeen: boolean
  diamonds: number
  /** Per-day task flags (reset when `date` changes). Each = reward already granted
   *  today. `pvpDiamonds` is the retired 3-win field, kept optional for legacy. */
  daily: {
    date: string
    signin?: boolean
    match?: boolean
    pvpWin1?: boolean
    pvpWin2?: boolean
    pvpDiamonds?: number
  }
  unlocked: {
    specialCards: Record<string, true>
    avatars: Record<string, true>
    achievements: Record<string, number>
    emojis: Record<string, true>
  }
  equipped: { avatar: string; achievements: string[]; specialCards: string[] }
  stats: Record<string, number>
}

let _db: Database | null = null
function db(): Database {
  if (!_db) _db = getDatabase(getFirebaseApp())
  return _db
}

export function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Fresh profile for a brand-new uid. */
function freshProfile(isAnonymous: boolean, now: number): Record<string, unknown> {
  return {
    username: null,
    displayName: null,
    isAnonymous,
    createdAt: now,
    lastActive: now,
    progress: { maxStageCleared: null },
    tutorialSeen: false,
    diamonds: 0,
    daily: { date: todayStr() },
    unlocked: { specialCards: { [BASELINE_SPECIAL_CARD]: true } },
    equipped: { avatar: DEFAULT_AVATAR, specialCards: [BASELINE_SPECIAL_CARD] },
    stats: {},
  }
}

// RTDB drops empty objects/arrays, so reads must tolerate missing branches.
function normalize(raw: any): Profile {
  return {
    username: raw?.username ?? null,
    displayName: raw?.displayName ?? null,
    isAnonymous: raw?.isAnonymous ?? true,
    createdAt: raw?.createdAt ?? 0,
    lastActive: raw?.lastActive ?? 0,
    progress: {
      maxStageCleared: raw?.progress?.maxStageCleared ?? null,
      stageClearedAt: raw?.progress?.stageClearedAt ?? {},
      activeSeries: raw?.progress?.activeSeries
        ? {
            subId: raw.progress.activeSeries.subId,
            bestOf: raw.progress.activeSeries.bestOf,
            winsNeeded: raw.progress.activeSeries.winsNeeded,
            results: raw.progress.activeSeries.results ?? [],
          }
        : null,
    },
    tutorialSeen: raw?.tutorialSeen ?? false,
    diamonds: raw?.diamonds ?? 0,
    daily: {
      date: raw?.daily?.date ?? '',
      signin: !!raw?.daily?.signin,
      match: !!raw?.daily?.match,
      pvpWin1: !!raw?.daily?.pvpWin1,
      pvpWin2: !!raw?.daily?.pvpWin2,
    },
    unlocked: {
      specialCards: raw?.unlocked?.specialCards ?? {},
      avatars: raw?.unlocked?.avatars ?? {},
      achievements: raw?.unlocked?.achievements ?? {},
      emojis: raw?.unlocked?.emojis ?? {},
    },
    equipped: {
      avatar: raw?.equipped?.avatar ?? DEFAULT_AVATAR,
      achievements: raw?.equipped?.achievements ?? [],
      specialCards: raw?.equipped?.specialCards ?? [],
    },
    stats: raw?.stats ?? {},
  }
}

/**
 * Create the profile with defaults if missing; otherwise only bump lastActive /
 * isAnonymous. Transactional so concurrent callers (onAuth + register) never
 * clobber an existing profile (e.g. wipe a just-written username). See §2.2.1.
 */
export async function ensureProfile(uid: string, isAnonymous: boolean): Promise<void> {
  const now = Date.now()
  // applyLocally:false — don't surface the optimistic first-run value (which is
  // freshProfile when the node isn't cached yet) to local listeners; only the
  // committed server value reaches subscribeProfile, so username never flashes null.
  await runTransaction(
    ref(db(), `users/${uid}`),
    (cur) => {
      if (cur === null) return freshProfile(isAnonymous, now)
      cur.lastActive = now
      cur.isAnonymous = isAnonymous
      return cur
    },
    { applyLocally: false },
  )
}

export function subscribeProfile(uid: string, cb: (p: Profile | null) => void): () => void {
  return onValue(ref(db(), `users/${uid}`), (snap) => cb(snap.exists() ? normalize(snap.val()) : null))
}

/** One-shot read of the committed profile (used to recompute leaderboard scores
 *  right after a write, without waiting for the live subscription to catch up). */
export async function fetchProfile(uid: string): Promise<Profile | null> {
  const snap = await get(ref(db(), `users/${uid}`))
  return snap.exists() ? normalize(snap.val()) : null
}

/**
 * Best-effort username→uid mirror for display/lookups. Real uniqueness is
 * enforced by Firebase Auth's email uniqueness (email = f(username)).
 */
export async function reserveUsername(username: string, uid: string): Promise<void> {
  await runTransaction(ref(db(), `usernames/${normalizeUsername(username)}`), (cur) =>
    cur === null || cur === uid ? uid : undefined,
  )
}

export async function setUsername(uid: string, username: string): Promise<void> {
  await update(ref(db(), `users/${uid}`), { username: username.trim(), isAnonymous: false })
}

/** Set the free-form display name shown in-game / leaderboards (no uniqueness,
 *  can be Chinese). Distinct from the login `username`. */
export async function setDisplayName(uid: string, name: string): Promise<void> {
  await update(ref(db(), `users/${uid}`), { displayName: name.trim() })
}

/** One-shot read of a uid's display name (null if not set yet — e.g. a first-
 *  time Google user who hasn't picked one). */
export async function fetchDisplayName(uid: string): Promise<string | null> {
  const snap = await get(ref(db(), `users/${uid}/displayName`))
  return snap.exists() ? (snap.val() as string) : null
}

/** Mark the tutorial as entered (unlocks 第1關). Idempotent. */
export async function markTutorialSeen(uid: string): Promise<void> {
  await update(ref(db(), `users/${uid}`), { tutorialSeen: true })
}

/** Save the player's special-card loadout (equipped.specialCards, ≤3). */
export async function setSpecialLoadout(uid: string, ids: string[]): Promise<void> {
  await update(ref(db(), `users/${uid}/equipped`), { specialCards: ids })
}

/** Save the player's equipped avatar. */
export async function setAvatar(uid: string, avatarId: string): Promise<void> {
  await update(ref(db(), `users/${uid}/equipped`), { avatar: avatarId })
}

/** Save the player's displayed achievements (equipped.achievements, ≤3 family ids). */
export async function setEquippedAchievements(uid: string, ids: string[]): Promise<void> {
  await update(ref(db(), `users/${uid}/equipped`), { achievements: ids })
}

/** Unlock a set of special cards + avatars (used to fully open the test account). */
export async function unlockAll(
  uid: string,
  specialCardIds: string[],
  avatarIds: string[],
  stickerIds: string[] = [],
): Promise<void> {
  const patch: Record<string, true> = {}
  for (const id of specialCardIds) patch[`unlocked/specialCards/${id}`] = true
  for (const id of avatarIds) patch[`unlocked/avatars/${id}`] = true
  for (const id of stickerIds) patch[`unlocked/emojis/${id}`] = true
  await update(ref(db(), `users/${uid}`), patch)
}

/** Is this username already registered? (usernames/ is world-readable.) */
export async function isUsernameTaken(username: string): Promise<boolean> {
  return (await get(ref(db(), `usernames/${normalizeUsername(username)}`))).exists()
}

/**
 * Persist a campaign sub-stage clear (first clear only — the caller decides).
 * Records the timestamp + advances maxStageCleared, and grants the reward
 * (unlock a card / avatar, add diamonds atomically). See campaign.ts rewards.
 */
export async function recordStageClear(
  uid: string,
  opts: {
    subId: string
    /** the furthest-cleared sub-stage id after this clear (for map gating) */
    maxStageCleared: string
    cardId?: string
    avatarId?: string
    diamonds?: number
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    [`progress/stageClearedAt/${opts.subId}`]: Date.now(),
    'progress/maxStageCleared': opts.maxStageCleared,
  }
  if (opts.cardId) patch[`unlocked/specialCards/${opts.cardId}`] = true
  if (opts.avatarId) patch[`unlocked/avatars/${opts.avatarId}`] = true
  if (opts.diamonds) {
    patch['diamonds'] = increment(opts.diamonds)
    // Lifetime tally for 積鑽達人 — only ever grows (spending doesn't touch it).
    patch['stats/diamondsEarned'] = increment(opts.diamonds)
  }
  await update(ref(db(), `users/${uid}`), patch)
}

/**
 * Grant a PvP-win diamond reward atomically: add to the balance + lifetime tally,
 * and set today's PvP-diamond total (absolute, with the date so it resets daily).
 * The caller enforces the daily cap.
 */
export async function grantPvpReward(uid: string, amount: number, date: string, dailyTotal: number): Promise<void> {
  await update(ref(db(), `users/${uid}`), {
    diamonds: increment(amount),
    'stats/diamondsEarned': increment(amount),
    'daily/date': date,
    'daily/pvpDiamonds': dailyTotal,
  })
}

/**
 * Grant a daily-task reward atomically (#6): add diamonds + lifetime tally, and
 * write the full day's task flags (so a new day is reset consistently — the caller
 * computes the flags). Replaces the old per-win grantPvpReward.
 */
export async function grantDailyReward(
  uid: string,
  amount: number,
  daily: { date: string; signin?: boolean; match?: boolean; pvpWin1?: boolean; pvpWin2?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (amount > 0) {
    patch.diamonds = increment(amount)
    patch['stats/diamondsEarned'] = increment(amount)
  }
  patch['daily/date'] = daily.date
  patch['daily/signin'] = !!daily.signin
  patch['daily/match'] = !!daily.match
  patch['daily/pvpWin1'] = !!daily.pvpWin1
  patch['daily/pvpWin2'] = !!daily.pvpWin2
  await update(ref(db(), `users/${uid}`), patch)
}

/** Backfill the lifetime-diamonds tally (absolute set). Used once per account to
 *  seed 積鑽達人 with a floor = current balance for players who earned diamonds
 *  before the tally existed; afterwards it only grows via recordStageClear. */
export async function setDiamondsEarned(uid: string, value: number): Promise<void> {
  await update(ref(db(), `users/${uid}/stats`), { diamondsEarned: value })
}

/** Save (or clear, with null) the in-progress BO series so it resumes later. */
export async function saveActiveSeries(uid: string, series: ActiveSeries | null): Promise<void> {
  await update(ref(db(), `users/${uid}/progress`), { activeSeries: series })
}

/**
 * Persist a finished match: absolute `stats` values (場次/勝/連勝/各牌型單場最佳;
 * 勝率 & 敗 are derived, not stored — 使用者要求) plus the recomputed achievement
 * tiers. Absolute values (not increments) because streak resets and hand-type
 * bests are read-modify-write — the caller computes them from the live profile.
 */
/** Buy a sticker: atomically deduct 鑽石 and unlock it. Caller pre-checks funds. */
export async function buySticker(uid: string, id: string, cost: number): Promise<void> {
  await update(ref(db(), `users/${uid}`), { diamonds: increment(-cost), [`unlocked/emojis/${id}`]: true })
}

export async function writeMatchRecord(
  uid: string,
  stats: Record<string, number>,
  achievements: Record<string, number>,
): Promise<void> {
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(stats)) patch[`stats/${k}`] = v
  for (const [k, v] of Object.entries(achievements)) patch[`unlocked/achievements/${k}`] = v
  await update(ref(db(), `users/${uid}`), patch)
}
