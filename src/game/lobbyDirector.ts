import { ambientUnit, greetingUtter, reactUnit, pickBots, type BotUtterance, type LobbyGlobals, type ReactInput } from './lobbyChat'
import { BOTS, type BotPersona } from './bots'

/**
 * 大廳聊天「導演」：決定什麼時候講、講幾則、要不要打招呼（見 docs/LOBBY-AI-SPEC.md §13.10）。
 * 純邏輯 + 依賴注入（寫訊息 / 確認 host / 睡眠 / 時鐘），所以能脫離 React/Firebase 做多分頁劇本模擬測試。
 * useLobby 為每個分頁建一個單例，餵它 host/在場人數/訊息/全域事實，並轉發事件。
 *
 * 規則（2026-10 使用者定案）：
 *   - 唯一嘴巴 = host；送每則前都 verifyHost，失去 host 立刻收手（不會兩台同時講）。
 *   - 招呼（安安大家好）只在「冷啟動 且 聊天已安靜 ≥ GREET_QUIET_MS」才講；其他時候一律接著聊。
 *   - 換手續聊：接手成 host（非冷啟動）→ 引擎沒在跑就補 RESUME 額度(2~4)接著聊。
 *   - 回大廳續聊：host 看到某人離開 ≥ RETURN_GAP_MS 又回來（例：打完一場）→ 同上補 2~4。
 *   - 新到訪 / 真人發言 / 點開聊天室 → 額度回滿 6~9（新到訪、發言另排一句回覆插隊）。
 *   - 聊天已安靜 ≥ QUIET_FAST_MS 時，第一句 1.5~4s 就出來；其餘每則間隔 10~20s。
 */

export const GAP_MIN = 10000, GAP_MAX = 20000          // 每則間隔
export const QUOTA_MIN = 6, QUOTA_MAX = 9              // 一輪額度
export const RESUME_MIN = 2, RESUME_MAX = 4            // 換手 / 回大廳的續聊額度
export const FAST_MIN = 1500, FAST_MAX = 4000          // 安靜很久後的第一句延遲
export const QUIET_FAST_MS = 30_000                    // 安靜超過這麼久 → 第一句走快速延遲
export const GREET_QUIET_MS = 10 * 60_000              // 冷啟動時安靜超過這麼久才打招呼
export const RETURN_GAP_MS = 45_000                    // 離開大廳超過這麼久再出現 = 「回大廳」
export const REPLY_THROTTLE_MS = 15_000                // 同一真人 15s 內最多被回一次
const SESSION_BOTS = 8

export interface DirectorDeps {
  write: (u: BotUtterance) => Promise<void>
  verifyHost: () => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  now: () => number
  prune?: () => void
  rand?: () => number
  log?: (msg: string) => void
}

export interface ChatDirector {
  // ── 狀態餵入（每次 render / 訂閱更新時）──
  setHost: (h: boolean) => void
  setAudience: (n: number) => void          // 大廳裡的真人數（lobbyActive）
  setLastMessageTs: (ts: number | null) => void
  setGlobals: (g: LobbyGlobals) => void
  // ── 事件 ──
  onBecameHost: (cold: boolean) => void
  observeActive: (uids: string[], selfUid: string | null) => void // host 每輪 poll 呼叫，偵測「回大廳」
  onNewcomer: (greet: BotUtterance | null) => void
  onHumanMessage: (uid: string, input: ReactInput) => void
  onOpened: () => void
  /** 停用（HMR 換新導演時把舊的迴圈關掉，避免同一分頁兩條迴圈同時講）。 */
  dispose: () => void
  // ── 給測試 / 除錯 ──
  readonly roster: BotPersona[]
  debug: () => { host: boolean; audience: number; quota: number; running: boolean; replies: number }
}

