import { ref, onValue, get, set as dbSet, update, remove, runTransaction, serverTimestamp } from 'firebase/database'
import { getDb } from '../net/firebase'
import { currentUser } from '../platform/auth'
import { CONN_ID } from '../net/lobby'
import {
  createGame, applyPick, applyPlace, applyDraw, resolveShowdown, otherPlayer,
  type GameState, type PlayerId,
} from './state'
import { bossPick, bossPlace, type BossRuntime } from './bossAI'
import { rollCasualBot } from './casualBots'
import { BOTS } from './bots'
import { leaseBotsById, releaseBotsById } from '../net/bots'
import { serializeForSpectator } from '../net/sync'
import {
  writeLiveEntry, flipLiveEnded, removeLiveEntry, writeSpectatorCount, fetchBotRecord,
  patchLivePlayerRecord, subscribeLiveIndex, type LivePlayer, type LiveEntry,
} from '../net/liveIndex'
import { pushHighlight, type ReplayRecord } from '../net/replays'
import type { Move } from './replay'

/**
 * 大廳 LiveBoard「人機 vs 人機 表演賽」(見 docs/LOBBY-AI-SPEC.md §4)。
 *
 * 由「唯一 host」在偵測到新玩家上線且 liveIndex 沒有 live 時開一場,**無頭驅動**(host 待在主畫面、
 * 不進遊戲畫面)——純用 state.ts 的 pure reducer 逐步跑一局 bot vs bot,把每步廣播到
 * `spectate/{code}`(和真人局長得一模一樣),打完存全域 `replays`。
 *
 * 🔒 紅線(§4.4):**不呼叫 recordBotResult、不寫 bots/{botId}、不進排行榜、回放只進全域 replays
 * (不掛任何玩家帳號 userReplays)、永不揭露是人機**(呈現如兩個真人,同既有 casual 人機做法)。
 *
 * 續播(§4.3):整場狀態(seed / firstPicker / 兩隻大腦 / 走到現在的 moves)存在單一 Firebase 節點
 * `lobbyExhibition`;驅動權用「driverConn + driverAt 心跳」鎖住,心跳 stale > 10 秒 → 任何活人可
 * transaction 搶走、從斷點續跑(spectators 只會停頓約 10 秒然後繼續、不會斷掉)。5 分鐘硬上限。
 *
 * v1 限一般房(無特殊牌);moves 只有 pick/place。特殊房之後再加。
 */

// ---- 時間常數 ---------------------------------------------------------------
const PICK_MIN = 6000, PICK_MAX = 9000   // 選牌思考 6–9s(2026-09-21 微調快一點)
const PLACE_MIN = 3000, PLACE_MAX = 4000 // 放牌 3–4s(2026-09-21 微調快一點)
const SHOWDOWN_MS = 6000                 // 開牌看勝負固定 6s
const DRAW_MS = 800                      // 補牌
const STALE_MS = 10000                   // 驅動心跳 stale > 10s → 可被(別的活人)接手續跑
const HEARTBEAT_MS = 4000                // 驅動者每 4s 更新 driverAt
const ABANDON_MS = 3 * 60 * 1000         // 驅動者消失 > 3 分且沒人接手 = 真的被遺棄 → 收掉(不存回放)。
                                         // 取代舊的「開局 5 分硬上限(連暫停都算)」——那會讓觀眾分心一下就被砍;
                                         // 改成「有人驅動就一直跑到完、存回放」,只清真的沒人跑的。
const TICK_MS = 2500                     // 控制迴圈節奏
const OPEN_REQ_TTL = 8000                // 「開場請求」有效期:8s 內沒 live 才開;過期就算了(有 live 就看、不排隊)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

// ---- Firebase 節點 ----------------------------------------------------------
const EX_PATH = 'lobbyExhibition'
const exRef = () => ref(getDb(), EX_PATH)
const specRef = (code: string) => ref(getDb(), `spectate/${code}/spec`)

interface ExSide { botId: string; name: string; avatarId: string; boss: BossRuntime }
interface ExState {
  code: string
  seed: number
  firstPicker: PlayerId
  special: boolean
  p1: ExSide
  p2: ExSide
  moves: Move[]
  startedAt: number
  driverConn: string
  driverAt: number
  status: 'live' | 'ended'
}

