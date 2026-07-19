import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../state/appStore'
import { useNetStore } from '../../state/netStore'
import Button, { Paw, IconRobot, IconDice, IconKey, IconGlobe } from '../components/Button'
import Modal from '../components/Modal'
import { sfx } from '../../audio/sfx'
import './Menu.css'

export default function Menu() {
  const go = useAppStore((s) => s.go)
  const launchGame = useAppStore((s) => s.launchGame)
  const net = useNetStore()
  const [dialog, setDialog] = useState<null | 'start' | 'join'>(null)

  const createRoom = () => {
    void net.create()
    launchGame({ mode: 'host' })
  }
  const joinRoom = (code: string) => {
    void net.join(code)
    launchGame({ mode: 'guest', roomId: code })
  }
  const [joinCode, setJoinCode] = useState('')
  const [heroOk, setHeroOk] = useState(true)

  const openStart = () => {
    sfx.unlock()
    setDialog('start')
  }

  return (
    <div className="menu">
      {/* Full-bleed hero art (title baked in) */}
      {heroOk ? (
        <img
          className="menu__hero"
          src={`${import.meta.env.BASE_URL}title.png`}
          alt="Seven Hand Poker"
          onError={() => setHeroOk(false)}
        />
      ) : (
        <div className="menu__hero-fallback">
          <h1 className="menu__fallback-title">Seven Hand Poker</h1>
        </div>
      )}

      {/* Buttons: vertical stack, lower-center over the felt */}
      {/* x:'-50%' is animated by framer so it isn't clobbered like a CSS transform would be */}
      <motion.div
        className="menu__buttons"
        initial={{ x: '-50%', y: 24, opacity: 0 }}
        animate={{ x: '-50%', y: 0, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 220, damping: 22 }}
      >
        <Button full icon={<Paw />} onClick={openStart}>
          開始遊戲
        </Button>
        <Button full icon={<Paw />} variant="secondary" onClick={() => go('howto')}>
          如何遊玩
        </Button>
        <Button full icon={<Paw />} variant="secondary" onClick={() => go('settings')}>
          設定
        </Button>
      </motion.div>

      {/* Start dialog: 4 options */}
      <Modal open={dialog === 'start'} onClose={() => setDialog(null)} title="開始遊戲" largeTitle>
        <Button full icon={<IconRobot />} onClick={() => launchGame({ mode: 'ai' })}>
          對戰電腦
        </Button>
        <Button full icon={<IconDice />} onClick={createRoom}>
          建立對戰
        </Button>
        <Button full icon={<IconKey />} onClick={() => setDialog('join')}>
          加入對戰
        </Button>
        <Button full icon={<IconGlobe />} disabled>
          自由匹配（即將推出）
        </Button>
      </Modal>

      {/* Join room */}
      <Modal open={dialog === 'join'} onClose={() => setDialog(null)} title="加入對戰">
        <p className="menu__hint">輸入朋友給你的 3 碼房號：</p>
        <input
          className="menu__input"
          inputMode="numeric"
          maxLength={3}
          placeholder="000"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
        />
        <Button full disabled={joinCode.length !== 3} onClick={() => joinRoom(joinCode)}>
          加入房間
        </Button>
      </Modal>
    </div>
  )
}