export function createChatDirector(deps: DirectorDeps): ChatDirector {
  const R = deps.rand ?? Math.random
  const rint = (a: number, b: number) => a + Math.floor(R() * (b - a + 1))

  let host = false
  let audience = 0
  let lastTs: number | null = null
  let globals: LobbyGlobals = { onlineCount: 0, hasLive: false }
  let quota = 0
  let replies: BotUtterance[] = []
  let running = false
  let gen = 0
  let roster: BotPersona[] = []
  const lastReactByUid: Record<string, number> = {}
  const lastSeenAt = new Map<string, number>() // host 本機記錄：uid 最後一次在大廳的時間
  let lastObserveAt: number | null = null      // 上次 observeActive 的時間

  const getRoster = () => {
    if (!roster.length) roster = pickBots(Math.min(SESSION_BOTS, BOTS.length), R)
    return roster
  }
  const quietFor = () => (lastTs == null ? Infinity : deps.now() - lastTs)
  const idle = () => !running && quota === 0 && replies.length === 0

  function run(opts: { greet?: boolean; fast?: boolean } = {}): void {
    if (running || !host || audience < 1) return
    running = true
    const myGen = ++gen
    const alive = () => host && audience >= 1 && myGen === gen
    void (async () => {
      let pending: BotUtterance[] = []
      let first = true
      // 確認 host 是非同步的 → 確認完「再看一次本地狀態」：這段時間內人已離開/失去 host 就不送
      if (opts.greet && alive() && (await deps.verifyHost()) && alive()) {
        lastTs = deps.now()
        await deps.write(greetingUtter(getRoster(), R))
        if (quota > 0) quota -= 1
        first = false
      }
      while (alive()) {
        if (!replies.length && !pending.length) {
          if (quota > 0) { pending = ambientUnit(getRoster(), globals, R); quota -= 1; continue }
          break // 沒回覆、沒步驟、沒額度 → 收工待命
        }
        await deps.sleep(first && opts.fast ? rint(FAST_MIN, FAST_MAX) : rint(GAP_MIN, GAP_MAX))
        first = false
        if (!alive()) break
        // 硬間隔：聊天室最後一則（不論誰講、哪個分頁講）不到 GAP_MIN → 先等到滿，杜絕跨分頁/換手瞬間連發
        const since = quietFor()
        if (since < GAP_MIN) { await deps.sleep(GAP_MIN - since + rint(0, 2000)); if (!alive()) break }
        if (!(await deps.verifyHost())) { host = false; break } // 已被別台接手 → 立刻收手
        if (!alive()) break                                      // 確認期間人離開/失去 host → 不送
        const msg = replies.shift() ?? pending.shift()           // 回覆插隊（連劇場中間也插得進去）
        if (msg) { lastTs = deps.now(); await deps.write(msg) }
      }
      if (myGen === gen) running = false
      deps.prune?.()
    })()
  }

  /** 換手 / 回大廳：引擎閒著才補小額度接著聊（不打招呼；冪等，連續觸發不會疊加）。 */
  function resume(reason: string): void {
    if (!host || audience < 1) return
    if (!idle()) { run(); return } // 還有剩的額度/回覆 → 只確保在跑
    quota = rint(RESUME_MIN, RESUME_MAX)
    deps.log?.(`續聊(${reason}) +${quota}`)
    run({ fast: quietFor() >= QUIET_FAST_MS })
  }

  function refill(extra?: BotUtterance[]): void {
    quota = Math.max(quota, rint(QUOTA_MIN, QUOTA_MAX))
    if (extra?.length) replies.push(...extra)
    run({ fast: quietFor() >= QUIET_FAST_MS })
  }

  return {
    setHost: (h) => { host = h },
    setAudience: (n) => {
      audience = n
      if (n === 0) { roster = []; quota = 0; replies = [] } // 全部離開 → 清本 session
    },
    setLastMessageTs: (ts) => { lastTs = ts },
    setGlobals: (g) => { globals = g },

    onBecameHost: (cold) => {
      host = true
      if (cold) {
        quota = rint(QUOTA_MIN, QUOTA_MAX)
        const greet = quietFor() >= GREET_QUIET_MS
        deps.log?.(`冷啟動 +${quota}${greet ? '（打招呼）' : '（接著聊）'}`)
        run({ greet, fast: true })
      } else {
        resume('換手')
      }
    },

    observeActive: (uids, selfUid) => {
      const now = deps.now()
      // host 自己太久沒觀察(分頁被節流/剛接手) → 名單不可信，這次只重設基準、不判定「有人回來」。
      const blind = lastObserveAt == null || now - lastObserveAt >= RETURN_GAP_MS
      lastObserveAt = now
      let returned = false
      for (const u of uids) {
        const prev = lastSeenAt.get(u)
        if (!blind && u !== selfUid && prev != null && now - prev >= RETURN_GAP_MS) returned = true
        lastSeenAt.set(u, now)
      }
      if (returned) resume('有人回大廳')
    },

    onNewcomer: (greet) => refill(greet ? [greet] : undefined),

    onHumanMessage: (uid, input) => {
      if (!host) return
      const now = deps.now()
      if (now - (lastReactByUid[uid] ?? 0) < REPLY_THROTTLE_MS) { refill(); return } // 節流：熱場但不回話
      lastReactByUid[uid] = now
      refill(reactUnit(input, getRoster(), globals, R))
    },

    onOpened: () => { if (host) refill() },

    dispose: () => { host = false; audience = 0; gen++ },

    get roster() { return getRoster() },
    debug: () => ({ host, audience, quota, running, replies: replies.length }),
  }
}
