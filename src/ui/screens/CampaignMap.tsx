import { useAppStore } from '../../state/appStore'
import { useCampaignStore } from '../../state/campaignStore'
import { usePlatformStore } from '../../state/platformStore'
import { getStage, isSubStageUnlocked, type MatchResult, type SubStage } from '../../game/campaign'
import { getSpecialCard } from '../../game/specialCards'
import PlayerAvatar from '../components/PlayerAvatar'
import { SpecialCardArt } from '../components/SpecialCard'
import Diamond from '../components/game/Diamond'
import SeriesTrack from '../components/game/SeriesTrack'
import StartConfirm from '../components/game/StartConfirm'
import { sfx } from '../../audio/sfx'
import './CampaignMap.css'

/**
 * A 大關's map: sub-stage nodes (1-1/1-2/1-3) over the stage art. Each node
 * shows what it unlocks (diamond / card / avatar) so you see it at a glance; an
 * in-progress series shows its ✓/✗ track. Clicking an unlocked node opens the
 * pre-match (or resume) dialog. Locked nodes need the previous one cleared.
 */
export default function CampaignMap() {
  const stageId = useCampaignStore((s) => s.viewStageId)
  const openStart = useCampaignStore((s) => s.openStart)
  const pendingStart = useCampaignStore((s) => s.pendingStart)
  const go = useAppStore((s) => s.go)
  const clearedAt = usePlatformStore((s) => s.profile?.progress.stageClearedAt)
  const tutorialSeen = usePlatformStore((s) => s.profile?.tutorialSeen ?? false)
  const active = usePlatformStore((s) => s.profile?.progress.activeSeries)

  const stage = stageId ? getStage(stageId) : undefined
  if (!stage) {
    return (
      <div className="cmap">
        <BackButton onClick={() => go('campaignStages')} />
      </div>
    )
  }

  const clearedIds = Object.keys(clearedAt ?? {})
  const bg = `${import.meta.env.BASE_URL}maps/stage${stage.index}.png`
  const pts = stage.nodePositions.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="cmap">
      <div className="cmap__bg" style={{ backgroundImage: `url(${bg})` }} />
      <div className="cmap__veil" />
      {/* Hide the map's back button while the start dialog is open, so only the
          dialog's own back button is active (its scrim covers the map). */}
      {!pendingStart && <BackButton onClick={() => go('campaignStages')} />}
      <div className="cmap__title">{stage.name}</div>

      <svg className="cmap__path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <polyline points={pts} />
      </svg>

      {stage.subStages.map((sub, i) => {
        const pos = stage.nodePositions[i]
        const unlocked = isSubStageUnlocked(sub.id, clearedIds, tutorialSeen)
        const done = clearedIds.includes(sub.id)
        const inProgress = active?.subId === sub.id && active.results.length > 0
        const state = done ? 'is-done' : unlocked ? 'is-open' : 'is-locked'
        return (
          <div key={sub.id} className="cmap__node-wrap" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
            <RewardHint sub={sub} />
            <button
              className={`cmap__node ${state}`}
              disabled={!unlocked}
              onClick={() => { sfx.click(); openStart(sub.id) }}
            >
              <span className="cmap__node-label">{sub.label}</span>
              {!unlocked && <span className="cmap__node-mark">🔒</span>}
            </button>
            {inProgress && <SeriesTrack bestOf={sub.bestOf} results={active!.results as MatchResult[]} size={22} />}
          </div>
        )
      })}

      <StartConfirm />
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="cmap__back" onClick={() => { sfx.click(); onClick() }} aria-label="返回" title="返回">
      <svg viewBox="0 0 24 24" width="26" height="26">
        <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

function RewardHint({ sub }: { sub: SubStage }) {
  const r = sub.reward
  const card = r.card ? getSpecialCard(r.card) : undefined
  return (
    <div className="cmap__reward">
      {card && (
        <span className="cmap__reward-card">
          <SpecialCardArt id={card.id} color={card.accent} uid={`map-${card.id}`} />
        </span>
      )}
      {r.avatar && (
        <span className="cmap__reward-av">
          <PlayerAvatar avatarId={r.avatar} size={42} />
        </span>
      )}
      <span className="cmap__reward-gem">
        <Diamond size={24} />
        <b>{r.diamonds}</b>
      </span>
    </div>
  )
}
