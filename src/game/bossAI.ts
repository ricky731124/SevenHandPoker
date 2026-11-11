/**
 * Profile-driven campaign boss AI — GAME CONTENT behaviour layer. Turns a
 * BossProfile (defined per boss in campaign.ts) into concrete pick/place moves,
 * so each boss FEELS different (main pick style + skills) and gets sharper stage
 * to stage (execution). See the design locked with the user 2026-08-01:
 *
 *  主策略(每局抽一次): 強攻 attack / 囤牌 hoard / 平衡 balance
 *  副技能(遇時機才發動,%): 詐唬 bluff / 拼牌 draw / 鬼牌時機 jokerTiming / 看破 insight
 *  執行力 execution(0..1): 把策略執行得多精 + 反向失手率;越高越會做跨手最佳化、
 *                          看破張數詐唬、擋殺 — x-1/x-2/x-3 = 0.6/0.75/0.9(暫定,可下修)
 *  放牌: 即時判斷 — 搶幣/認賠(下四換上四)/避戰,依「對方張數(唯一情報)+自己那格強弱」,
 *        看破(insight)決定多信任張數;擋殺=基本牌理(高執行力才看得出致勝威脅)。
 *
 * FAIRNESS: placement is BLIND — the boss reads only the incoming pile's card
 * COUNT (state.pendingPick.cards.length), never its values. It never peeks at
 * the human's hidden hand (that would be cheating); 看破 is pure count-discount +
 * (future) card-counting, and spy grants a legit read only via the card effect.
 */

import type { Card } from './cards'
import { isBlank, isJoker, isSpecial } from './cards'
import { CATEGORY, compareHands, compareValue, evaluate } from './evaluate'
import {
  SLOT_COUNT,
  canExplode,
  canRefresh,
  countCoins,
  deathEyeSlots,
  explodeTargets,
  emptySlotsFor,
  exposedSlots,
  isTargetable,
  ownsSlot,
  suitTargets,
  swapTargets,
  type GameState,
  type PlayerId,
} from './state'
import { getSpecialCard, suitMaxOf, type SpecialCardId } from './specialCards'
import { candidatePiles, fallbackPile, pileStrength } from './aiCore'
import { beatsEntry, blankBoardScores, hasPlaceTable, normalStrength, type PileEntry } from './limitedPlace'

export type PickMain = 'attack' | 'hoard' | 'balance'

export interface BossProfile {
  /** 主策略機率(和=100),每局抽一次 */
  pickMain: { attack: number; hoard: number; balance: number }
  /** 副技能發動率 0..100 — 遇到好時機時,多大機率會出手(不是每手都做) */
  bluff: number // 詐唬:用張數偽裝
  draw: number // 拼牌:留牌等升級(同花/順/葫蘆)
  jokerTiming: number // 鬼牌時機:高槓桿才用鬼牌
  insight: number // 看破:對對方張數的折扣(不作弊)
}

export interface BossRuntime {
  profile: BossProfile
  /** sampled once per match from pickMain */
  main: PickMain
  /** 0..1, from the sub-stage (x-1/x-2/x-3) */
  execution: number
  /**
   * 資訊卡強化打法 (#5) — set when the boss fires its info signature this match.
   * These grant the boss LEGIT extra information (the card's whole point); it is
   * never allowed to read hidden state without having spent the card.
   */
  /** spy (讓我看看) fired → the boss saw the foe's hand, so it reads the TRUE
   *  strength of incoming piles (perfect 看破, sees through 詐唬 count-padding)
   *  instead of guessing from the card count alone. */
  spySeen?: boolean
  /** peek (偷窺) fired → the boss foresaw its own next draw, so it can plan which
   *  cards to hold this turn (any upgrade — pair/trips/flush/straight/quads), not
   *  just a flush/straight completion. Valid for the immediate next draw. */
  peekDraw?: Card[] | null
  /** spy (讓我看看) fired → snapshot of the foe's hand at that moment. Used on the
   *  PICK side to infer the foe's best reachable hand and bring forward the boss's
   *  cash-out (stop hoarding once the foe clearly holds a monster). */
  spyHand?: Card[] | null
  /** 這隻 boss 自己的招牌卡(主線才有;快速配對人機沒有)。強迫更新靠它分辨「柴柴本尊」要不要優先用。 */
  signature?: SpecialCardId
  /** 死神之眼停損用(見 eyeAdjust):最近一次評估是 boss 自己的第幾手(placementsDone)、
   *  那手之前已連續「忍住不出大牌」幾手、那手有沒有忍。bossPick 會就地更新(同一手重算不重複累加)。 */
  eyeHold?: { hand: number; streak: number; held: boolean }
}

type Rng = () => number

// ---- sampling helpers ----------------------------------------------------

/** Roll the match's dominant pick strategy from the profile's weights. */
export function rollMain(profile: BossProfile, rng: Rng = Math.random): PickMain {
  const { attack, hoard, balance } = profile.pickMain
  const total = attack + hoard + balance || 1
  const r = rng() * total
  if (r < attack) return 'attack'
  if (r < attack + hoard) return 'hoard'
  return 'balance'
}

/** True when the boss executes this decision sharply (else it under-executes). */
function sharp(execution: number, rng: Rng): boolean {
  return rng() < execution
}

/** True when a skill with the given proficiency (0..100) chooses to fire. */
function fires(skill: number, rng: Rng): boolean {
  return rng() * 100 < skill
}

// ---- pick ----------------------------------------------------------------

function strongest(cands: Card[][]): Card[] {
  return cands.reduce((best, c) => (compareValue(evaluate(c), evaluate(best)) > 0 ? c : best), cands[0])
}
function weakest(cands: Card[][]): Card[] {
  return cands.reduce((lo, c) => (compareValue(evaluate(c), evaluate(lo)) < 0 ? c : lo), cands[0])
}
function usesJoker(pile: Card[]): boolean {
  return pile.some(isJoker)
}

/** Among joker-using candidate piles, pick the best by CP效益 (葫蘆/三條 > 同花 > 順子,
 *  see cpValue) plus 後手 (strength left in hand). CP-based, NOT raw poker-tier, so the
 *  joker isn't wasted completing a low-CP straight when a 三條/葫蘆 is available — but a
 *  flush/straight can still win when it leaves a clearly better remainder. */
function bestJokerCombo(jokerCands: Card[][], hand: Card[]): Card[] {
  const remStrength = (p: Card[]): number => {
    const used = new Set(p.map((c) => c.id))
    const rem = candidatePiles(hand.filter((c) => !used.has(c.id)))
    return rem.length ? Math.max(...rem.map(pileStrength)) : 0
  }
  // 鬼牌用途效益(使用者定):葫蘆/三條 最划算 > 同花 > 順子(順子最差)。同花順/鐵支自然最高。
  const jokerResultValue = (c: Card[]): number => {
    switch (evaluate(c).category) {
      case CATEGORY.STRAIGHT_FLUSH:
        return 100
      case CATEGORY.FULL_HOUSE:
        return 98
      case CATEGORY.FOUR_KIND:
        return 95
      case CATEGORY.THREE_KIND:
        return 85
      case CATEGORY.FLUSH:
        return 60
      case CATEGORY.STRAIGHT:
        return 45
      default:
        return evaluate(c).category * 10
    }
  }
  const score = (c: Card[]): number => jokerResultValue(c) + 2 * remStrength(c)
  return jokerCands.reduce((best, c) => (score(c) > score(best) ? c : best), jokerCands[0])
}

/** 強攻(優化版): among the top piles, prefer the one that leaves the best NEXT
 *  pile — "第一手 90 讓第二手 75 > 第一手 100 第二手 50". */
