import type { PlayerId, WinReason } from '../../../game/state'
import type { PvpReward } from '../../../state/platformStore'
import Modal from '../Modal'
import Button from '../Button'

const REASON: Record<WinReason, string> = {
  coins4: '取得 4 枚金幣',
  line3: '金幣三連線',
  boardFull: '金幣較多',
}

export default function EndModal({
  open,
  winner,
  reason,
  me,
  reward,
  onRematch,
  onLeave,
  waiting,
  foeWantsRematch,
}: {
  open: boolean
  winner: PlayerId | null
  reason: WinReason | null
  me: PlayerId
  /** PvP-win diamond result (shown as a「+5 💎」line); null on a loss / solo. */
  reward?: PvpReward | null
  onRematch: () => void
  onLeave: () => void
  /** online: I agreed to a rematch and am waiting for the opponent to agree */
  waiting?: boolean
  /** online: the opponent has already agreed to a rematch */
  foeWantsRematch?: boolean
}) {
  const iWon = winner === me
  return (
    <Modal
      open={open}
      locked
      width={420}
      largeTitle
      title={
        <span className={`end__head ${iWon ? 'end__head--win' : 'end__head--lose'}`}>
          <span className="end__head-ico">{iWon ? '🎉' : '😿'}</span>
          {iWon ? '勝利！' : '落敗'}
        </span>
      }
    >
      {reason && (
        <p style={{ textAlign: 'center', color: 'var(--parch-text)', fontWeight: 700 }}>
          {iWon ? '你' : '對手'}以「<span className="accent">{REASON[reason]}</span>」獲勝
        </p>
      )}
      {reward &&
        (reward.capped ? (
          <p style={{ textAlign: 'center', color: 'var(--parch-muted)', fontWeight: 700, fontSize: 14, margin: '2px 0' }}>
            今日真人對戰獎勵已領滿
          </p>
        ) : (
          <p
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              gap: 6,
              textAlign: 'center',
              color: 'var(--wood-text)',
              fontWeight: 900,
              margin: '2px 0',
            }}
          >
            <span>對戰勝利 +{reward.amount} 💎</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--parch-muted)' }}>今日 {reward.count}/2</span>
          </p>
        ))}
      {waiting ? (
        <p style={{ textAlign: 'center', color: '#1f9d57', fontWeight: 800 }}>等待對手同意再玩一場…</p>
      ) : foeWantsRematch ? (
        <p style={{ textAlign: 'center', color: '#b07d0c', fontWeight: 800 }}>對手想再玩一場！</p>
      ) : null}
      <div className="confirm__actions">
        <Button variant="secondary" onClick={onLeave}>
          離開
        </Button>
        <Button onClick={onRematch} disabled={waiting}>
          再玩一場
        </Button>
      </div>
    </Modal>
  )
}
