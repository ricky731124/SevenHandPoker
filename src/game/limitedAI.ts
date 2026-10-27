/**
 * 限定房人機(LIMITED-ROOM-SPEC §11)。只在限定房被呼叫(ai.ts 依 state.mode 分派);
 * bossAI.ts 一行都不改 —— 這裡只「唯讀呼叫」它的 bossPlace / rollMain。
 *
 * 目前做了:百鬼夜行(§11.4)。空城計 / 撲朔迷離 / 火力全開之後一種一種加。
 *
 * 公平:限定房對手只看得到張數(推牌位置隨機),所以 boss 的「看破」一律當 0(§11.2)。
 */

import type { Card } from './cards'
import { isBlank, isJoker } from './cards'
import { CATEGORY, evaluate } from './evaluate'
import { candidatePiles, groupBy } from './aiCore'
import { bossPlace, type BossProfile, type BossRuntime } from './bossAI'
import { DRAW_SCHEDULE, SLOT_COUNT, countCoins, ownsSlot, otherPlayer, type GameState, type PlayerId } from './state'

type Rng = () => number

/** 對戰電腦(沒有 boss 個性)在限定房用的預設個性:平衡、中等詐唬、中等執行力(§11.1)。 */
export const DEFAULT_LIMITED_PROFILE: BossProfile = {
  pickMain: { attack: 0, hoard: 0, balance: 100 },
  bluff: 50,
  draw: 0,
  jokerTiming: 0,
  insight: 0,
}
export function defaultLimitedBrain(): BossRuntime {
  return { profile: DEFAULT_LIMITED_PROFILE, main: 'balance', execution: 0.75 }
}

/** 看破關掉的 boss(只讀張數)。不改原 profile,複製一份傳下去。 */
const noInsight = (rt: BossRuntime): BossRuntime => ({ ...rt, profile: { ...rt.profile, insight: 0 } })

export function limitedPick(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng = Math.random): string[] {
  // 步驟 1 只有百鬼夜行;其他玩法上線時在這裡分派
  return ghostPick(state, me, rt, rng).map((c) => c.id)
}

export function limitedPlace(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng = Math.random): number {
  // 百鬼夜行:原本的 boss 放牌,看破 = 0(§11.4)
  return bossPlace(state, me, noInsight(rt), rng)
}

// ---- 百鬼夜行(§11.4) ------------------------------------------------------
//
// 一人整局約 11 張鬼、7 手;同花順一手要 2~3 鬼 → 不可能每手都出大牌,一定要放掉幾格。
// 所以每手只在兩件事裡選:
//   出大牌 = 同花順(主)/ 鐵支(輔),用最多正牌、最少鬼牌湊;
//   放掉   = 只出 1 張最不影響之後湊大牌的正牌(把鬼和核心牌留給後面)。
// 葫蘆 / 順子 / 同花 / 三條 / 對子「中間牌」CP 值太低:又耗正牌又耗鬼還常輸,不主動出,
// 只有後期沒鬼、湊不出大牌時才用正牌天然的成牌。

/** 這格牌力(牌型 + 最大點數),跟 aiCore.pileStrength 同一把尺。 */
function power(pile: Card[]): number {
  const v = evaluate(pile)
  return v.category + (v.rankSeq[0] ?? 0) / 15
}

/** `who` 拿下格子 i 會不會直接贏(4 幣或湊成 3 連)?公開資訊。 */
function winsIfOwns(state: GameState, who: PlayerId, i: number): boolean {
  if (countCoins(state, who) + (ownsSlot(state.slots[i], who) ? 0 : 1) >= 4) return true
  for (let s = 0; s <= SLOT_COUNT - 3; s++) {
    let ok = true
    for (let k = s; k < s + 3; k++) if (!(k === i || ownsSlot(state.slots[k], who))) ok = false
    if (ok) return true
  }
  return false
}
/** 還沒有主的格子裡,有沒有一格 `who` 拿到就贏。 */
function atMatchPoint(state: GameState, who: PlayerId): boolean {
  return state.slots.some((s, i) => s.owner === null && winsIfOwns(state, who, i))
}

/** 一個「大牌」組法:正牌 cards + 補 jokers 張鬼。 */
interface Strong {
  kind: 'sf' | 'quads'
  cards: Card[]
  jokers: number
  /** 同花順的頭 / 鐵支的點數 */
  top: number
}

/**
 * 所有同花順 / 鐵支組法(只列正牌部分,鬼牌另補)。
 *  - 同花順:每個花色、每個 5 格窗(正牌只有 7~A → 7-J、8-Q、9-K、10-A),窗裡同花色正牌全用上。
 *    只有 1 張正牌時一定要湊 10~A:1 張小牌 + 4 鬼(例 ♣7~J)比 5 鬼還小(§4.3 #12)。
 *  - 鐵支:同點數正牌(最多 4 張)+ 鬼補到 4 張。
 */
