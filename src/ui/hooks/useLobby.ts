import { useEffect, useRef, useState } from 'react'
import { usePlatformStore } from '../../state/platformStore'
import { subStageOrder } from '../../game/campaign'
import { ambientUnit, greetingUtter, reactUnit, arrivalGreeting, pickBots, type ReactInput, type LobbyGlobals, type BotUtterance } from '../../game/lobbyChat'
import { BOTS, type BotPersona } from '../../game/bots'
import { fetchCard } from '../../platform/cards'
import { subscribeLiveIndex } from '../../net/liveIndex'
import { subscribeOnlineCount } from '../../net/presence'
import {
  ensureLobbyAuth, startActive, stopActive, subscribeActive,
  tryBecomeHost, releaseHost, amHost, verifyStillHost, pruneActive, LOBBY_MUTE_USERS, hostGrabWasCold, hostGrabInfo,
  markSeenAndFindNewcomers, writeChatMessage, subscribeChat, pruneChat, visibleChat, type LobbyMsg,
} from '../../net/lobby'
import { exhibitionStart, exhibitionStop, exhibitionSetContext, exhibitionRequestOpen } from '../../game/exhibition'

/**
 * 大廳聊天 orchestration（見 docs/LOBBY-AI-SPEC.md §2/§3、§11、§13）。
 *
 * 定案(使用者拍板):
 *   - 唯一嘴巴 = host。非 host 只顯示、不產生任何訊息(含反應式回覆)。
 *   - 引擎是「整個分頁的單例」(模組層變數),React StrictMode 雙掛載 / HMR 都只一條迴圈。
 *   - 內容全走 chatContent.ts 產句引擎(§13):ambientUnit(環境)/reactUnit(反應+補刀)/arrivalGreeting(招呼)。
 *   - host 讀發言者的「玩家資訊卡」組 facts(連勝/成就/預設特殊牌/主線→BOSS),挑針對性回覆。
 *   - 額度:一輪 6~9 個單元;重置觸發①新到訪②真人發言③host 點開④換 host。回覆插隊優先。
 *   - 冷場首句零間隔;其餘 10~20s。表演賽「怎麼觸發」的邏輯不在本次改動範圍(紅線)。
 */

const HOST_POLL_MS = 6000
const GAP_MIN = 10000, GAP_MAX = 20000 // 每則訊息間隔 10~20s
const QUOTA_MIN = 6, QUOTA_MAX = 9     // 一輪聊天的「額度」= 6~9 個單元
const REPLY_THROTTLE_MS = 15000        // 同一真人 15s 內最多被回一次
const FRESH_MS = 12000                 // 最新訊息比這新 → 不硬插零間隔首句
const SESSION_BOTS = 8                 // 一次聊天只用隨機 8 隻人機（§9）

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
const gap = () => rand(GAP_MIN, GAP_MAX)

type QueuedReply = BotUtterance

// ─── 分頁單例引擎狀態（模組層,跨 mount/StrictMode/HMR 只有一份、一條迴圈）─────────
let mHost = false
let mActive = 0
let mMessages: LobbyMsg[] = []
let mQuota = 0
let mReplies: QueuedReply[] = []       // 待插隊的針對性回覆(可含補刀,依序送出)
let mRunning = false
let mGen = 0
let mRoster: BotPersona[] = []
let mLastSeenHuman: string | null = null
let mLastReactByUid: Record<string, number> = {}
let mActiveUids: string[] = []
let mMyUid: string | null = null
let mLiveCode: string | null = null // 當前可觀戰的 live code（spectate CTA 用；null=現在沒 live）
let mOnline = 0 // 顯示用線上人數（= 角落 OnlineCount：presence 活躍 uid + BOTS_ONLINE 20）

const getRoster = (): BotPersona[] => {
  if (mRoster.length === 0) mRoster = pickBots(Math.min(SESSION_BOTS, BOTS.length))
  return mRoster
}
const globals = (): LobbyGlobals => ({ onlineCount: mOnline, hasLive: !!mLiveCode, liveCode: mLiveCode ?? undefined })
const chatStale = (): boolean => {
  if (mMessages.length === 0) return true
  return Date.now() - (mMessages[mMessages.length - 1]?.ts ?? 0) > FRESH_MS
}

