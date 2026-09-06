import { get, ref, update, remove, runTransaction, onDisconnect, serverTimestamp, type DataSnapshot } from 'firebase/database'
import { getDb, waitForConnected, withTimeout } from './firebase'
import { BOTS, BOT_BY_ID } from '../game/bots'
import type { BotPersona } from '../game/bots'

/**
 * RTDB side of the fixed bot personas (§3): seed personas, lease them for
 * exclusivity, write their real win/loss record, and read their public card.
 * See docs/SPECTATE-REPLAY-SPEC.md §3.
 */

let _seedDone = false

/**
 * Seed any MISSING bot personas into `bots/{botId}` (idempotent, once per load).
 * Writes name/avatar/loadout/achievements + wins:0/games:0 only for personas that
 * don't exist yet — never touches an existing bot's accumulated wins/games.
 * Requires an authenticated caller (rule: bots/$botId .write = auth != null).
 */
export async function seedBots(): Promise<void> {
  if (_seedDone) return
  try {
    const snap = await get(ref(getDb(), 'bots'))
    const existing = (snap.val() ?? {}) as Record<string, unknown>
    const missing = BOTS.filter((b) => !existing[b.id])
    if (missing.length === 0) {
      _seedDone = true
      return
    }
    const updates: Record<string, unknown> = {}
    for (const b of missing) {
      updates[b.id] = { name: b.name, avatarId: b.avatarId, loadout: b.loadout, achievements: b.achievements, wins: 0, games: 0 }
    }
    await update(ref(getDb(), 'bots'), updates)
    _seedDone = true
  } catch {
    /* best-effort — a later load retries */
  }
}

/* ---- Lease (exclusivity §3.3) --------------------------------------------
 * A persona陪一個人時被「租借」(botLease/{botId})，不能同時被配給別人。整個快速配對
 * 對局期間(含 rematch)持有；下次配對(自動釋放上一隻)、回主畫面、或關分頁(onDisconnect)時釋放。 */

let _leasedBotId: string | null = null

/** Release a specific persona's lease by id (best-effort). Used by the abandon
 *  reconcile on the leaver's reopen — the closed tab's onDisconnect may not have
 *  fired, so free it explicitly. */
export async function releaseBotById(botId: string): Promise<void> {
  try {
    await remove(ref(getDb(), `botLease/${botId}`))
  } catch {
    /* best-effort */
  }
}

/** Release whatever persona this client currently holds (best-effort). */
export async function releaseLeasedBot(): Promise<void> {
  const id = _leasedBotId
  _leasedBotId = null
  if (!id) return
  try {
    await onDisconnect(ref(getDb(), `botLease/${id}`)).cancel()
  } catch {
    /* ignore */
  }
  try {
    await remove(ref(getDb(), `botLease/${id}`))
  } catch {
    /* best-effort */
  }
}

/** 租借過期時間:一局頂多幾分鐘,超過 15 分鐘的租借視為殭屍(onDisconnect 不可靠、
 *  當機/硬關殘留),可被搶——避免租借累積把 15 隻佔滿、之後永遠配不到人(自我修復)。 */
const LEASE_TTL_MS = 15 * 60 * 1000

/** A lease is claimable if absent OR its `at` is older than the TTL (stale zombie). */
function leaseClaimable(l: unknown): boolean {
  const at = (l as { at?: number } | null)?.at
  return typeof at !== 'number' || Date.now() - at > LEASE_TTL_MS
}

/**
 * Lease a FREE (or stale) persona (transaction-claim so two clients can't grab the
 * same one). Releases any previously-held lease first. Returns the persona, or null
 * if all 15 are genuinely busy (caller keeps「尋找對手中…」; 使用者可取消). Arms
 * onDisconnect so a crash / closed tab frees it; stale leases self-heal via TTL.
 */
