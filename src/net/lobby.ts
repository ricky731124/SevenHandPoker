import {
  ref, onValue, onDisconnect, set, remove, push, get, query, limitToLast,
  runTransaction, serverTimestamp, update, type DatabaseReference,
} from 'firebase/database'
import { getDb } from './firebase'
import { currentUser, onAuth } from '../platform/auth'
import { usePlatformStore } from '../state/platformStore'
import { BOT_BY_ID } from '../game/bots'

/**
 * 大廳 AI 底層（見 docs/LOBBY-AI-SPEC.md §2/§3）。純 RTDB 原語，不含 React、不含內容。
 *   - lobbyActive/{connId}：誰在大廳「active」（可見且在主畫面、不在對局）→ 即時判定。
 *   - lobbyHost：主持人鎖（心跳 + 交接）。只有 active client 能搶；統一由 host 發環境閒聊。
 *   - lobbyChat：全頻聊天（人機 + 真人），公開讀、登入寫、保留 30 則 / 2 小時。
 *
 * 🔒 只寫這三個新節點，絕不碰任何現有節點/真人資料（SPEC §0-A）。
 */

/** 每個分頁一個穩定 id（lobbyActive 子鍵 + lobbyHost.by）。 */
export const CONN_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

// ---- 時間常數（SPEC §2/§3）---------------------------------------------------
const HOST_HEARTBEAT_MS = 5000 // host 每 5s 更新 at
export const HOST_STALE_MS = 15000 // host at 超過 15s 沒更新 → 視為掉線、可被別的 active client 接手
const COLD_HOST_MS = 30000 // 搶到 host 時,前一任已消失 > 30s(或根本沒人)= 「冷啟動(空大廳)」→ 才開表演賽;
                           // 15~21s 那種是「交接」(前一任剛掉、兩分頁互搶)→ 不開,避免亂觸發
const ACTIVE_HEARTBEAT_MS = 20000 // active 每 20s 更新 at
const ACTIVE_WINDOW_MS = 60000 // active 子節點 at 在 60s 內才算數（防當機殘留）
const CHAT_RETENTION_MS = 2 * 60 * 60 * 1000 // 訊息保留 2 小時
const NEW_ARRIVAL_MS = 15 * 60 * 1000 // lobbySeen:某 uid 缺席/沒紀錄 ≥15 分才算「新到訪」(和在線人數是不同節點/地基,故用 15 分)
export const CHAT_DISPLAY_MAX = 30 // 顯示最多 30 則
const CHAT_PRUNE_MAX = 50 // RTDB 保留上限（超過就刪最舊）

// ---- server 時鐘偏移（比照 presence，讓 at 比對準確）-------------------------
let _offset = 0
onValue(ref(getDb(), '.info/serverTimeOffset'), (s) => { _offset = (s.val() as number) ?? 0 })
const nowServer = () => Date.now() + _offset

// ---- 自動匿名登入（SPEC §2；A 案 + 登出防呆）--------------------------------
let _prevUser = currentUser()
let _suppressAutoAnon = false
onAuth((u) => {
  // 偵測「有登入者 → 變 null」＝ 使用者按了登出 → 本 session 起不再自動匿名登入，
  // 避免登出後 uid 又被自動拉回來（使用者特別叮嚀的地雷）。
  if (_prevUser && !u) _suppressAutoAnon = true
  _prevUser = u
})

/**
 * 讓這個 client 具備 auth（才能發言/當 host）。進主畫面時呼叫「一次」。
 * 已登入 → no-op；本 session 曾登出 → 不自動登入（尊重登出）。
 */
export async function ensureLobbyAuth(): Promise<void> {
  if (currentUser()) return
  if (_suppressAutoAnon) return
  try {
    await usePlatformStore.getState().ensureAccount()
  } catch {
    /* best-effort — 沒 auth 就只能唯讀聊天 */
  }
}

// ---- lobbyActive -------------------------------------------------------------
let _activeRef: DatabaseReference | null = null
let _activeTimer: ReturnType<typeof setInterval> | null = null

/** 標記本 client 為 active（可見且在主畫面）。冪等。 */
export function startActive(): void {
  const u = currentUser()
  if (!u || _activeRef) return
  _activeRef = ref(getDb(), `lobbyActive/${CONN_ID}`)
  void onDisconnect(_activeRef).remove()
  const beat = () => { if (_activeRef) void set(_activeRef, { at: serverTimestamp(), uid: u.uid }) }
  beat()
  _activeTimer = setInterval(beat, ACTIVE_HEARTBEAT_MS)
}

