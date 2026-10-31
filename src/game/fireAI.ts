/**
 * 限定房「火力全開」的電腦(LIMITED-ROOM-SPEC §11.7)。出牌 / 放牌照一般房的 boss(limitedAI 分派),
 * 這裡只管特殊卡:帶哪 5 張、這回合要不要用、用哪張。bossAI.ts 一行不改,只唯讀呼叫它的觸發條件。
 *
 * 原則(使用者 2026-10-31 定):
 *  - 有條件才用,沒條件寧可留著——不為了把 3 次花完硬用。
 *  - 花色卡:先假裝換完、跑一次出牌,這手真的會出那個花色的同花才換,而且這手就出那疊(不會換了沒出)。
 *  - 電腦帶卡 = 自己打法的卡抽 2 張固定(花色卡最多 1 張)+ 其他卡隨機補到 5 張(fireStyle 標在 specialCards)。
 */

import type { Card } from './cards'
import { CATEGORY, evaluate } from './evaluate'
import { bossPick, deathEyeTrigger, explodeTriggers, refreshTriggers, type BossRuntime, type PickMain } from './bossAI'
import { shuffle } from './rng'
import { FIRE_LOADOUT, FIRE_USES, SPECIAL_CARD_LIST, getSpecialCard, type SpecialCardId } from './specialCards'
import {
  applySpecial,
  canDeathEye,
  canExplode,
  canRefresh,
  countCoins,
  fireUsedOf,
  fireUsesLeft,
  isTargetable,
  otherPlayer,
  peekNextDraw,
  suitTargets,
  swapTargets,
  type GameState,
  type PlayerId,
} from './state'

type Rng = () => number

/**
 * 用卡機率(有條件時,這回合用的機率)。模擬調過:目標平均一場用 2~2.5 張(§11.7)。
 * late:每多出一手,機率 ×(1 + late × 第幾手)——後期條件一樣時更願意用(但沒條件還是不用)。
 * own:自己打法的卡再 × own。
 */
// 2026-10-31 模擬(玩家模型 200 場):第一版機率(爆破 .4/.65/.85、死神 .85…)平均一場用 2.9 張、前三手就用完;
// 調到下面這組 → 平均 2.4~2.6 張,勝率幾乎不變(用得多不等於贏得多)。
export const FIRE_TUNE = {
  eye: { sure: 0.4, maybe: 0.15 },
  /** 爆破:依觸發條件數 0~3(對手手牌少 / 對手快贏 / 自己落後) */
  explode: [0, 0.15, 0.35, 0.6],
  /** 強迫更新:依觸發條件數 0~4(對手用過卡 / 對手囤牌 / 自己落後 / 自己牌爛),只在自己前 refreshHands 手 */
  refresh: [0, 0.1, 0.25, 0.45, 0.7],
  refreshHands: 5,
  /** 讓我看看:對手手上普通牌 ≥ spyMinFoe 才有看的價值 */
  spy: 0.12,
  spyMinFoe: 6,
  /** 偷窺:還有下一次補牌才用 */
  peek: 0.12,
  /** 偷天換日:手上有落單的小牌(≤6)才換 */
  swap: 0.15,
  late: 0.1,
  own: 1.3,
  max: 0.95,
  /**
   * 節奏(使用者 2026-11-01):盡量在自己第 deadline 手之前把 3 次用完,但不要前三手就全用光。
   * cap[h] = 第 h+1 手結束時最多用幾張(前三手最多 2 張);落後進度(剩幾次 ≥ 到期前還有幾手)
   * 或對手快贏了(≥ 3 幣)→ 這手挑一張「有用的」卡用掉(不是亂用,見 forcedPick)。
   */
  deadline: 5,
  cap: [1, 2, 2],
}
export type FireTune = typeof FIRE_TUNE

/** 電腦帶的 5 張:自己打法的 2 張固定 + 卡池裡其他卡隨機補滿。pool = 這場的卡池(預設全部)。 */
export function fireLoadout(main: PickMain, rng: Rng = Math.random, pool: SpecialCardId[] = SPECIAL_CARD_LIST.map((d) => d.id)): SpecialCardId[] {
  const inPool = SPECIAL_CARD_LIST.filter((d) => pool.includes(d.id))
  const core = inPool.filter((d) => d.fireStyle === main).map((d) => d.id)
  const rest = shuffle(inPool.filter((d) => !core.includes(d.id)), rng).map((d) => d.id)
  return [...core, ...rest].slice(0, FIRE_LOADOUT)
}

