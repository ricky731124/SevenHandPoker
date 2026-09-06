import type { GameState, PlayerId } from '../game/state'
import type { BossRuntime } from '../game/bossAI'
import type { SpecialCardId } from '../game/specialCards'
import type { SeriesState } from '../game/campaign'

/**
 * 本地對局（主線 / 建立房打電腦 / 快速配對遇人機）的存檔（見 docs/SPECTATE-REPLAY-SPEC.md §3.7）。
 * 鏡像 online 的做法（room.ts session/openMatch）：
 *  - **sessionStorage 快照**（重整留、關分頁清）→ 重整能續玩、不判敗。
 *  - **localStorage marker**（關分頁也留）→ 關分頁後下次開 app 補判該場敗。
 * 純持久化，不 import 任何 store（避免循環）。重連/補判的編排在 net/localResume.ts。
 */

export type LocalMode = 'casual' | 'campaign' | 'solo'

/** sessionStorage 快照：足以還原一場本地對局 + campaign 的 series。 */
export interface LocalSnapshot {
  matchId: string
  mode: LocalMode
  botId?: string
  subId?: string
  series?: SeriesState
  engine: GameState
  coinFirstPicker: PlayerId
  me: PlayerId
  special: boolean
  loadout: SpecialCardId[]
  timeLimit: number
  aiLoadout: SpecialCardId[]
  aiBoss: BossRuntime | null
  casualFoe: { name: string; avatarId: string; botId?: string } | null
}

/** localStorage marker：關分頁後補判用（不含完整 engine，只留補判所需）。 */
export interface LocalOpen {
  matchId: string
  mode: LocalMode
  botId?: string
  subId?: string
  series?: SeriesState
}

const SNAP_KEY = 'shp.local' // sessionStorage
const OPEN_KEY = 'shp.localopen' // localStorage

export function newLocalMatchId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `m_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/** Save both the reload-resume snapshot (sessionStorage) and the close-reconcile marker (localStorage). */
export function saveLocalMatch(snap: LocalSnapshot): void {
  try {
    sessionStorage.setItem(SNAP_KEY, JSON.stringify(snap))
  } catch {
    /* ignore */
  }
  const open: LocalOpen = { matchId: snap.matchId, mode: snap.mode, botId: snap.botId, subId: snap.subId, series: snap.series }
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open))
  } catch {
    /* ignore */
  }
}

export function readLocalSnapshot(): LocalSnapshot | null {
  try {
    const r = sessionStorage.getItem(SNAP_KEY)
    return r ? (JSON.parse(r) as LocalSnapshot) : null
  } catch {
    return null
  }
}

export function readLocalOpen(): LocalOpen | null {
  try {
    const r = localStorage.getItem(OPEN_KEY)
    return r ? (JSON.parse(r) as LocalOpen) : null
  } catch {
    return null
  }
}

/** Clear both (called on natural end / in-app leave / after reconcile). */
export function clearLocalMatch(): void {
  try {
    sessionStorage.removeItem(SNAP_KEY)
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(OPEN_KEY)
  } catch {
    /* ignore */
  }
}
