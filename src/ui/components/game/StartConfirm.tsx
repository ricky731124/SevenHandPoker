import { useState, type CSSProperties } from 'react'
import { useCampaignStore } from '../../../state/campaignStore'
import { usePlatformStore } from '../../../state/platformStore'
import { getSubStage, type MatchResult } from '../../../game/campaign'
import { getSpecialCard } from '../../../game/specialCards'
import { AVATARS } from '../PlayerAvatar'
import Modal from '../Modal'
import Button from '../Button'
import Diamond from './Diamond'
import SeriesTrack from './SeriesTrack'

const formatLabel = (winsNeeded: number) => (winsNeeded >= 3 ? '五戰三勝' : '三戰兩勝')

const chip: CSSProperties = {
  fontWeight: 800,
  color: 'var(--parch-text)',
  background: 'rgba(255,255,255,0.5)',
  border: '2px solid #b98a3a',
  borderRadius: 999,
  padding: '4px 12px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
}

/** Pre-match info dialog (fresh start) / resume dialog (in-progress series),
 *  opened from a map node. Plain-language room type + best-of + rewards. */
export default function StartConfirm() {
  const subId = useCampaignStore((s) => s.pendingStart)
  const cancel = useCampaignStore((s) => s.cancelStart)
  const start = useCampaignStore((s) => s.startSeries)
  const active = usePlatformStore((s) => s.profile?.progress.activeSeries)
  const clearedAt = usePlatformStore((s) => s.profile?.progress.stageClearedAt)
  const [confirmReset, setConfirmReset] = useState(false)
  if (!subId) return null
  const found = getSubStage(subId)
  if (!found) return null
  const { sub } = found

  const alreadyCleared = !!clearedAt?.[subId]
  const resuming = active?.subId === subId && active.results.length > 0
  const r = sub.reward
  const card = r.card ? getSpecialCard(r.card) : undefined
  const avatar = r.avatar ? AVATARS.find((a) => a.id === r.avatar) : undefined

  return (
    <Modal open onClose={cancel} title={`第 ${sub.label} 關`} width={440} largeTitle>
      {/* The resume view (放棄重打 / 繼續挑戰) has no 取消 button, so it keeps a ←.
          Every other view already has 取消 / 不要, so no back arrow needed. */}
      {resuming && !confirmReset && (
        <button
          onClick={cancel}
          aria-label="返回"
          title="返回"
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '2px solid var(--wood-edge)',
            background: 'linear-gradient(180deg, var(--wood-1), var(--wood-2))',
            color: 'var(--wood-text)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {confirmReset ? (
        <>
          <p style={{ textAlign: 'center', color: 'var(--parch-text)', fontWeight: 700, lineHeight: 1.6, margin: '4px 0 10px' }}>
            放棄第 {sub.label} 關目前的進度，比數會<span className="accent">重新計算</span>。確定嗎？
          </p>
          <div className="confirm__actions">
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              不要
            </Button>
            <Button onClick={() => start(subId, { reset: true })}>確定放棄</Button>
          </div>
        </>
      ) : (
        <>
          <p style={{ textAlign: 'center', fontWeight: 800, color: 'var(--parch-text)', margin: '0 0 2px' }}>
            {sub.special ? '特殊牌房 · 可帶 3 張特殊牌' : '一般房間 · 不能使用特殊牌'}
          </p>
          <p style={{ textAlign: 'center', fontWeight: 900, color: 'var(--parch-text)', fontSize: 19, margin: '0 0 4px' }}>
            {formatLabel(sub.winsNeeded)}
          </p>

          {resuming && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <span style={{ color: 'var(--parch-muted)', fontWeight: 700 }}>目前比數</span>
              <SeriesTrack bestOf={sub.bestOf} results={active!.results as MatchResult[]} size={20} />
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginBottom: 6 }}>
            <div style={{ fontWeight: 900, color: 'var(--parch-text)' }}>
              過關獎勵{alreadyCleared && <span style={{ color: 'var(--parch-muted)', fontWeight: 700, fontSize: 13 }}>（已獲得 · 重打無獎勵）</span>}
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                justifyContent: 'center',
                opacity: alreadyCleared ? 0.45 : 1,
                textDecoration: alreadyCleared ? 'line-through' : 'none',
              }}
            >
              {card && <span style={{ ...chip, borderColor: card.accent }}>解鎖特殊牌「{card.name}」</span>}
              {avatar && <span style={chip}>解鎖頭像「{avatar.name}」</span>}
              <span style={{ ...chip, borderColor: '#2b6cb0', color: '#1f4e79' }}>
                <Diamond size={16} /> {r.diamonds} 鑽石
              </span>
            </div>
          </div>

          <div className="confirm__actions">
            {resuming ? (
              <>
                <Button variant="secondary" onClick={() => setConfirmReset(true)}>
                  放棄重打
                </Button>
                <Button onClick={() => start(subId, { resume: true })}>繼續挑戰</Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={cancel}>
                  取消
                </Button>
                <Button onClick={() => start(subId)}>開始挑戰</Button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
