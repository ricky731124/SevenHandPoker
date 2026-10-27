/**
 * Special (ability) card catalog — GAME CONTENT (每款遊戲重寫). The portable
 * framework (choose-3-carry / use-1, intersection pool, activation timing,
 * visibility, host+intent sync) lives in the platform layer; this file only
 * defines *which* cards this game has and what they do. See SPEC §15 / Phase C.
 *
 * Rules recap:
 *  - Loadout: carry 3, activate exactly 1 per match (SPEC §15).
 *  - All cards are used during your OWN pick phase, before submitting.
 *  - Visibility: cards that DON'T affect the opponent only show "對方似乎使用了
 *    特殊牌" (not which); cards that DO affect them must disclose the content.
 */

import type { Suit } from './cards'

export type SpecialCardId = 'swap' | 'peek' | 'spy' | 'clubs' | 'diamonds' | 'hearts' | 'spades' | 'refresh' | 'explode' | 'deathEye'

/**
 * 這場能不能帶這張卡(戰前選卡畫面用)。共同卡池(雙方都有的卡才能帶)只套在「快速配對」配到的真人——
 * 跟陌生人打,老手帶十張打新手不公平;朋友房(建立/加入房間,舊房沒標記的也算)各帶各的(2026-10-27 使用者定)。
 * 主線 boss 照關卡進度、快配人機只從你已解鎖的卡裡挑 → 不經過這裡。
 * @param foeSpecials 對手已解鎖的卡(還沒收到 = null → 只開基本卡)
 */
export function usableInMatch(
  id: SpecialCardId,
  opts: { iHave: boolean; online: boolean; origin?: 'match' | 'friend'; foeSpecials: string[] | null; baseline: SpecialCardId },
): boolean {
  if (!opts.iHave) return false
  if (!opts.online || opts.origin !== 'match') return true
  return opts.foeSpecials ? opts.foeSpecials.includes(id) : id === opts.baseline
}

export interface SpecialCardDef {
  id: SpecialCardId
  name: string
  /** one-line effect, for tiles */
  short: string
  /** fuller description */
  desc: string
  /** true → the effect touches the opponent → the opponent is told the content */
  affectsFoe: boolean
  /** true → after activating, the player must pick a target card in their hand */
  needsTarget: boolean
  /** accent colour for the tile */
  accent: string
  /** suit-bloom cards only: the suit the chosen card is re-suited to */
  suit?: Suit
  /** 會動到對手的卡:用「被打的人」的角度寫的一句介紹。對手用了你還沒有的卡時跳出來,
   *  不然你不知道剛剛發生了什麼(朋友房不受共同卡池限制後常會遇到;主線 boss 也會先用你還沒拿到的招牌卡)。 */
  foeNote?: string
}

export const SPECIAL_CARDS: Record<SpecialCardId, SpecialCardDef> = {
  swap: {
    id: 'swap',
    name: '偷天換日',
    short: '換掉一張手牌',
    desc: '選一張手牌丟回牌池，再從牌池隨機抽回一張。',
    affectsFoe: false,
    needsTarget: true,
    accent: '#c9962e',
  },
  peek: {
    id: 'peek',
    name: '偷窺',
    short: '預視下次補牌',
    desc: '查看自己下一次補牌會抽到的牌（依補牌序為 3 或 2 張）。',
    affectsFoe: false,
    needsTarget: false,
    accent: '#4f8f4a',
  },
  spy: {
    id: 'spy',
    name: '讓我看看',
    short: '查看對手手牌',
    desc: '直接查看對手目前的手牌。因為會影響對手，對手會被告知。',
    foeNote: '「讓我看看」：可以直接看你目前所有的手牌',
    affectsFoe: true,
    needsTarget: false,
    accent: '#a1233a',
  },
  clubs: {
    id: 'clubs',
    name: '踏雪尋梅',
    short: '一張牌變梅花',
    desc: '選一張非梅花的手牌，將其花色變為梅花（可能造成平手）。',
    affectsFoe: false,
    needsTarget: true,
    accent: '#2f6d4f',
    suit: 'C',
  },
  diamonds: {
    id: 'diamonds',
    name: '永恆鑽石',
    short: '一張牌變方塊',
    desc: '選一張非方塊的手牌，將其花色變為方塊（可能造成平手）。',
    affectsFoe: false,
    needsTarget: true,
    accent: '#2b6cb0',
    suit: 'D',
  },
  hearts: {
    id: 'hearts',
    name: '正中紅心',
    short: '一張牌變紅心',
    desc: '選一張非紅心的手牌，將其花色變為紅心（可能造成平手）。',
    affectsFoe: false,
    needsTarget: true,
    accent: '#c0392b',
    suit: 'H',
  },
  spades: {
    id: 'spades',
    name: '塊桃鴨',
    short: '一張牌變黑桃',
    desc: '選一張非黑桃的手牌，將其花色變為黑桃（可能造成平手）。',
    affectsFoe: false,
    needsTarget: true,
    accent: '#33384a',
    suit: 'S',
  },
  refresh: {
    id: 'refresh',
    name: '強迫更新',
    short: '對手手牌全部重抽',
    desc: '對手的手牌（空白牌、鬼牌除外）全部洗回牌堆，整副重洗後再抽回相同張數。因為會影響對手，對手會被告知。',
    foeNote: '「強迫更新」：把你的手牌洗回牌堆、重抽一樣的張數',
    affectsFoe: true,
    needsTarget: false,
    accent: '#6b3fa0',
  },
  explode: {
    id: 'explode',
    name: '爆破',
    short: '炸掉對手一張手牌',
    desc: '隨機炸掉對手一張手牌（開局的空白牌、鬼牌除外），被炸的牌直接消失。',
    foeNote: '「爆破」：隨機炸掉你一張手牌，被炸的牌直接消失',
    affectsFoe: true,
    needsTarget: false,
    accent: '#d9480f',
  },
  deathEye: {
    id: 'deathEye',
    name: '死神之眼',
    short: '透視對手目前已放在決鬥區的所有牌',
    desc: '翻開對手目前已放在決鬥區的所有牌（之後放的不算）。對手會被告知。',
    foeNote: '「死神之眼」：翻開你目前放在決鬥區的所有牌',
    affectsFoe: true,
    needsTarget: false,
    accent: '#b8860b',
  },
}

export const SPECIAL_CARD_LIST: SpecialCardDef[] = Object.values(SPECIAL_CARDS)
export const ALL_SPECIAL_CARD_IDS: SpecialCardId[] = SPECIAL_CARD_LIST.map((c) => c.id)

/** Carry this many into a match; only one may be activated (SPEC §15). */
export const LOADOUT_SIZE = 3

export function getSpecialCard(id: string): SpecialCardDef | undefined {
  return SPECIAL_CARDS[id as SpecialCardId]
}
