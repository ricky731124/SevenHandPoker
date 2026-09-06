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
  // 「已發牌」= status 進到 playing(過了擲硬幣)且未結束 → 中途離開一律判該場敗。
  // ⚠️ 用 status:host 在擲硬幣階段 engine 已存在,只看 engine 會在發牌前就判敗。
  const dealt = useGameStore((s) => s.status === 'playing' && !!s.engine && s.engine.phase !== 'ended')
  // #8:正在被觀戰(有廣播 code)才顯示「觀眾彈幕」開關;預設開。
  const broadcastCode = useGameStore((s) => s.broadcastCode)
  const showDanmaku = useGameStore((s) => s.showSpectatorDanmaku)
  const toggleDanmaku = useGameStore((s) => s.toggleSpectatorDanmaku)

  const inCampaign = !!series
  const curCleared = series ? !!clearedAt?.[series.subId] : false
  // 已通關的主線「重打」不判敗;其餘(主線未通關/打電腦/打真人/快速配對)發牌後離開都判敗。
  const leaveIsLoss = dealt && !(inCampaign && curCleared)

  const close = () => {
    setOpen(false)
    setConfirmLeave(false)
  }

  const doLeave = () => {
    const gs = useGameStore.getState()
    const isDealt = gs.status === 'playing' && !!gs.engine && gs.engine.phase !== 'ended'
    if (inCampaign) {
      // 未通關 + 已發牌 → forfeit(series + solo 敗);已通關重打或未發牌 → 只離開。
      if (isDealt && !curCleared) forfeit()
      else exitCampaign()
      return
    }
    if (gs.online) {
      gs.forfeitOnline(false) // 主動離開 → 判敗(guarded: 未發牌/已結束不計);對手會判勝
      gs.leaveOnline()
      go('menu')
      return
    }
    // 本地非主線(建立房打電腦 / 快速配對人機):發牌後離開 → forfeitLocal 判敗。
    if (isDealt) gs.forfeitLocal()
    gs.reset()
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
            {broadcastCode && (
              <div className="settings__row">
                <label>觀眾彈幕</label>
                <button className={`settings__chip${showDanmaku ? ' settings__chip--on' : ''}`} onClick={() => { toggleDanmaku(); sfx.click() }}>
                  {showDanmaku ? '開' : '關'}
                </button>
              </div>
            )}
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
