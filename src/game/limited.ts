import type { Card } from './cards'
import { makeDeck } from './cards'
import { mulberry32, shuffle } from './rng'

/**
 * 限定房(LIMITED-ROOM-SPEC):第三種房型,玩法依星期決定、玩家不能自選。
 * 這支只放「玩法設定 + 排程 + 牌組」;比牌在 evaluate.compareLimited,人機在 limitedAI.ts。
 * 一般房 / 特殊房 / 主線完全不經過這裡。
 */

/** ghost 百鬼夜行 / blank 空城計 / mixed 撲朔迷離 / fire 火力全開 */
export type LimitedMode = 'ghost' | 'blank' | 'mixed' | 'fire'

export interface LimitedInfo {
  name: string
  /** 規則卡(VS 畫面後跳出)的 2~3 行規則 */
  rules: string[]
}

export const LIMITED_INFO: Record<LimitedMode, LimitedInfo> = {
  ghost: {
    name: '百鬼夜行',
    rules: ['2~6 共 20 張全部變成鬼牌。', '牌一樣大時，鬼牌用得少的贏；鬼牌一樣多，比正牌。', '對手只看得到你出幾張。'],
  },
  blank: {
    name: '空城計',
    rules: ['2~6 共 20 張全部變成空白牌。', '空白牌比牌時不算，但會佔張數——真真假假，讓對手猜。', '對手只看得到你出幾張。'],
  },
  mixed: {
    name: '撲朔迷離',
    rules: ['2~6 裡 10 張變鬼牌、10 張變空白牌。', '牌一樣大時，鬼牌用得少的贏；鬼牌一樣多，比正牌。', '對手只看得到你出幾張。'],
  },
  fire: {
    name: '火力全開',
    rules: ['帶 5 張特殊卡進場，整場可以用 3 張。', '每回合最多用 1 張，每張只能用一次。', '對手只看得到你出幾張。'],
  },
}

/** 星期 → 玩法(0 = 星期日,台灣時間)。之後要限時段只改這張表(spec §9)。 */
export const LIMITED_SCHEDULE: Record<number, LimitedMode> = {
  0: 'fire',
  1: 'ghost',
  2: 'blank',
  3: 'fire',
  4: 'ghost',
  5: 'blank',
  6: 'mixed',
}

/**
 * 測試期固定玩法(spec §0):有設定時,不管星期幾都是這一種。四種都測完才改成 null 開星期輪替。
 * 步驟 1 = 百鬼夜行。
 */
export const LIMITED_TEST_MODE: LimitedMode | null = 'ghost'

const TAIWAN_OFFSET_MS = 8 * 60 * 60 * 1000

/** 某個時間點(ms,最好是伺服器時間)的限定房玩法。換日點 = 台灣 00:00。 */
export function limitedModeAt(nowMs: number): LimitedMode {
  if (LIMITED_TEST_MODE) return LIMITED_TEST_MODE
  const day = new Date(nowMs + TAIWAN_OFFSET_MS).getUTCDay()
  return LIMITED_SCHEDULE[day]
}

/** 這個玩法的比牌用決勝五步(鬼牌少的贏…)嗎?只有有一堆鬼牌的兩種。 */
export const usesLimitedCompare = (m: LimitedMode | null | undefined): boolean => m === 'ghost' || m === 'mixed'

/** 牌組有沒有變(2~6 換掉)。牌組變化日沒有特殊卡,當一般房處理。 */
export const changesDeck = (m: LimitedMode | null | undefined): boolean => m === 'ghost' || m === 'blank' || m === 'mixed'

/** 牌組變出來的鬼牌 / 空白(id 跟開局那張不同,isStarterSpecial 不認它們)。 */
const deckJoker = (n: number): Card => ({ id: `JOKER_d${n}`, suit: 'S', rank: 14, kind: 'joker' })
const deckBlank = (n: number): Card => ({ id: `BLANK_d${n}`, suit: 'C', rank: 2, kind: 'blank' })

/**
 * 限定房的 52 張牌組(還沒洗)。2~6 依玩法換成鬼牌 / 空白;撲朔迷離哪 10 張變鬼由 seed 決定
 * (用另一條亂數,不影響洗牌那條 → 回放可重現)。其他玩法 / 沒有玩法 = 原本的牌組。
 */
export function makeLimitedDeck(seed: number, mode: LimitedMode | null | undefined): Card[] {
  const deck = makeDeck()
  if (!changesDeck(mode)) return deck
  const lows = deck.map((c, i) => (c.rank <= 6 ? i : -1)).filter((i) => i >= 0) // 20 張
  let ghosts: Set<number>
  if (mode === 'ghost') ghosts = new Set(lows)
  else if (mode === 'blank') ghosts = new Set()
  else ghosts = new Set(shuffle(lows, mulberry32((seed ^ 0x5bd1e995) >>> 0)).slice(0, 10))
  let j = 0
  let b = 0
  return deck.map((c, i) => (c.rank > 6 ? c : ghosts.has(i) ? deckJoker(++j) : deckBlank(++b)))
}
