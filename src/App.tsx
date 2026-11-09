import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useAppStore } from './state/appStore'
import { usePlatformStore } from './state/platformStore'
import { tryReconnect, reconcileAbandonedMatch } from './net/netgame'
import { resumeLocalMatch, reconcileAbandonedLocal } from './net/localResume'
import { trackPresence } from './net/presence'
import { seedBots } from './net/bots'
import { isFirebaseConfigured } from './firebaseApp'
import OnlineCount from './ui/components/OnlineCount'
import Menu from './ui/screens/Menu'
import HowToPlay from './ui/screens/HowToPlay'
import Settings from './ui/screens/Settings'
import Personalize from './ui/screens/Personalize'
import Leaderboard from './ui/screens/Leaderboard'
import Game from './ui/screens/Game'
import Tutorial from './ui/screens/Tutorial'
import CampaignMap from './ui/screens/CampaignMap'
import ChapterMap from './ui/screens/ChapterMap'
import Matchmaking from './ui/screens/Matchmaking'
import SpectatorGame from './ui/screens/SpectatorGame'
import ReplayViewer from './ui/screens/ReplayViewer'
import TableBackground from './ui/components/TableBackground'
import Toast from './ui/components/Toast'
import AchievementToast from './ui/components/AchievementToast'
import UpgradePrompt from './ui/components/UpgradePrompt'
import InAppBrowserGate from './ui/components/InAppBrowserGate'
import Splash from './ui/splash/Splash'
import TypingRotateTip from './ui/splash/TypingRotateTip'
import { INSTALL_TEXT } from './ui/splash/guides'
import { isInAppBrowser, isStandalone, usePwaStore } from './platform/pwa'
import { useToastStore } from './state/toastStore'
import { useStageMapPreload } from './ui/hooks/useStageMapPreload'

/** 冷開(從零打開、重整)先看開場頁。內建瀏覽器看的是導出教學,不給開場頁。
 *  截圖工具(scripts/layout)開發模式下可用 window.__shpNoSplash 跳過。 */
function showSplashAtBoot(): boolean {
  if (isInAppBrowser() && !isStandalone()) return false
  if (import.meta.env.DEV && (window as unknown as { __shpNoSplash?: boolean }).__shpNoSplash) return false
  return true
}

const screens = {
  menu: Menu,
  howto: HowToPlay,
  settings: Settings,
  personalize: Personalize,
  leaderboard: Leaderboard,
  game: Game,
  tutorial: Tutorial,
  campaign: CampaignMap,
  campaignStages: ChapterMap, // 主線章節大地圖(取代舊的關卡清單)
} as const

/** Resolve once auth has settled AND (if there's an account) its profile has loaded,
 *  so boot-time reconcile (a) uses the restored uid — not a new anon — and (b) reads
 *  the REAL stats for its read-modify-write, instead of wiping them to 1/0. */
function whenProfileReady(): Promise<void> {
  const done = () => {
    const s = usePlatformStore.getState()
    return s.ready && (!s.uid || !!s.profile) // settled, and (no account OR profile loaded)
  }
  if (done()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsub = usePlatformStore.subscribe(() => {
      if (done()) {
        unsub()
        resolve()
      }
    })
  })
}

