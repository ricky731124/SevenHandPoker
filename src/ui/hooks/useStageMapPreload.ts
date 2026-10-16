import { useEffect } from 'react'
import { useAppStore } from '../../state/appStore'
import { usePlatformStore } from '../../state/platformStore'
import { CAMPAIGN, ALL_SUB_STAGE_IDS, getSubStage, isStageUnlocked, type CampaignStage } from '../../game/campaign'
import { CHAPTERS, chapterMapUrl, chapterStages, frontierFocus, getChapter, isChapterUnlocked } from '../../game/chapters'

/**
 * 關卡地圖預載（2026-10 使用者定案）：
 *   - 先載「接下來正常要打的那關」(第一個還沒過的小關所在的大關)：開 app 穩定後就載，過關推進了就換載新的那關。
 *   - 其他已解鎖的關卡：進主線列表才開始，一張一張慢慢載。
 *   - 沒解鎖的不載。
 * 同一個頁面裡 <img> 載過的圖會直接沿用、不再問伺服器(GitHub Pages 只快取 10 分鐘，過了 CSS 背景會重問一次)，
 * 所以地圖用 <img> 顯示，預載過的關卡點進去就有圖，不會先閃底色。Image 物件留著不放，免得被回收。
 *
 * 章節大地圖(2026-10-16,每張 ~240KB)同一套:開 app 先載「玩家現在所在那章」(主線一進來就看到它),
 * 再載接下來那關的小關圖;進主線後先補其他已解鎖的章(切章要瞬間),再慢慢載其他小關圖。沒解鎖的章不載。
 */

export const stageMapUrl = (stage: CampaignStage) => `${import.meta.env.BASE_URL}maps/stage${stage.index}.webp` // 網頁用 webp(~150KB);改圖後跑 build-img 重產

const START_DELAY_MS = 4000 // 開 app 先讓主畫面/大廳載完(大廳 3 秒後才開工)再載
const GAP_MS = 2500 // 其他關卡一張一張載的間隔
const FIRST_IN_CAMPAIGN_MS = 800 // 進主線後第一張(別章的大地圖)先等畫面穩一下就載,切章才快

const loaded = new Map<string, HTMLImageElement>()

function preload(url: string): Promise<void> {
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

/** 進主線後要補載的圖(依序):其他已解鎖的章 → 已解鎖的小關圖(離接下來那關近的先)。 */
export function campaignPreloadQueue(cleared: string[], tutorialSeen: boolean): string[] {
  const front = frontierStage(cleared)?.index ?? CAMPAIGN.length
  const chapterUrls = CHAPTERS.filter((c) => !!chapterStages(c)[0] && isChapterUnlocked(c, cleared, tutorialSeen)).map(chapterMapUrl)
  const stageUrls = CAMPAIGN.filter((s) => isStageUnlocked(s, cleared, tutorialSeen))
    .sort((a, b) => Math.abs(a.index - front) - Math.abs(b.index - front))
    .map(stageMapUrl)
  return [...chapterUrls, ...stageUrls]
}

/** 掛在 App：開 app 後預載現在那章+接下來那關；進主線後再慢慢載其他已解鎖的。 */
export function useStageMapPreload(): void {
  const clearedAt = usePlatformStore((s) => s.profile?.progress.stageClearedAt)
  const tutorialSeen = usePlatformStore((s) => s.profile?.tutorialSeen ?? false)
  const inCampaign = useAppStore((s) => s.screen === 'campaignStages' || s.screen === 'campaign')
  const clearedKey = Object.keys(clearedAt ?? {}).sort().join(',')

  // 現在那章 + 接下來那關：開 app 等一下再載；之後過關推進了 → 馬上載新的
  useEffect(() => {
    const cleared = clearedKey ? clearedKey.split(',') : []
    const stage = frontierStage(cleared)
    const ch = getChapter(frontierFocus(cleared, tutorialSeen).chapter)
    const urls = [ch ? chapterMapUrl(ch) : '', stage ? stageMapUrl(stage) : ''].filter((u) => u && !loaded.has(u))
    if (!urls.length) return
    const wait = performance.now() < START_DELAY_MS ? START_DELAY_MS - performance.now() : 0
    let stopped = false
    const t = setTimeout(async () => {
      for (const u of urls) if (!stopped) await preload(u)
    }, wait)
    return () => { stopped = true; clearTimeout(t) }
  }, [clearedKey, tutorialSeen])

  // 進主線 → 其他已解鎖的章、小關圖一張一張慢慢載
  useEffect(() => {
    if (!inCampaign) return
    const queue = campaignPreloadQueue(clearedKey ? clearedKey.split(',') : [], tutorialSeen).filter((u) => !loaded.has(u))
    let stopped = false
    let t: ReturnType<typeof setTimeout> | undefined
    const step = async () => {
      const u = queue.shift()
      if (!u || stopped) return
      await preload(u)
      if (!stopped) t = setTimeout(() => void step(), GAP_MS)
    }
    t = setTimeout(() => void step(), FIRST_IN_CAMPAIGN_MS)
    return () => { stopped = true; clearTimeout(t) }
  }, [inCampaign, clearedKey, tutorialSeen])
}
