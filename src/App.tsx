import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { useAppStore } from './state/appStore'
import { useNetStore } from './state/netStore'
import { tryReconnect } from './net/netgame'
import Menu from './ui/screens/Menu'
import HowToPlay from './ui/screens/HowToPlay'
import Settings from './ui/screens/Settings'
import Game from './ui/screens/Game'
import TableBackground from './ui/components/TableBackground'

const screens = {
  menu: Menu,
  howto: HowToPlay,
  settings: Settings,
  game: Game,
} as const

export default function App() {
  const screen = useAppStore((s) => s.screen)
  const launchGame = useAppStore((s) => s.launchGame)
  const Current = screens[screen]

  // On load: first try to reconnect an accidentally-dropped game; otherwise
  // honour a /?room=123 deep link.
  useEffect(() => {
    void (async () => {
      if (await tryReconnect()) return
      const room = new URLSearchParams(window.location.search).get('room')
      if (room && /^\d{3}$/.test(room)) {
        void useNetStore.getState().join(room)
        launchGame({ mode: 'guest', roomId: room })
      }
    })()
  }, [launchGame])

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

      <div className="rotate-hint">
        <div className="rotate-hint__icon">📱</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>請將手機橫置</div>
        <div style={{ color: 'var(--muted)' }}>Seven Hand Poker 適合橫向遊玩</div>
      </div>
    </>
  )
}
