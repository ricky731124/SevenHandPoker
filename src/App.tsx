import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { useAppStore } from './state/appStore'
import { usePlatformStore } from './state/platformStore'
import { tryReconnect, reconcileAbandonedMatch } from './net/netgame'
import { trackPresence } from './net/presence'
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
import CampaignStages from './ui/screens/CampaignStages'
import Matchmaking from './ui/screens/Matchmaking'
import TableBackground from './ui/components/TableBackground'
import Toast from './ui/components/Toast'
import AchievementToast from './ui/components/AchievementToast'
import UpgradePrompt from './ui/components/UpgradePrompt'
import InstallGuide from './ui/components/InstallGuide'
import OrientationTip from './ui/components/OrientationTip'

const screens = {
  menu: Menu,
  howto: HowToPlay,
  settings: Settings,
  personalize: Personalize,
  leaderboard: Leaderboard,
  game: Game,
  tutorial: Tutorial,
  campaign: CampaignMap,
  campaignStages: CampaignStages,
} as const

export default function App() {
  const screen = useAppStore((s) => s.screen)
  const matchType = useAppStore((s) => s.matchType)
  const Current = screens[screen]
  const uid = usePlatformStore((s) => s.uid)

  // Report this client as online while it holds a uid (anonymous included), so
  // the owner-only 線上人數 counter reflects everyone. Cleaned up on uid change.
  useEffect(() => {
    if (!uid || !isFirebaseConfigured()) return
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
      // Didn't resume a game → if a started match was left un-rejoinable, settle it
      // as a single loss (#8). Idempotent via the settled-set.
      void reconcileAbandonedMatch()
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
      <Toast />
      <AchievementToast />
      <UpgradePrompt />

      <InstallGuide />
      {/* InAppBrowserGate 已停用:不再硬擋 LINE/FB in-app 瀏覽器,讓人可直接以訪客試玩。
          Google 登入在 webview 仍會被 Google 擋,之後視測試結果再決定要不要加「用外部瀏覽器開」的軟提示。 */}
      <OrientationTip />
      {/* 在線人數只在主畫面顯示(全體可見,見 OnlineCount) */}
      {screen === 'menu' && <OnlineCount />}
    </>
  )
}