/** 取消 active（切背景/進對局/離開主畫面）。冪等。 */
export function stopActive(): void {
  if (_activeTimer) { clearInterval(_activeTimer); _activeTimer = null }
  if (_activeRef) {
    const r = _activeRef
    _activeRef = null
    void onDisconnect(r).cancel()
    void remove(r)
  }
}

/**
 * host 順手清 lobbyActive 殘留:分頁當掉/強關/HMR 時 onDisconnect 不一定觸發 → 殭屍
 * 會長期累積(實測有 6~17 小時前的殘留)。只刪明顯過期(>5 分)的,best-effort。
 * 注意:active「人數」本來就用 60s 窗口算,殘留不影響數字;這純粹是 DB 清潔。
 */
export async function pruneActive(): Promise<void> {
  if (!currentUser()) return
  try {
    const snap = await get(ref(getDb(), 'lobbyActive'))
    const val = (snap.val() ?? {}) as Record<string, { at?: number }>
    const cutoff = nowServer() - 5 * 60 * 1000
    for (const [conn, v] of Object.entries(val)) {
      const at = typeof v?.at === 'number' ? v.at : 0
      if (at < cutoff) await remove(ref(getDb(), `lobbyActive/${conn}`))
    }
  } catch {
    /* best-effort */
  }
}

/** 訂閱「目前是否有活人在大廳」＋人數（at 在窗口內的 distinct connId）＋在席 uid 集合
 *  （給「新到訪(≥10 分)」判定用：聊天/表演賽都靠它,而不是靠「人數上升」那種會被抖動亂觸發的訊號）。 */
export function subscribeActive(cb: (count: number, uids: Set<string>) => void): () => void {
  const node = ref(getDb(), 'lobbyActive')
  type Entry = { at?: number; uid?: string }
  const recompute = (val: Record<string, Entry> | null) => {
    const now = nowServer()
    let n = 0
    const uids = new Set<string>()
    for (const c of Object.values(val ?? {})) {
      const at = typeof c?.at === 'number' ? c.at : 0
      if (at > 0 && now - at < ACTIVE_WINDOW_MS) { n++; if (c.uid) uids.add(c.uid) }
    }
    cb(n, uids)
  }
  let last: Record<string, Entry> | null = null
  const unsub = onValue(node, (snap) => { last = (snap.val() as typeof last) ?? {}; recompute(last) }, () => cb(0, new Set()))
  // 過期沒有 DB 事件 → 定時重算（純本地）。
  const timer = setInterval(() => recompute(last), ACTIVE_HEARTBEAT_MS)
  return () => { unsub(); clearInterval(timer) }
}

/**
 * 開發用:這些「帳號名(username)」的 client **不主持、不驅動、不觸發**大廳 AI(聊天/表演賽),
 * 方便正式機/local 同庫時,用測試帳號寫程式而不被一直洗版。留空 = 不排除任何人。
 * (使用者提供測試帳號名後填進來。)
 */
export const LOBBY_MUTE_USERS: string[] = ['ka', 'kaka']

// ---- lobbyHost（主持人鎖 + 心跳 + 交接）-------------------------------------
let _hostTimer: ReturnType<typeof setInterval> | null = null
let _amHost = false
let _lastGrabCold = false // 上一次搶到 host 時,是不是「冷啟動(空大廳)」
let _lastGrabInfo = '' // 上一次搶 host 的細節(給 DEV log:誰是前一任、缺席多久)

/** 上一次成為 host 是不是冷啟動(空大廳/前一任消失 >30s)。用來決定 becameHost 要不要開表演賽。 */
export const hostGrabWasCold = (): boolean => _lastGrabCold
/** 上一次搶 host 的細節字串(DEV log 用)。 */
export const hostGrabInfo = (): string => _lastGrabInfo

