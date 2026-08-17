import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { createGame } from './state'
import { detectUnlocks, matchHandTypeCounts, tierFor, type AchMetric } from './achievements'

const c = (suit: Suit, rank: Rank): Card => ({ id: `${suit}${rank}`, suit, rank })

const METRICS = (over: Partial<Record<AchMetric, number>> = {}): Record<AchMetric, number> => ({
  streak: 0, games: 0, wins: 0, soloGames: 0, soloWins: 0, flush: 0, fullHouse: 0, quads: 0, straightFlush: 0, sfDuel: 0, ...over,
})

describe('tierFor — 銅/銀/金 門檻', () => {
  const th: [number, number, number] = [3, 5, 10]
  it('未達銅=0', () => expect(tierFor(2, th)).toBe(0))
  it('達銅=1', () => expect(tierFor(3, th)).toBe(1))
  it('達銀=2', () => expect(tierFor(5, th)).toBe(2))
  it('達金=3', () => expect(tierFor(10, th)).toBe(3))
  it('超過金仍=3', () => expect(tierFor(99, th)).toBe(3))
})

describe('matchHandTypeCounts — 數這場我放了幾組各牌型', () => {
  it('同花/葫蘆/鐵支/同花順 各一組', () => {
    const g = createGame(1, 'p1')
    const slots = g.slots.map((s) => ({ ...s, p1: [] as Card[], p2: [] as Card[], owner: null }))
    slots[0].p2 = [c('C', 2), c('C', 5), c('C', 7), c('C', 9), c('C', 13)] // flush
    slots[1].p2 = [c('S', 3), c('H', 3), c('D', 3), c('S', 6), c('H', 6)] // full house
    slots[2].p2 = [c('S', 8), c('H', 8), c('D', 8), c('C', 8)] // quads
    slots[3].p2 = [c('C', 4), c('C', 5), c('C', 6), c('C', 7), c('C', 8)] // straight flush
    g.slots = slots
    expect(matchHandTypeCounts(g, 'p2')).toEqual({ flush: 1, fullHouse: 1, quads: 1, straightFlush: 1 })
  })

  it('兩組同花 → flush=2;空格不計', () => {
    const g = createGame(1, 'p1')
    const slots = g.slots.map((s) => ({ ...s, p1: [] as Card[], p2: [] as Card[], owner: null }))
    slots[0].p2 = [c('C', 2), c('C', 5), c('C', 7), c('C', 9), c('C', 13)]
    slots[1].p2 = [c('H', 2), c('H', 5), c('H', 8), c('H', 10), c('H', 12)]
    g.slots = slots
    expect(matchHandTypeCounts(g, 'p2').flush).toBe(2)
  })
})

describe('detectUnlocks — 只在跳到更高階時通知', () => {
  it('首次達成:連勝銀(5) + 同花銅(2)', () => {
    const { updated, newly } = detectUnlocks({}, METRICS({ streak: 5, flush: 2 }))
    expect(updated.streak).toBe(2)
    expect(updated.flush).toBe(1)
    expect(newly.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'flush', tier: 1 },
      { id: 'streak', tier: 2 },
    ])
  })

  it('已解鎖同階 → 不再通知', () => {
    const { newly } = detectUnlocks({ streak: 2 }, METRICS({ streak: 6 }))
    expect(newly).toEqual([]) // 6 still silver, already had silver
  })

  it('跨階直上金 → 通知一次金', () => {
    const { updated, newly } = detectUnlocks({ streak: 1 }, METRICS({ streak: 10 }))
    expect(updated.streak).toBe(3)
    expect(newly).toEqual([{ id: 'streak', tier: 3 }])
  })
})