// ---- 模組單例狀態(整個分頁一份;比照聊天引擎,避免 StrictMode/HMR 多迴圈)-----------
let mOffset = 0
let mActive = false
let mIsHost = false
let mUid: string | null = null
let mOpenReqAt = 0 // 「開場請求」時間戳(由 useLobby 在新到訪/剛接手 host 時設);8s 內沒 live 才開,不排隊
let mOpenReqReason = '' // 這次請求的原因(冷啟動/新到訪…),給 log 用
let mReqLoggedAt = 0 // 已對「這個請求(以 mOpenReqAt 為 id)」印過略過原因 → 不每個 tick 洗版
let mState: ExState | null = null
let mLive: LiveEntry[] = []
let mUnsubEx: (() => void) | null = null
let mUnsubLive: (() => void) | null = null
let mUnsubOffset: (() => void) | null = null
let mTick: ReturnType<typeof setInterval> | null = null
let mDriving = false
let mDriveGen = 0
let mHeartbeat: ReturnType<typeof setInterval> | null = null
let mWatchUnsub: (() => void) | null = null
let mOpening = false

const serverNow = () => Date.now() + mOffset
const movesOf = (s: ExState): Move[] => (Array.isArray(s.moves) ? s.moves : Object.values((s.moves ?? {}) as Record<string, Move>))

// ---- 對外 API(由 useLobby 呼叫)-------------------------------------------
export function exhibitionStart(): void {
  if (mTick) return
  mUnsubOffset = onValue(ref(getDb(), '.info/serverTimeOffset'), (s) => { mOffset = (s.val() as number) ?? 0 })
  mUnsubEx = onValue(exRef(), (snap) => { mState = (snap.val() as ExState | null) ?? null }, () => { mState = null }) // 規則未發布 → permission_denied → 當作沒有表演賽
  mUnsubLive = subscribeLiveIndex((entries) => { mLive = entries }, 50)
  mTick = setInterval(() => void tick(), TICK_MS)
  void tick()
  void pruneDeadExhibition() // 進大廳「立刻」清掉上個 session 留下、驅動者早死的孤兒場(免得被人點進去卡在讀取中,Bug 1)
}

/**
 * 一次性清「孤兒表演賽」:上個 session 全關時 lobbyExhibition/liveIndex 沒被收 → 40 分後還掛著假 live 卡。
 * 只清「已結束」或「驅動者 stale > 3 分」的(真的死透)→ 直接收節點,不動還活著/剛開的場。best-effort。
 * 由 exhibitionStart 呼叫一次;LiveBoard 也在掛載時 await 一次 → 「清完再呈現」,不讓人看到死卡(使用者定案)。
 */
export async function pruneDeadExhibition(): Promise<void> {
  if (!currentUser()) return
  try {
    const cur = (await get(exRef())).val() as ExState | null
    if (!cur) return
    const dead = cur.status === 'ended' || (typeof cur.driverAt === 'number' && serverNow() - cur.driverAt > ABANDON_MS)
    if (!dead) return
    if (import.meta.env.DEV) console.log('%c[exhibition] 🧹 進場清孤兒場(驅動者早死/殘留)', 'color:#c60', (cur.code ?? '').slice(-8))
    await remove(exRef()).catch(() => {})
    if (cur.code) {
      await removeLiveEntry(cur.code).catch(() => {})
      await remove(ref(getDb(), `spectate/${cur.code}`)).catch(() => {})
    }
    if (cur.p1?.botId && cur.p2?.botId) void releaseBotsById([cur.p1.botId, cur.p2.botId])
  } catch {
    /* best-effort */
  }
}

export function exhibitionStop(): void {
  if (mTick) { clearInterval(mTick); mTick = null }
  mUnsubEx?.(); mUnsubEx = null
  mUnsubLive?.(); mUnsubLive = null
  mUnsubOffset?.(); mUnsubOffset = null
  stopDriving()
  mState = null
  mLive = []
}

