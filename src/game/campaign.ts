/**
 * Campaign (關卡戰役) content — GAME CONTENT (每款遊戲重寫). Pure data: which
 * stages exist, each boss's signature card / avatar / AI profile, and the
 * per-sub-stage rules (room type, best-of, execution, rewards). The portable
 * machinery (BO series shell, progress + unlock persistence, surrender/replay)
 * lives in the platform layer (campaignStore); this file never touches
 * React/Firebase. Boss *behaviour* from these profiles lives in bossAI.ts.
 *
 * Structure (locked with user 2026-08-01):
 *   一大關 = 一 boss = 三小關 —
 *     x-1  一般房 · 雙方禁特殊牌            · BO3(先2勝) · 執行力 0.60 · 過關給鑽石
 *     x-2  特殊牌房 · boss 只用招牌卡        · BO3(先2勝) · 執行力 0.75 · 贏→解鎖招牌卡 + 鑽石
 *     x-3  特殊牌房 · boss 用招牌卡+已解鎖卡 · BO5(先3勝) · 執行力 0.90 · 贏→解鎖 boss 頭像 + 鑽石
 *   通關後可回任一關重打,但獎勵只在「首次過關」發一次(見 campaignStore)。
 *
 * AI model: 主策略(每局抽一次) 強攻/囤牌/平衡 + 副技能% 詐唬/拼牌/鬼牌時機/看破 +
 * 執行力(每小關遞增)。體感靠混合權重、難度靠執行力。詳見 bossAI.ts。
 */

import type { SpecialCardId } from './specialCards'
import { rollMain, type BossProfile, type BossRuntime } from './bossAI'

export type BossCardMode =
  | 'none' // x-1: boss 不用特殊牌
  | 'signature' // x-2: boss 只發動自己的招牌卡
  | 'pool' // x-3: 招牌卡 + 玩家目前已解鎖的卡(執行期依 profile 計算)

export interface SubStage {
  /** e.g. 's1-2' */
  id: string
  /** 顯示用,e.g. '1-2' */
  label: string
  /** 特殊牌房? (x-1=false, x-2/x-3=true) */
  special: boolean
  bestOf: number
  winsNeeded: number
  /** boss 執行力 0..1 — 越高越會做跨手最佳化/看破/擋殺,失手率越低 */
  execution: number
  bossCardMode: BossCardMode
  /** 首次過關獎勵。card→解鎖特殊牌,avatar→解鎖頭像,diamonds→鑽石 */
  reward: { card?: SpecialCardId; avatar?: string; diamonds: number }
}

export interface CampaignStage {
  /** e.g. 's1' */
  id: string
  /** 1-based 大關序,對應地圖背景 maps/stage{index}.png */
  index: number
  name: string
  /** boss 立繪 = 該關要解鎖的頭像 id */
  bossAvatar: string
  signatureCard: SpecialCardId
  /** boss 牌風(主策略機率 + 副技能%);每小關套用,執行力來自 SubStage */
  profile: BossProfile
  subStages: SubStage[]
  /** 三小關節點在地圖背景上的相對座標(0..100 %);對齊使用者畫的路徑,可微調。 */
  nodePositions: { x: number; y: number }[]
}

const DIAMONDS_PER_CLEAR = 10

/** x-1/x-2/x-3 share this shape, differing only in the card/avatar unlocked and
 *  the execution ramp. */
function subStages(
  stageId: string,
  stageIndex: number,
  card: SpecialCardId,
  avatar: string,
): SubStage[] {
  const d = DIAMONDS_PER_CLEAR
  return [
    {
      id: `${stageId}-1`,
      label: `${stageIndex}-1`,
      special: false,
      bestOf: 3,
      winsNeeded: 2,
      execution: 0.6,
      bossCardMode: 'none',
      reward: { diamonds: d },
    },
    {
      id: `${stageId}-2`,
      label: `${stageIndex}-2`,
      special: true,
      bestOf: 3,
      winsNeeded: 2,
      execution: 0.75,
      bossCardMode: 'signature',
      reward: { card, diamonds: d },
    },
    {
      id: `${stageId}-3`,
      label: `${stageIndex}-3`,
      special: true,
      bestOf: 5,
      winsNeeded: 3,
      execution: 0.9,
      bossCardMode: 'pool',
      reward: { avatar, diamonds: d },
    },
  ]
}

const NODE_POS = [
  { x: 24, y: 60 },
  { x: 50, y: 44 },
  { x: 76, y: 58 },
]

