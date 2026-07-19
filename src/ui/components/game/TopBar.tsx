import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../../state/appStore'
import { useGameStore } from '../../../state/gameStore'
import Modal from '../Modal'
import Button from '../Button'
import { sfx } from '../../../audio/sfx'

/** Round wooden menu button (top-left). Score badge removed per design. */
export default function TopBar() {
  const [open, setOpen] = useState(false)
  const go = useAppStore((s) => s.go)
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updateSettings)

  return (
    <>
      <motion.button
        className="topbar__menu"
        onClick={() => {
          sfx.click()
          setOpen(true)
        }}
        whileTap={{ scale: 0.92 }}
        aria-label="選單"
      >
        <svg viewBox="0 0 24 24" width="52%" height="52%" fill="none" stroke="var(--wood-text)" strokeWidth="2.6" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </motion.button>

      <Modal open={open} onClose={() => setOpen(false)} title="選單" width={360}>
        <div className="settings__row">
          <label>音樂</label>
          <button className="settings__chip" disabled>
            {settings.music ? '開' : '關'}
          </button>
        </div>
        <div className="settings__row">
          <label>音效</label>
          <button className="settings__chip settings__chip--on" onClick={() => update({ sfx: !settings.sfx })}>
            {settings.sfx ? '開' : '關'}
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
          <Button
            variant="secondary"
            onClick={() => {
              const gs = useGameStore.getState()
              if (gs.online) gs.leaveOnline()
              go('menu')
            }}
          >
            離開遊戲
          </Button>
        </div>
      </Modal>
    </>
  )
}
