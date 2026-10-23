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
    // x = (平台左側投影的左緣 + 右側石框外緣) / 2:頭像要左右對稱蓋住投影跟石框(2026-10-23 程式量,
    // 投影約 5px、石框約 10px@2146 寬;第 4 關石框跟沙地同色、量的時候已含在沙地裡,維持原值);y = 沙地中心。
    nodes: [
      { x: 18.17, y: 49.6 },
      { x: 31.15, y: 53.8 },
      { x: 41.12, y: 59.3 },
      { x: 50.05, y: 51 },
      { x: 61.72, y: 53 },
      { x: 72.65, y: 45.5 },
      { x: 83.15, y: 50.9 },
    ],
    tutorial: { x: 26.5, y: 22.8 },
  },
  {
    index: 2,
    name: '種子選拔賽',
    nodes: [
      { x: 19.08, y: 49.4 },
      { x: 34.04, y: 53.3 },
      { x: 44.38, y: 58.9 },
      { x: 54.96, y: 51.2 },
      { x: 66.33, y: 54.7 },
      { x: 77.91, y: 51.4 },
      { x: 88.82, y: 55.4 },
    ],
  },
  {
    index: 3,
    name: '撲克王大賽',
    nodes: [
      // 第三章金框平台比較大、左邊是紅地毯(量不準投影),先用一般投影寬校準;做到第 15 關時要再確認頭像蓋不蓋得住
      { x: 18.76, y: 51.6 },
      { x: 30.62, y: 56.1 },
      { x: 41.5, y: 60.3 },
      { x: 51.33, y: 53.5 },
      { x: 61.83, y: 61.1 },
      { x: 74.02, y: 60.7 },
      { x: 86.63, y: 52.8 },
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

/** 進主線時要看哪裡:從小關地圖返回 → 那一關;從新手教學回來 → 第一章的教學木牌(不管進度到第幾章);
 *  否則 → 玩家現在該打的地方。 */
export function initialFocus(viewStageId: string | null, clearedIds: string[], tutorialSeen: boolean, fromTutorial = false): MapFocus {
  const st = viewStageId ? getStage(viewStageId) : undefined
  if (st) return { chapter: chapterIndexOfStage(st.index), target: st.id }
  if (fromTutorial) return { chapter: 1, target: 'tutorial' }
  return frontierFocus(clearedIds, tutorialSeen)
}

/** 從第 1 關起,連續「三小關全過」打到第幾關(0 = 一關都還沒全破)。 */
export function lastClearedStageIndex(clearedIds: Iterable<string>): number {
  const set = new Set(clearedIds)
  let n = 0
  for (const s of [...CAMPAIGN].sort((a, b) => a.index - b.index)) {
    if (!s.subStages.every((ss) => set.has(ss.id))) break
    n = s.index
  }
  return n
}

/**
 * 解鎖動畫(2026-10-23 使用者定):打完某關 x-3(整隻 boss)才播,x-1/x-2 不播。
 * `seen` = 這台裝置上次在大地圖「看過動畫」時已打完到第幾關(localStorage;null = 第一次,不補播舊的)。
 * 有新打完的關 → 回傳要從哪關播到哪關(下一關還沒做 = to 為 undefined,只蓋章)。
 */
export function pendingUnlock(
  clearedIds: Iterable<string>,
  seen: number | null,
): { from: CampaignStage; to?: CampaignStage } | null {
  const last = lastClearedStageIndex(clearedIds)
  if (seen == null || last <= seen || last === 0) return null
  const from = CAMPAIGN.find((s) => s.index === last)
  if (!from) return null
  return { from, to: CAMPAIGN.find((s) => s.index === last + 1) }
}

/** 切到某章時捲到哪:玩家現在所在的章 → 現在那關;其他(已全破)的章 → 最左邊開頭。 */
export function focusForChapter(chapter: number, clearedIds: string[], tutorialSeen: boolean): MapFocus | { chapter: number; target: 'start' } {
  const f = frontierFocus(clearedIds, tutorialSeen)
  return f.chapter === chapter ? f : { chapter, target: 'start' }
}