export const CAMPAIGN: CampaignStage[] = [
  {
    id: 's1',
    index: 1,
    name: '哪裡來的鎹鴉?',
    bossAvatar: 'bird',
    signatureCard: 'peek',
    // 愛詐唬的賭徒:主打強攻,peek 餵拼牌(看下張值不值得等)。
    profile: {
      pickMain: { attack: 70, hoard: 10, balance: 20 },
      bluff: 10,
      draw: 50,
      jokerTiming: 30,
      insight: 20,
    },
    subStages: subStages('s1', 1, 'peek', 'bird'),
    nodePositions: NODE_POS,
  },
  {
    id: 's2',
    index: 2,
    name: '明天開始168',
    bossAvatar: 'cat2', // 英國短毛貓 = cat2.png(已存在)
    signatureCard: 'spy',
    // 龜到你發火:主打囤牌,spy 給合法高看破(看穿你的詐唬)。
    profile: {
      pickMain: { attack: 10, hoard: 70, balance: 20 },
      bluff: 30,
      draw: 30,
      jokerTiming: 20,
      insight: 70,
    },
    subStages: subStages('s2', 2, 'spy', 'cat2'),
    nodePositions: NODE_POS,
  },
  {
    id: 's3',
    index: 3,
    name: '魚與熊掌我全都要',
    bossAvatar: 'bear', // 北極熊(bear.png)
    signatureCard: 'clubs',
    // 全能猛獸:平衡為主、火力足,鬼牌留成陰險終結技。
    profile: {
      pickMain: { attack: 40, hoard: 10, balance: 50 },
      bluff: 30,
      draw: 20,
      jokerTiming: 60,
      insight: 40,
    },
    subStages: subStages('s3', 3, 'clubs', 'bear'),
    nodePositions: NODE_POS,
  },
  {
    id: 's4',
    index: 4,
    name: '萌即是正義', // 關卡名(暫定,可改);對局顯示角色名=紅貴賓 dog
    bossAvatar: 'dog', // 紅貴賓(dog.png)
    signatureCard: 'diamonds',
    // 想做什麼就做什麼、完全看心情:主風格三分天下、技能都平平、隨興打。
    profile: {
      pickMain: { attack: 40, hoard: 40, balance: 20 },
      bluff: 20,
      draw: 30,
      jokerTiming: 20,
      insight: 20,
    },
    subStages: subStages('s4', 4, 'diamonds', 'dog'),
    nodePositions: NODE_POS,
  },
  {
    id: 's5',
    index: 5,
    name: '奴才別打擾朕睡覺',
    bossAvatar: 'cat3', // 波斯貓(cat3.png)
    signatureCard: 'hearts', // 正中紅心
    // 慵懶的貴族:平衡為主、幾乎不詐唬,鬼牌留到高槓桿才慢條斯理地終結。
    profile: {
      pickMain: { attack: 30, hoard: 10, balance: 60 },
      bluff: 10,
      draw: 30,
      jokerTiming: 60,
      insight: 40,
    },
    subStages: subStages('s5', 5, 'hearts', 'cat3'),
    nodePositions: NODE_POS,
  },
  {
    id: 's6',
    index: 6,
    name: '情緒勒索的吉祥物',
    bossAvatar: 'bird2', // 貓頭鷹(bird2.png)
    signatureCard: 'spades', // 塊桃鴨
    // 高智商夜行者:極重平衡與看破,鬼牌時機幾乎必抓,壓迫感最強的收尾王。
    profile: {
      pickMain: { attack: 10, hoard: 20, balance: 70 },
      bluff: 20,
      draw: 20,
      jokerTiming: 80,
      insight: 60,
    },
    subStages: subStages('s6', 6, 'spades', 'bird2'),
    nodePositions: NODE_POS,
  },
]

// ---- lookups -------------------------------------------------------------

export const ALL_SUB_STAGE_IDS: string[] = CAMPAIGN.flatMap((s) => s.subStages.map((ss) => ss.id))

export function getStage(stageId: string): CampaignStage | undefined {
  return CAMPAIGN.find((s) => s.id === stageId)
}

/** Find a sub-stage + its parent stage by sub-stage id (e.g. 's2-3'). */
export function getSubStage(subId: string): { stage: CampaignStage; sub: SubStage } | undefined {
  for (const stage of CAMPAIGN) {
    const sub = stage.subStages.find((ss) => ss.id === subId)
    if (sub) return { stage, sub }
  }
  return undefined
}

/** Linear clear order across all stages, for prerequisite checks. */
export function subStageOrder(subId: string): number {
  return ALL_SUB_STAGE_IDS.indexOf(subId)
}

/** The next sub-stage in global order (1-1→1-2→1-3→2-1…), or null if it's the last. */
export function nextSubStageId(subId: string): string | null {
  const i = subStageOrder(subId)
  return i >= 0 && i + 1 < ALL_SUB_STAGE_IDS.length ? ALL_SUB_STAGE_IDS[i + 1] : null
}