function attackPick(cands: Card[][], hand: Card[]): Card[] {
  const sorted = [...cands].sort((a, b) => compareValue(evaluate(b), evaluate(a)))
  const top = sorted.slice(0, Math.min(4, sorted.length))
  let best = top[0]
  let bestScore = -Infinity
  for (const c of top) {
    const used = new Set(c.map((x) => x.id))
    const remaining = hand.filter((x) => !used.has(x.id))
    const rem = candidatePiles(remaining)
    const next = rem.length ? Math.max(...rem.map(pileStrength)) : 0
    const score = pileStrength(c) + 0.5 * next
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

/** 收手期(落後 / 後段)出什麼:修正前 = 直接出最大;2026-11-03 起照強攻挑(大牌裡挑出完還留得下一手的),
 *  不要一落後就一手接一手砸到沒牌(使用者:後段散牌多是前面被逼著狂扔大牌)。 */
function cashOutPick(cands: Card[][], hand: Card[]): Card[] {
  return PICK_TUNE.fix1103 ? attackPick(cands, hand) : strongest(cands)
}

/** CP(效益)分數:選「這手要領什麼」時用,不是比牌大小(那用 pileStrength)。
 *  依使用者定的效益觀:三條最高;中強對(≥7)高;弱對/兩對/順子略扣(耗多張、易被看穿);
 *  單張高牌 = 這格認輸。只在囤牌/平衡挑便宜牌領時使用。 */
function cpValue(pile: Card[]): number {
  const v = evaluate(pile)
  const hi = v.rankSeq[0] ?? 0
  switch (v.category) {
    case CATEGORY.THREE_KIND:
      return 100 + hi // 三條 CP 最高:3 張吃強對/兩對
    case CATEGORY.PAIR:
      return hi >= 7 ? 55 + hi : 15 + hi // 中強對高;弱對(≤6)重扣
    case CATEGORY.TWO_PAIR:
      return 40 + hi / 15 // 耗 4 張、輸三條、易被看穿 → 略扣
    case CATEGORY.STRAIGHT:
      return 50 + hi / 15 // 耗 5 張 → 略扣
    case CATEGORY.HIGH_CARD:
      return pile.length <= 1 ? 1 : 8 + hi / 15 // 單張=認輸;兩張略好但仍差
    default:
      return v.category * 20 + hi // 同花↑ 等大牌本來就高
  }
}

/** The cards that make up the strongest monster (≥ straight) in hand — protected
 *  so hoard filler never breaks a made flush/straight/full house. */
function monsterCards(cands: Card[][]): Set<string> {
  const monsters = cands.filter((c) => evaluate(c).category >= CATEGORY.STRAIGHT)
  if (!monsters.length) return new Set()
  const best = monsters.reduce((b, c) => (compareValue(evaluate(c), evaluate(b)) > 0 ? c : b), monsters[0])
  return new Set(best.map((c) => c.id))
}

/** The best hand category reachable from a set of cards (for spy foe-read). */
function bestCategoryOf(cards: Card[]): number {
  const cs = candidatePiles(cards)
  return cs.reduce<number>((m, c) => Math.max(m, evaluate(c).category), CATEGORY.EMPTY)
}

/** 囤牌收手邊界:輸 ≥2 硬幣,或(先攻已出到第4手 / 後攻已出到第3手),或 spy 看到對手已握大牌
 *  → 停止囤牌、開始兌現強牌。 */
function shouldCashOut(state: GameState, me: PlayerId, rt: BossRuntime): boolean {
  const foe = me === 'p1' ? 'p2' : 'p1'
  if (countCoins(state, foe) >= 2) return true
  const picks = state.placementsDone[me]
  const threshold = state.firstPicker === me ? 3 : 2 // 先攻:第4手(已放3);後攻:第3手(已放2)
  if (picks >= threshold) return true
  if (rt.spyHand) {
    const cat = bestCategoryOf(rt.spyHand)
    if (cat >= CATEGORY.STRAIGHT) return true // 對手明顯握有順↑ → 別再傻囤
    if (cat === CATEGORY.THREE_KIND) return true // 高 CP 三條也算大牌
  }
  return false
}

/** 囤牌: 收手期→兌現最強;囤牌期→優先三條、其次中強對(7~10/JQKA),不領弱對/高牌;
 *  沒有中強成牌就丟低散牌保留成對牌(不拆同花/順)。 */
function hoardPick(cands: Card[][], hand: Card[], state: GameState, me: PlayerId, rt: BossRuntime): Card[] {
  if (shouldCashOut(state, me, rt)) return cashOutPick(cands, hand) // 收手轉攻:兌現強牌

  const trips = cands.filter((c) => evaluate(c).category === CATEGORY.THREE_KIND)
  if (trips.length) return trips.reduce((b, c) => (c[0].rank > b[0].rank ? c : b), trips[0]) // 最高三條

  const midPairs = cands.filter((c) => evaluate(c).category === CATEGORY.PAIR && c[0].rank >= 7)
  if (midPairs.length) return midPairs.reduce((b, c) => (c[0].rank > b[0].rank ? c : b), midPairs[0]) // 最強中強對

  // 沒中強成牌:送 2 張最沒用的散牌(保留弱對去湊三條/葫蘆、不拆同花/順;送 2 張的理由見 junkCards)。
  const junk = junkCards(hand, monsterCards(cands))
  if (junk.length) return junk

  // 只剩弱對/兩對等便宜成牌 → 領其中最弱的(照 CP)。
  const cheap = cands.filter((c) => evaluate(c).category < CATEGORY.STRAIGHT)
  if (cheap.length) return cheap.reduce((lo, c) => (cpValue(c) < cpValue(lo) ? c : lo), cheap[0])
  return fallbackPile(hand)
}

/** 平衡(前瞻,不執著馬上兌現): 收手期→兌現最強。否則**保留 5 張大牌**(同花↑除非別無選擇),
 *  在其餘候選裡挑「本手效益(cpValue) + 保留了拼牌潛力(剩牌還有 4 張同花/順的活抽)」最高的領牌
 *  → 常常寧可出中強對而不是馬上砸順子/同花,留著牌去等升更強(對應使用者「出AA留順子牌」)。 */
function balancePick(cands: Card[][], hand: Card[], state: GameState, me: PlayerId, rt: BossRuntime): Card[] {
  if (shouldCashOut(state, me, rt)) return cashOutPick(cands, hand)
  const nonMonster = cands.filter((c) => evaluate(c).category < CATEGORY.FLUSH)
  const pool = nonMonster.length ? nonMonster : cands
  const reals = hand.filter((c) => !isSpecial(c))
  const balScore = (c: Card[]): number => {
    const cat = evaluate(c).category
    const used = new Set(c.map((x) => x.id))
    const rem = reals.filter((x) => !used.has(x.id))
    // 高牌 win-weight 最低 → 重壓(只有別無選擇才領);拼牌加成只給像樣的成牌(對子↑)。
    const highCardPenalty = cat === CATEGORY.HIGH_CARD ? 40 : 0
    const keepsDraw = cat >= CATEGORY.PAIR && (flushDrawCards(rem) || straightDrawCards(rem))
    return cpValue(c) - highCardPenalty + (keepsDraw ? 25 : 0)
  }
  return pool.reduce((best, c) => (balScore(c) > balScore(best) ? c : best), pool[0])
}

/** 拼牌: if a strong draw (4-flush / open straight) exists, keep those cards and
 *  send filler this turn instead of cashing the current best. Returns null if no
 *  worthwhile draw to protect. */
function drawHoldPick(hand: Card[], main: PickMain): Card[] | null {
  const reals = hand.filter((c) => !isSpecial(c))
  const fix = PICK_TUNE.fix1103
  // 已經湊得出順子以上(不用鬼)→ 沒什麼好「拼」的
  if (fix && candidatePiles(reals).some((c) => evaluate(c).category >= CATEGORY.STRAIGHT)) return null
  // 聽牌只用落單的牌(使用者 2026-11-03:為了留 ♥A 8 7 2 拆掉 AA / 88 / 777 不合理)
  const counts = rankCounts(hand)
  const loose = fix ? reals.filter((c) => counts.get(c.rank) === 1) : reals
  const draw = flushDrawCards(loose) ?? straightDrawCards(loose)
  if (!draw) return null
  const drawSet = new Set(draw.map((c) => c.id))
  const spare = reals.filter((c) => !drawSet.has(c.id))
  const sp = noTripSplits(candidatePiles(spare), hand)
  // 留著聽牌、這手出「有戰力」的成牌(使用者 2026-11-03:有主動權就出有戰力的,強一對也行):
  // 強攻 / 平衡出最大的;囤牌出 CP 最高的便宜牌(三條 > 強一對),大牌照樣留著
  if (sp.length) {
    if (!fix) return weakest(sp)
    if (main !== 'hoard') return strongest(sp)
    const cheap = sp.filter((c) => evaluate(c).category < CATEGORY.STRAIGHT)
    return cheap.length ? cheap.reduce((b, c) => (cpValue(c) > cpValue(b) ? c : b), cheap[0]) : weakest(sp)
  }
  const junk = junkCards(hand, drawSet)
  if (junk.length) return junk
  if (spare.length) return [[...spare].sort((a, b) => a.rank - b.rank)[0]]
  return null
}

function flushDrawCards(reals: Card[]): Card[] | null {
  const bySuit = new Map<string, Card[]>()
  for (const c of reals) bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c])
  for (const cards of bySuit.values()) if (cards.length === 4) return cards
  return null
}
function straightDrawCards(reals: Card[]): Card[] | null {
  const ranks = [...new Set(reals.map((c) => c.rank))].sort((a, b) => a - b)
  for (let i = 0; i + 3 < ranks.length + 1 && i + 3 < ranks.length; i++) {
    // window of 4 consecutive distinct ranks
    const w = ranks.slice(i, i + 4)
    if (w.length === 4 && w[3] - w[0] === 3) {
      return w.map((r) => reals.find((c) => c.rank === r)!).filter(Boolean)
    }
  }
  return null
}