export function exhibitionSetContext(ctx: { active: boolean; isHost: boolean; uid: string | null }): void {
  mActive = ctx.active
  mIsHost = ctx.isHost
  mUid = ctx.uid
}

/** 請求開一場(由 useLobby 在「新到訪(≥10分)」或「冷啟動當上 host」時呼叫)。
 *  下個 tick 若 host 且此刻沒有任何 live 才開;有 live 就不開(讓他看現有那場、不排隊);8s 內沒開就過期。 */
/**
 * 給 LiveBoard 用:回「目前唯一真的還活著的表演賽 code」(status live 且驅動心跳 < 遺棄門檻 3 分),
 * 否則 null。LiveBoard 據此把「死掉/殘留的表演賽卡」**即時**濾掉,不必等背景清理寫回 DB → board 照樣秒開、
 * 也不會讓人看到死卡。表演賽全域只有一個節點,所以「不等於這個 code 的 spec_ex 卡」就是死卡。
 */
export function subscribeExhibitionLiveCode(cb: (liveCode: string | null) => void): () => void {
  return onValue(
    exRef(),
    (snap) => {
      const s = snap.val() as ExState | null
      const fresh = !!s && s.status === 'live' && typeof s.driverAt === 'number' && serverNow() - s.driverAt < ABANDON_MS
      cb(fresh ? s!.code : null)
    },
    () => cb(null),
  )
}

export function exhibitionRequestOpen(reason = ''): void {
  mOpenReqAt = serverNow()
  mOpenReqReason = reason
  mReqLoggedAt = 0 // 新請求 → 允許再印一次略過原因
  if (import.meta.env.DEV) console.log('%c[exhibition] 📨 收到開場請求:' + reason, 'color:#c90;font-weight:bold')
}

/** 有請求、但這 tick 開不成 → 印一次原因(同一請求只印一次,避免每 2.5s 洗版)。 */
function logReqSkip(reason: string): void {
  if (!import.meta.env.DEV) return
  if (mReqLoggedAt === mOpenReqAt) return
  mReqLoggedAt = mOpenReqAt
  console.log('%c[exhibition] ⏭️ 沒開表演賽:' + reason, 'color:#c60')
}

// ---- 控制迴圈 ---------------------------------------------------------------
/**
 * 目前「真的還活著、會擋著我開新表演賽」的場 code 清單。
 * ⚠️ 要和 LiveBoard 的濾鏡一致(2026-09-21 修):**死掉的表演賽卡不算**——
 *   表演賽全域只有一個節點(mState),所以「雙方都是人機、又不是當前這個 mState」的 live 卡 = 死卡 → 忽略。
 *   否則會出現「LiveBoard 顯示 0 場、底層 noOtherLive 卻說有 live 擋著不開」的打架(使用者實測回報)。
 *   真人/casual 的 live 卡(至少一方不是人機)照舊算數 → 有真人局進行中就不另開表演賽(讓新手看那場)。
 */
function liveBlockers(): string[] {
  const myCode = mState?.code
  return mLive
    .filter((e) => e.status === 'live' && e.code !== myCode && !(e.p1?.isBot && e.p2?.isBot))
    .map((e) => e.code)
}
function noOtherLive(): boolean {
  return liveBlockers().length === 0
}

