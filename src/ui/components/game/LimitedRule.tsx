import { useEffect } from 'react'
import { LIMITED_INFO, type LimitedMode } from '../../../game/limited'
import Modal from '../Modal'
import Button from '../Button'
import { sfx } from '../../../audio/sfx'
import './LimitedRule.css'

/**
 * 限定房規則卡(LIMITED-ROOM-SPEC §8.3):VS 畫面之後跳一次;牌桌上的標籤點了也能再看。
 * autoCloseMs:連線對戰時自動收掉,避免一方一直開著、另一方乾等。
 */
export function LimitedRuleModal({
  mode,
  open,
  onClose,
  autoCloseMs,
}: {
  mode: LimitedMode
  open: boolean
  onClose: () => void
  autoCloseMs?: number
}) {
  useEffect(() => {
    if (!open || !autoCloseMs) return
    const t = setTimeout(onClose, autoCloseMs)
    return () => clearTimeout(t)
  }, [open, autoCloseMs, onClose])

  const info = LIMITED_INFO[mode]
  return (
    <Modal open={open} onClose={onClose} title={`限定房・${info.name}`} width={380} panelClass="limited-rule">
      <ul className="limited-rule__list">
        {info.rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <Button
        full
        onClick={() => {
          sfx.click()
          onClose()
        }}
      >
        知道了
      </Button>
    </Modal>
  )
}

/** 牌桌上方常駐的「限定房・百鬼夜行」標籤(§8.4),點了再看一次規則卡。 */
export function LimitedBadge({ mode, onClick }: { mode: LimitedMode; onClick?: () => void }) {
  return (
    <button
      type="button"
      className="limited-badge"
      onClick={
        onClick
          ? () => {
              sfx.click()
              onClick()
            }
          : undefined
      }
      title="看規則"
      aria-label={`限定房・${LIMITED_INFO[mode].name}`}
    >
      <span className="limited-badge__kind">限定房</span>
      <span className="limited-badge__name">{LIMITED_INFO[mode].name}</span>
    </button>
  )
}