const writeUtter = (u: BotUtterance) =>
  writeChatMessage({ kind: 'bot', botId: u.botId, name: u.name, avatarId: u.avatarId, type: u.type, text: u.text, stickerId: u.stickerId, cta: u.cta })

/** 單一序列引擎:回覆插隊(連 mini-thread 中間)、消耗額度、冷場首句零間隔。整個分頁只會有一條。 */
function runEngine(): void {
  if (mRunning) return
  if (!mHost || mActive < 1) return
  mRunning = true
  const gen = ++mGen
  const alive = () => mHost && mActive >= 1 && gen === mGen
  void (async () => {
    let pending: BotUtterance[] = [] // 當前環境單元(可能多則:mini-thread)尚未播的步驟
    if (chatStale() && alive() && await verifyStillHost()) {
      await writeUtter(greetingUtter(getRoster()))
      if (mQuota > 0) mQuota -= 1
    }
    while (alive()) {
      if (mReplies.length === 0 && pending.length === 0) {
        if (mQuota > 0) { pending = ambientUnit(getRoster(), globals()); mQuota -= 1 }
        else break // 沒回覆、沒步驟、沒額度 → 收工待命
      }
      await sleep(gap())
      if (!alive()) break
      if (!(await verifyStillHost())) { mHost = false; break }
      const msg = mReplies.shift() ?? pending.shift() // 回覆插隊(連 thread 中間)
      if (!msg) continue
      await writeUtter(msg)
    }
    if (gen === mGen) mRunning = false
    void pruneChat()
  })()
}

/** 重置額度回滿 6~9 +（可選）排入回覆(可多則:reply+補刀),並確保引擎在跑。 */
function bumpQuota(replies?: QueuedReply[]): void {
  mQuota = rand(QUOTA_MIN, QUOTA_MAX)
  if (replies && replies.length) mReplies.push(...replies)
  runEngine()
}

/** 「真的有新到訪」→ 請表演賽開一場(不排隊)+ 重置聊天 +（可選）點名招呼。 */
function onLobbyArrival(reason: string, greet?: QueuedReply[]): void {
  exhibitionRequestOpen(reason) // §4:表演賽觸發邏輯(不在本次改動範圍)
  bumpQuota(greet)
}

/** host 的 poll 每輪:比對全域 lobbySeen 找「別人的新到訪」→ 開場 + 點名招呼(讀新人卡片取名)。 */
async function checkNewcomers(): Promise<void> {
  if (!mHost) return
  const newcomers = await markSeenAndFindNewcomers(mActiveUids, mMyUid)
  if (!newcomers.length) return
  let name = '新朋友'
  try { const c = await fetchCard(newcomers[0]); if (c?.displayName) name = c.displayName } catch { /* best-effort */ }
  const greet = arrivalGreeting(name, getRoster(), globals())
  onLobbyArrival('新到訪 ' + newcomers.map((u) => u.slice(0, 6)).join(', '), greet ? [greet] : undefined)
}

export interface UseLobby {
  messages: LobbyMsg[]
  latest: LobbyMsg | null
  send: (payload: { text?: string; stickerId?: string }) => void
  notifyOpened: () => void
}

