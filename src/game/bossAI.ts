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
  countCoins,
  emptySlotsFor,
  isTargetable,
  ownsSlot,
  suitTargets,
  swapTargets,
  type GameState,
  type PlayerId,
} from './state'
import { getSpecialCard, type SpecialCardId } from './specialCards'
import { candidatePiles, fallbackPile, pileStrength } from './aiCore'

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
  if (shouldCashOut(state, me, rt)) return strongest(cands) // 收手轉攻:兌現最強成牌

  const trips = cands.filter((c) => evaluate(c).category === CATEGORY.THREE_KIND)
  if (trips.length) return trips.reduce((b, c) => (c[0].rank > b[0].rank ? c : b), trips[0]) // 最高三條

  const midPairs = cands.filter((c) => evaluate(c).category === CATEGORY.PAIR && c[0].rank >= 7)
  if (midPairs.length) return midPairs.reduce((b, c) => (c[0].rank > b[0].rank ? c : b), midPairs[0]) // 最強中強對

  // 沒中強成牌:丟一張低散牌(保留弱對去湊三條/葫蘆、不拆同花/順)。
  const held = monsterCards(cands)
  const rankCount = new Map<number, number>()
  for (const c of hand) if (!isSpecial(c)) rankCount.set(c.rank, (rankCount.get(c.rank) ?? 0) + 1)
  const junkSingles = hand
    .filter((c) => !isSpecial(c) && !held.has(c.id) && (rankCount.get(c.rank) ?? 0) === 1)
    .sort((a, b) => a.rank - b.rank)
  if (junkSingles.length) return [junkSingles[0]]

  // 只剩弱對/兩對等便宜成牌 → 領其中最弱的(照 CP)。
  const cheap = cands.filter((c) => evaluate(c).category < CATEGORY.STRAIGHT)
  if (cheap.length) return cheap.reduce((lo, c) => (cpValue(c) < cpValue(lo) ? c : lo), cheap[0])
  return fallbackPile(hand)
}

/** 平衡(前瞻,不執著馬上兌現): 收手期→兌現最強。否則**保留 5 張大牌**(同花↑除非別無選擇),
 *  在其餘候選裡挑「本手效益(cpValue) + 保留了拼牌潛力(剩牌還有 4 張同花/順的活抽)」最高的領牌
 *  → 常常寧可出中強對而不是馬上砸順子/同花,留著牌去等升更強(對應使用者「出AA留順子牌」)。 */
function balancePick(cands: Card[][], hand: Card[], state: GameState, me: PlayerId, rt: BossRuntime): Card[] {
  if (shouldCashOut(state, me, rt)) return strongest(cands)
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
function drawHoldPick(hand: Card[]): Card[] | null {
  const reals = hand.filter((c) => !isSpecial(c))
  const draw = flushDrawCards(reals) ?? straightDrawCards(reals)
  if (!draw) return null
  const drawSet = new Set(draw.map((c) => c.id))
  const spare = reals.filter((c) => !drawSet.has(c.id))
  const sp = candidatePiles(spare)
  if (sp.length) return weakest(sp)
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
  const sp = candidatePiles(spare)
  if (sp.length) return weakest(sp)
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

export function bossPick(state: GameState, me: PlayerId, rt: BossRuntime, rng: Rng = Math.random): string[] {
  const hand = state.hands[me]
  const cands = candidatePiles(hand)
  if (cands.length === 0) return fallbackPile(hand).map((c) => c.id)

  const cashOut = shouldCashOut(state, me, rt)

  // Under-execution (blunder): fall back to the naive strongest pile.
  let pile: Card[]
  if (!sharp(rt.execution, rng)) {
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
  if (!cashOut) {
    let held: Card[] | null = null
    if (rt.peekDraw) held = peekHoldPick(hand, rt.peekDraw) // 偷窺:一般化留牌(任何升級)
    if (!held && lowLeverage(state, me) && fires(rt.profile.draw, rng)) held = drawHoldPick(hand)
    if (held && held.length) pile = held
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
      if (bestNoJoker && jump < 4 && lowLeverage(state, me) && fires(rt.profile.jokerTiming, rng)) pile = bestNoJoker
    }
  }

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
export function bossChooseSpecial(
  state: GameState,
  me: PlayerId,
  loadout: SpecialCardId[],
  profile?: BossProfile,
): { card: SpecialCardId; targetId?: string } | null {
  if (state.specialUsed[me]) return null
  const hand = state.hands[me]
  const insight = profile?.insight ?? 0
  const draw = profile?.draw ?? 0

  type Cand = { card: SpecialCardId; targetId?: string; score: number }
  const cands: Cand[] = []

  // suit-bloom → ONLY to complete/keep a real 5-card flush (SPEC 使用者 2026-08-16):
  //   花色牌一定是拿來湊同花/同花順。必須已握 ≥4 張該花色,轉「第 5 張」才成同花;而且不去
  //   拆掉更該保留的對子/三條——轉一張沒成對的低散牌當犧牲。已握 5 張(已是同花)時,只有
  //   在「某張同花牌同時能跟別張湊對(雙用)、且有多餘散牌可轉」時才轉,好讓同花與對子兼得。
  const rankCount = new Map<number, number>()
  for (const c of hand) if (isTargetable(c)) rankCount.set(c.rank, (rankCount.get(c.rank) ?? 0) + 1)
  const pickVictim = (cards: Card[]): Card | null => {
    if (!cards.length) return null
    const unpaired = cards.filter((c) => (rankCount.get(c.rank) ?? 0) === 1)
    const pool = unpaired.length ? unpaired : cards
    return pool.reduce((lo, c) => (c.rank < lo.rank ? c : lo), pool[0])
  }
  let bloom: { card: SpecialCardId; targetId: string; suited: number } | null = null
  for (const id of loadout) {
    const def = getSpecialCard(id)
    if (!def?.suit) continue
    const suited = hand.filter((c) => isTargetable(c) && c.suit === def.suit)
    const others = suitTargets(state, me, def.suit) // targetable, not this suit
    if (suited.length < 4) continue // 少於 4 張同花 → 一次轉牌湊不出同花,不亂用

    let victim: Card | null = null
    if (suited.length === 4) {
      victim = pickVictim(others) // 轉第 5 張成同花
    } else {
      // 已是同花:找「同時能湊對的雙用同花牌」,轉一張多餘散牌把它釋放出來(同花+對子兼得)。
      const doubleDuty = suited.some((s) => (rankCount.get(s.rank) ?? 0) >= 2)
      if (doubleDuty) victim = pickVictim(others.filter((o) => (rankCount.get(o.rank) ?? 0) === 1))
    }
    if (victim && (!bloom || suited.length > bloom.suited)) {
      bloom = { card: id, targetId: victim.id, suited: suited.length }
    }
  }
  if (bloom) cands.push({ card: bloom.card, targetId: bloom.targetId, score: 70 + bloom.suited }) // 湊成同花

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
  return pick.targetId ? { card: pick.card, targetId: pick.targetId } : { card: pick.card }
}
