import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../../state/appStore'
import { useGameStore } from '../../../state/gameStore'
import { useCampaignStore } from '../../../state/campaignStore'
import { usePlatformStore } from '../../../state/platformStore'
import Modal from '../Modal'
import Button from '../Button'
import { sfx } from '../../../audio/sfx'

/** Round wooden menu button (top-left). In a campaign match, leaving mid-series
 *  (a not-yet-cleared stage) forfeits the current match as a loss — with a
 *  confirm — and returns to the stage map; a replay of a cleared stage just
 *  leaves. Non-campaign play returns to the main menu. */
export default function TopBar() {
  const [open, setOpen] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const go = useAppStore((s) => s.go)
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updateSettings)
  const series = useCampaignStore((s) => s.series)
  const forfeit = useCampaignStore((s) => s.forfeit)
  const exitCampaign = useCampaignStore((s) => s.exit)
  const clearedAt = usePlatformStore((s) => s.profile?.progress.stageClearedAt)
  // Online mid-match (已開打、未結束) → leaving forfeits it as a loss.
  const onlineLoss = useGameStore(
    (s) =>
      !!s.online &&
      !!s.engine &&
      s.engine.phase !== 'ended' &&
      (s.engine.placementsDone.p1 + s.engine.placementsDone.p2 > 0 || !!s.engine.pendingPick),
  )

  const inCampaign = !!series
  const curCleared = series ? !!clearedAt?.[series.subId] : false
  const leaveIsLoss = (inCampaign && !curCleared) || onlineLoss

  const close = () => {
    setOpen(false)
    setConfirmLeave(false)
  }

  const doLeave = () => {
    if (inCampaign) {
      // forfeit records a loss (only meaningful when not yet cleared); a cleared
      // replay just exits — both land on the stage map.
      if (leaveIsLoss) forfeit()
      else exitCampaign()
      return
    }
    const gs = useGameStore.getState()
    if (gs.online) {
      gs.forfeitOnline(false) // 主動離開 → 判敗(guarded: 開局前/已結束不計)
      gs.leaveOnline()
    }
    go('menu')
  }

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

      <Modal
        open={open}
        onClose={close}
        onBack={confirmLeave ? () => setConfirmLeave(false) : close}
        title={confirmLeave ? '離開遊戲' : '選單'}
        width={360}
      >
        {confirmLeave ? (
          <>
            <p style={{ textAlign: 'center', color: 'var(--parch-text)', fontWeight: 700, lineHeight: 1.6 }}>
              現在離開會判這場<span className="accent">敗場</span>，目前進度會保留。確定離開？
            </p>
            <div className="confirm__actions">
              <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
                取消
              </Button>
              <Button onClick={doLeave}>確定離開</Button>
            </div>
          </>
        ) : (
          <>
            <div className="settings__row">
              <label>音樂</label>
              <button className="settings__chip" disabled>
                {settings.music ? '開' : '關'}
              </button>
            </div>
            <div className="settings__row">
              <label>音效</label>
              <button className="settings__chip settings__chip--on" onClick={() => { const on = !settings.sfx; update({ sfx: on }); if (on) sfx.success() }}>
                {settings.sfx ? '開' : '關'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
              <Button variant="secondary" onClick={() => (leaveIsLoss ? setConfirmLeave(true) : doLeave())}>
                離開遊戲
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