/** 試著成為 host（沒 host 或 host 心跳過期才搶得到）。回傳是否成為 host。 */
export async function tryBecomeHost(): Promise<boolean> {
  const u = currentUser()
  if (!u) return false
  const hostRef = ref(getDb(), 'lobbyHost')
  try {
    let prevAt: number | undefined // 搶到前,前一任 host 的 at(判冷啟動 vs 交接)
    let prevBy: string | undefined // 前一任 host 是誰(自己被節流後搶回「自己的」→ 不算冷啟動)
    const res = await runTransaction(hostRef, (cur: { by?: string; at?: number } | null) => {
      prevAt = typeof cur?.at === 'number' ? cur.at : undefined
      prevBy = cur?.by
      const fresh = cur && typeof cur.at === 'number' && nowServer() - cur.at < HOST_STALE_MS
      if (fresh && cur!.by !== CONN_ID) return // 別人正握著且新鮮 → 放棄
      return { by: CONN_ID, at: serverTimestamp() }
    })
    const val = res.snapshot.val() as { by?: string } | null
    _amHost = !!res.committed && val?.by === CONN_ID
    // 冷啟動 = 前一任不是我自己 + (根本沒人 或 消失 >30s)= 真的空大廳有新的人接手。
    // 「前一任是我自己」= 我被節流/斷線後搶回自己的 host → 不算冷啟動(否則會莫名又開一場)。
    if (_amHost) {
      _lastGrabCold = prevBy !== CONN_ID && (prevAt === undefined || nowServer() - prevAt > COLD_HOST_MS)
      _lastGrabInfo =
        prevBy === undefined ? '無前一任 host(全新/空大廳)'
        : prevBy === CONN_ID ? '前一任是我自己(切分頁/斷線回來)'
        : `前一任(…${prevBy.slice(-4)})缺席 ${prevAt ? ((nowServer() - prevAt) / 1000).toFixed(0) : '?'} 秒`
    }
    if (_amHost && !_hostTimer) {
      // 心跳：只有仍是自己握著才更新（避免搶輸還一直寫）。
      _hostTimer = setInterval(() => {
        void runTransaction(hostRef, (cur: { by?: string } | null) => {
          if (cur && cur.by !== CONN_ID) return cur // 已被別人接手 → 不動
          return { by: CONN_ID, at: serverTimestamp() }
        }).then((r) => { _amHost = (r.snapshot.val() as { by?: string } | null)?.by === CONN_ID })
      }, HOST_HEARTBEAT_MS)
    }
    return _amHost
  } catch {
    return false
  }
}

/** 放掉 host（離開 active/unmount 時）。 */
export function releaseHost(): void {
  if (_hostTimer) { clearInterval(_hostTimer); _hostTimer = null }
  _amHost = false
  // ⚠️ 不把 DB 的 lobbyHost 清成 null:留著 {by:我, at:舊值} 讓它自然過期(15s)→ 別的活人接手。
  //   若清成 null,我只是切分頁/被遮住一下再回來,重搶時會「看到沒人握 host」→ 誤判冷啟動 → 亂開新表演賽。
  //   留著自己的舊值,回來時 tryBecomeHost 看到 prevBy 還是我自己 → 判「非冷啟動」→ 不亂開。
}

export const amHost = () => _amHost

/**
 * 送聊天訊息前的「即時 host 確認」:直接讀 lobbyHost,看這一瞬間握著 host 的是不是我。
 * 防的就是「兩視窗交接時,剛被降級的分頁還在 6s 輪詢空窗裡把訊息寫出去」→ 訊息成雙(#1/#2)。
 * 只要 DB 說 host 已是別人 → 回 false,引擎立刻收手。讀失敗 → 退回本地旗標(best-effort)。
 */
export async function verifyStillHost(): Promise<boolean> {
  if (!currentUser()) return false
  try {
    const cur = (await get(ref(getDb(), 'lobbyHost'))).val() as { by?: string } | null
    return !!cur && cur.by === CONN_ID
  } catch {
    return _amHost
  }
}

// ---- lobbySeen（全域「每個 uid 最後在大廳的時間」;判「新到訪」的唯一真相）--------------------
/**
 * host 專用(集中寫,才不會 race):
 *   ① 讀全域 lobbySeen(每個 uid 上次在場時間)
 *   ② 找出「別人的新到訪」= 該 uid 沒紀錄、或距今 ≥15 分(排除自己 selfUid,#7)
 *   ③ 把「現在在席的所有 uid(含自己)」蓋上現在時間
 *   ④ 順手刪很舊的(>2×窗口)→ lobbySeen 不會無限長大(定期清)
 * 回傳這次判定為新到訪的 uid 清單。只有 host 該呼叫(回來的人自己不寫 → 沒有「自己把自己蓋成不新」的 race)。
 */