/** peek 強化(一般化): 把預視到的補牌併入手牌,找出「補牌後能成、且比現在最強成牌更強」
 *  的最佳新牌型(湊對/三條/同花/順/鐵支都算)。若有,就把「湊那手所需、我現在就握著的牌」
 *  留住,這手改丟最弱廢牌。回傳要丟的那疊(filler),沒有值得留的規劃則回傳 null。 */
function peekHoldPick(hand: Card[], peek: Card[]): Card[] | null {
  const reals = hand.filter((c) => !isSpecial(c))
  const peekReals = peek.filter((c) => !isSpecial(c))
  if (!peekReals.length) return null
  const peekIds = new Set(peekReals.map((c) => c.id))

  const nowBest = candidatePiles(reals)
  const nowStrength = nowBest.length ? Math.max(...nowBest.map(pileStrength)) : 0

  // best future hand that actually USES a drawn card and beats what I can make now
  const future = candidatePiles([...reals, ...peekReals])
    .filter((c) => c.some((card) => peekIds.has(card.id)))
    .filter((c) => pileStrength(c) > nowStrength)
    .sort((a, b) => pileStrength(b) - pileStrength(a))
  const target = future[0]
  if (!target) return null

  const protect = new Set(target.filter((c) => !peekIds.has(c.id)).map((c) => c.id))
  const spare = reals.filter((c) => !protect.has(c.id))
  const sp = noTripSplits(candidatePiles(spare), hand)
  if (sp.length) return weakest(sp)
  const junk = junkCards(hand, protect)
  if (junk.length) return junk
  if (spare.length) return [[...spare].sort((a, b) => a.rank - b.rank)[0]]
  return null
}

/** 詐唬(只 3 種,全配空白牌,絕不燒有用的真牌):
 *   ① 空白 + 最弱沒成對的單張 → 看起來像一對(其實廢牌,保留手上對子去湊三條/葫蘆)
 *   ② 空白 + 中強一對          → 看起來像三條(嚇退對手)
 *   ③ 空白 + 三條              → 看起來像兩對/四張(三條 CP 高,易反殺)
 *  沒有空白就不詐唬(不墊真牌)。加空白只是「加數量」不改牌力,也不會拆掉同花/順。 */
function padBluff(pile: Card[], hand: Card[]): Card[] {
  if (pile.length >= 4) return pile
  const inPile = new Set(pile.map((c) => c.id))
  const blank = hand.find((c) => isBlank(c) && !inPile.has(c.id))
  if (!blank) return pile // 只用空白,沒有就不詐唬
  const cat = evaluate(pile).category
  const single = pile.length === 1 && cat === CATEGORY.HIGH_CARD
  if (cat === CATEGORY.THREE_KIND || cat === CATEGORY.PAIR || single) return [...pile, blank]
  return pile
}

/** How close the match is — used to gate 鬼牌時機 (hold the joker off low-leverage
 *  turns). Low leverage = nobody near winning and slots to spare. */
function lowLeverage(state: GameState, me: PlayerId): boolean {
  const foe = me === 'p1' ? 'p2' : 'p1'
  const near = countCoins(state, me) >= 3 || countCoins(state, foe) >= 3
  const slotsLeft = emptySlotsFor(state, me).length
  return !near && slotsLeft > 2
}

/** 對手被死神之眼翻開、還沒對決的牌堆(boss 用卡後合法看到的資訊;雙方都看得到)。 */
export function knownFoePiles(state: GameState, me: PlayerId): Card[][] {
  const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'
  return exposedSlots(state, foe)
    .map((i) => state.slots[i])
    .filter((s) => s && s.owner === null && s[foe].length > 0)
    .map((s) => s[foe])
}

/** 死神之眼的停損上限:最多連續忍 2 手。 */
const EYE_MAX_HOLDS = 2

/**
 * 死神之眼看牌後的出牌(使用者 2026-10-16 定案)。boss 出的牌由對手決定放哪一格,所以假設
 * 「對手一定把它放到自己贏得了的那格」→ 只看翻開的牌堆裡最強的那堆:
 *  - 打得過 → 改出「剛好打得過」的最便宜牌,不浪費大牌。
 *  - 打不過 → 不硬出大牌(三條以上),改出小牌/墊牌,把大牌留著。
 *  - 停損(不要被資訊綁住):最多連續忍 2 手;boss 自己第 4 手起、或對手只差一格就贏 → 照平常打。
 * 執行力沒發揮(!sharp)= 這手「忘了」看過的資訊,照平常打。翻開之後對手新放的牌堆照舊蓋著,
 * 那些 boss 沒資訊,不在這裡處理。
 */
function eyeAdjust(pile: Card[], cands: Card[][], hand: Card[], state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng): Card[] {
  const known = knownFoePiles(state, me)
  if (!known.length) return pile
  const h = state.placementsDone[me]
  const prev = rt.eyeHold
  const streak = !prev ? 0 : prev.hand === h ? prev.streak : prev.hand === h - 1 && prev.held ? prev.streak + 1 : 0
  let held = false
  let out = pile
  if (sharp(rt.execution, rng)) {
    const top = known.reduce((b, p) => (compareHands(p, b) > 0 ? p : b), known[0])
    const beat = cands.filter((c) => compareHands(c, top) > 0)
    const plain = beat.filter((c) => !usesJoker(c)) // 不用鬼牌打得過就別浪費鬼牌
    const winners = plain.length ? plain : beat
    if (winners.length) {
      out = winners.reduce((lo, c) => (pileStrength(c) < pileStrength(lo) ? c : lo), winners[0])
    } else {
      const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'
      const mayHold = streak < EYE_MAX_HOLDS && h < 3 && !foeAtMatchPoint(state, foe)
      if (mayHold && tierScore(pile) >= 6) {
        out = smallPile(cands, hand)
        held = true
      }
    }
  }
  rt.eyeHold = { hand: h, streak, held }
  return out
}

/** 忍的時候出的小牌:最沒用的沒成對散牌(不拆大牌,見 junkCards);沒有就出最弱的候選。 */
function smallPile(cands: Card[][], hand: Card[]): Card[] {
  // 手上有 7 以上的對子 → 出最小的那對,不送格(使用者 2026-11-03:有牌出就別讓自己陷入被動);三條以上是要忍的大牌,不出
  if (PICK_TUNE.fix1103) {
    const decent = cands.filter((c) => !usesJoker(c) && isDecent(c) && evaluate(c).category === CATEGORY.PAIR)
    if (decent.length) return weakest(decent)
  }
  const junk = junkCards(hand, monsterCards(cands))
  if (junk.length) return junk
  return weakest(cands)
}

/**
 * 送格調整(模擬比較用;遊戲裡永遠是 true)。dumpTwo = 2026-11-02 使用者定的送格打法:
 * 不單出鬼、送格送 2 張最沒用的牌、沒成牌時收手期出「鬼 + 最大那張」。false = 舊打法(送 1 張、沒成牌就單出鬼 / 最大兩張)。
 */
export const PICK_TUNE = {
  dumpTwo: true,
  /** 2026-11-03 回放檢討的修正(不拆三條、拼牌不拆對、有成牌不送格、弱五張扣分、鬼牌不退回順子 / 同花)。false = 修正前(模擬比較用) */
  fix1103: true,
  /** 2026-11-04 回報:五張牌型也不拆三條。false = 修正前(模擬比較用) */
  fix1104: true,
}

/** 手上普通牌至少幾張才送 2 張(junkCards)。使用者舉的第 6 手(手上 5~6 張)也要送 2 張,所以是 5。 */
const JUNK_TWO_MIN = 5

/** 只有一張鬼牌的那疊(單出鬼 = 白白耗掉鬼牌,使用者 2026-11-02:不准)。 */
const isLoneJoker = (c: Card[]) => c.length === 1 && isJoker(c[0])

/** 手上每個點數有幾張(普通牌)。 */
function rankCounts(hand: Card[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const c of hand) if (!isSpecial(c)) m.set(c.rank, (m.get(c.rank) ?? 0) + 1)
  return m
}

/**
 * 這疊把手上的三條拆成一對(出 2 張、留 1 張落單)。使用者 2026-11-03:握 KKK 出 KK、握 777 出 77 不合理
 * ——要嘛三條、要嘛三條 + 鬼 / 配對子成葫蘆,要嘛出別的。
 */
function splitsTrips(pile: Card[], counts: Map<number, number>): boolean {
  const inPile = rankCounts(pile)
  for (const [r, n] of inPile) {
    if (counts.get(r) !== 3) continue
    if (n === 2) return true
    // 拿一張去湊同花 / 順子也算拆(使用者 2026-11-04:握 10 10 10 出 ♠K 10 6 3 2 同花);同花順以上才值得
    if (n === 1 && PICK_TUNE.fix1104 && evaluate(pile).category < CATEGORY.STRAIGHT_FLUSH) return true
  }
  return false
}