/** 每個 boss 起手就有的基底卡(同新手預設)。 */
const BASELINE_CARD: SpecialCardId = 'swap'

/** The card ids a boss may activate this sub-stage.
 *  - none      → []
 *  - signature → [招牌卡]           (x-2:只用自己的招牌卡)
 *  - pool      → 基底偷天換日 + 本關與之前關卡的招牌卡 (x-3;依戰役進度,不是玩家解鎖)
 *
 * NOTE: 池用「戰役進度(關卡序)」算,不看玩家 profile.unlocked——否則測試帳號(全解鎖)
 * 會讓早期 boss 拿到後面關卡的卡(例:麻雀用到踏雪尋梅)。 */
export function bossCardPool(stage: CampaignStage, sub: SubStage): SpecialCardId[] {
  if (sub.bossCardMode === 'none') return []
  if (sub.bossCardMode === 'signature') return [stage.signatureCard]
  const earned = CAMPAIGN.filter((s) => s.index <= stage.index).map((s) => s.signatureCard)
  return [...new Set<SpecialCardId>([BASELINE_CARD, ...earned])]
}

/** Build the per-match boss runtime: roll the dominant pick strategy once and
 *  bind this sub-stage's execution. Call at match start (campaignStore). */
export function rollBossRuntime(
  stage: CampaignStage,
  sub: SubStage,
  rng: () => number = Math.random,
): BossRuntime {
  return { profile: stage.profile, main: rollMain(stage.profile, rng), execution: sub.execution }
}

// ---- BO series (pure logic; the store just drives matches with it) --------

export type MatchResult = 'win' | 'lose'

export interface SeriesState {
  subId: string
  bestOf: number
  winsNeeded: number
  /** per-match results in play order ('win' = the human won that match) — drives
   *  the ✓/✗ progress track. Counts are derived (seriesWins). */
  results: MatchResult[]
}

export type SeriesOutcome = 'ongoing' | 'won' | 'lost'

export function newSeries(sub: SubStage): SeriesState {
  return { subId: sub.id, bestOf: sub.bestOf, winsNeeded: sub.winsNeeded, results: [] }
}

/** Derived win counts. */
export function seriesWins(s: SeriesState): { mine: number; boss: number } {
  let mine = 0
  for (const r of s.results) if (r === 'win') mine++
  return { mine, boss: s.results.length - mine }
}

export function seriesOutcome(s: SeriesState): SeriesOutcome {
  const { mine, boss } = seriesWins(s)
  return mine >= s.winsNeeded ? 'won' : boss >= s.winsNeeded ? 'lost' : 'ongoing'
}

/** Fold one match result into the series and report whether it's decided. */
export function advanceSeries(s: SeriesState, winnerIsMe: boolean): { series: SeriesState; outcome: SeriesOutcome } {
  const series: SeriesState = { ...s, results: [...s.results, winnerIsMe ? 'win' : 'lose'] }
  return { series, outcome: seriesOutcome(series) }
}

// ---- progression / unlock gating -----------------------------------------

/** A sub-stage is playable if it's the first overall or its predecessor is cleared.
 *  (通關後可回任一關重打 → cleared ones are always unlocked too.) The very first
 *  sub-stage (order 0) additionally requires the tutorial to have been entered —
 *  a new player only sees 新手教學 lit until they've been through it. */
export function isSubStageUnlocked(
  subId: string,
  clearedIds: Iterable<string>,
  tutorialSeen = true,
): boolean {
  const order = subStageOrder(subId)
  if (order <= 0) return tutorialSeen
  const set = clearedIds instanceof Set ? clearedIds : new Set(clearedIds)
  if (set.has(subId)) return true
  return set.has(ALL_SUB_STAGE_IDS[order - 1])
}

/** Is a whole 大關 reachable? (Its first sub-stage is unlocked.) */
export function isStageUnlocked(
  stage: CampaignStage,
  clearedIds: Iterable<string>,
  tutorialSeen = true,
): boolean {
  return isSubStageUnlocked(stage.subStages[0].id, clearedIds, tutorialSeen)
}

/** The next sub-stage to play in a stage: the first not-yet-cleared one, or the
 *  last (a replay) if all are done. */
export function nextPlayableSub(stage: CampaignStage, clearedIds: Iterable<string>): SubStage {
  const set = clearedIds instanceof Set ? clearedIds : new Set(clearedIds)
  return stage.subStages.find((ss) => !set.has(ss.id)) ?? stage.subStages[stage.subStages.length - 1]
}

/** Reward for clearing `sub`, or null on a replay (rewards are first-clear only). */
export function rewardForClear(sub: SubStage, alreadyCleared: boolean): SubStage['reward'] | null {
  return alreadyCleared ? null : sub.reward
}
