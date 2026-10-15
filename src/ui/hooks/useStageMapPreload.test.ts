import { describe, it, expect } from 'vitest'
import { frontierStage } from './useStageMapPreload'
import { ALL_SUB_STAGE_IDS, CAMPAIGN } from '../../game/campaign'

const upTo = (id: string) => ALL_SUB_STAGE_IDS.slice(0, ALL_SUB_STAGE_IDS.indexOf(id) + 1)

describe('關卡地圖預載：接下來要打的那關', () => {
  it('什麼都沒打 → 第 1 關', () => expect(frontierStage([])?.index).toBe(1))
  it('打完 1-2 → 還是第 1 關(不先載第 2 關)', () => expect(frontierStage(upTo('s1-2'))?.index).toBe(1))
  it('打完 7-2 → 第 7 關', () => expect(frontierStage(upTo('s7-2'))?.index).toBe(7))
  it('打完 4-3 → 下一場是 5-1 → 第 5 關', () => expect(frontierStage(upTo('s4-3'))?.index).toBe(5))
  it('全破 → 沒有(點哪關再載)', () => expect(frontierStage(ALL_SUB_STAGE_IDS)).toBeNull())
  it('關卡 id 照 s{N}-{k} 命名(預載靠這個順序)', () => expect(CAMPAIGN.every((s) => s.subStages[0].id === `s${s.index}-1`)).toBe(true))
})
