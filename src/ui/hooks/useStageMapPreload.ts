import { useEffect } from 'react'
import { useAppStore } from '../../state/appStore'
import { usePlatformStore } from '../../state/platformStore'
import { CAMPAIGN, ALL_SUB_STAGE_IDS, getSubStage, isStageUnlocked, type CampaignStage } from '../../game/campaign'

/**
 * 關卡地圖預載（2026-10 使用者定案）：
 *   - 先載「接下來正常要打的那關」(第一個還沒過的小關所在的大關)：開 app 穩定後就載，過關推進了就換載新的那關。
 *   - 其他已解鎖的關卡：進主線列表才開始，一張一張慢慢載。
 *   - 沒解鎖的不載。
 * 同一個頁面裡 <img> 載過的圖會直接沿用、不再問伺服器(GitHub Pages 只快取 10 分鐘，過了 CSS 背景會重問一次)，
 * 所以地圖用 <img> 顯示，預載過的關卡點進去就有圖，不會先閃底色。Image 物件留著不放，免得被回收。
 */

export const stageMapUrl = (stage: CampaignStage) => `${import.meta.env.BASE_URL}maps/stage${stage.index}.webp` // 網頁用 webp(~150KB);改圖後跑 build-img 重產

const START_DELAY_MS = 4000 // 開 app 先讓主畫面/大廳載完(大廳 3 秒後才開工)再載
const GAP_MS = 2500 // 其他關卡一張一張載的間隔

const loaded = new Map<string, HTMLImageElement>()

function preload(stage: CampaignStage): Promise<void> {
  const url = stageMapUrl(stage)
  if (loaded.has(url)) return Promise.resolve()
  const img = new Image()
  img.decoding = 'async'
  loaded.set(url, img)
  return new Promise((resolve) => {
    img.onload = img.onerror = () => resolve()
    img.src = url
  })
}

/** 接下來正常要打的大關：照全域順序第一個還沒過的小關所在的大關；全破 → null(都打過了，點哪關再載)。 */
export function frontierStage(clearedIds: string[]): CampaignStage | null {
  const set = new Set(clearedIds)
  const next = ALL_SUB_STAGE_IDS.find((id) => !set.has(id))
  return next ? getSubStage(next)?.stage ?? null : null
}

/** 掛在 App：開 app 後預載接下來那關；進主線列表後再慢慢載其他已解鎖的。 */
export function useStageMapPreload(): void {
  const clearedAt = usePlatformStore((s) => s.profile?.progress.stageClearedAt)
  const tutorialSeen = usePlatformStore((s) => s.profile?.tutorialSeen ?? false)
  const inCampaign = useAppStore((s) => s.screen === 'campaignStages' || s.screen === 'campaign')
  const clearedKey = Object.keys(clearedAt ?? {}).sort().join(',')

  // 接下來那關：開 app 等一下再載；之後過關推進了 → 馬上載新的那關
  useEffect(() => {
    const stage = frontierStage(clearedKey ? clearedKey.split(',') : [])
    if (!stage || loaded.has(stageMapUrl(stage))) return
    const wait = performance.now() < START_DELAY_MS ? START_DELAY_MS - performance.now() : 0
    const t = setTimeout(() => void preload(stage), wait)
    return () => clearTimeout(t)
  }, [clearedKey])

  // 進主線列表 → 其他已解鎖的一張一張慢慢載(離接下來那關近的先)
  useEffect(() => {
    if (!inCampaign) return
    const cleared = clearedKey ? clearedKey.split(',') : []
    const front = frontierStage(cleared)?.index ?? CAMPAIGN.length
    const queue = CAMPAIGN.filter((s) => isStageUnlocked(s, cleared, tutorialSeen) && !loaded.has(stageMapUrl(s)))
      .sort((a, b) => Math.abs(a.index - front) - Math.abs(b.index - front))
    let stopped = false
    let t: ReturnType<typeof setTimeout> | undefined
    const step = async () => {
      const s = queue.shift()
      if (!s || stopped) return
      await preload(s)
      if (!stopped) t = setTimeout(() => void step(), GAP_MS)
    }
    t = setTimeout(() => void step(), GAP_MS)
    return () => { stopped = true; clearTimeout(t) }
  }, [inCampaign, clearedKey, tutorialSeen])
}
