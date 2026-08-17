import { useCampaignStore } from '../../../state/campaignStore'
import { nextSubStageId, seriesWins } from '../../../game/campaign'
import { getSpecialCard } from '../../../game/specialCards'
import PlayerAvatar, { AVATARS } from '../PlayerAvatar'
import Modal from '../Modal'
import Button from '../Button'
import Diamond from './Diamond'
import SeriesTrack from './SeriesTrack'
import type { PlayerId } from '../../../game/state'

/**
 * Between-match / end-of-series screen for a campaign BO series.
 *  - ongoing → 繼續下一場 / 放棄重打, with the ✓/✗ track
 *  - won     → 通關 + first-clear reward reveal → 回關卡地圖
 *  - lost    → 重新挑戰 (0-0) / 離開
 */
export default function CampaignEndModal({ open, winner, me }: { open: boolean; winner: PlayerId | null; me: PlayerId }) {
  const series = useCampaignStore((s) => s.series)
  const outcome = useCampaignStore((s) => s.outcome)
  const reward = useCampaignStore((s) => s.reward)
  const nextMatch = useCampaignStore((s) => s.nextMatch)
  const surrender = useCampaignStore((s) => s.surrender)
  const goNextStage = useCampaignStore((s) => s.goNextStage)
  const exit = useCampaignStore((s) => s.exit)
  if (!series) return null
  const hasNextStage = !!nextSubStageId(series.subId)

  const iWon = winner === me
  const { mine, boss } = seriesWins(series)
  const title =
    outcome === 'won' ? '通關！' : outcome === 'lost' ? '挑戰失敗' : iWon ? '這場你贏了！' : '這場輸了'

  return (
    <Modal
      open={open}
      locked
      width={430}
      largeTitle
      title={
        <span className={`end__head ${outcome === 'lost' || (outcome === 'ongoing' && !iWon) ? 'end__head--lose' : 'end__head--win'}`}>
          {title}
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
        <SeriesTrack bestOf={series.bestOf} results={series.results} size={26} />
        <span style={{ fontWeight: 800, color: 'var(--parch-text)' }}>
          比數 <span className="accent">{mine}</span> – <span className="accent">{boss}</span>
          <span style={{ opacity: 0.7, fontSize: 14 }}>（先 {series.winsNeeded} 勝）</span>
        </span>
      </div>

      {outcome === 'won' && reward && <RewardReveal reward={reward} />}
      {outcome === 'won' && !reward && (
        <p style={{ textAlign: 'center', color: 'var(--parch-text)', opacity: 0.75 }}>重打通關，無額外獎勵</p>
      )}

      {outcome === 'ongoing' ? (
        <div className="confirm__actions">
          <Button variant="secondary" onClick={exit}>
            先休息
          </Button>
          <Button onClick={nextMatch}>繼續下一場</Button>
        </div>
      ) : outcome === 'won' ? (
        <div className="confirm__actions">
          <Button variant="secondary" onClick={exit}>
            回關卡地圖
          </Button>
          {hasNextStage && <Button onClick={goNextStage}>前往下一關</Button>}
        </div>
      ) : (
        <div className="confirm__actions">
          <Button variant="secondary" onClick={exit}>
            離開
          </Button>
          <Button onClick={surrender}>重新挑戰</Button>
        </div>
      )}
    </Modal>
  )
}

function RewardReveal({ reward }: { reward: { card?: string; avatar?: string; diamonds: number } }) {
  const card = reward.card ? getSpecialCard(reward.card) : undefined
  const avatar = reward.avatar ? AVATARS.find((a) => a.id === reward.avatar) : undefined
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, margin: '6px 0 2px' }}>
      <div style={{ fontWeight: 900, color: 'var(--parch-text)' }}>解鎖獎勵</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        {card && (
          <span
            style={{
              fontWeight: 800,
              color: 'var(--parch-text)',
              background: 'rgba(255,255,255,0.5)',
              border: `2px solid ${card.accent}`,
              borderRadius: 999,
              padding: '4px 12px',
            }}
          >
            特殊牌「{card.name}」
          </span>
        )}
        {avatar && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, color: 'var(--parch-text)' }}>
            <PlayerAvatar avatarId={avatar.id} size={40} />
            {avatar.name}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, color: '#1f4e79' }}>
          <Diamond size={20} /> {reward.diamonds} 鑽石
        </span>
      </div>
    </div>
  )
}