function strongOptions(reals: Card[]): Strong[] {
  const out: Strong[] = []
  for (const suited of groupBy(reals, (c) => c.suit).values()) {
    for (let top = 11; top <= 14; top++) {
      const inWin = suited.filter((c) => c.rank <= top && c.rank > top - 5)
      if (!inWin.length || (inWin.length === 1 && top < 14)) continue
      out.push({ kind: 'sf', cards: inWin, jokers: 5 - inWin.length, top })
    }
  }
  for (const g of groupBy(reals, (c) => c.rank).values()) {
    const use = g.slice(0, 4)
    out.push({ kind: 'quads', cards: use, jokers: 4 - use.length, top: g[0].rank })
  }
  return out
}

/**
 * 在可花的鬼牌內挑一個大牌(§11.4 使用者定案 2026-10-28):
 *  - 同花順:先比用的鬼少,再比頭大(♣9 10 J + 2 鬼 勝過 ♣10 J + 3 鬼)。
 *  - 同花順最多比鐵支多用 1 張鬼就選同花順;多 2 張以上才選鐵支。
 */
function bestStrong(opts: Strong[], cap: number): Strong | null {
  const ok = opts.filter((o) => o.jokers <= cap)
  const by = (a: Strong, b: Strong) => a.jokers - b.jokers || b.top - a.top
  const sf = ok.filter((o) => o.kind === 'sf').sort(by)[0]
  const quads = ok.filter((o) => o.kind === 'quads').sort(by)[0]
  if (sf && (!quads || sf.jokers <= quads.jokers + 1)) return sf
  return quads ?? null
}

/** 不管省鬼、只求最大的大牌(差一格就贏 / 最後一手 / 執行力失手時用)。 */
function biggestStrong(opts: Strong[], cap: number): Strong | null {
  const rank = (o: Strong) => (o.kind === 'sf' ? 100 : 0) + o.top * 2 - o.jokers * 0.1
  return opts.filter((o) => o.jokers <= cap).sort((a, b) => rank(b) - rank(a))[0] ?? null
}

/**
 * 這些正牌 + 鬼牌還湊得出幾手大牌(每次挑最省鬼的那手,湊完拿掉再算)。剩的鬼 4 張算一手鐵支。
 * jokersUsed = 湊這幾手正牌要花的鬼(越少代表手上的正牌越好用)。
 */
function strongPlan(reals: Card[], jokers: number): { n: number; jokersUsed: number } {
  let rs = reals
  let j = jokers
  let n = 0
  let used = 0
  for (;;) {
    // 一樣省鬼就先用正牌少的(剩的正牌還能多湊一手)
    const o = strongOptions(rs)
      .filter((x) => x.jokers <= j)
      .sort((a, b) => a.jokers - b.jokers || a.cards.length - b.cards.length)[0]
    if (!o) break
    n++
    j -= o.jokers
    used += o.jokers
    rs = rs.filter((c) => !o.cards.includes(c))
  }
  return { n: n + Math.floor(j / 4), jokersUsed: used }
}
const strongCount = (reals: Card[], jokers: number) => strongPlan(reals, jokers).n

/** 之後還會補幾張牌,以及其中大概幾張是鬼(只用公開資訊:牌堆 + 對手手牌 + 沒翻開的對手牌堆)。 */
function futureDraws(state: GameState, me: PlayerId): { cards: number; jokers: number } {
  const cards = DRAW_SCHEDULE.slice(state.drawsDone[me]).reduce((s, n) => s + n, 0)
  const foe = otherPlayer(me)
  const myJokers = state.hands[me].filter(isJoker).length
  const myPiles = state.slots.flatMap((s) => s[me])
  const shownFoe = state.slots.filter((s) => s.owner !== null).flatMap((s) => s[foe])
  const seenJokers = myJokers + [...myPiles, ...shownFoe].filter(isJoker).length
  const unseenCards = state.deck.length + state.hands[foe].length + state.slots.filter((s) => s.owner === null).reduce((n, s) => n + s[foe].length, 0)
  const unseenJokers = Math.max(0, 22 - seenJokers) // 20 張牌組鬼 + 兩張開局鬼
  const rate = unseenCards > 0 ? Math.min(1, unseenJokers / unseenCards) : 0
  return { cards, jokers: cards * rate }
}

/**
 * 核心牌:能跟別張正牌一起湊大牌的(同花順裡 ≥2 張正牌、對子 / 三條補鬼成鐵支)。
 * 從最省鬼的組法開始分,分過的牌不重複用(例 ♦7 8 9 先分走,♦K 就落單)。
 */
function coreCards(reals: Card[]): Set<Card> {
  const core = new Set<Card>()
  let rs = reals
  for (;;) {
    const o = strongOptions(rs)
      .filter((x) => x.cards.length >= 2)
      .sort((a, b) => a.jokers - b.jokers || b.top - a.top)[0]
    if (!o) break
    for (const c of o.cards) core.add(c)
    rs = rs.filter((c) => !o.cards.includes(c))
  }
  return core
}