/** 像樣的便宜牌:三條,或 7 以上的對子。 */
function isDecent(pile: Card[]): boolean {
  const v = evaluate(pile)
  return v.category === CATEGORY.THREE_KIND || (v.category === CATEGORY.PAIR && (v.rankSeq[0] ?? 0) >= 7)
}

/** 手上(不用鬼)湊得出像樣的便宜牌嗎。 */
function hasDecent(hand: Card[]): boolean {
  return [...rankCounts(hand)].some(([r, n]) => n >= 3 || (n === 2 && r >= 7))
}

/** 拿掉拆三條的那幾疊(拿完沒東西就照舊)。 */
function noTripSplits(cands: Card[][], hand: Card[]): Card[][] {
  if (!PICK_TUNE.fix1103) return cands
  const counts = rankCounts(hand)
  const ok = cands.filter((c) => !splitsTrips(c, counts))
  return ok.length ? ok : cands
}

/**
 * 送格要送「最沒用的 2 張」(使用者 2026-11-02):送 1 張 = 對手一看就知道最多是單張,拿最便宜的牌就吃掉,
 * 等於白送一格;送 2 張對手分不出是一對還是高牌(例:對手有 8 一對和 3 條,不知道該用哪個打哪疊),
 * 送格才有價值。最沒用 = 沒成對的單張裡:點數低、不是湊同花(同花色 ≥ 3 張)/ 順子(4 連)的料、
 * 有鬼牌時 Q 以上留著(之後跟鬼湊大對)。protect = 不能動的牌(要留的大牌 / 拼牌)。
 */
function junkCards(hand: Card[], protect: Set<string>, count?: number): Card[] {
  const reals = hand.filter((c) => !isSpecial(c))
  // 送 2 張只在手上普通牌還多(≥ 8 張)時;後段牌少了送 1 張,不浪費(使用者 2026-11-02 同意)
  const n = count ?? (PICK_TUNE.dumpTwo && reals.length >= JUNK_TWO_MIN ? 2 : 1)
  const rankCount = new Map<number, number>()
  const suitCount = new Map<string, number>()
  for (const c of reals) {
    rankCount.set(c.rank, (rankCount.get(c.rank) ?? 0) + 1)
    suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1)
  }
  const hasJoker = hand.some(isJoker)
  const draw = new Set((straightDrawCards(reals) ?? []).map((c) => c.id))
  const useful = (c: Card): number =>
    c.rank + Math.max(0, (suitCount.get(c.suit) ?? 0) - 2) * 6 + (draw.has(c.id) ? 8 : 0) + (hasJoker && c.rank >= 12 ? 10 : 0)
  return reals
    .filter((c) => !protect.has(c.id) && (rankCount.get(c.rank) ?? 0) === 1)
    .sort((a, b) => (PICK_TUNE.dumpTwo ? useful(a) - useful(b) : 0) || a.rank - b.rank)
    .slice(0, n)
}

/**
 * 手上沒有任何成牌(鬼牌也湊不出同花 / 順子)時出什麼(使用者 2026-11-02):
 *  - 收手期(落後 / 後段,見 shouldCashOut)或失手 → 出最大的:有鬼 = 鬼 + 最大那張(強一對 hold 住);沒鬼 = 最大兩張。
 *  - 其他時候 → 送格:送 2 張最沒用的牌(junkCards),鬼牌和大牌留著。
 * 絕不單出一張鬼。
 */
function noMadeHandPick(hand: Card[], state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng): Card[] {
  const reals = hand.filter((c) => !isSpecial(c))
  const joker = hand.find(isJoker)
  if (!reals.length) return fallbackPile(hand)
  if (shouldCashOut(state, me, rt) || !sharp(rt.execution, rng)) {
    // 沒鬼:最大兩張高牌只在最後一手出;其他時候詐唬也是送兩張小的(使用者 2026-11-03:兩張大高牌詐唬不合理)
    const last = SLOT_COUNT - state.placementsDone[me] <= 1
    if (!joker && PICK_TUNE.fix1103 && !last) {
      const junk = junkCards(hand, new Set())
      if (junk.length) return junk
    }
    if (!joker) return fallbackPile(hand)
    const top = reals.reduce((b, c) => (c.rank > b.rank ? c : b), reals[0])
    return [top, joker]
  }
  const junk = junkCards(hand, new Set())
  return junk.length ? junk : fallbackPile(hand)
}

// ---- 看棋盤 + 反推(一般牌組,2026-11-02 使用者定) ------------------------------------------
//
// 原本出牌只看自己的牌:鬼牌一用就被升到最大(第 1 手 45~48% 出葫蘆)、後段沒牌(第 6~7 手一半是散牌)。
// 改成跟空城計 / 撲朔迷離一樣看棋盤(limitedPlace.blankBoardScores,一般牌組用 NORMAL_TABLE):
//   每種出法 → 對手等著的牌照「張數 → 分布表」抽 → 對手會把這疊放哪 → 這手的期望(格子價值)
//   + 看未來(剩下的牌之後還湊得出多少)× 打法比重 − 用鬼的成本 + 打法自己選的那手加分。
// 第二段(反推):我出強牌時,對手沒拿去撞的那幾疊 → 大概打不過我那疊(使用者:「他 5 不敢撞我 5,頂多小葫 / 同花」)。

/** 看棋盤可調參數(模擬調過;on = false 回到舊打法,模擬比較用)。 */
export const BOARD_TUNE = {
  on: true,
  samples: 10,
  /** 看未來比重:強攻最看現在、囤牌最看以後 */
  gamma: { attack: 0.45, balance: 0.75, hoard: 0.95 } as Record<PickMain, number>,
  /** 每用一張鬼扣的分(鬼牌是最萬用的資源,不要第一手就隨便升到最大) */
  jokerCost: 0.3,
  /** 打法自己選的那手加分(保住打法個性:強攻還是會強攻) */
  styleBonus: 0.2,
  noise: 0.06,
  /** 調參用:每次看棋盤把各選項的分數丟出來(遊戲裡是 null) */
  debug: null as null | ((rows: { pile: string; now: number; future: number; joker: number; use: number; style: number; total: number }[]) => void),
  /** 之後的手只是「送格」也有一點點價值 */
  sacWin: 0.05,
  /** 每種(牌型, 有沒有用鬼)最多留幾個候選 */
  perKind: 2,
  /** 鬼牌用途效益(使用者定:葫蘆 / 三條 / 鐵支最划算 > 同花 > 順子):用鬼湊成這些牌型的加分 */
  jokerUse: { [CATEGORY.THREE_KIND]: 0.25, [CATEGORY.FULL_HOUSE]: 0.25, [CATEGORY.FOUR_KIND]: 0.25, [CATEGORY.STRAIGHT_FLUSH]: 0.25, [CATEGORY.STRAIGHT]: -0.1 } as Record<number, number>,
  /** 前段出弱五張(順子 / 同花)扣的分(手上有三條 / 7 以上對子可出時;沒有就同花不扣、順子扣一半):
   *  一次燒 5 張,後段就沒牌(使用者 2026-11-03:「牌變少的元兇」,順子優先權最低) */
  fiveCost: { [CATEGORY.STRAIGHT]: 0.3, [CATEGORY.FLUSH]: 0.15 } as Record<number, number>,
  /** 反推:我那疊至少這麼強(贏隨便一疊的機率)才算「對手不敢撞」 */
  readMin: 0.55,
  /** 反推:對手沒拿去撞的那疊裡「打得過我那疊」的可能 × 這個 */
  avoid: 0.4,
}

/** 看未來算幾手。 */
const FUTURE_HANDS = 3

/** 前幾手出 5 張大牌時才交給看棋盤重新考慮(後段出大牌本來就該出)。 */
const BOARD_EARLY_HANDS = 3

/** 這手出的牌 + 當時對手等著的牌(第二段反推用)。 */
interface LastPick {
  cards: Card[]
  waiting: { slot: number; count: number }[]
}
/** 反推讀到的:第 slot 格對手那疊(count 張)大概打不過 cards。 */
interface FoeRead {
  slot: number
  count: number
  cards: Card[]
}
const lastPicks = new WeakMap<BossRuntime, LastPick>()
const foeReads = new WeakMap<BossRuntime, FoeRead[]>()

/** 測試用:目前反推讀到的(唯讀)。 */
export const bossReadsOf = (rt: BossRuntime): readonly FoeRead[] => foeReads.get(rt) ?? []

/** 對手那邊還在等對決的格子(我這邊還空著、他那邊有牌)。 */
function foeWaiting(state: GameState, me: PlayerId): { slot: number; count: number }[] {
  const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'
  return state.slots
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.owner === null && s[me].length === 0 && s[foe].length > 0)
    .map(({ s, i }) => ({ slot: i, count: s[foe].length }))
}

function rememberPick(state: GameState, me: PlayerId, rt: BossRuntime, ids: string[]): void {
  if (!BOARD_TUNE.on || hasPlaceTable(state.mode)) return
  lastPicks.set(rt, { cards: state.hands[me].filter((c) => ids.includes(c.id)), waiting: foeWaiting(state, me) })
}

