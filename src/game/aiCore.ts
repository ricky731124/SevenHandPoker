/**
 * Shared AI helpers used by both the default single-difficulty AI (ai.ts) and
 * the profile-driven campaign boss AI (bossAI.ts). Kept here so neither imports
 * the other (no cycle). Pure functions over game types — no React/store.
 */

import type { Card, Rank, Suit } from './cards'
import { isJoker, isSpecial } from './cards'
import { evaluate } from './evaluate'

export function groupBy<T, K>(arr: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>()
  for (const x of arr) {
    const k = key(x)
    const g = m.get(k)
    if (g) g.push(x)
    else m.set(k, [x])
  }
  return m
}

/**
 * Candidate piles (made hands) an AI could pick from its hand.
 *
 * Blank/joker carry dummy suit/rank, so grouping must run on real cards only.
 * The joker (a pure wild) is appended to each ≤4-card candidate — evaluate()
 * turns it into whatever maximises the pile — plus a lone-joker option (= ♠A).
 * The blank never improves a hand, so it's never built with here.
 */
/** 候選牌補漏(模擬比較用;遊戲裡永遠是 true)。sf = 2026-11-04:同花色 ≥ 5 張時藏著的同花順、鬼補的同花順原本不在候選裡。 */
export const CAND_TUNE = { sf: true }

export function candidatePiles(hand: Card[]): Card[][] {
  const reals = hand.filter((c) => !isSpecial(c))
  const joker = hand.find(isJoker)
  const out: Card[][] = []
  const byRank = groupBy(reals, (c) => c.rank)
  const bySuit = groupBy(reals, (c) => c.suit)

  const groups = [...byRank.values()]
  const pairs = groups.filter((g) => g.length >= 2).sort((a, b) => b[0].rank - a[0].rank)
  const trips = groups.filter((g) => g.length >= 3).sort((a, b) => b[0].rank - a[0].rank)
  const quads = groups.filter((g) => g.length >= 4)

  for (const q of quads) out.push(q.slice(0, 4))
  for (const t of trips) out.push(t.slice(0, 3))
  for (const p of pairs) out.push(p.slice(0, 2))

  if (pairs.length >= 2) out.push([...pairs[0].slice(0, 2), ...pairs[1].slice(0, 2)])

  if (trips.length >= 1) {
    const otherPair = pairs.find((p) => p[0].rank !== trips[0][0].rank)
    if (otherPair) out.push([...trips[0].slice(0, 3), ...otherPair.slice(0, 2)])
  }

  for (const cards of bySuit.values()) {
    if (cards.length >= 5) out.push([...cards].sort((a, b) => b.rank - a.rank).slice(0, 5))
  }

  const straight = findStraight(reals)
  if (straight) out.push(straight)

  // 同花順(使用者 2026-11-04 回報):同花色 ≥ 5 張時上面只取最大 5 張當同花,裡面的同花順會漏掉
  const same = (a: Card[], b: Card[]) => a.length === b.length && a.every((c) => b.includes(c))
  const add = (p: Card[]) => {
    if (!out.some((o) => same(o, p))) out.push(p)
  }
  if (CAND_TUNE.sf) {
    for (const cards of bySuit.values()) {
      const sf = cards.length >= 5 ? findStraight(cards) : null
      if (sf) add(sf)
    }
  }

  if (joker) {
    for (const cand of [...out]) {
      if (cand.length < 5) out.push([...cand, joker])
    }
    // joker completes a DRAW: 4-of-a-suit → flush, or 4-of-a-straight → straight.
    // (candidatePiles otherwise only builds made hands, so these were never offered.)
    for (const cards of bySuit.values()) {
      if (cards.length === 4) out.push([...[...cards].sort((a, b) => b.rank - a.rank), joker])
    }
    const sDraw = straightDrawFour(reals)
    if (sDraw) out.push([...sDraw, joker])
    // 鬼補同花順:同花色裡有 4 張連得起來(例:♦A Q J 10 + 鬼)。原本只看「剛好 4 張同花色」補成同花,
    // 同花色 6 張時就看不到(死神之眼看到對手同花順,只有這手壓得過)
    if (CAND_TUNE.sf) {
      for (const cards of bySuit.values()) {
        const d = cards.length >= 4 ? straightDrawFour(cards) : null
        if (d) add([...d, joker])
      }
    }
    out.push([joker])
  }

  return out
}

/** Four distinct-rank cards that a single wild completes into a 5-card straight
 *  (open-ended or single-gap, wheel included). Null if none. */
function straightDrawFour(hand: Card[]): Card[] | null {
  const byRank = groupBy(hand, (c) => c.rank)
  const windows: number[][] = []
  for (let hi = 14; hi >= 5; hi--) windows.push([hi, hi - 1, hi - 2, hi - 3, hi - 4])
  windows.push([5, 4, 3, 2, 14]) // wheel
  for (const w of windows) {
    const present = w.map((r) => byRank.get(r as Rank)?.[0]).filter(Boolean) as Card[]
    if (present.length === 4) return present
  }
  return null
}

export function findStraight(hand: Card[]): Card[] | null {
  const byRank = groupBy(hand, (c) => c.rank)
  const has = (r: number) => byRank.get(r as Rank)?.[0]
  const windows: number[][] = []
  for (let hi = 14; hi >= 5; hi--) windows.push([hi, hi - 1, hi - 2, hi - 3, hi - 4])
  windows.push([5, 4, 3, 2, 14]) // wheel
  for (const w of windows) {
    const cards = w.map((r) => has(r === 1 ? 14 : r)).filter(Boolean) as Card[]
    if (cards.length === 5) return cards
  }
  return null
}

/** Coarse strength 0..~8.9 for routing/comparison decisions. */
export function pileStrength(pile: Card[]): number {
  const v = evaluate(pile)
  return v.category + (v.rankSeq[0] ?? 0) / 15
}

export function suitRank(s: Suit): number {
  return { C: 0, D: 1, H: 2, S: 3 }[s]
}

/**
 * Fallback pick when no made hand exists: the two highest real cards as a
 * high-card pile (prefer reals so a blank isn't wasted; fall back to whatever's
 * left if that's all there is).
 */
export function fallbackPile(hand: Card[]): Card[] {
  const pool = hand.some((c) => !isSpecial(c)) ? hand.filter((c) => !isSpecial(c)) : hand
  const sorted = [...pool].sort((a, b) => b.rank - a.rank || suitRank(b.suit) - suitRank(a.suit))
  return sorted.slice(0, Math.min(2, sorted.length))
}