/**
 * 放掉這格要丟的那張:先從「落單的正牌」裡丟最小的(不拆同花順核心、不拆對子);
 * 全都是核心牌時,丟拿掉後「還湊得出幾手大牌」掉最少、多花的鬼最少的那張(鬼牌算上之後會補到的)。
 */
function sacrificeCard(reals: Card[], jokers: number): Card {
  const core = coreCards(reals)
  const loose = reals.filter((c) => !core.has(c))
  if (loose.length) return loose.reduce((b, c) => (c.rank < b.rank ? c : b), loose[0])
  let best = reals[0]
  let bestScore = -Infinity
  for (const c of reals) {
    const paired = reals.some((x) => x !== c && x.rank === c.rank)
    const plan = strongPlan(
      reals.filter((x) => x !== c),
      jokers,
    )
    const score = plan.n * 100 - plan.jokersUsed * 8 - (paired ? 30 : 0) - c.rank
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

/**
 * 中間牌:正牌天然的成牌,或對子 / 三條補 1 張鬼。只在後期湊不出大牌時用。
 * urgent(差一格就贏 / 最後一手):鬼全部可以補,單張也補(例 ♦10 + 2 鬼 = 三條,比送單張好)。
 */
function midPile(reals: Card[], jokers: Card[], urgent: boolean): Card[] | null {
  const opts: Card[][] = candidatePiles(reals).filter((p) => evaluate(p).category >= CATEGORY.PAIR)
  const k = Math.min(urgent ? jokers.length : 1, jokers.length)
  for (const g of groupBy(reals, (c) => c.rank).values()) {
    const add = Math.min(k, 4 - Math.min(4, g.length))
    if (add > 0 && (urgent || g.length >= 2)) opts.push([...g.slice(0, 4), ...jokers.slice(0, add)])
  }
  if (!opts.length) return null
  return opts.reduce((b, p) => (power(p) > power(b) ? p : b), opts[0])
}

const withJokers = (o: Strong, jokers: Card[]): Card[] => [...o.cards, ...jokers.slice(0, o.jokers)]

function ghostPick(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng): Card[] {
  const hand = state.hands[me]
  const reals = hand.filter((c) => !isJoker(c) && !isBlank(c))
  const jokers = hand.filter(isJoker)
  const blanks = hand.filter(isBlank)
  const pd = state.placementsDone[me]
  const left = SLOT_COUNT - pd // 含這一手

  // 手上沒有正牌:只剩鬼牌才出鬼(分散用,最後一手才全出);連鬼都沒有就墊空白
  if (!reals.length) {
    if (!jokers.length) return blanks.slice(0, 1)
    const n = left <= 1 ? jokers.length : Math.ceil(jokers.length / left)
    return jokers.slice(0, Math.max(1, Math.min(5, n)))
  }

  const J = jokers.length
  const foe = otherPlayer(me)
  const opts = strongOptions(reals)

  // 差一格就贏(誰都一樣)/ 最後一手:不省了,出最大的
  if (left <= 1 || atMatchPoint(state, foe) || atMatchPoint(state, me)) {
    const big = biggestStrong(opts, J)
    if (big) return withJokers(big, jokers)
    return midPile(reals, jokers, true) ?? [sacrificeCard(reals, J)]
  }

  // 一手最多花 3 張鬼;4 張以上(1 張大牌 + 4 鬼)太耗,只有鬼牌很多時才用
  const future = futureDraws(state, me)
  const roomy = J + future.jokers >= 4 + 2.5 * (left - 1)
  const cap = Math.min(J, roomy || left <= 2 ? 5 : 3)

  // 執行力失手:不算省鬼、也不放格子,直接出上限內最大的大牌(浪費一點鬼,但不會出怪牌)
  if (rng() >= rt.execution) {
    const big = biggestStrong(opts, cap)
    if (big) return withJokers(big, jokers)
  }

  const pick = bestStrong(opts, cap)

  // 還湊得出幾手大牌 → 要放掉幾格
  const canMake = strongCount(reals, J) + future.cards / 4.5
  const mustSac = Math.max(0, left - canMake)

  let sac: boolean
  if (!pick) sac = true
  else if (rt.main === 'hoard') {
    // 囤牌:百鬼節奏快 → 只放前面(先手前 2 手 / 後手前 1 手),之後就開始出同花順;落後 2 幣提早兌現
    const hoardEnd = state.firstPicker === me ? 2 : 1
    const behind = countCoins(state, foe) - countCoins(state, me) >= 2
    sac = pd < hoardEnd && !behind
  } else if (rt.main === 'attack') {
    sac = false // 強攻:先出大牌,沒資源了才放(上面 !pick)
  } else {
    sac = mustSac > 0 && rng() < mustSac / left // 平衡:要放的格子平均分散
  }

  if (!sac && pick) return withJokers(pick, jokers)

  // 後期沒鬼、湊不出大牌:正牌天然的成牌還能搶一格,比送一張好
  if (!pick && left <= 3) {
    const mid = midPile(reals, jokers, false)
    if (mid) return mid
  }
  return [sacrificeCard(reals, J + Math.round(future.jokers))]
}