export async function leaseBot(uid: string): Promise<BotPersona | null> {
  await releaseLeasedBot()
  const fallback = () => BOTS[Math.floor(Math.random() * BOTS.length)] ?? null // 不佔租借的退路
  // ⚠️ 剛重開的分頁常繼承「半死」的 socket:`.info/connected` 不會 true,但對它發的
  // 讀寫會「無限掛住」(Firebase 沒有內建逾時、不會 reject)→ leaseBot 永不回 → 卡在 23 秒。
  // waitForConnected 會先嘗試強制重連;若仍連不上,直接走本機隨機人機,絕不對死 socket 發會掛住的操作。
  if (!(await waitForConnected())) return fallback()
  let txFailed = false
  try {
    // 每個 DB 操作都套逾時:即使連上了但個別操作卡住,也不會拖死配對(退回隨機人機)。
    const snap = await withTimeout<DataSnapshot | null>(get(ref(getDb(), 'botLease')), 4000, null)
    if (!snap) return fallback() // 讀 botLease 逾時/失敗 → 不卡死,本機開局
    const leased = (snap.val() ?? {}) as Record<string, unknown>
    const free = BOTS.filter((b) => leaseClaimable(leased[b.id])).sort(() => Math.random() - 0.5)
    for (const b of free) {
      const lref = ref(getDb(), `botLease/${b.id}`)
      const res = await withTimeout(
        runTransaction(lref, (cur) => {
          if (cur && !leaseClaimable(cur)) return // taken & fresh → abort; stale → reclaim
          return { by: uid, at: serverTimestamp() }
        }).catch(() => {
          txFailed = true // maxretry/denied(連線/權限未穩)
          return null
        }),
        4000,
        null, // 交易掛住 → 當作失敗,走退路
      )
      if (res === null) txFailed = true
      if (res && res.committed && (res.snapshot.val() as { by?: string } | null)?.by === uid) {
        _leasedBotId = b.id
        void onDisconnect(lref).remove()
        return b
      }
      if (txFailed) break // 連線/權限/逾時問題 → 別一隻隻撞,直接走退路
    }
    // txFailed → 退回隨機人機(不卡死);否則 15 隻真的都在打 → null(caller 重試)。
    return txFailed ? fallback() : null
  } catch {
    // 讀 botLease 失敗(連線/權限)→ 不卡死,退回隨機人機讓對局照常開始。
    // 交換條件:此刻可能與別人撞同一隻(§4 廣播前無影響),但玩家不會卡在配對畫面。
    return fallback()
  }
}

/* ---- Record (§3.2) -------------------------------------------------------- */

/**
 * Record a finished human-vs-bot match on the bot's real record (transaction, so
 * two humans finishing vs the same persona can't clobber each other). `humanWon`
 * from the human's perspective → the bot's win is the opposite.
 */
export async function recordBotResult(botId: string, humanWon: boolean): Promise<void> {
  try {
    await runTransaction(ref(getDb(), `bots/${botId}`), (cur) => {
      if (!cur) return cur // not seeded yet → skip
      cur.games = (cur.games ?? 0) + 1
      if (!humanWon) cur.wins = (cur.wins ?? 0) + 1 // bot won
      return cur
    })
  } catch {
    /* best-effort */
  }
}

/* ---- Read a bot's public card (§3.2, for PlayerInfoCard) ------------------ */

export interface BotCard {
  displayName: string
  avatarId: string
  loadout: string[]
  achievements: { id: string; tier: number }[]
  pvp: { games: number; wins: number; streak: number; bestStreak: number }
  solo: { games: number; wins: number }
  lastOnline: number
}

/** Is this uid actually one of our fixed personas? */
export function isBotId(uid: string | null | undefined): boolean {
  return !!uid && !!BOT_BY_ID[uid]
}

/** Read a persona's card from `bots/{botId}` (falls back to the local persona
 *  definition for display fields if the DB read misses). */
export async function fetchBotCard(botId: string): Promise<BotCard | null> {
  const persona = BOT_BY_ID[botId]
  if (!persona) return null
  let v: Partial<BotCard> & { wins?: number; games?: number } = {}
  try {
    const snap = await get(ref(getDb(), `bots/${botId}`))
    v = (snap.val() ?? {}) as typeof v
  } catch {
    /* fall back to local persona */
  }
  return {
    displayName: (v as { name?: string }).name ?? persona.name,
    avatarId: v.avatarId ?? persona.avatarId,
    loadout: Array.isArray(v.loadout) ? v.loadout : persona.loadout,
    achievements: Array.isArray(v.achievements) ? v.achievements : persona.achievements,
    pvp: { games: v.games ?? 0, wins: v.wins ?? 0, streak: 0, bestStreak: 0 },
    solo: { games: 0, wins: 0 },
    lastOnline: Date.now(), // 假人永遠在線
  }
}
