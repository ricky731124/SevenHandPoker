/**
 * 主線章節(2026-10-16 使用者定案)— GAME CONTENT。每 7 個大關一章,一章一張橫向長圖
 * (public/chapters/ch{N}.webp,母檔 art/chapters/ch{N}.png,跑 scripts/chapter-art.mjs 重產)。
 * 第 N 關屬於第 ceil(N/7) 章、是那章的第 ((N-1)%7)+1 個節點 —— 新關卡加進 CAMPAIGN 就自動掛上去,
 * 這裡只放每章的名字跟 7 個平台在圖上的位置。還沒做的關卡位置顯示「敬請期待」。
 *
 * 解鎖不另存資料:第一章永遠開(新手教學在裡面);之後的章 = 該章第一關解鎖了(上一章最後一關打完)。
 */

import { ALL_SUB_STAGE_IDS, CAMPAIGN, getStage, isStageUnlocked, type CampaignStage } from './campaign'

export const CHAPTER_SIZE = 7
/** 三張章節圖的長寬比(母檔 2146×733)。 */
export const CHAPTER_MAP_ASPECT = 2146 / 733

export interface Chapter {
  /** 1-based */
  index: number
  name: string
  /** 7 個平台中心在圖上的位置(0..100 %,對齊圖) */
  nodes: { x: number; y: number }[]
  /** 新手教學木牌(只有第一章) */
  tutorial?: { x: number; y: number }
}

export const CHAPTERS: Chapter[] = [
  {
    index: 1,
    name: '新手娛樂城',
    nodes: [
      { x: 18.3, y: 49.8 },
      { x: 31.3, y: 54.2 },
      { x: 42, y: 59.3 },
      { x: 50.3, y: 51.2 },
      { x: 61.8, y: 53.4 },
      { x: 72.8, y: 45.4 },
      { x: 83.3, y: 51.2 },
    ],
    tutorial: { x: 26.5, y: 22.8 },
  },
  {
    index: 2,
    name: '種子選拔賽',
    nodes: [
      { x: 19.3, y: 49.8 },
      { x: 34, y: 53.4 },
      { x: 44.5, y: 58.6 },
      { x: 55, y: 51.2 },
      { x: 66.3, y: 54.9 },
      { x: 78, y: 52 },
      { x: 88.8, y: 55.6 },
    ],
  },
  {
    index: 3,
    name: '撲克王大賽',
    nodes: [
      { x: 19.3, y: 52 },
      { x: 31, y: 56.4 },
      { x: 42, y: 60.8 },
      { x: 51.8, y: 54.2 },
      { x: 62.3, y: 60.8 },
      { x: 74.5, y: 60.8 },
      { x: 87, y: 53.4 },
    ],
  },
]

export const CHAPTER_NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

export const chapterMapUrl = (ch: Chapter) => `${import.meta.env.BASE_URL}chapters/ch${ch.index}.webp`

export function chapterIndexOfStage(stageIndex: number): number {
  return Math.ceil(stageIndex / CHAPTER_SIZE)
}

export function getChapter(index: number): Chapter | undefined {
  return CHAPTERS.find((c) => c.index === index)
}

/** 這章 7 個位置各是哪一關(還沒做的 = undefined)。 */
export function chapterStages(ch: Chapter): (CampaignStage | undefined)[] {
  const first = (ch.index - 1) * CHAPTER_SIZE + 1
  return Array.from({ length: CHAPTER_SIZE }, (_, i) => CAMPAIGN.find((s) => s.index === first + i))
}

export function isChapterUnlocked(ch: Chapter, clearedIds: Iterable<string>, tutorialSeen: boolean): boolean {
  if (ch.index === 1) return true
  const first = chapterStages(ch)[0]
  return !!first && isStageUnlocked(first, clearedIds, tutorialSeen)
}

/** 這章打完幾關(三小關全過才算)。 */
export function chapterClearedCount(ch: Chapter, clearedIds: Iterable<string>): number {
  const set = new Set(clearedIds)
  return chapterStages(ch).filter((s) => s && s.subStages.every((ss) => set.has(ss.id))).length
}

/** 玩家現在「該打的地方」:還沒看過新手教學 → 教學;否則第一個還沒過的小關所在的大關;全破 → 最後一關。 */
export type MapFocus = { chapter: number; target: 'tutorial' | string }

export function frontierFocus(clearedIds: string[], tutorialSeen: boolean): MapFocus {
  if (!tutorialSeen) return { chapter: 1, target: 'tutorial' }
  const set = new Set(clearedIds)
  const subId = ALL_SUB_STAGE_IDS.find((id) => !set.has(id))
  const stage = subId ? CAMPAIGN.find((s) => s.subStages.some((ss) => ss.id === subId)) : CAMPAIGN[CAMPAIGN.length - 1]
  const st = stage ?? CAMPAIGN[0]
  return { chapter: chapterIndexOfStage(st.index), target: st.id }
}

/** 進主線時要看哪裡:從小關地圖返回 → 那一關;否則 → 玩家現在該打的地方。 */
export function initialFocus(viewStageId: string | null, clearedIds: string[], tutorialSeen: boolean): MapFocus {
  const st = viewStageId ? getStage(viewStageId) : undefined
  if (st) return { chapter: chapterIndexOfStage(st.index), target: st.id }
  return frontierFocus(clearedIds, tutorialSeen)
}

/** 切到某章時捲到哪:玩家現在所在的章 → 現在那關;其他(已全破)的章 → 最左邊開頭。 */
export function focusForChapter(chapter: number, clearedIds: string[], tutorialSeen: boolean): MapFocus | { chapter: number; target: 'start' } {
  const f = frontierFocus(clearedIds, tutorialSeen)
  return f.chapter === chapter ? f : { chapter, target: 'start' }
}
