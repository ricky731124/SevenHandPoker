import { useEffect, useRef, useState } from 'react'
import { usePlatformStore } from '../../state/platformStore'
import { subStageOrder } from '../../game/campaign'
import { arrivalGreeting, syncChatHistory, type ReactInput, type LobbyGlobals, type BotUtterance } from '../../game/lobbyChat'
import { fetchLatestHighlight } from '../../net/replays'
import { createChatDirector, type ChatDirector } from '../../game/lobbyDirector'
import { fetchCard } from '../../platform/cards'
import { subscribeLiveIndex } from '../../net/liveIndex'
import { subscribeOnlineCount } from '../../net/presence'
import {
  ensureLobbyAuth, startActive, stopActive, subscribeActive,
  tryBecomeHost, releaseHost, amHost, verifyStillHost, pruneActive, LOBBY_MUTE_USERS, hostGrabWasCold, hostGrabInfo,
  markSeenAndFindNewcomers, writeChatMessage, subscribeChat, pruneChat, visibleChat, serverNow, type LobbyMsg,
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
 *   - 何時講/講幾則/要不要打招呼 → 全交給 lobbyDirector(可測)。本檔只負責 Firebase 接線 + 表演賽觸發。
 *   - 表演賽「怎麼觸發」的邏輯不在本次改動範圍(紅線),維持原樣。
 */

const HOST_POLL_MS = 6000
const START_DELAY_MS = 3000 // 進主畫面先讓畫面/圖片載完,3 秒後才接 host 工作(表演賽/聊天),新玩家手機不會一進來就卡

// ─── 分頁單例（模組層,跨 mount/StrictMode/HMR 只有一份）──────────────────────────
let mHost = false
let mLastSeenHuman: string | null = null
let mActiveUids: string[] = []
let mMyUid: string | null = null
let mLiveCode: string | null = null // 當前可觀戰的 live code（spectate CTA 用；null=現在沒 live）
let mOnline = 0 // 顯示用線上人數（= 角落 OnlineCount：presence 活躍 uid + BOTS_ONLINE 20）
let mMessages: LobbyMsg[] = []
let mLastResult: LobbyGlobals['lastResult'] // 最近一場打完的(精華最新一筆、10 分內)→「剛剛誰打敗誰」
let mLurkers: NonNullable<LobbyGlobals['lurkers']> = [] // 潛水的人 →「點名」

const globals = (): LobbyGlobals => ({
  onlineCount: mOnline, hasLive: !!mLiveCode, liveCode: mLiveCode ?? undefined,
  lastResult: mLastResult, lurkers: mLurkers,
})

const writeUtter = (u: BotUtterance) =>
  writeChatMessage({ kind: 'bot', botId: u.botId, name: u.name, avatarId: u.avatarId, type: u.type, text: u.text, stickerId: u.stickerId, cta: u.cta, ck: u.ck })

// ─── host 的主動句素材：剛剛誰打敗誰 / 潛水的人（§13.8）────────────────────────────
const RESULT_FRESH_MS = 10 * 60_000 // 10 分內打完的才算「剛剛」
const RESULT_POLL_MS = 2 * 60_000   // 最新戰績每 2 分鐘讀一次(一筆 2~5KB,只有 host 讀)
const LURK_AFTER_MS = 2 * 60_000    // 在大廳待滿 2 分鐘…
const LURK_QUIET_MS = 10 * 60_000   // …而且 10 分鐘內沒講過話 = 潛水
let mResultFetchedAt = 0
const mArrivedAt = new Map<string, number>() // host 本機：uid 這次在大廳從何時開始
const mNameCache = new Map<string, string | null>() // uid → 名片顯示名(沒名片 = null,不點名)

async function refreshHostFacts(): Promise<void> {
  const now = serverNow()
  // ① 剛剛誰打敗誰
  if (now - mResultFetchedAt >= RESULT_POLL_MS) {
    mResultFetchedAt = now
    const r = await fetchLatestHighlight()
    if (r && !r.abandoned && now - r.endedAt < RESULT_FRESH_MS) {
      const w = r[r.winner], l = r[r.winner === 'p1' ? 'p2' : 'p1']
      mLastResult = w?.name && l?.name ? { id: r.id, winner: w.name, loser: l.name } : undefined
    } else mLastResult = undefined
  }
  // ② 潛水的人：在場夠久 + 最近沒講話 + 有名片名字
  const active = new Set(mActiveUids)
  for (const u of [...mArrivedAt.keys()]) if (!active.has(u)) mArrivedAt.delete(u)
  for (const u of active) if (!mArrivedAt.has(u)) mArrivedAt.set(u, now)
  const spoke = new Set(mMessages.filter((m) => m.kind === 'human' && m.uid && now - m.ts < LURK_QUIET_MS).map((m) => m.uid!))
  const out: NonNullable<LobbyGlobals['lurkers']> = []
  for (const [u, at] of mArrivedAt) {
    if (now - at < LURK_AFTER_MS || spoke.has(u)) continue
    if (!mNameCache.has(u)) { try { mNameCache.set(u, (await fetchCard(u))?.displayName || null) } catch { mNameCache.set(u, null) } }
    const name = mNameCache.get(u)
    if (name) out.push({ uid: u, name })
  }
  mLurkers = out
  pushGlobals()
}

// 分頁唯一導演：HMR 重新載入本模組時先把舊導演的迴圈關掉，避免同一分頁兩條迴圈同時講。
const holder = globalThis as { __shpChatDirector?: ChatDirector }
holder.__shpChatDirector?.dispose()
const director = createChatDirector({
  write: writeUtter,
  verifyHost: async () => { const ok = await verifyStillHost(); if (!ok) mHost = false; return ok },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: serverNow, // 訊息 ts 是伺服器時間 → 用校正過的伺服器時鐘比較
  prune: () => void pruneChat(),
  log: import.meta.env.DEV ? (m) => console.log('%c[lobby chat] ' + m, 'color:#69c') : undefined,
})
holder.__shpChatDirector = director
const pushGlobals = () => director.setGlobals(globals())

/** host 的 poll 每輪:比對全域 lobbySeen 找「別人的新到訪」→ 開表演賽(原邏輯) + 點名招呼;再偵測「回大廳」續聊。 */
async function checkNewcomers(): Promise<void> {
  if (!mHost) return
  const newcomers = await markSeenAndFindNewcomers(mActiveUids, mMyUid)
  if (newcomers.length) {
    let name = '新朋友'
    try { const c = await fetchCard(newcomers[0]); if (c?.displayName) name = c.displayName } catch { /* best-effort */ }
    exhibitionRequestOpen('新到訪 ' + newcomers.map((u) => u.slice(0, 6)).join(', ')) // §4:表演賽觸發(不在本次改動範圍)
    director.onNewcomer(arrivalGreeting(name, director.roster, globals()))
  }
  director.observeActive(mActiveUids, mMyUid)
  void refreshHostFacts()
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
  mMyUid = uid
  // 餵導演最新狀態（render 期間同步;整個 app 只有一個 <LobbyChat/>）。
  director.setHost(host)
  director.setAudience(activeCount)
  director.setLastMessageTs(messages.length ? messages[messages.length - 1].ts ?? null : null)

  const prevHostRef = useRef(false)

  useEffect(() => { void ensureLobbyAuth() }, [])

  useEffect(() => {
    const un1 = subscribeChat((all) => {
      const v = visibleChat(all)
      mMessages = v
      syncChatHistory(v) // 防重複的記憶 = 聊天室最近講過什麼（換 host / 重整都接得上）
      setMessages(v)
    })
    const un2 = subscribeActive((n, uids) => { setActiveCount(n); mActiveUids = [...uids] })
    const un3 = subscribeLiveIndex((entries) => { mLiveCode = entries.find((e) => e.status === 'live')?.code ?? null; pushGlobals() })
    const un4 = subscribeOnlineCount((n) => { mOnline = n; pushGlobals() }) // 與角落在線人數同源(含 +20 保底)
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
        director.setHost(h)
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
      director.setHost(false)
    }

    // 進主畫面延遲 START_DELAY_MS 才接 host 工作 → 先讓畫面/圖片載完(新玩家手機一進來不卡)。
    let started = false
    const startTimer = setTimeout(() => {
      started = true
      if (document.visibilityState === 'visible') goActive()
    }, START_DELAY_MS)
    const onVis = () => {
      if (!started) return // 還在開場延遲內 → 交給 startTimer
      document.visibilityState === 'visible' ? goActive() : goInactive()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      clearTimeout(startTimer)
      document.removeEventListener('visibilitychange', onVis)
      goInactive()
    }
  }, [uid, muted])

  // 成為 host：冷啟動 → 開表演賽(原邏輯) + 聊天冷啟動；換手 → 聊天續聊(不開表演賽)。
  //   「成為 host」與「大廳人數到位」誰先到不一定 → 先記住(pendingBecameRef)，人數 ≥1 時才處理，不會漏掉。
  const pendingBecameRef = useRef<boolean | null>(null) // null=無；true/false=待處理的 cold 旗標
  useEffect(() => {
    if (host && !prevHostRef.current) pendingBecameRef.current = hostGrabWasCold()
    if (!host) pendingBecameRef.current = null
    prevHostRef.current = host
    if (pendingBecameRef.current === null || activeCount === 0) return
    const cold = pendingBecameRef.current
    pendingBecameRef.current = null
    if (cold) exhibitionRequestOpen('冷啟動 [' + hostGrabInfo() + ']')
    else if (import.meta.env.DEV) console.log('%c[lobby] 成為 host(非冷啟動 → 不開表演賽,聊天續聊)[' + hostGrabInfo() + ']', 'color:#69c')
    director.onBecameHost(cold)
  }, [host, activeCount])

  // 任一真人發言/貼圖 → host 讀他的玩家資訊卡組 facts → 導演排入針對性回覆(節流在導演內)。
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (!last || last.kind !== 'human' || last.id === mLastSeenHuman) return
    mLastSeenHuman = last.id
    if (!host) return // 只有 host 是嘴巴

    const u = last.uid ?? '?'
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
      director.onHumanMessage(u, input)
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

  const notifyOpened = () => director.onOpened()

  const latest = messages.length ? messages[messages.length - 1] : null
  return { messages, latest, send, notifyOpened }
}
