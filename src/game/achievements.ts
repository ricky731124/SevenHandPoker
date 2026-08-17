/**
 * Achievements (成就) — GAME CONTENT (每款遊戲重寫). Pure definitions + detection;
 * no React/Firebase. The portable machinery (persistence, notification queue,
 * display) lives in the platform/UI layers. Design locked with user 2026-08-08:
 *
 *  - 銅/銀/金 三階,每個成就「家族」一個圖示 + 階級換顏色(不用畫很多徽章)。
 *  - 連勝 / 遊玩 / 勝場 = 真人(pvp)才計(打電腦不計);牌型 = 全模式都計。
 *  - 「單場打出 N 組同花」= 一場對局中,我放置的 7 疊裡有 N 疊是該牌型
 *    (同花順自成一類,不計入同花)。
 */
import { CATEGORY, evaluate } from './evaluate'
import type { Card } from './cards'
import type { GameState, PlayerId } from './state'

export type AchTier = 0 | 1 | 2 | 3 // 0=未達成, 1=銅, 2=銀, 3=金
export const TIER_NAME_ZH = ['', '銅', '銀', '金'] as const

/** Where a family's metric comes from. 'all'-scope metrics count every mode;
 *  pvp-scope metrics only count 真人對戰. */
export type AchMetric =
  | 'streak'
  | 'games'
  | 'wins'
  | 'soloGames'
  | 'soloWins'
  | 'flush'
  | 'fullHouse'
  | 'quads'
  | 'straightFlush'
  | 'sfDuel'
export type HandTypeMetric = 'flush' | 'fullHouse' | 'quads' | 'straightFlush'

export interface AchFamily {
  id: string
  name: string
  /** short symbol id for the badge art (bronze/silver/gold recolours the frame) */
  icon: HandTypeMetric | 'streak' | 'games' | 'wins' | 'soloGames' | 'soloWins' | 'sfDuel'
  metric: AchMetric
  /** bronze / silver / gold thresholds */
  thresholds: [number, number, number]
  scope: 'pvp' | 'solo' | 'all'
  /** human blurb for a given threshold */
  desc: (n: number) => string
}

export const ACHIEVEMENTS: AchFamily[] = [
  { id: 'games', name: '身經百戰', icon: 'games', metric: 'games', thresholds: [30, 50, 100], scope: 'pvp', desc: (n) => `真人對戰遊玩 ${n} 場` },
  { id: 'wins', name: '常勝將軍', icon: 'wins', metric: 'wins', thresholds: [30, 50, 100], scope: 'pvp', desc: (n) => `真人對戰獲得 ${n} 勝` },
  { id: 'streak', name: '勢如破竹', icon: 'streak', metric: 'streak', thresholds: [3, 5, 10], scope: 'pvp', desc: (n) => `真人對戰連勝 ${n} 場` },
  { id: 'soloGames', name: '百戰不殆', icon: 'soloGames', metric: 'soloGames', thresholds: [30, 50, 100], scope: 'solo', desc: (n) => `電腦對戰遊玩 ${n} 場` },
  { id: 'soloWins', name: 'AI領主', icon: 'soloWins', metric: 'soloWins', thresholds: [30, 50, 100], scope: 'solo', desc: (n) => `電腦對戰獲得 ${n} 勝` },
  { id: 'flush', name: '同花', icon: 'flush', metric: 'flush', thresholds: [2, 3, 4], scope: 'all', desc: (n) => `單場打出 ${n} 組同花` },
  { id: 'fullHouse', name: '葫蘆', icon: 'fullHouse', metric: 'fullHouse', thresholds: [2, 3, 4], scope: 'all', desc: (n) => `單場打出 ${n} 組葫蘆` },
  { id: 'quads', name: '鐵支', icon: 'quads', metric: 'quads', thresholds: [1, 2, 3], scope: 'all', desc: (n) => `單場打出 ${n} 組鐵支` },
  { id: 'straightFlush', name: '同花順', icon: 'straightFlush', metric: 'straightFlush', thresholds: [1, 2, 3], scope: 'all', desc: (n) => `單場打出 ${n} 組同花順` },
  { id: 'sfDuel', name: '狹路相逢', icon: 'sfDuel', metric: 'sfDuel', thresholds: [1, 3, 5], scope: 'all', desc: (n) => `對決中同花順對上同花順 ${n} 次` },
]

/** True if a showdown pits a straight flush against a straight flush (either side
 *  may win). Drives the 狹路相逢 achievement — needs BOTH revealed piles. */
export function isSfDuel(p1: Card[], p2: Card[]): boolean {
  return (
    p1.length > 0 &&
    p2.length > 0 &&
    evaluate(p1).category === CATEGORY.STRAIGHT_FLUSH &&
    evaluate(p2).category === CATEGORY.STRAIGHT_FLUSH
  )
}

export function getAchievement(id: string): AchFamily | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id)
}

/** Highest tier reached for a metric value (0..3). */
export function tierFor(value: number, thresholds: [number, number, number]): AchTier {
  if (value >= thresholds[2]) return 3
  if (value >= thresholds[1]) return 2
  if (value >= thresholds[0]) return 1
  return 0
}

/** The tracked hand-type of a single pile, or null if it isn't one. */
export function handTypeOf(pile: Card[]): HandTypeMetric | null {
  switch (evaluate(pile).category) {
    case CATEGORY.FLUSH:
      return 'flush'
    case CATEGORY.FULL_HOUSE:
      return 'fullHouse'
    case CATEGORY.FOUR_KIND:
      return 'quads'
    case CATEGORY.STRAIGHT_FLUSH:
      return 'straightFlush'
    default:
      return null
  }
}

/** Count how many of MY placed piles this match are each tracked hand type
 *  (empty slots ignored; each pile scores its single best category). */
export function matchHandTypeCounts(state: GameState, me: PlayerId): Record<HandTypeMetric, number> {
  const out: Record<HandTypeMetric, number> = { flush: 0, fullHouse: 0, quads: 0, straightFlush: 0 }
  for (const slot of state.slots) {
    const pile = slot[me]
    if (!pile || pile.length === 0) continue
    switch (evaluate(pile).category) {
      case CATEGORY.FLUSH:
        out.flush++
        break
      case CATEGORY.FULL_HOUSE:
        out.fullHouse++
        break
      case CATEGORY.FOUR_KIND:
        out.quads++
        break
      case CATEGORY.STRAIGHT_FLUSH:
        out.straightFlush++
        break
    }
  }
  return out
}

export interface AchUnlock {
  id: string
  tier: AchTier
}

/**
 * Compare live metric values against already-unlocked tiers; return the map to
 * persist plus any families that jumped to a higher tier (for the notification
 * queue). `metrics` supplies every AchMetric's current value (streak/games/wins
 * from stats; hand types = best single-match count ever).
 */
export function detectUnlocks(
  unlocked: Record<string, number>,
  metrics: Record<AchMetric, number>,
): { updated: Record<string, number>; newly: AchUnlock[] } {
  const updated = { ...unlocked }
  const newly: AchUnlock[] = []
  for (const fam of ACHIEVEMENTS) {
    const tier = tierFor(metrics[fam.metric] ?? 0, fam.thresholds)
    const had = (unlocked[fam.id] ?? 0) as AchTier
    if (tier > had) {
      updated[fam.id] = tier
      newly.push({ id: fam.id, tier })
    }
  }
  return { updated, newly }
}
