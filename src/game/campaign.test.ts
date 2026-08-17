import { describe, expect, it } from 'vitest'
import {
  advanceSeries,
  getStage,
  getSubStage,
  isSubStageUnlocked,
  newSeries,
  nextPlayableSub,
  rewardForClear,
  seriesWins,
  type SeriesState,
} from './campaign'

const sub = (id: string) => getSubStage(id)!.sub

/** Fold a sequence of results (true=my win) through advanceSeries. */
function playOut(start: SeriesState, results: boolean[]) {
  let series = start
  let outcome: ReturnType<typeof advanceSeries>['outcome'] = 'ongoing'
  for (const w of results) {
    if (outcome !== 'ongoing') break
    ;({ series, outcome } = advanceSeries(series, w))
  }
  return { series, outcome }
}

describe('BO 系列賽 advanceSeries', () => {
  it('x-1/x-2 = BO3 先2勝', () => {
    const s = newSeries(sub('s1-1'))
    expect(s.winsNeeded).toBe(2)
    expect(playOut(s, [true, true]).outcome).toBe('won')
    expect(playOut(s, [false, false]).outcome).toBe('lost')
    expect(playOut(s, [true, false, true]).outcome).toBe('won')
    expect(playOut(s, [false, true, false]).outcome).toBe('lost')
  })

  it('x-3 = BO5 先3勝', () => {
    const s = newSeries(sub('s1-3'))
    expect(s.winsNeeded).toBe(3)
    expect(playOut(s, [true, true, true]).outcome).toBe('won')
    expect(playOut(s, [false, false, false]).outcome).toBe('lost')
    const decider = playOut(s, [true, false, true, false, true])
    expect(decider.outcome).toBe('won')
    expect(seriesWins(decider.series)).toEqual({ mine: 3, boss: 2 })
  })

  it('決勝後不再累加(playOut 在決定後停止)', () => {
    const s = newSeries(sub('s1-1'))
    const r = playOut(s, [true, true, true])
    expect(seriesWins(r.series).mine).toBe(2) // stopped at 2, not 3
  })
})

describe('解鎖 gating', () => {
  it('第一關第一小關永遠可打', () => {
    expect(isSubStageUnlocked('s1-1', [])).toBe(true)
  })
  it('小關要前一關過了才解鎖', () => {
    expect(isSubStageUnlocked('s1-2', [])).toBe(false)
    expect(isSubStageUnlocked('s1-2', ['s1-1'])).toBe(true)
  })
  it('跨大關:2-1 要 1-3 過了才解鎖', () => {
    expect(isSubStageUnlocked('s2-1', ['s1-1', 's1-2'])).toBe(false)
    expect(isSubStageUnlocked('s2-1', ['s1-1', 's1-2', 's1-3'])).toBe(true)
  })
  it('已過的關永遠可回打', () => {
    expect(isSubStageUnlocked('s1-3', ['s1-3'])).toBe(true)
  })
})

describe('nextPlayableSub — 點大關接到下一個沒過的小關', () => {
  const s1 = getStage('s1')!
  it('全新 → 1-1', () => expect(nextPlayableSub(s1, []).id).toBe('s1-1'))
  it('過了 1-1/1-2 → 1-3', () => expect(nextPlayableSub(s1, ['s1-1', 's1-2']).id).toBe('s1-3'))
  it('全過 → 最後一關(重打)', () => expect(nextPlayableSub(s1, ['s1-1', 's1-2', 's1-3']).id).toBe('s1-3'))
})

describe('首次過關才給獎勵', () => {
  it('首次 → 給該小關獎勵', () => {
    const s = sub('s1-3')
    expect(rewardForClear(s, false)).toEqual(s.reward)
    expect(rewardForClear(s, false)?.avatar).toBe('bird')
  })
  it('重打 → 無獎勵', () => {
    expect(rewardForClear(sub('s1-3'), true)).toBeNull()
  })
})