/**
 * 第二段:上一手我出的牌被對手放進第 j 格。那時對手等著、他卻沒拿來撞的那幾疊 →
 * 如果我那疊夠強,代表他不敢撞:那幾疊「打得過我那疊」的可能打折(FoeRead,看棋盤時套用)。
 */
function observeLastPick(state: GameState, me: PlayerId, rt: BossRuntime): void {
  const last = lastPicks.get(rt)
  if (!last) return
  lastPicks.delete(rt)
  const ids = new Set(last.cards.map((c) => c.id))
  const j = state.slots.findIndex((s) => s[me].length === ids.size && s[me].every((c) => ids.has(c.id)))
  if (j < 0 || normalStrength(last.cards) < BOARD_TUNE.readMin) return
  const add = last.waiting.filter((w) => w.slot !== j).map((w) => ({ ...w, cards: last.cards }))
  if (add.length) foeReads.set(rt, [...(foeReads.get(rt) ?? []), ...add])
}

/** 看棋盤時,對手第 slot 格那疊的分布套用反推(那疊沒變、還在等才算)。 */
function readAdjust(state: GameState, me: PlayerId, rt: BossRuntime): ((slot: number, dist: PileEntry[]) => PileEntry[]) | undefined {
  const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'
  const reads = (foeReads.get(rt) ?? []).filter((r) => state.slots[r.slot].owner === null && state.slots[r.slot][foe].length === r.count)
  foeReads.set(rt, reads)
  if (!reads.length) return undefined
  return (slot, dist) => {
    const mine = reads.filter((r) => r.slot === slot)
    if (!mine.length) return dist
    const out = dist.map((e): PileEntry => {
      let p = e[3]
      for (const r of mine) if (!beatsEntry(r.cards, e)) p *= BOARD_TUNE.avoid
      return [e[0], e[1], e[2], p, e[4]]
    })
    const tot = out.reduce((s, e) => s + e[3], 0)
    return tot > 0 ? out.map((e): PileEntry => [e[0], e[1], e[2], e[3] / tot, e[4]]) : dist
  }
}

/** 看未來:剩下的牌一手一手挑最強的(貪心),前 slots 手的強弱加總。 */
function futureValue(rest: Card[], slots: number): number {
  let cards = rest
  let v = 0
  for (let k = 0; k < slots; k++) {
    const cs = candidatePiles(cards).filter((c) => !isLoneJoker(c))
    if (!cs.length) break
    let best = cs[0]
    let bs = -1
    for (const c of cs) {
      const s = normalStrength(c)
      if (s > bs) {
        bs = s
        best = c
      }
    }
    v += 2 * (bs - BOARD_TUNE.sacWin)
    const used = new Set(best.map((c) => c.id))
    cards = cards.filter((c) => !used.has(c.id))
  }
  return v
}