/** 落單的小牌(偷天換日要換的):點數 ≤ maxRank、手上沒有同點數。 */
function deadCards(state: GameState, me: PlayerId, maxRank: number): Card[] {
  const targets = swapTargets(state, me)
  const rc = new Map<number, number>()
  for (const c of targets) rc.set(c.rank, (rc.get(c.rank) ?? 0) + 1)
  return targets.filter((c) => c.rank <= maxRank && (rc.get(c.rank) ?? 0) === 1)
}
const lowestRank = (cards: Card[]): Card => cards.reduce((lo, c) => (c.rank < lo.rank ? c : lo), cards[0])

/**
 * 趕進度時這手用哪張:只挑「現在用有效果」的卡,照價值排(死神之眼有蓋牌可翻 → 爆破 → 強迫更新
 * → 讓我看看(對手還有 ≥3 張牌)→ 偷窺(還有下次補牌)→ 偷天換日(有落單的 ≤10))。都不成立就不用。
 * 花色卡不在這裡——它只在「換了這手就出同花」時用。
 */
function forcedPick(state: GameState, me: PlayerId, avail: SpecialCardId[], rt: BossRuntime): FireDecision | null {
  const foe = otherPlayer(me)
  if (avail.includes('deathEye') && canDeathEye(state, me)) return { card: 'deathEye' }
  if (avail.includes('explode') && canExplode(state, me)) return { card: 'explode' }
  if (avail.includes('refresh') && canRefresh(state, me)) return { card: 'refresh' }
  if (avail.includes('spy') && !rt.spySeen && state.hands[foe].filter(isTargetable).length >= 3) return { card: 'spy' }
  if (avail.includes('peek') && !rt.peekDraw && peekNextDraw(state, me).length > 0) return { card: 'peek' }
  if (avail.includes('swap') && state.deck.length > 0) {
    const dead = deadCards(state, me, 10)
    if (dead.length) return { card: 'swap', targetId: lowestRank(dead).id }
  }
  return null
}

export interface FireDecision {
  card: SpecialCardId
  targetId?: string
  /** 花色卡:用完這手要出的牌(已確認是那個花色的同花)——呼叫端照這個出,不再另外算 */
  thenPick?: string[]
}

/**
 * 花色卡的「換了一定要出」檢查:先假裝換完,用 pickFn 跑一次這手會出什麼;出的是那個花色的
 * 同花 / 同花順才回傳(連同這手要出的牌),不然 null(這回合不換)。對戰電腦也共用。
 */
export function suitPlayCheck(
  state: GameState,
  me: PlayerId,
  card: SpecialCardId,
  targetId: string,
  pickFn: (after: GameState) => string[],
): FireDecision | null {
  const suit = getSpecialCard(card)?.suit
  if (!suit) return null
  const after = applySpecial(state, me, card, { targetId })
  if (after === state) return null
  const pick = pickFn(after)
  const cards = after.hands[me].filter((c) => pick.includes(c.id))
  const cat = evaluate(cards).category
  const flush = cat === CATEGORY.FLUSH || cat === CATEGORY.STRAIGHT_FLUSH
  return flush && cards.filter(isTargetable).every((c) => c.suit === suit) ? { card, targetId, thenPick: pick } : null
}

/** 花色卡要換哪張(跟 boss 同一套:已握 4 張同花色才換第 5 張;已是同花時只為了把能湊對的同花牌換出來)。 */
function suitVictim(state: GameState, me: PlayerId, suit: Card['suit']): Card | null {
  const hand = state.hands[me]
  const rankCount = new Map<number, number>()
  for (const c of hand) if (isTargetable(c)) rankCount.set(c.rank, (rankCount.get(c.rank) ?? 0) + 1)
  const suited = hand.filter((c) => isTargetable(c) && c.suit === suit)
  const others = suitTargets(state, me, suit)
  if (suited.length < 4) return null
  const lowest = (cards: Card[]): Card | null => {
    if (!cards.length) return null
    const unpaired = cards.filter((c) => (rankCount.get(c.rank) ?? 0) === 1)
    const pool = unpaired.length ? unpaired : cards
    return pool.reduce((lo, c) => (c.rank < lo.rank ? c : lo), pool[0])
  }
  if (suited.length === 4) return lowest(others)
  const doubleDuty = suited.some((s) => (rankCount.get(s.rank) ?? 0) >= 2)
  return doubleDuty ? lowest(others.filter((o) => (rankCount.get(o.rank) ?? 0) === 1)) : null
}

