import { useEffect } from 'react'
import { LIMITED_INFO, LIMITED_SCHEDULE, LIMITED_WEEK, type LimitedMode } from '../../../game/limited'
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

/** 牌桌右側「?」正上方的玩法方鈕(§8.4),點了再看一次規則卡。 */
export function LimitedBadge({ mode, onClick }: { mode: LimitedMode; onClick?: () => void }) {
  const info = LIMITED_INFO[mode]
  return (
    <button
      type="button"
      className={`limited-badge${info.badge.length > 1 ? '' : ' limited-badge--one'}`}
      onClick={
        onClick
          ? () => {
              sfx.click()
              onClick()
            }
          : undefined
      }
      title="看規則"
      aria-label={`限定房・${info.name}`}
    >
      {info.badge.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </button>
  )
}

/** 快速配對「?」:限定房一週表(§8.2)。今天那列標亮;測試期固定玩法時多一行說明。 */
export function LimitedWeekModal({ open, onClose, today, testMode }: { open: boolean; onClose: () => void; today: number; testMode: LimitedMode | null }) {
  return (
    <Modal open={open} onClose={onClose} title="限定房一週表" width={340} panelClass="limited-week">
      <ul className="limited-week__list">
        {LIMITED_WEEK.map(({ day, label }) => (
          <li key={day} className={day === today ? 'limited-week__row limited-week__row--today' : 'limited-week__row'}>
            <span>{label}</span>
            <span>{LIMITED_INFO[LIMITED_SCHEDULE[day]].name}</span>
          </li>
        ))}
      </ul>
      {testMode && <p className="limited-week__note">測試期間每天都是{LIMITED_INFO[testMode].name}</p>}
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
