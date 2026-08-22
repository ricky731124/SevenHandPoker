import { getDatabase, ref, get, update, type Database } from 'firebase/database'
import { getFirebaseApp } from '../firebaseApp'

/**
 * Public, world-readable player "name card" (#5). Denormalized so anyone can show
 * a player's card (排行榜點列 / 遊戲中點對手 / 未來找好友) WITHOUT reading their
 * private `users/{uid}`. Only the owner writes their own (see database.rules.json).
 *
 * `lastOnline` is managed separately by presence (onDisconnect), so the profile
 * fields are written with `update` (merge) — never a whole-node `set` that would
 * clobber it. Win-rate is computed on the client, not stored.
 */
export interface PlayerCard {
  displayName: string
  avatarId: string
  loadout: string[] // 預設牌組 (≤3 special-card ids)
  /** 展示成就:玩家「裝備」的成就族 + 其階級(供資訊卡的成就展示,UI 之後補)。 */
  achievements: { id: string; tier: number }[]
  pvp: { games: number; wins: number; streak: number; bestStreak: number }
  solo: { games: number; wins: number }
  /** ms epoch of the player's last disconnect; 0 if unknown. Shown when offline. */
  lastOnline: number
}

/** The profile-derived fields (everything except lastOnline). */
export type CardProfileFields = Omit<PlayerCard, 'lastOnline'>

let _db: Database | null = null
function db(): Database {
  if (!_db) _db = getDatabase(getFirebaseApp())
  return _db
}

/** Write the profile-derived fields, merging so presence's lastOnline survives. */
export async function writeCard(uid: string, fields: CardProfileFields): Promise<void> {
  try {
    await update(ref(db(), `cards/${uid}`), fields)
  } catch {
    /* best-effort */
  }
}

export async function fetchCard(uid: string): Promise<PlayerCard | null> {
  let snap
  try {
    snap = await get(ref(db(), `cards/${uid}`))
  } catch {
    return null // e.g. rules not published yet → fall back to what the caller knows
  }
  if (!snap.exists()) return null
  const v = (snap.val() ?? {}) as Partial<PlayerCard>
  return {
    // Empty (not '?') when a field is missing — the popup then falls back to what
    // the caller already knows (e.g. the leaderboard row's name/avatar).
    displayName: v.displayName ?? '',
    avatarId: v.avatarId ?? '',
    loadout: Array.isArray(v.loadout) ? v.loadout : [],
    achievements: Array.isArray(v.achievements) ? v.achievements : [],
    pvp: {
      games: v.pvp?.games ?? 0,
      wins: v.pvp?.wins ?? 0,
      streak: v.pvp?.streak ?? 0,
      bestStreak: v.pvp?.bestStreak ?? 0,
    },
    solo: { games: v.solo?.games ?? 0, wins: v.solo?.wins ?? 0 },
    lastOnline: v.lastOnline ?? 0,
  }
}

/** Is this uid currently online? (has ≥1 live presence connection) */
export async function fetchIsOnline(uid: string): Promise<boolean> {
  try {
    const snap = await get(ref(db(), `presence/${uid}`))
    return snap.exists() && snap.size > 0
  } catch {
    return false
  }
}
