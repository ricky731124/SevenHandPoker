import type { CSSProperties } from 'react'
import { useCampaignStore } from '../../../state/campaignStore'
import { usePlatformStore } from '../../../state/platformStore'
import { getSpecialCard } from '../../../game/specialCards'
import { CAMPAIGN, type CampaignStage, type MatchResult } from '../../../game/campaign'
import PlayerAvatar, { AVATARS } from '../PlayerAvatar'
import { SpecialCardArt } from '../SpecialCard'
import Modal from '../Modal'
import Button from '../Button'
import Diamond from './Diamond'
import SeriesTrack from './SeriesTrack'
import './ChapterStageCard.css'

const STYLE_NAME = { attack: '強攻型', hoard: '囤牌型', balance: '平衡型' } as const

/** boss 牌風標籤:主策略取機率最高的那個。 */
function bossStyle(stage: CampaignStage): string {
  const m = stage.profile.pickMain
  const top = (Object.keys(m) as (keyof typeof m)[]).reduce((a, b) => (m[b] > m[a] ? b : a))
  return STYLE_NAME[top]
}

const chip: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3 }

/**
 * 章節大地圖點節點彈出的關卡資訊卡:boss、牌風、招牌卡(含效果)、三小關的房型/獎勵/進度。
 * 沒解鎖的也看得到全部內容(讓人有動力往前打),只是「進入」鎖住。
 */
export default function ChapterStageCard({
  stage,
  unlocked,
  tutorialSeen,
  onClose,
}: {
  stage: CampaignStage
  unlocked: boolean
  tutorialSeen: boolean
  onClose: () => void
}) {
  const openMap = useCampaignStore((s) => s.openMap)
  const clearedAt = usePlatformStore((s) => s.profile?.progress.stageClearedAt)
  const active = usePlatformStore((s) => s.profile?.progress.activeSeries)
  const card = getSpecialCard(stage.signatureCard)
  const prev = CAMPAIGN.find((s) => s.index === stage.index - 1)
  const lockedHint = stage.index === 1 && !tutorialSeen ? '先完成新手教學' : `打完第 ${prev?.index ?? stage.index - 1} 關解鎖`

  return (
    <Modal open onClose={onClose} onBack={onClose} title={`第 ${stage.index} 關 · ${stage.name}`} width={600} panelClass="cscard-panel">
      <div className={`cscard${unlocked ? '' : ' is-locked'}`}>
        <div className="cscard__boss">
          <div className="cscard__avatar">
            <PlayerAvatar avatarId={stage.bossAvatar} size={92} />
            {!unlocked && <span className="cscard__lock">🔒</span>}
          </div>
          <b className="cscard__boss-name">{stage.bossName}</b>
          <span className="cscard__style">{bossStyle(stage)}</span>
        </div>

        <div className="cscard__info">
          {card && (
            <div className="cscard__sig" style={{ borderColor: card.accent }}>
              <span className="cscard__sig-art">
                <SpecialCardArt id={card.id} color={card.accent} uid={`cscard-${card.id}`} />
              </span>
              <span className="cscard__sig-text">
                <span className="cscard__sig-label">招牌卡</span>
                <b>{card.name}</b>
                <small>{card.desc}</small>
              </span>
            </div>
          )}

          <ul className="cscard__subs">
            {stage.subStages.map((sub) => {
              const done = !!clearedAt?.[sub.id]
              const inProgress = active?.subId === sub.id && active.results.length > 0
              const r = sub.reward
              const rc = r.card ? getSpecialCard(r.card) : undefined
              const ra = r.avatar ? AVATARS.find((a) => a.id === r.avatar) : undefined
              return (
                <li key={sub.id} className={done ? 'is-done' : ''}>
                  <span className="cscard__sub-label">{sub.label}</span>
                  <span className="cscard__sub-rule">
                    {sub.special ? '特殊牌房' : '一般房'} · {sub.winsNeeded >= 3 ? '五戰三勝' : '三戰兩勝'}
                  </span>
                  <span className="cscard__sub-reward">
                    {rc && <span style={chip}>「{rc.name}」</span>}
                    {ra && <span style={chip}>頭像「{ra.name}」</span>}
                    <span style={chip}>
                      <Diamond size={14} />
                      {r.diamonds}
                    </span>
                  </span>
                  <span className="cscard__sub-state">
                    {done ? (
                      <span className="cscard__ok">✓</span>
                    ) : inProgress ? (
                      <SeriesTrack bestOf={sub.bestOf} results={active!.results as MatchResult[]} size={14} />
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      <div className="confirm__actions">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        {unlocked ? (
          <Button onClick={() => openMap(stage.id)}>進入</Button>
        ) : (
          <Button disabled>🔒 {lockedHint}</Button>
        )}
      </div>
    </Modal>
  )
}