export default function App() {
  const screen = useAppStore((s) => s.screen)
  const matchType = useAppStore((s) => s.matchType)
  const spectateCode = useAppStore((s) => s.spectateCode)
  const replayData = useAppStore((s) => s.replayData)
  const Current = screens[screen]
  const uid = usePlatformStore((s) => s.uid)
  useStageMapPreload() // 關卡地圖：先載接下來要打的那關，其他已解鎖的進主線才慢慢載

  const [splash, setSplash] = useState(showSplashAtBoot)
  // 開場頁還開著就被帶去別的畫面(斷線重連、本地局續玩)→ 直接收起,不擋著正在進行的牌局
  useEffect(() => {
    if (splash && (screen !== 'menu' || spectateCode || replayData)) setSplash(false)
  }, [splash, screen, spectateCode, replayData])

  // 安卓裝好了(appinstalled):瀏覽器分頁還停在原地,提醒改從桌面圖示開
  const justInstalled = usePwaStore((s) => s.justInstalled)
  useEffect(() => {
    if (!justInstalled) return
    useToastStore.getState().show(INSTALL_TEXT.done)
    usePwaStore.setState({ justInstalled: false })
  }, [justInstalled])

  // Report this client as online while it holds a uid (anonymous included), so
  // the owner-only 線上人數 counter reflects everyone. Cleaned up on uid change.
  useEffect(() => {
    if (!uid || !isFirebaseConfigured()) return
    void seedBots() // once a uid exists, ensure the 15 bot personas are in bots/{botId} (idempotent)
    return trackPresence(uid)
  }, [uid])

  // On load: first try to reconnect an accidentally-dropped game; otherwise
  // hold a /?room=123 deep link as `pendingRoom` — the identity gate (in Menu's
  // AccountButton) resolves 登入/訪客 first, then joins. Registered users join
  // straight through. See PLATFORM-SPEC §4.1.
  useEffect(() => {
    usePlatformStore.getState().init()
    void (async () => {
      if (await tryReconnect()) return
      // §3.7 本地局重整 → 還原對局續玩(sessionStorage 快照)。
      if (resumeLocalMatch()) return
      // Deep link 先捕捉(不需 auth)。
      const room = new URLSearchParams(window.location.search).get('room')
      // The join-confirm popup peeks the room's type/time/host, so the link
      // only needs the code (no ?type/?time).
      if (room && /^\d{3}$/.test(room)) {
        useAppStore.getState().setPendingRoom(room)
        // Strip ?room= from the address bar once captured, so if the player
        // later "adds to home screen" the icon opens the clean start_url —
        // never a stale room link. See the onboarding flow.
        window.history.replaceState(null, '', window.location.pathname + window.location.hash)
      }
      // ⚠️ 補判必須等 auth settle 後才跑:否則 ensureAccount/ensureUser 會在 Firebase
      // 還原登入 session 前誤建新匿名帳號、蓋掉正在還原的登入(=關分頁再開變登出、
      // 補判寫到錯的 uid、線上人數虛增)。等 `ready` 後 uid 已還原,ensureAccount 為 no-op。
      await whenProfileReady()
      void reconcileAbandonedMatch() // online: 未能重進的已開打房 → 判敗(#8)
      void reconcileAbandonedLocal() // §3.7 本地:關分頁的已發牌局 → 判敗(+人機勝/series 敗)
    })()
  }, [])

  return (
    <>
      {screen !== 'menu' && <TableBackground />}
      <motion.div
        key={screen}
        className="stage"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.28 }}
      >
        <Current />
      </motion.div>

      {matchType && <Matchmaking />}
      {spectateCode && <SpectatorGame />}
      {replayData && <ReplayViewer />}
      <Toast />
      <AchievementToast />
      <UpgradePrompt />

      {/* 開場頁:點擊開始、安卓全螢幕鎖橫、加主畫面 / 自動旋轉的提示卡(取代原本的橫幅和大廳小框) */}
      {splash && <Splash onStart={() => setSplash(false)} />}
      {/* iOS 假橫向打字時,提醒開自動旋轉(鍵盤才不會直著跳出來) */}
      <TypingRotateTip />
      {/* In-app webview 路由門:LINE 靜默轉外部瀏覽器、安卓 FB 跳 Chrome、iOS FB 顯示手動引導。
          一般瀏覽器/全螢幕/電腦版不受影響(見 InAppBrowserGate)。 */}
      <InAppBrowserGate />
      {/* 在線人數只在主畫面顯示(全體可見,見 OnlineCount) */}
      {screen === 'menu' && !spectateCode && !replayData && <OnlineCount />}
    </>
  )
}