export function useLobby(): UseLobby {
  const uid = usePlatformStore((s) => s.uid)
  const username = usePlatformStore((s) => s.username)
  const [messages, setMessages] = useState<LobbyMsg[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [host, setHost] = useState(false)

  const muted = !!username && LOBBY_MUTE_USERS.some((u) => u.toLowerCase() === username.toLowerCase())

  mHost = host
  mActive = activeCount
  mMessages = messages
  mMyUid = uid

  const prevHostRef = useRef(false)

  useEffect(() => { void ensureLobbyAuth() }, [])

  useEffect(() => {
    const un1 = subscribeChat((all) => setMessages(visibleChat(all)))
    const un2 = subscribeActive((n, uids) => { setActiveCount(n); mActiveUids = [...uids] })
    const un3 = subscribeLiveIndex((entries) => { mLiveCode = entries.find((e) => e.status === 'live')?.code ?? null })
    const un4 = subscribeOnlineCount((n) => { mOnline = n }) // 與角落在線人數同源(含 +20 保底)
    return () => { un1(); un2(); un3(); un4() }
  }, [])

  useEffect(() => {
    if (!uid || muted) return
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const goActive = () => {
      startActive()
      exhibitionStart()
      if (pollTimer) return
      const poll = async () => {
        if (!amHost()) await tryBecomeHost()
        const h = amHost()
        setHost(h)
        mHost = h
        exhibitionSetContext({ active: true, isHost: h, uid })
        if (h) { void pruneActive(); void checkNewcomers() }
      }
      void poll()
      pollTimer = setInterval(() => void poll(), HOST_POLL_MS)
    }
    const goInactive = () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
      releaseHost()
      stopActive()
      exhibitionSetContext({ active: false, isHost: false, uid })
      exhibitionStop()
      setHost(false)
      mHost = false
    }

    const onVis = () => { document.visibilityState === 'visible' ? goActive() : goInactive() }
    if (document.visibilityState === 'visible') goActive()
    document.addEventListener('visibilitychange', onVis)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      goInactive()
    }
  }, [uid, muted])

  // 全部離線 → 清本 session 名單/額度。剛「冷啟動」成 host → 開一場給他看(表演賽,原邏輯)。
  useEffect(() => {
    if (activeCount === 0) { mRoster = []; mQuota = 0; prevHostRef.current = host; return }
    const becameHost = host && !prevHostRef.current
    prevHostRef.current = host
    if (becameHost) {
      if (hostGrabWasCold()) {
        onLobbyArrival('冷啟動 [' + hostGrabInfo() + ']')
      } else if (import.meta.env.DEV) {
        console.log('%c[lobby] 成為 host(非冷啟動 → 不開表演賽,新到訪交給 lobbySeen 判)[' + hostGrabInfo() + ']', 'color:#69c')
      }
    }
  }, [host, activeCount])

  // 任一真人發言/貼圖 → host 重置額度 +（節流後）讀他的玩家資訊卡組 facts、排入針對性回覆(可含補刀)。
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.kind !== 'human' || last.id === mLastSeenHuman) return
    mLastSeenHuman = last.id
    if (!host) return // 只有 host 是嘴巴

    const u = last.uid ?? '?'
    const now = Date.now()
    if (now - (mLastReactByUid[u] ?? 0) < REPLY_THROTTLE_MS) { bumpQuota(); return } // 節流:重置額度但不回話
    mLastReactByUid[u] = now

    void (async () => {
      const card = last.uid ? await fetchCard(last.uid) : null
      const input: ReactInput = {
        name: last.name,
        username: last.username,
        registered: !!last.reg,
        streak: card?.pvp.streak ?? 0,
        bestStreak: card?.pvp.bestStreak ?? 0,
        wins: card?.pvp.wins ?? 0,
        games: card?.pvp.games ?? 0,
        clearedOrder: typeof last.stage === 'number' ? last.stage : -1,
        achvList: card?.achievements ?? [],
        loadout: card?.loadout ?? [],
        isSticker: last.type === 'sticker',
        stickerId: last.stickerId,
        text: last.text,
      }
      bumpQuota(reactUnit(input, getRoster(), globals()))
    })()
  }, [messages, host])

  // 真人發言:只寫訊息(帶上自己的狀態供 host 挑回覆)。回覆 + 重置一律由 host 處理。
  const send = (payload: { text?: string; stickerId?: string }) => {
    const st = usePlatformStore.getState()
    const isSticker = !!payload.stickerId
    const name = st.displayName ?? '訪客'
    const avatarId = st.profile?.equipped.avatar ?? 'cat'
    void (async () => {
      await ensureLobbyAuth()
      const s2 = usePlatformStore.getState()
      const cleared = s2.profile?.progress.maxStageCleared ?? null
      await writeChatMessage({
        kind: 'human', uid: s2.uid ?? undefined, name, avatarId,
        type: isSticker ? 'sticker' : 'text', text: payload.text, stickerId: payload.stickerId,
        reg: !!s2.uid && !s2.isAnonymous,
        stage: cleared ? subStageOrder(cleared) : -1,
        username: s2.username ?? undefined,
      })
    })()
  }

  const notifyOpened = () => { if (mHost) bumpQuota() }

  const latest = messages.length ? messages[messages.length - 1] : null
  return { messages, latest, send, notifyOpened }
}
