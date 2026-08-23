import { useAppStore } from '../../state/appStore'
import { useCampaignStore } from '../../state/campaignStore'
import { usePlatformStore } from '../../state/platformStore'
import { CAMPAIGN, isStageUnlocked } from '../../game/campaign'
import Button from '../components/Button'
import BackButton from '../components/BackButton'
import './CampaignStages.css'

/**
 * 主線任務 stage list: 新手教學 + the boss 大關 (哪裡來的鎹鴉? / 明天開始168 / 魚與熊掌我全都要 …),
 * each gated by clearing the previous stage. Its own screen so the map's back
 * button returns here (not to the main menu). See campaign flow in campaignStore.
 */
export default function CampaignStages() {
  const go = useAppStore((s) => s.go)
  const openMap = useCampaignStore((s) => s.openMap)
  const clearedAt = usePlatformStore((s) => s.profile?.progress.stageClearedAt)
  const tutorialSeen = usePlatformStore((s) => s.profile?.tutorialSeen ?? false)
  const clearedIds = Object.keys(clearedAt ?? {})

  return (
    <div className="cstages">
      <div className="cstages__panel">
        <div className="cstages__titlebar">
          <BackButton onClick={() => go('menu')} className="cstages__backbtn" />
          <h2 className="cstages__title">主線任務</h2>
        </div>
        <div className="cstages__list">
          <Button full onClick={() => go('tutorial')}>
            新手教學
          </Button>
          {CAMPAIGN.map((stage) => {
            const unlocked = isStageUnlocked(stage, clearedIds, tutorialSeen)
            return (
              <Button key={stage.id} full disabled={!unlocked} onClick={() => openMap(stage.id)}>
                第 {stage.index} 關 · {stage.name}
                {!unlocked && '（未解鎖）'}
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
