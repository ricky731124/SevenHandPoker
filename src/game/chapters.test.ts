import { describe, it, expect } from 'vitest'
import { ALL_SUB_STAGE_IDS, CAMPAIGN } from './campaign'
import {
  CHAPTERS,
  CHAPTER_SIZE,
  chapterClearedCount,
  chapterIndexOfStage,
  chapterStages,
  focusForChapter,
  frontierFocus,
  getChapter,
  initialFocus,
  isChapterUnlocked,
} from './chapters'
import { campaignPreloadQueue } from '../ui/hooks/useStageMapPreload'

const upTo = (id: string) => ALL_SUB_STAGE_IDS.slice(0, ALL_SUB_STAGE_IDS.indexOf(id) + 1)
const ch = (n: number) => getChapter(n)!

describe('章節資料', () => {
  it('每章剛好 7 個平台、座標在圖內', () => {
    for (const c of CHAPTERS) {
      expect(c.nodes).toHaveLength(CHAPTER_SIZE)
      for (const p of c.nodes) {
        expect(p.x).toBeGreaterThan(10) // 最左 10% 被章節按鈕蓋住,不放節點
        expect(p.x).toBeLessThan(100)
        expect(p.y).toBeGreaterThan(20)
        expect(p.y).toBeLessThan(85)
      }
    }
  })
  it('第 N 關屬於第 ceil(N/7) 章', () => {
    expect(chapterIndexOfStage(1)).toBe(1)
    expect(chapterIndexOfStage(7)).toBe(1)
    expect(chapterIndexOfStage(8)).toBe(2)
    expect(chapterIndexOfStage(14)).toBe(2)
    expect(chapterIndexOfStage(15)).toBe(3)
  })
  it('現有每一關都掛在某章的某個位置上(新關卡自動掛)', () => {
    for (const s of CAMPAIGN) {
      const c = ch(chapterIndexOfStage(s.index))
      expect(chapterStages(c)).toContain(s)
    }
  })
  it('第二章現在有第 8、9 關,其餘位置是敬請期待', () => {
    const st = chapterStages(ch(2))
    expect(st[0]?.index).toBe(8)
    expect(st[1]?.index).toBe(9)
    expect(st.filter(Boolean).length).toBe(CAMPAIGN.filter((s) => s.index >= 8 && s.index <= 14).length)
  })
})

describe('章節解鎖', () => {
  it('第一章永遠開(新手教學在裡面)', () => expect(isChapterUnlocked(ch(1), [], false)).toBe(true))
  it('第 7 關還沒全破 → 第二章鎖住', () => expect(isChapterUnlocked(ch(2), upTo('s7-2'), true)).toBe(false))
  it('7-3 打完 → 第二章開', () => expect(isChapterUnlocked(ch(2), upTo('s7-3'), true)).toBe(true))
  it('第三章還沒有關卡 → 鎖住', () => expect(isChapterUnlocked(ch(3), ALL_SUB_STAGE_IDS, true)).toBe(false))
  it('通關數只算三小關全過的', () => {
    expect(chapterClearedCount(ch(1), upTo('s2-2'))).toBe(1)
    expect(chapterClearedCount(ch(1), upTo('s7-3'))).toBe(7)
  })
})

describe('進場/切章要看哪裡', () => {
  it('還沒看過新手教學 → 第一章的新手教學', () => expect(frontierFocus([], false)).toEqual({ chapter: 1, target: 'tutorial' }))
  it('看過教學、什麼都沒打 → 第 1 關', () => expect(frontierFocus([], true)).toEqual({ chapter: 1, target: 's1' }))
  it('打到 8-2 → 第二章第 8 關', () => expect(frontierFocus(upTo('s8-1'), true)).toEqual({ chapter: 2, target: 's8' }))
  it('全破 → 最後一關', () => {
    const last = CAMPAIGN[CAMPAIGN.length - 1]
    expect(frontierFocus(ALL_SUB_STAGE_IDS, true)).toEqual({ chapter: chapterIndexOfStage(last.index), target: last.id })
  })
  it('從小關地圖返回 → 剛剛那關(不是進度最前面)', () =>
    expect(initialFocus('s3', upTo('s8-1'), true)).toEqual({ chapter: 1, target: 's3' }))
  it('從新手教學回來 → 第一章教學木牌(就算進度在第二章)', () =>
    expect(initialFocus(null, upTo('s8-1'), true, true)).toEqual({ chapter: 1, target: 'tutorial' }))
  it('切到現在所在的章 → 現在那關;切到別章 → 最左邊', () => {
    expect(focusForChapter(2, upTo('s8-1'), true)).toEqual({ chapter: 2, target: 's8' })
    expect(focusForChapter(1, upTo('s8-1'), true)).toEqual({ chapter: 1, target: 'start' })
  })
})

describe('進主線後的預載順序', () => {
  it('先載已解鎖的章,再載小關圖;沒解鎖的章不載', () => {
    const q = campaignPreloadQueue(upTo('s7-1'), true)
    expect(q[0]).toMatch(/chapters\/ch1\.webp$/)
    expect(q.some((u) => u.includes('chapters/ch2'))).toBe(false)
    expect(q.some((u) => u.includes('maps/stage8'))).toBe(false)
    const q2 = campaignPreloadQueue(upTo('s7-3'), true)
    expect(q2.slice(0, 2).map((u) => u.match(/ch\d/)?.[0])).toEqual(['ch1', 'ch2'])
  })
})