export async function markSeenAndFindNewcomers(activeUids: string[], selfUid: string | null): Promise<string[]> {
  if (!currentUser()) return []
  const now = Date.now() // 門檻 15 分遠大於時鐘偏移,用本地時間即可
  let seen: Record<string, number> = {}
  try {
    seen = ((await get(ref(getDb(), 'lobbySeen'))).val() as Record<string, number>) ?? {}
  } catch {
    return []
  }
  const newcomers: string[] = []
  const patch: Record<string, unknown> = {}
  for (const uid of activeUids) {
    const t = seen[uid]
    if (uid !== selfUid && (typeof t !== 'number' || now - t >= NEW_ARRIVAL_MS)) newcomers.push(uid)
    patch[uid] = serverTimestamp() // 幫所有在席 uid 蓋章(含自己)
  }
  for (const [uid, t] of Object.entries(seen)) if (typeof t === 'number' && now - t > NEW_ARRIVAL_MS * 2) patch[uid] = null // 清很舊的
  try {
    await update(ref(getDb(), 'lobbySeen'), patch)
  } catch {
    /* best-effort */
  }
  return newcomers
}

// ---- lobbyChat ---------------------------------------------------------------
export interface LobbyMsg {
  id: string
  ts: number
  kind: 'bot' | 'human'
  botId?: string
  uid?: string
  name: string
  avatarId: string
  type: 'text' | 'sticker' | 'action'
  text?: string
  stickerId?: string
  // 真人訊息帶上自己的狀態,讓「唯一 host」能挑對反應式回覆(訪客→註冊 CTA、第幾關…),
  // 不必去讀對方 profile。非機密(是否訪客/主線進度)。
  reg?: boolean
  stage?: number
  username?: string // 帳號（判 isOwner 專屬彩蛋用；他寫自己的、非機密）
  cta?: { label?: string; action: LobbyCtaAction; room?: 'normal' | 'special'; code?: string }[]
}

/** 聊天 CTA 可導向的動作（§13）。多數接既有畫面/彈窗；未接的先當 no-op。 */
export type LobbyCtaAction =
  | 'register' | 'google' | 'quickmatch' | 'campaign' | 'tutorial'
  | 'personalize' | 'loadout' | 'achvShow' | 'leaderboard' | 'replays' | 'daily' | 'shop' | 'spectate'

/** 寫一則聊天訊息（人機或真人）。需 auth。best-effort。 */
export async function writeChatMessage(msg: Omit<LobbyMsg, 'id' | 'ts'>): Promise<void> {
  if (!currentUser()) return
  // RTDB 不吃 undefined → 只放有值的欄位。
  const payload: Record<string, unknown> = { ts: serverTimestamp(), kind: msg.kind, name: msg.name, avatarId: msg.avatarId, type: msg.type }
  if (msg.botId != null) payload.botId = msg.botId
  if (msg.uid != null) payload.uid = msg.uid
  if (msg.text != null) payload.text = msg.text
  if (msg.stickerId != null) payload.stickerId = msg.stickerId
  if (msg.reg != null) payload.reg = msg.reg
  if (msg.stage != null) payload.stage = msg.stage
  if (msg.username != null) payload.username = msg.username
  if (msg.cta != null) payload.cta = msg.cta
  try {
    await push(ref(getDb(), 'lobbyChat'), payload)
  } catch {
    /* best-effort — 規則未發布/離線 */
  }
}

/** 訂閱聊天（最新 40 則；顯示端再套 30 則 + 2 小時過濾）。 */
export function subscribeChat(cb: (msgs: LobbyMsg[]) => void): () => void {
  const q = query(ref(getDb(), 'lobbyChat'), limitToLast(40))
  const unsub = onValue(q, (snap) => {
    const val = (snap.val() ?? {}) as Record<string, Omit<LobbyMsg, 'id'>>
    const list = Object.entries(val)
      .map(([id, m]) => ({ ...m, id }))
      .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
    cb(list)
  }, () => cb([]))
  return unsub
}