async function tick(): Promise<void> {
  const now = serverNow()
  const hasReq = now - mOpenReqAt < OPEN_REQ_TTL // 目前有沒有「還沒過期的開場請求」
  if (!mActive || !mUid || !currentUser()) {
    if (hasReq) logReqSkip('我這台目前沒在大廳 active(切背景/剛登入還沒就緒/未登入)')
    stopDriving(); return
  }
  if (mState) {
    // 已經有一場表演賽在跑(自己或別台的)→ 有請求也不開,讓大家看那場、不排隊。
    if (hasReq) logReqSkip(mState.status === 'ended' ? '偵測到殘留的「已結束」表演賽節點(先清掉再說)' : '已有一場表演賽進行中(看那場、不排隊)')
    if (mState.status === 'ended') {
      // 健康結束由 finishExhibition 自己 remove(→ mState 變 null)。這裡還看得到 ended = 孤兒
      // (driver 死在結尾 / 舊 bug 殘留)→ driver stale 就清掉,讓新的能開;driver 還新鮮就別碰。
      if (now - (mState.driverAt ?? 0) > STALE_MS) await closeExhibition()
      else stopDriving()
      return
    }
    if (mState.driverConn === CONN_ID) {
      if (!mDriving) startDriving() // 我就是驅動者(即使背景節流也繼續跑到完 → 會存回放)
    } else if (now - (mState.driverAt ?? 0) > ABANDON_MS) {
      await closeExhibition() // 別人的驅動者消失 >3 分、沒人接手 = 遺棄 → 收掉(不存回放)
    } else if (now - (mState.driverAt ?? 0) > STALE_MS) {
      await claimDriver() // 別人的驅動者短暫掉線(>10s)→ 接手續跑
    } else {
      stopDriving() // 別人正新鮮驅動中
    }
  } else {
    stopDriving()
    // 沒有任何 live 場 + host + 「8 秒內有開場請求」→ 開一場;否則印清楚為什麼沒開。
    if (hasReq) {
      if (!mIsHost) logReqSkip('我這台不是 host(只有 host 能開,交給 host 那台)')
      else if (!noOtherLive()) logReqSkip('已有別的「真人/進行中」場擋著(' + liveBlockers().map((c) => c.slice(-6)).join(',') + ',看那場、不排隊)')
      else {
        if (import.meta.env.DEV) console.log('%c[exhibition] ✅ 條件成立 → 開場(因:' + mOpenReqReason + ')', 'color:#0a0;font-weight:bold')
        mOpenReqAt = 0
        await openExhibition()
      }
    }
  }
}

