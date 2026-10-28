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
  /** 牌桌右側方鈕上的字(一行一個元素) */
  badge: string[]
  /** 規則卡(VS 畫面後跳出)的 2~3 行規則 */
  rules: string[]
  /** 規則卡在第一行後面接「比牌三步驟 + 範例」(百鬼 / 撲朔迷離,spec §8.3) */
  tieSteps?: boolean
}

const HIDDEN_RULE = '對手只看得到你出幾張，無法看到你實際出牌的位置。'
const JOKER_CAP_RULE = '每格最多放 2 張鬼牌。'

/** 規則卡「比牌三步驟」的一個範例:左疊 vs 右疊(牌 id 用 cardId 格式,鬼 = 'J'),左邊贏。 */
export interface TieStep {
  title: string
  left: string[]
  right: string[]
  note: string
}
export const TIE_STEPS_INTRO = '牌型和點數都一樣時：'
export const TIE_STEPS: TieStep[] = [
  { title: '① 鬼牌少的贏', left: ['CA', 'J'], right: ['J', 'J'], note: '都是一對 A，左邊鬼少' },
  { title: '② 鬼一樣多，比正牌點數', left: ['SJ', 'SQ', 'SK', 'J', 'J'], right: ['H10', 'HJ', 'HQ', 'J', 'J'], note: '都是 10~A 同花順，K 比 Q 大' },
  { title: '③ 正牌也一樣，比花色', left: ['DA', 'J'], right: ['CA', 'J'], note: '花色 ♠ > ♥ > ♦ > ♣' },
]

export const LIMITED_INFO: Record<LimitedMode, LimitedInfo> = {
  ghost: {
    name: '百鬼夜行',
    badge: ['百鬼', '夜行'],
    rules: ['點數 2~6（共 20 張）全部變成鬼牌。', JOKER_CAP_RULE, HIDDEN_RULE],
    tieSteps: true,
  },
  blank: {
    name: '空城計',
    badge: ['空城計'],
    rules: ['點數 2~6（共 20 張）全部變成空白牌。', '空白牌比牌時不算，但會佔張數——真真假假，讓對手猜。', HIDDEN_RULE],
  },
  mixed: {
    name: '撲朔迷離',
    badge: ['撲朔', '迷離'],
    rules: ['點數 2~6（共 20 張）裡 10 張變鬼牌、10 張變空白牌。', JOKER_CAP_RULE, HIDDEN_RULE],
    tieSteps: true,
  },
  fire: {
    name: '火力全開',
    badge: ['火力', '全開'],
    rules: ['帶 5 張特殊卡進場，整場可以用 3 張。', '每回合最多用 1 張，每張只能用一次。', HIDDEN_RULE],
  },
}

/**
 * 限定房人機執行力(spec §11.4a):有寫的玩法改用這組,沒寫的照一般快配(0.6 / 0.75 / 0.9、對戰電腦 0.75)。
 * 百鬼新放牌後比一般房難 → 跟第一關鳥鳥一樣。其他玩法做到時看模擬勝率再定。
 */
export const LIMITED_EXECUTION: Partial<Record<LimitedMode, { casual: number[]; vsComputer: number }>> = {
  ghost: { casual: [0.35, 0.5, 0.65], vsComputer: 0.5 },
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

const DAY_CHAR = ['日', '一', '二', '三', '四', '五', '六']
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] // 星期一排到星期日

/**
 * 輪值表(快速配對 / 建立房間「?」用,spec §8.2):同一種玩法的星期併成一列,
 * 依該玩法第一次出現的星期排(例:{ mode: 'fire', days: [3, 0], label: '星期三、日' })。
 */
export const LIMITED_ROTA: { mode: LimitedMode; days: number[]; label: string }[] = (() => {
  const rows: { mode: LimitedMode; days: number[]; label: string }[] = []
  for (const d of WEEK_ORDER) {
    const mode = LIMITED_SCHEDULE[d]
    const row = rows.find((r) => r.mode === mode)
    if (row) row.days.push(d)
    else rows.push({ mode, days: [d], label: '' })
  }
  for (const r of rows) r.label = '星期' + r.days.map((d) => DAY_CHAR[d]).join('、')
  return rows
})()

/**
 * 測試期固定玩法(spec §0):有設定時,不管星期幾都是這一種。四種都測完才改成 null 開星期輪替。
 * 步驟 1 = 百鬼夜行。
 */
export const LIMITED_TEST_MODE: LimitedMode | null = 'ghost'

const TAIWAN_OFFSET_MS = 8 * 60 * 60 * 1000

/** 某個時間點(ms,最好是伺服器時間)的限定房玩法。換日點 = 台灣 00:00。 */
export function limitedModeAt(nowMs: number): LimitedMode {
  if (LIMITED_TEST_MODE) return LIMITED_TEST_MODE
  return LIMITED_SCHEDULE[taiwanDay(nowMs)]
}

/** 台灣時間的星期(0 = 星期日)。 */
export const taiwanDay = (nowMs: number): number => new Date(nowMs + TAIWAN_OFFSET_MS).getUTCDay()

/** 這個玩法的比牌用決勝五步(鬼牌少的贏…)嗎?只有有一堆鬼牌的兩種。 */
export const usesLimitedCompare = (m: LimitedMode | null | undefined): boolean => m === 'ghost' || m === 'mixed'

/**
 * 一格最多放幾張鬼牌(§4.0):鬼牌多的兩種玩法 = 2,其他 = 不限(null)。
 * 引擎不檢查(舊回放照原棋譜重播);只在輸入端擋:玩家選牌、人機出牌、房主驗對手出牌。
 */
export const LIMITED_JOKER_CAP = 2
export const jokerCapOf = (m: LimitedMode | null | undefined): number | null => (usesLimitedCompare(m) ? LIMITED_JOKER_CAP : null)

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