/** 清掉超過 2 小時 / 超過 50 則的最舊訊息（host 寫入後順手做）。best-effort。 */
export async function pruneChat(): Promise<void> {
  if (!currentUser()) return
  try {
    const snap = await get(ref(getDb(), 'lobbyChat'))
    const val = (snap.val() ?? {}) as Record<string, { ts?: number }>
    const entries = Object.entries(val).sort((a, b) => (a[1].ts ?? 0) - (b[1].ts ?? 0))
    const now = nowServer()
    const dead = new Set<string>()
    for (const [id, m] of entries) if (typeof m.ts === 'number' && now - m.ts > CHAT_RETENTION_MS) dead.add(id)
    const overflow = entries.length - CHAT_PRUNE_MAX
    for (let i = 0; i < overflow; i++) dead.add(entries[i][0])
    for (const id of dead) await remove(ref(getDb(), `lobbyChat/${id}`))
  } catch {
    /* best-effort */
  }
}

/** 顯示過濾：只留 2 小時內、最後 30 則（SPEC §3.2）。 */
export function visibleChat(msgs: LobbyMsg[]): LobbyMsg[] {
  const now = nowServer()
  return msgs.filter((m) => typeof m.ts === 'number' && now - m.ts < CHAT_RETENTION_MS).slice(-CHAT_DISPLAY_MAX)
}

// ---- DEV 偵錯:F12 Console 打 `await __lobby()`(記得加 await)→ 回一個可展開的物件:
//   誰握 host / 幾秒沒更新 / 是不是我 / 是否 stale、大廳在席名單、表演賽驅動者、各人機租借。 -----------
if (import.meta.env.DEV) {
  ;(window as unknown as { __lobby: () => Promise<unknown> }).__lobby = async () => {
    const now = nowServer()
    const g = async (p: string) => (await get(ref(getDb(), p))).val() as Record<string, { at?: number; by?: string; uid?: string; driverConn?: string; driverAt?: number; status?: string; code?: string; moves?: unknown[]; p1?: { botId?: string }; p2?: { botId?: string }; displayName?: string; name?: string }> | null
    const age = (t?: number) => (typeof t === 'number' ? +((now - t) / 1000).toFixed(1) : null)
    const host = (await g('lobbyHost')) as { by?: string; at?: number } | null
    const active = ((await g('lobbyActive')) ?? {}) as Record<string, { at?: number; uid?: string }>
    const ex = (await g('lobbyExhibition')) as { code?: string; status?: string; moves?: unknown[]; driverConn?: string; driverAt?: number; p1?: { botId?: string }; p2?: { botId?: string } } | null
    const lease = ((await g('botLease')) ?? {}) as Record<string, { by?: string; at?: number }>
    const cards = ((await g('cards')) ?? {}) as Record<string, { displayName?: string; name?: string }>
    const nameU = (uid?: string) => (uid ? (cards[uid]?.displayName ?? cards[uid]?.name ?? '(訪客/無名片)') : '?') // 帳號的顯示名
    const nameB = (id?: string) => (id ? (BOT_BY_ID[id]?.name ?? id) : '?')                                    // 人機名字
    const uidOfConn = (conn?: string) => (conn ? active[conn]?.uid : undefined)
    const out = {
      我這台_CONN_ID: CONN_ID,
      host: host
        ? { 握著的人: nameU(uidOfConn(host.by)), uid: (uidOfConn(host.by) ?? '').slice(0, 8), conn: (host.by ?? '').slice(-6), 幾秒沒更新: age(host.at), 是我嗎: host.by === CONN_ID, 已stale可被搶_15s: typeof host.at === 'number' && now - host.at > HOST_STALE_MS }
        : '(沒人握 host)',
      大廳在席: Object.entries(active).map(([conn, v]) => ({ 名字: nameU(v.uid), uid: (v.uid ?? '').slice(0, 8), conn: conn.slice(-6), 幾秒沒更新: age(v.at) })),
      表演賽: ex
        ? { 對戰: `${nameB(ex.p1?.botId)} vs ${nameB(ex.p2?.botId)}`, 狀態: ex.status, 第幾步: (ex.moves ?? []).length, 驅動者是我嗎: ex.driverConn === CONN_ID, 驅動幾秒沒更新: age(ex.driverAt), code: ex.code?.slice(-8) }
        : '(目前沒有表演賽)',
      租借中的人機: Object.entries(lease).map(([bot, v]) => ({ 人機: nameB(bot), 租給conn: (v.by ?? '').slice(-6), 幾秒沒更新: age(v.at) })),
    }
    console.log(out)
    return out
  }
}