async function openExhibition(): Promise<void> {
  if (mOpening || mState || !mUid) return
  mOpening = true
  try {
    // 先讀現有租借 → 只從「沒被別桌(casual/其他表演賽)占用」的人機裡挑,才真正防同名。
    let leased: Record<string, { at?: number }> = {}
    try { leased = ((await get(ref(getDb(), 'botLease'))).val() as typeof leased) ?? {} } catch { /* best-effort */ }
    const LEASE_TTL = 15 * 60 * 1000
    const now = serverNow()
    const free = BOTS.filter((b) => { const l = leased[b.id]; return !l || typeof l.at !== 'number' || now - l.at > LEASE_TTL })
    const pool = [...(free.length >= 2 ? free : BOTS)] // 空閒不足 2 隻(極少)→ 退回全體
    const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
    const b = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
    if (!a || !b) return
    void leaseBotsById(mUid, [a.id, b.id])
    const bot1 = rollCasualBot(false, [], Math.random, a)
    const bot2 = rollCasualBot(false, [], Math.random, b)
    const code = `spec_ex_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    const seed = Math.floor(Math.random() * 1e9)
    const firstPicker: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2'
    const side = (bot: typeof bot1): ExSide => ({ botId: bot.botId, name: bot.name, avatarId: bot.avatarId, boss: clean(bot.boss) })
    const payload: ExState = {
      code, seed, firstPicker, special: false,
      p1: side(bot1), p2: side(bot2),
      moves: [],
      startedAt: serverTimestamp() as unknown as number,
      driverConn: CONN_ID,
      driverAt: serverTimestamp() as unknown as number,
      status: 'live',
    }
    // 冪等守門(#6):同一時間只允許一場。DB 若已有未結束的表演賽 → 放棄開新的(改去看/接手那場),
    //   免得新分頁剛載入(mState/mLive 還沒收到快照 → noOtherLive 誤判)時開出第二場。
    const res = await runTransaction(exRef(), (cur: ExState | null) => {
      if (cur && cur.status !== 'ended') return cur // 已有 live → 不動
      return payload
    })
    const opened = res.committed && (res.snapshot.val() as ExState | null)?.code === code
    if (!opened) {
      if (import.meta.env.DEV) console.log('%c[exhibition] ↩︎ 放棄開場:DB 已有一場進行中(改去看/接手那場)', 'color:#c60')
      void releaseBotsById([a.id, b.id]) // 把剛租的還回去
      return
    }
    if (import.meta.env.DEV) console.log('%c[exhibition] 開新一場', 'color:#0a0;font-weight:bold', code.slice(-8), a.id, 'vs', b.id)
    // Live 卡(§5):兩邊都當「人機 persona」(uid=botId → 可點頭像看戰績,同 casual 做法;不揭露)。
    const lp = (bot: typeof bot1): LivePlayer => ({ name: bot.name, avatar: bot.avatarId, uid: bot.botId, wins: 0, games: 0, isBot: true })
    await writeLiveEntry(code, lp(bot1), lp(bot2))
    void fetchBotRecord(bot1.botId).then((r) => patchLivePlayerRecord(code, 'p1', r.wins, r.games))
    void fetchBotRecord(bot2.botId).then((r) => patchLivePlayerRecord(code, 'p2', r.wins, r.games))
    // 驅動由下一個 tick 啟動(subscription 會把 mState 更新成 driverConn=我)。
  } catch {
    /* best-effort */
  } finally {
    mOpening = false
  }
}

async function claimDriver(): Promise<void> {
  try {
    const res = await runTransaction(exRef(), (cur: ExState | null) => {
      if (!cur || cur.status === 'ended') return cur // 沒了/已結束 → 不搶
      const fresh = typeof cur.driverAt === 'number' && serverNow() - cur.driverAt <= STALE_MS
      if (cur.driverConn !== CONN_ID && fresh) return cur // 還新鮮、別人握著 → 放棄
      return { ...cur, driverConn: CONN_ID, driverAt: serverTimestamp() }
    })
    const val = res.snapshot.val() as ExState | null
    if (res.committed && val?.driverConn === CONN_ID) startDriving()
  } catch {
    /* best-effort */
  }
}

// ---- 驅動(無頭跑一局 + 廣播)-----------------------------------------------
function stopDriving(): void {
  mDriving = false
  mDriveGen++
  if (mHeartbeat) { clearInterval(mHeartbeat); mHeartbeat = null }
  if (mWatchUnsub) { mWatchUnsub(); mWatchUnsub = null }
}

function startDriving(): void {
  if (mDriving) return
  mDriving = true
  const gen = ++mDriveGen
  const code = mState?.code
  mHeartbeat = setInterval(() => {
    if (mState?.driverConn === CONN_ID && mState.status !== 'ended') void update(exRef(), { driverAt: serverTimestamp() }).catch(() => {})
  }, HEARTBEAT_MS)
  // 驅動者負責把觀戰人數(watch 節點大小)寫回 liveIndex.spectators(§4.4,眼睛計數)。
  if (code && !mWatchUnsub) {
    mWatchUnsub = onValue(ref(getDb(), `spectate/${code}/watch`), (snap) => { void writeSpectatorCount(code, snap.size) }, () => {})
  }
  void driveLoop(gen)
}

/** 把一步 place 之後的開牌/補牌推進到下一個 pick 邊界(棋譜不記,決定性)。 */
function settle(g: GameState): GameState {
  let s = g
  if (s.phase === 'showdown') s = resolveShowdown(s)
  if (s.phase === 'draw') s = applyDraw(s)
  return s
}

/** 用 moves 從 seed 重建到現在(接手續播用)。place 後自動 settle → 停在 pick/ended。 */
function rebuild(s: ExState): GameState {
  let g = createGame(s.seed, s.firstPicker)
  for (const m of movesOf(s)) {
    if (m.t === 'pick') g = applyPick(g, m.by, m.ids)
    else if (m.t === 'place') g = settle(applyPlace(g, m.by, m.slot))
  }
  return g
}

async function commitStep(code: string, engine: GameState, moves: Move[]): Promise<void> {
  try { await dbSet(specRef(code), serializeForSpectator(engine)) } catch { /* best-effort */ }
  // ⚠️ 不在這裡寫 status:'ended' —— 那會讓驅動者自己的 alive() 立刻變 false、
  //   跳過 finishExhibition(翻 ended + 存回放 + 收節點)。status 只由 finish/close 改。
  try { await update(exRef(), { moves: clean(moves), driverAt: serverTimestamp() }) } catch { /* best-effort */ }
}

async function driveLoop(gen: number): Promise<void> {
  const s0 = mState
  if (!s0) { mDriving = false; return }
  const code = s0.code
  // 接手續播:原 driver 掉線後它的租借被 onDisconnect 放掉 → 依 id 重占,免得交接空窗被別桌撈走。
  if (mUid) void leaseBotsById(mUid, [s0.p1.botId, s0.p2.botId])
  const brains: Record<PlayerId, BossRuntime> = { p1: s0.p1.boss, p2: s0.p2.boss }
  let engine = rebuild(s0)
  const moves: Move[] = [...movesOf(s0)]
  const alive = () =>
    mDriving && gen === mDriveGen && mActive && !!currentUser() &&
    mState?.driverConn === CONN_ID && mState?.status !== 'ended'

  // 接手/開場 → 先把當前狀態推上去(spectators 立即看到、不是空畫面)。
  try { await dbSet(specRef(code), serializeForSpectator(engine)) } catch { /* best-effort */ }

  while (alive() && engine.phase !== 'ended') {
    if (engine.phase === 'pick') {
      await sleep(rand(PICK_MIN, PICK_MAX))
      if (!alive()) return
      const picker = engine.turn
      const ids = bossPick(engine, picker, brains[picker])
      engine = applyPick(engine, picker, ids)
      moves.push({ t: 'pick', by: picker, ids })
      await commitStep(code, engine, moves)
    } else if (engine.phase === 'place') {
      await sleep(rand(PLACE_MIN, PLACE_MAX))
      if (!alive()) return
      const picker = engine.pendingPick!.by
      const placer = otherPlayer(picker)
      const slot = bossPlace(engine, placer, brains[placer])
      engine = applyPlace(engine, placer, slot)
      moves.push({ t: 'place', by: placer, slot })
      await commitStep(code, engine, moves)
      if (engine.phase === 'showdown') {
        await sleep(SHOWDOWN_MS)
        if (!alive()) return
        engine = resolveShowdown(engine)
        await commitStep(code, engine, moves)
      }
      if (engine.phase === 'draw') {
        engine = applyDraw(engine)
        await commitStep(code, engine, moves)
        await sleep(DRAW_MS)
      }
    } else {
      engine = settle(engine)
    }
  }

  if (alive() && engine.phase === 'ended' && engine.winner) {
    await finishExhibition(code, engine, moves)
  }
  mDriving = false
  if (mHeartbeat) { clearInterval(mHeartbeat); mHeartbeat = null }
}

async function finishExhibition(code: string, engine: GameState, moves: Move[]): Promise<void> {
  const s = mState
  if (!s) return
  try { await dbSet(specRef(code), serializeForSpectator(engine)) } catch { /* best-effort */ }
  await update(exRef(), { status: 'ended' }).catch(() => {})
  await flipLiveEnded(code, engine.winner!)
  // 🔒 只進全域 replays(pushHighlight);不 pushUserReplay、不 recordBotResult。呈現如兩個真人。
  const rec: Omit<ReplayRecord, 'v' | 'endedAt'> = {
    seed: s.seed,
    firstPicker: s.firstPicker,
    special: false,
    matchType: 'casual',
    p1: { name: s.p1.name, avatar: s.p1.avatarId, uid: s.p1.botId, isBot: true },
    p2: { name: s.p2.name, avatar: s.p2.avatarId, uid: s.p2.botId, isBot: true },
    winner: engine.winner!,
    moves,
  }
  await pushHighlight(rec)
  void releaseBotsById([s.p1.botId, s.p2.botId]) // 放掉兩隻租借
  // 收掉表演賽節點(Live 卡已翻 ended、保留 24h)。
  await remove(exRef()).catch(() => {})
  void writeSpectatorCount(code, 0)
}

/** 逾時(>5分)/孤兒回收 → 關 live、清節點、放租借,不存回放。 */
async function closeExhibition(): Promise<void> {
  const s = mState
  stopDriving()
  if (s) void releaseBotsById([s.p1.botId, s.p2.botId])
  await remove(exRef()).catch(() => {})
  if (s?.code) {
    await removeLiveEntry(s.code).catch(() => {})
    await remove(ref(getDb(), `spectate/${s.code}`)).catch(() => {})
  }
}