/**
 * 這回合要不要用卡(輪到電腦選牌、還沒出牌時呼叫一次)。loadout = 帶進場的 5 張;用過的自動略過。
 * 回傳 null = 這回合不用。
 */
export function fireChooseSpecial(
  state: GameState,
  me: PlayerId,
  loadout: SpecialCardId[],
  rt: BossRuntime,
  rng: Rng = Math.random,
  tune: FireTune = FIRE_TUNE,
): FireDecision | null {
  if (state.mode !== 'fire' || state.phase !== 'pick' || state.turn !== me) return null
  if (state.specialUsed[me] || fireUsesLeft(state, me) <= 0) return null
  const used = fireUsedOf(state, me)
  const avail = loadout.filter((c) => !used.includes(c))
  if (!avail.length) return null
  const hand = state.placementsDone[me]
  // 節奏:前三手最多用 2 張(不在開局就把 3 次花光)
  if (used.length + 1 > (tune.cap[hand] ?? FIRE_USES)) return null

  // 1) 花色卡:只在「換完這手就出那個花色的同花」時用(價值確定,不擲機率)
  for (const id of avail) {
    const suit = getSpecialCard(id)?.suit
    if (!suit) continue
    const victim = suitVictim(state, me, suit)
    if (!victim) continue
    // 複製一份 runtime:bossPick 會就地記死神之眼停損
    const ok = suitPlayCheck(state, me, id, victim.id, (after) => bossPick(after, me, { ...rt }, rng))
    if (ok) return ok
  }

  // 2) 其他卡:有條件才擲機率;後期、自己打法的卡機率高一點
  const foe = otherPlayer(me)
  const boost = (id: SpecialCardId, p: number) =>
    Math.min(tune.max, p * (1 + tune.late * hand) * (getSpecialCard(id)?.fireStyle === rt.main ? tune.own : 1))
  const roll = (id: SpecialCardId, p: number) => p > 0 && rng() < boost(id, p)

  if (avail.includes('deathEye') && canDeathEye(state, me)) {
    const t = deathEyeTrigger(state, me)
    if (roll('deathEye', t === 'sure' ? tune.eye.sure : t === 'maybe' ? tune.eye.maybe : 0)) return { card: 'deathEye' }
  }
  if (avail.includes('explode') && canExplode(state, me)) {
    if (roll('explode', tune.explode[explodeTriggers(state, me)] ?? 0)) return { card: 'explode' }
  }
  if (avail.includes('refresh') && hand < tune.refreshHands && canRefresh(state, me)) {
    if (roll('refresh', tune.refresh[refreshTriggers(state, me)] ?? 0)) return { card: 'refresh' }
  }
  if (avail.includes('spy') && !rt.spySeen && state.hands[foe].filter(isTargetable).length >= tune.spyMinFoe) {
    if (roll('spy', tune.spy)) return { card: 'spy' }
  }
  if (avail.includes('peek') && !rt.peekDraw && peekNextDraw(state, me).length > 0) {
    if (roll('peek', tune.peek)) return { card: 'peek' }
  }
  if (avail.includes('swap') && state.deck.length > 0) {
    const dead = deadCards(state, me, 6)
    if (dead.length && roll('swap', tune.swap)) return { card: 'swap', targetId: lowestRank(dead).id }
  }

  // 3) 趕進度:剩的次數 ≥ 到期前還有幾手,或對手快贏了 → 挑一張有用的卡用掉
  const left = fireUsesLeft(state, me)
  if (left >= tune.deadline - hand || countCoins(state, foe) >= 3) return forcedPick(state, me, avail, rt)
  return null
}

/**
 * 用完卡之後電腦學到的(合法資訊):讓我看看 → 看過對手手牌;偷窺 → 知道下次補牌;
 * 自己強迫更新對手 → 之前看過的對手手牌作廢。回傳新的 runtime(沒變就回原本的)。
 */
export function fireLearn(rt: BossRuntime, card: SpecialCardId, after: GameState, me: PlayerId): BossRuntime {
  if (card === 'spy') return { ...rt, spySeen: true, spyHand: after.hands[otherPlayer(me)] }
  if (card === 'peek') return { ...rt, peekDraw: peekNextDraw(after, me) }
  if (card === 'refresh' && rt.spySeen) return { ...rt, spySeen: false, spyHand: null }
  return rt
}