function boardRefine(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng, hand: Card[], cands: Card[][], stylePile: Card[]): Card[] {
  if (!BOARD_TUNE.on || hasPlaceTable(state.mode)) return stylePile
  const left = SLOT_COUNT - state.placementsDone[me]
  if (left <= 1) return stylePile
  const T = BOARD_TUNE
  const reals = hand.filter((c) => !isSpecial(c))

  // 候選:打法選的那手 + 每種(牌型, 有沒有用鬼)最強的幾個 + 送格(2 張或 1 張最沒用的)
  const opts: Card[][] = [stylePile]
  const byKind = new Map<number, Card[][]>()
  for (const c of cands) {
    const k = evaluate(c).category * 2 + (usesJoker(c) ? 1 : 0)
    byKind.set(k, [...(byKind.get(k) ?? []), c])
  }
  // 同一種牌型只考慮最大的(使用者 2026-11-03:握 AA + 1010 + 鬼出 1010 很怪 —— 之後補 A 跟補 10 機率一樣,
  // AA 鬼 / 1010 鬼 留到後面都很強,不如現在出 AA;一對比鐵支容易成,強一對現在出更有價值)
  const perKind = PICK_TUNE.fix1103 ? 1 : T.perKind
  for (const cs of byKind.values()) opts.push(...cs.sort((a, b) => normalStrength(b) - normalStrength(a)).slice(0, perKind))
  // 送格只在手上沒有像樣的牌(三條、7 以上的對子)時才考慮(使用者 2026-11-03:握 AA / 1010 / 88 / 77
  // 第一手送 6 3 高牌 不合理 —— 跟囤牌一樣,有中強成牌就領成牌)
  const decent = PICK_TUNE.fix1103 && hasDecent(hand)
  const junk = decent ? [] : junkCards(hand, new Set())
  if (junk.length) opts.push(junk)
  const seen = new Set<string>()
  const uniq = opts.filter((o) => {
    const id = o.map((c) => c.id).sort().join()
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  if (uniq.length <= 1) return stylePile

  const now = blankBoardScores(state, me, uniq, T.samples, rng, 0, readAdjust(state, me, rt))
  // 看未來:現在留著的牌,之後(最多 FUTURE_HANDS 手)還湊得出多少。補到的牌多半湊不成牌型,不算進來
  // (第一版用「補 2.5 張湊一手」扣掉,前幾手算出來是 0 手 → 看未來整個沒作用)
  const slotsForRest = Math.min(left - 1, FUTURE_HANDS)
  const gamma = T.gamma[rt.main]
  let best = 0
  let top = -Infinity
  const rows: NonNullable<Parameters<NonNullable<typeof T.debug>>[0]> = []
  uniq.forEach((o, k) => {
    const used = new Set(o.map((c) => c.id))
    const rest = hand.filter((c) => !used.has(c.id))
    const fut = slotsForRest > 0 && reals.length ? futureValue(rest, slotsForRest) : 0
    const jokers = o.filter(isJoker).length
    const use = jokers ? (T.jokerUse[evaluate(o).category] ?? 0) : 0
    const style = o === stylePile ? T.styleBonus : 0
    // 弱五張扣分:手上有三條 / 7 以上對子可出時才扣滿;沒對沒三條時同花不扣、順子扣一半(使用者 2026-11-03:
    // 「同花沒那麼差,完全沒對沒三條又要出強牌時,同花就是考量點」)
    const five = PICK_TUNE.fix1103 && o.length >= 5 ? (T.fiveCost[evaluate(o).category] ?? 0) * (decent ? 1 : evaluate(o).category === CATEGORY.FLUSH ? 0 : 0.5) : 0
    const s = now[k] + gamma * fut - T.jokerCost * jokers + use + style - five + rng() * T.noise
    if (T.debug) rows.push({ pile: o.map((c) => (isJoker(c) ? '鬼' : `${c.suit}${c.rank}`)).join(' '), now: now[k], future: gamma * fut, joker: -T.jokerCost * jokers, use, style, total: s })
    if (s > top) {
      top = s
      best = k
    }
  })
  T.debug?.(rows)
  return uniq[best]
}

export function bossPick(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng = Math.random): string[] {
  observeLastPick(state, me, rt) // 第二段:上一手的牌被對手放到哪 → 反推對手等著的牌
  const ids = pickCore(state, me, rt, rng)
  rememberPick(state, me, rt, ids)
  return ids
}

function pickCore(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng): string[] {
  const hand = state.hands[me]
  // 單出一張鬼不當候選(使用者 2026-11-02:把鬼耗掉不合理)。拿掉後沒候選 = 手上沒任何成牌 → noMadeHandPick。
  const all = candidatePiles(hand)
  const cands = noTripSplits(PICK_TUNE.dumpTwo ? all.filter((c) => !isLoneJoker(c)) : all, hand)
  if (cands.length === 0) return (PICK_TUNE.dumpTwo ? noMadeHandPick(hand, state, me, rt, rng) : fallbackPile(hand)).map((c) => c.id)

  const cashOut = shouldCashOut(state, me, rt)

  // Under-execution (blunder): fall back to the naive strongest pile.
  let pile: Card[]
  const sharpPick = sharp(rt.execution, rng)
  if (!sharpPick) {
    pile = strongest(cands)
  } else {
    pile =
      rt.main === 'attack'
        ? attackPick(cands, hand)
        : rt.main === 'hoard'
          ? hoardPick(cands, hand, state, me, rt)
          : balancePick(cands, hand, state, me, rt)
  }

  // 拼牌 / peek: hold pieces of a better next-turn hand and send filler — UNLESS we're
  // cashing out (behind / late), when we tempo up instead of building.
  let holding = false // 偷窺 / 拼牌決定留牌 → 看棋盤不蓋掉這個計畫
  if (!cashOut) {
    let held: Card[] | null = null
    if (rt.peekDraw) held = peekHoldPick(hand, rt.peekDraw) // 偷窺:一般化留牌(任何升級)
    if (!held && lowLeverage(state, me) && fires(rt.profile.draw, rng)) held = drawHoldPick(hand, rt.main)
    if (held && held.length) {
      pile = held
      holding = true
    }
  }

  // 鬼牌:必須「升級牌型」才用(禁跳張、禁高牌→一對);用時搜尋所有鬼牌擺法,挑升最多階、又
  // 保留最好後手的組合(bestJokerCombo)。鬼牌時機% 高 → 升幅不大的低槓桿把鬼牌收起來留高槓桿。
  if (usesJoker(pile)) {
    const noJoker = cands.filter((c) => !usesJoker(c))
    const bestNoJoker = noJoker.length ? strongest(noJoker) : null
    const baseTier = bestNoJoker ? tierScore(bestNoJoker) : 0
    const jUp = cands.filter(
      (c) => usesJoker(c) && tierScore(c) > baseTier && !(baseTier <= 1 && evaluate(c).category === CATEGORY.PAIR),
    )
    if (!jUp.length) {
      if (bestNoJoker) pile = bestNoJoker
    } else {
      pile = bestJokerCombo(jUp, hand)
      const jump = tierScore(pile) - baseTier
      // 鬼牌留著等高槓桿 —— 但不退回順子 / 同花(使用者 2026-11-03:有 ♠Q J 10 8 + 鬼的同花順,先手卻出順子)
      const weakFive = PICK_TUNE.fix1103 && bestNoJoker && bestNoJoker.length >= 5 && evaluate(bestNoJoker).category <= CATEGORY.FLUSH
      if (bestNoJoker && !weakFive && jump < 4 && lowLeverage(state, me) && fires(rt.profile.jokerTiming, rng)) pile = bestNoJoker
    }
  }

  // 看棋盤(一般牌組,2026-11-02):打法選的那手 vs 其他出法(不用鬼 / 鬼只升一點 / 送格…),
  // 依對手等著的牌(張數 → 分布表)和他會怎麼放,挑期望最高的;打法自己的選擇有加分,強攻還是強攻。
  // 只管兩種情況(使用者要解決的「前強後超弱」):這手要用鬼、或前 3 手要出 5 張大牌。
  // 打法自己的其他決定(囤牌留同花、偷窺留牌…)不碰。
  // 三種打法都看棋盤(看對手等著的牌決定要不要出大牌 / 升級);打法個性靠 BOARD_TUNE.gamma(強攻最看現在)+ styleBonus 保住。
  // 2026-11-02 模擬:只讓平衡考慮時,強攻 / 囤牌對舊打法 47~49%(比舊的還弱);三種都考慮 51~54%、打基本 AI 強攻 61% / 囤牌 67%。
  const bigEarly = pile.length >= 5 && state.placementsDone[me] < BOARD_EARLY_HANDS
  if (sharpPick && !holding && (usesJoker(pile) || bigEarly)) pile = boardRefine(state, me, rt, rng, hand, cands, pile)

  // 死神之眼:看過對手翻開的牌堆 → 打得過就出剛好打得過的,打不過就忍(有停損)。
  pile = eyeAdjust(pile, cands, hand, state, me, rt, rng)

  // 詐唬: 只用空白牌把可見張數墊大(3 種樣式,見 padBluff)。
  if (fires(rt.profile.bluff, rng)) {
    pile = padBluff(pile, hand)
  }

  return pile.map((c) => c.id)
}

// ---- place ---------------------------------------------------------------

/** 牌力權重 1..11(使用者定的佈局尺標):強5張(同花順/葫蘆)11、鐵支10、同花9、順子8、
 *  強三條7、弱三條6、兩對5、強一對4、中一對3、弱一對2、高牌1。放牌時用它比「階差」。 */
function tierScore(pile: Card[]): number {
  const v = evaluate(pile)
  const hi = v.rankSeq[0] ?? 0
  switch (v.category) {
    case CATEGORY.STRAIGHT_FLUSH:
      return 11
    case CATEGORY.FULL_HOUSE:
      return 11
    case CATEGORY.FOUR_KIND:
      return 10
    case CATEGORY.FLUSH:
      return 9
    case CATEGORY.STRAIGHT:
      return 8
    case CATEGORY.THREE_KIND:
      return hi >= 10 ? 7 : 6
    case CATEGORY.TWO_PAIR:
      return 5
    case CATEGORY.PAIR:
      return hi >= 11 ? 4 : hi >= 7 ? 3 : 2
    default:
      return 1
  }
}

/** Inferred tier of an incoming pile from its card COUNT alone (blind placer) —
 *  the expected weight of that many cards. insight later discounts it (詐唬 padding
 *  makes weak piles look big). */
const COUNT_TIER = [0, 1, 3, 6, 5.5, 9] as const // index by count 1..5
function countTier(count: number): number {
  return COUNT_TIER[Math.min(5, Math.max(1, count))]
}

/** 讀「出牌序」推真實階(看破用)。七手撲克選牌會照排序(預設:依大小、小到大)即時把牌
 *  推出來排好,是刻意做的資訊戰信號。這裡把那疊照 rank 升冪排開、忽略空白墊張(→看穿詐唬:
 *  一對+空白讀成一對而非三條),用排序後的結構(同階群 / 連續 / 同花 / 鬼牌補強)判出牌型,
 *  回傳其牌力階。相當於評估這疊的真實牌力(boss 看得到選了哪些牌);"讀得多準" 由 bossPlace
 *  以看破值對「純張數估計」做內插。 */
function readOrderTier(cards: Card[]): number {
  const ordered = [...cards].filter((c) => !isBlank(c)).sort((a, b) => a.rank - b.rank)
  return tierScore(ordered)
}

/** Coins `owner` holds adjacent to slot i. */
function adjacentCoins(state: GameState, owner: PlayerId, i: number): number {
  let n = 0
  if (state.slots[i - 1] && ownsSlot(state.slots[i - 1], owner)) n++
  if (state.slots[i + 1] && ownsSlot(state.slots[i + 1], owner)) n++
  return n
}

/** Would `foe` win the match if they came to own slot i? (4 coins OR a 3-in-a-row
 *  completed by i.) Public-info only — used for 擋殺. */
function foeWinsIfOwns(state: GameState, foe: PlayerId, i: number): boolean {
  const coins = countCoins(state, foe) + (ownsSlot(state.slots[i], foe) ? 0 : 1)
  if (coins >= 4) return true
  const n = state.slots.length
  for (let s = 0; s <= n - 3; s++) {
    let ok = true
    for (let k = s; k < s + 3; k++) {
      if (!(k === i || ownsSlot(state.slots[k], foe))) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

/** Is the foe one winnable slot away from taking the match? */
function foeAtMatchPoint(state: GameState, foe: PlayerId): boolean {
  for (let i = 0; i < state.slots.length; i++) {
    if (ownsSlot(state.slots[i], foe)) continue
    if (foeWinsIfOwns(state, foe, i)) return true
  }
  return false
}

export function bossPlace(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng = Math.random): number {
  const picker = state.pendingPick!.by // the foe (human)
  const empties = emptySlotsFor(state, picker)
  if (empties.length <= 1) return empties[0] ?? 0

  const incomingCount = state.pendingPick!.cards.length // COUNT only — never read values
  const sharpNow = sharp(rt.execution, rng)
  const matchPoint = foeAtMatchPoint(state, picker)
  const center = (state.slots.length - 1) / 2

  // incoming 的推估牌力(階):spy 看過手牌 → 讀真牌真實階;否則從張數推估、再用看破折扣
  // (詐唬會把弱牌墊成大張數,看破越高越不被騙 → 往下修)。
  const incoming = state.pendingPick!.cards
  let it: number
  if (rt.spySeen) {
    it = tierScore(incoming) // 讓我看看:完美看破(讀真牌)+ 出牌側也會用(見 shouldCashOut)
  } else {
    // 看破 = 讀「出牌序」的準度。七手撲克選牌會即時把牌照排序推出來,是刻意做的資訊戰信號:
    // 讀 readOrderTier 從排序結構(同階群→對/三條、連續→順、同花、且忽略空白墊張→看穿詐唬)
    // 推真實階。準度隨看破值線性內插:看破 0 → 純張數(原佈局法);越高 → 越接近真讀。
    const insightEff = (rt.profile.insight / 100) * (sharpNow ? 1 : 0.5)
    it = countTier(incomingCount) * (1 - insightEff) + readOrderTier(incoming) * insightEff
  }

  // 佈局(權重階差):把 incoming 放進「用哪一格的牌接最划算」的格子。
  //   贏面(bt>it):領先 1~1.5 階最理想;超殺越多扣越重,而且 5 張大牌(bt≥8)超殺懲罰更狠
  //     → 絕不拿葫蘆去撞一對。│ 均勢:可接受的小賭。│ 明顯輸:犧牲最弱的牌認賠。
  //   例外(擋殺 / 自己三連)才允許強撞弱。低執行力(!sharp)退回舊的「梭最強去撞」壞習慣。
  const WIN_BASE = 50
  const IDEAL_GAP = 1.5
  let best = empties[0]
  let bestScore = -Infinity
  for (const i of empties) {
    const myPile = state.slots[i][me]
    let score = 0

    if (myPile.length === 0) {
      score += 26 // 避戰: defer into an empty slot — no pile spent, duel deferred
    } else if (!sharpNow) {
      // 失手(低執行力):粗略「贏得了就用最強去撞」,重現舊的過度投入手感。
      const gap = tierScore(myPile) - it
      score += gap >= 0 ? 55 + gap * 4 : 12 + gap * 3
      if (foeWinsIfOwns(state, picker, i) && gap < 0) score -= 140
    } else {
      const bt = tierScore(myPile)
      const gap = bt - it
      if (gap >= 0.5) {
        // 贏面:超殺越多扣越重;5 張大牌超殺懲罰加倍(別浪費)。
        const overkill = Math.max(0, gap - IDEAL_GAP)
        score += WIN_BASE - overkill * (bt >= 8 ? 8 : 3)
        if (adjacentCoins(state, me, i) > 0) score += 15 // 佈線:湊自己的連線
      } else if (gap > -1.5) {
        score += 30 // 均勢:用階數相當的牌小賭一格
      } else {
        // 犧牲:明顯贏不了 → 用最弱的牌認賠(弱牌接強牌);別把致勝格送出去。
        score += 16 - bt * 1.5
        if (foeWinsIfOwns(state, picker, i)) score -= 140
      }
    }

    // 擋殺 / 自己三連可強撞弱:對手 match point 時,寧可超殺也要守住能被對手拿去致勝的格。
    if (matchPoint && sharpNow && foeWinsIfOwns(state, picker, i)) {
      const denies = myPile.length > 0 && (rt.spySeen ? compareHands(myPile, incoming) > 0 : tierScore(myPile) - it >= 0.5)
      score += denies ? 120 : -250
    }

    score -= Math.abs(center - i) * 0.5 // mild centre preference
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

// ---- special cards (campaign boss) ---------------------------------------

/**
 * Which special card (if any) the campaign boss should activate this pick turn.
 * The boss carries `loadout` (x-2 = [signature]; x-3 = swap + earned signatures)
 * and spends exactly one per match. Policy:
 *  - value cards first: suit-bloom toward a real flush cluster, or swap to dump a
 *    low dead card (same as the default AI);
 *  - otherwise fall back to an info card (spy > peek) so the boss DOES use its
 *    signature — immediately when it holds only info cards (x-2), else late (x-3),
 *    so it never blocks a better value play.
 *
 * x-3 有多張可選時,用「這局期望價值」排序挑一張(SPEC 使用者 2026-08-16):
 *   花色牌(能湊成同花時)≈ spy ≈ peek  >>>>  swap(價值極低,只值換掉死牌)。
 *   spy 對高看破 boss 加成、peek 對高拼牌 boss 加成 → 高看破/高拼牌 boss 早期就偏好資訊牌。
 * Returns { card, targetId? } — peek/spy carry no target.
 */
/**
 * 強迫更新的觸發條件數(0~4,越多越想用):對方用過特殊牌、對方在囤牌(已出過牌、手上普通牌仍 ≥10)、
 * 自己落後(硬幣比對方少)、自己牌爛(手牌湊不到三條以上)。只讀公開資訊 + 自己手牌,不偷看。
 */
export function refreshTriggers(state: GameState, me: PlayerId): number {
  const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'
  const foeUsed = state.specialUsed[foe]
  const foeHoarding = state.placementsDone[foe] >= 1 && state.hands[foe].filter(isTargetable).length >= 10
  const behind = countCoins(state, foe) > countCoins(state, me)
  const weak = bestCategoryOf(state.hands[me]) <= CATEGORY.TWO_PAIR
  return [foeUsed, foeHoarding, behind, weak].filter(Boolean).length
}

/**
 * 爆破的觸發條件數(0~3):對方可炸的牌 ≤ 8 張(手牌少,一炸更可能炸到關鍵牌)、對方快贏了
 * (≥3 幣,或只差一格就贏)、自己落後(硬幣比對方少)。只讀公開資訊(張數、盤面),不偷看。
 */
export function explodeTriggers(state: GameState, me: PlayerId): number {
  const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'
  const fewCards = explodeTargets(state, me).length <= 8
  const foeClose = countCoins(state, foe) >= 3 || foeAtMatchPoint(state, foe)
  const behind = countCoins(state, foe) > countCoins(state, me)
  return [fewCards, foeClose, behind].filter(Boolean).length
}

/** 死神之眼「只有 1 堆且是 5 張」時用卡的機率(使用者定 40%)。 */
const EYE_MAYBE = 0.4
/** 其他 boss / 快速配對人機用死神之眼:本尊機率再乘這個(目標整場使用率 2~3 成,模擬調過)。 */
const EYE_OTHER = 0.08

/**
 * 死神之眼的時機(只讀公開資訊:對手場上蓋牌的堆數、張數):
 *  sure  = 對手 ≥2 堆蓋牌,或 boss 自己第 4 手起(已出 3 手)且有 ≥1 堆
 *  maybe = 只有 1 堆、而且是 5 張
 *  none  = 沒有蓋牌,或只有 1 堆不到 5 張
 */
export function deathEyeTrigger(state: GameState, me: PlayerId): 'sure' | 'maybe' | 'none' {
  const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'
  const slots = deathEyeSlots(state, me)
  if (!slots.length) return 'none'
  if (slots.length >= 2 || state.placementsDone[me] >= 3) return 'sure'
  return state.slots[slots[0]][foe].length >= 5 ? 'maybe' : 'none'
}

export function bossChooseSpecial(
  state: GameState,
  me: PlayerId,
  loadout: SpecialCardId[],
  profile?: BossProfile,
  opts: { signature?: SpecialCardId; rng?: Rng } = {},
): { card: SpecialCardId; targetId?: string; targetIds?: string[] } | null {
  if (state.specialUsed[me]) return null
  const hand = state.hands[me]
  const insight = profile?.insight ?? 0
  const draw = profile?.draw ?? 0
  const rng = opts.rng ?? Math.random

  type Cand = { card: SpecialCardId; targetId?: string; targetIds?: string[]; score: number }
  const cands: Cand[] = []

  // 死神之眼(使用者 2026-10-16 定案):看光對手已放在決鬥區、還沒對決的牌堆。每一手判斷:
  //  - 對手 ≥2 堆蓋牌 → 一定用;只有 1 堆且是 5 張 → 40%;boss 自己第 4 手起有 1 堆就用;0 堆 → 等下一手。
  //  - 依粿 9-2(只帶這張):照上面。
  //  - 依粿 9-3(卡池):照上面;這手沒用到死神之眼 → 12% 改用其他卡(往下走一般選卡),88% 這手不用卡。
  //  - 其他 boss / 快速配對人機:同樣條件,但只小機率用。
  // 放在最前面:9-3 本尊等死神之眼時,不能被卡池裡的爆破/強迫更新搶先用掉。
  if (loadout.includes('deathEye')) {
    const t = deathEyeTrigger(state, me)
    const own = opts.signature === 'deathEye'
    const roll = t === 'sure' ? 1 : t === 'maybe' ? EYE_MAYBE : 0
    if (own) {
      if (roll > 0 && rng() < roll) return { card: 'deathEye' }
      if (loadout.length === 1) return null
      if (rng() >= 0.12) return null
      loadout = loadout.filter((c) => c !== 'deathEye') // 12%:往下走一般選卡,只挑其他卡
    } else if (roll > 0 && rng() < roll * EYE_OTHER) return { card: 'deathEye' }
  }

  // 爆破(使用者 2026-10-13 定案):隨機炸對手一張 → 對手手牌越少越可能炸到關鍵牌,所以中後期用。
  //  - 啄木鳥 8-2(只帶這張):有觸發條件就用;到自己第 5 手還沒用 → 強制用(讓玩家一定看得到)。
  //  - 啄木鳥 8-3(卡池,使用者 2026-10-13/14 改):每一手都一樣——有條件就用爆破;沒條件就 12% 改用其他卡
  //    (照下面一般選卡挑,這手不會是爆破),88% 這手不用卡。
  //  - 其他 boss / 快速配對人機:有觸發條件才小機率用。
  // 放在強迫更新前面:8-3 本尊等爆破時,不能被卡池裡的強迫更新搶先用掉。
  if (loadout.includes('explode') && canExplode(state, me)) {
    const conds = explodeTriggers(state, me)
    const own = opts.signature === 'explode'
    if (own && loadout.length === 1) return conds > 0 || state.placementsDone[me] >= 4 ? { card: 'explode' } : null
    if (own) {
      if (conds > 0) return { card: 'explode' }
      if (rng() >= 0.12) return null
      loadout = loadout.filter((c) => c !== 'explode') // 12%:往下走一般選卡,只挑其他卡
    } else if (conds > 0 && rng() < Math.min(0.25, 0.08 + 0.06 * (conds - 1))) return { card: 'explode' }
  }

  // 強迫更新(使用者 2026-10-11 定案):只在 boss 自己的前 4 手內考慮。
  //  - 柴柴 7-2(只帶這張):有觸發條件就用;到第 4 手還沒用 → 強制用(推廣這張卡,一定要讓玩家看到)。
  //  - 柴柴 7-3(卡池):前 4 手優先等這張(其他卡先不用),每手機率較高;過了第 4 手才換其他卡。
  //  - 其他 boss / 快速配對人機:有觸發條件才小機率用。
  if (loadout.includes('refresh') && state.placementsDone[me] < 4 && canRefresh(state, me)) {
    const conds = refreshTriggers(state, me)
    const own = opts.signature === 'refresh'
    if (own && loadout.length === 1) {
      if (conds > 0 || state.placementsDone[me] === 3) return { card: 'refresh' }
      return null
    }
    if (own) return rng() < Math.min(0.9, 0.3 + 0.2 * conds) ? { card: 'refresh' } : null
    if (conds > 0 && rng() < Math.min(0.25, 0.08 + 0.06 * (conds - 1))) return { card: 'refresh' }
  }

  // suit-bloom → ONLY to complete/keep a real 5-card flush(規則在 suitVictims)。
  // 2026-11-02 花色卡一次改 1~2 張 → 握 3 張同花色就能換 2 張湊成同花(suitVictims)。
  let bloom: { card: SpecialCardId; targetIds: string[]; suited: number } | null = null
  // 招牌就是花色卡的 boss(四花色關)照舊,其他人手上有強牌就多半先不用
  const ownSuit = !!(opts.signature && getSpecialCard(opts.signature)?.suit)
  const holdOff = !ownSuit && loadout.some((id) => getSpecialCard(id)?.suit) && suitHoldOff(state, me, rng)
  for (const id of holdOff ? [] : loadout) {
    const def = getSpecialCard(id)
    if (!def?.suit) continue
    const victims = suitVictims(state, me, def.suit, rng, suitMaxOf(id))
    if (!victims) continue
    const suited = hand.filter((c) => isTargetable(c) && c.suit === def.suit).length
    if (!bloom || suited > bloom.suited) bloom = { card: id, targetIds: victims.map((c) => c.id), suited }
  }
  if (bloom) cands.push({ card: bloom.card, targetIds: bloom.targetIds, score: 70 + bloom.suited }) // 湊成同花

  // spy / peek — high, especially for high-insight / high-draw bosses (use early).
  if (loadout.includes('spy')) cands.push({ card: 'spy', score: 62 + insight * 0.25 })
  if (loadout.includes('peek')) cands.push({ card: 'peek', score: 58 + draw * 0.25 })

  // swap → dump a low, unpaired dead card (value 極低 — only edges out nothing).
  if (loadout.includes('swap') && state.deck.length > 0) {
    const targets = swapTargets(state, me)
    const rc = new Map<number, number>()
    for (const c of targets) rc.set(c.rank, (rc.get(c.rank) ?? 0) + 1)
    const deadLows = targets.filter((c) => c.rank <= 6 && (rc.get(c.rank) ?? 0) === 1)
    if (deadLows.length) {
      const victim = deadLows.reduce((lo, c) => (c.rank < lo.rank ? c : lo), deadLows[0])
      cands.push({ card: 'swap', targetId: victim.id, score: 20 })
    }
  }

  if (!cands.length) return null
  const pick = cands.reduce((b, c) => (c.score > b.score ? c : b), cands[0])
  if (pick.targetIds) return { card: pick.card, targetIds: pick.targetIds }
  return pick.targetId ? { card: pick.card, targetId: pick.targetId } : { card: pick.card }
}

/**
 * 花色卡要換哪幾張(boss / 火力全開 / 對戰電腦共用;2026-11-02 一次改 1~2 張):
 * 花色卡一定是拿來湊同花 / 同花順(SPEC 使用者 2026-08-16),不拆該留的對子——換沒成對的低散牌。
 *  - 握 3 張該花色 → 換 2 張沒成對的低散牌,湊成 5 張同花(沒有 2 張沒成對的散牌就不換)。
 *  - 握 4 張 → 換 1 張(第 5 張)。
 *  - max ≥ 3(漫天梅花)且握 2 張 → 換 3 張。
 *  - 已是同花(≥5):只有「某張同花牌同時能跟別張湊對(雙用)、且有多餘散牌可換」時換 1 張,同花與對子兼得。
 * 落單的散牌不夠時(2026-11-03 起,有給 rng 才會):對子照強弱擲機率決定能不能拆(PAIR_BREAK:強一對多半不拆、
 * 中一對一半、弱一對多半可拆);要拆就同一對兩張一起換(QQ 都變方塊、KK 留著),不會兩對各拆一張。
 * 回傳 null = 這張卡現在沒用。
 */
export function suitVictims(state: GameState, me: PlayerId, suit: Card['suit'], rng?: Rng, max = 2): Card[] | null {
  const hand = state.hands[me]
  const rankCount = new Map<number, number>()
  for (const c of hand) if (isTargetable(c)) rankCount.set(c.rank, (rankCount.get(c.rank) ?? 0) + 1)
  const suited = hand.filter((c) => isTargetable(c) && c.suit === suit)
  const others = suitTargets(state, me, suit) // targetable, not this suit
  const unpaired = (cards: Card[]) => cards.filter((c) => (rankCount.get(c.rank) ?? 0) === 1)
  const lowest = (cards: Card[], n: number): Card[] | null =>
    cards.length >= n ? [...cards].sort((a, b) => a.rank - b.rank).slice(0, n) : null
  // 落單的優先;不夠再用「擲到可以拆」的對子(由小到大、同一對排在一起)
  const pool = (n: number): Card[] | null => {
    const free = lowest(unpaired(others), unpaired(others).length) ?? []
    if (free.length >= n || !rng || !PICK_TUNE.fix1103) return lowest(free, n)
    const pairRanks = [...new Set(others.filter((c) => rankCount.get(c.rank) === 2).map((c) => c.rank))].sort((a, b) => a - b)
    const ok = pairRanks.filter((r) => rng() < pairBreakChance(r))
    const need = n - free.length
    for (const r of ok) {
      const cards = others.filter((c) => c.rank === r)
      if (cards.length >= need) return [...free, ...cards.slice(0, need)]
    }
    return null
  }
  // 漫天梅花(max 3,第 10 關):握 2 張就能換 3 張湊同花
  if (suited.length === 2 && max >= 3) return pool(3)
  if (suited.length === 3) return pool(2) // 要換 2 張:落單的優先,不夠才用(一對)
  if (suited.length === 4) {
    if (!PICK_TUNE.fix1103) {
      const free = unpaired(others)
      return lowest(free.length ? free : others, 1)
    }
    return pool(1)
  }
  if (suited.length >= 5 && suited.some((s) => (rankCount.get(s.rank) ?? 0) >= 2)) return lowest(unpaired(others), 1)
  return null
}

/** 花色卡拆對子的機率(使用者 2026-11-03):強一對(J 以上)多半不拆、中一對(7~10)一半、弱一對(≤6)多半可拆。 */
export const PAIR_BREAK = { strong: 0.15, mid: 0.5, weak: 0.85 }
function pairBreakChance(rank: number): number {
  return rank >= 11 ? PAIR_BREAK.strong : rank >= 7 ? PAIR_BREAK.mid : PAIR_BREAK.weak
}

/** 手上已經有強牌時,花色卡還是照用的機率(使用者 2026-11-03:「有強一對或其他牌就不用變花色」,寫成機率)。 */
export const SUIT_WITH_STRONG = { strong: 0.25, mid: 0.5 }

/**
 * 花色卡這手先別用:手上不用卡就有好牌時多半先不用 —— 三條或 J 以上的對子 = 強(只有 25% 照用),
 * 7~10 的對子 = 中(50%),只有弱對 / 散牌 = 照用。例:♦♦♦ + QQ + KK + 鬼 → 直接出葫蘆就好,不用為了同花拆對子。
 */
export function suitHoldOff(state: GameState, me: PlayerId, rng: Rng = Math.random): boolean {
  if (!PICK_TUNE.fix1103) return false
  const hand = state.hands[me]
  let level: 'strong' | 'mid' | null = null
  for (const [r, n] of rankCounts(hand)) {
    const lv = n >= 3 || (n === 2 && r >= 11) ? 'strong' : n === 2 && r >= 7 ? 'mid' : null
    if (lv === 'strong') level = 'strong'
    else if (lv === 'mid' && !level) level = 'mid'
  }
  return level !== null && rng() >= SUIT_WITH_STRONG[level]
}
