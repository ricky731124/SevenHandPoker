import { usePlatformStore } from '../../state/platformStore'
import { todayStr } from '../../platform/profile'
import Modal from './Modal'
import Diamond from './game/Diamond'
import './DailyTasks.css'

/**
 * 每日任務面板 (#6) — CHECK-only (獎勵在遊戲流程中達成即自動發,不在這裡領)。
 * 訪客可以看,但不能領(標示 + 每列鎖住)。真人 = 快速配對 或 對戰好友。
 */
const TASKS = [
  { key: 'signin', label: '每日簽到' },
  { key: 'match', label: '完成任意一場對戰' },
  { key: 'pvpWin1', label: '真人對戰獲勝一場' },
  { key: 'pvpWin2', label: '真人對戰獲勝二場' },
] as const

export default function DailyTasks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const uid = usePlatformStore((s) => s.uid)
  const isAnonymous = usePlatformStore((s) => s.isAnonymous)
  const daily = usePlatformStore((s) => s.profile?.daily)
  const registered = !!uid && !isAnonymous
  // Flags only count for today; a stale date = a fresh (all-未完成) day.
  const today = daily?.date === todayStr() ? daily : undefined
  const doneCount = TASKS.filter((t) => registered && !!today?.[t.key]).length

  return (
    <Modal open={open} onClose={onClose} onBack={onClose} title={`每日任務（${doneCount} / ${TASKS.length}）`} width={430}>
      <div className="dt">
        <p className="dt-note">
          {registered
            ? '達成後自動於遊戲中發放鑽石,並彈窗提示;此處僅供查看進度。'
            : '訪客無法領取每日任務,登入後即可領取。'}
        </p>
        <ul className="dt-list">
          {TASKS.map((t) => {
            const done = registered && !!today?.[t.key]
            return (
              <li key={t.key} className={`dt-row${done ? ' dt-row--done' : ''}${registered ? '' : ' dt-row--locked'}`}>
                <span className="dt-row__label">{t.label}</span>
                <span className="dt-row__reward">
                  +5 <Diamond size={15} />
                </span>
                <span className="dt-row__status">
                  {!registered ? '🔒' : done ? '✓ 已完成' : '未完成'}
                </span>
              </li>
            )
          })}
        </ul>
        <p className="dt-foot">真人對戰 = 快速配對 或 對戰好友</p>
      </div>
    </Modal>
  )
}
