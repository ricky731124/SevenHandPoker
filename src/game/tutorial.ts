import type { Card, Rank, Suit } from './cards'
import { makeBlank, makeJoker } from './cards'
import { SLOT_COUNT, type GameState, type PlayerId } from './state'
import type { SpecialCardId } from './specialCards'

/**
 * Phase D — the scripted new-player tutorial (SPEC §16). A FIXED deal + a scripted
 * opponent, so the coach text can point at exact cards. The player makes every
 * move themselves, but each step is light-gated to the one correct action
 * (masking other cards / lighting only the right slot). Teaches the things new
 * players trip over: the reversed placement (you place the OPPONENT's cards), that
 * you choose how many to pick and needn't force a showdown, the coin / 3-in-a-row
 * win, the FIXED draw schedule (not "draw what you played"), single-deck ⇒ card
 * counting, the blank (a count bluff, ignored at showdown), the joker (a pure wild),
 * and a special card (偷天換日 / swap) that completes a straight flush.
 *
 * The opponent's cards are INJECTED straight into pendingPick (its hand is hidden
 * anyway), so the scenario is independent of shuffle/draw timing; the player's
 * hand is hand-crafted to contain every gated pick. The player loses slot 1 to a
 * flush, then wins slots 3-4-5 for a 3-in-a-row.
 */

export type Highlight = 'hand' | 'slots' | 'special' | 'submit' | 'deck' | 'board' | 'foe' | 'sort' | null

export type TutorialNode =
  | { k: 'say'; text: string; hl?: Highlight }
  | { k: 'sort'; text: string }
  | { k: 'pick'; text: string; ids: string[]; hl?: Highlight }
  | { k: 'place'; text: string; slot: number; hl?: Highlight; dropHint?: string }
  | { k: 'magnify'; text: string; slot: number }
  | { k: 'swap'; text: string; target: string; result: string; targetText: string }
  | { k: 'oppPick'; ids: string[] }
  | { k: 'oppPlace'; slot: number }
  | { k: 'draw' }
  | { k: 'deal'; id: string }
  | { k: 'showdown'; text: string }
  | { k: 'win'; text: string }

/** Build a Card from an id, understanding the off-deck blank/joker ids. */
export function buildCard(id: string): Card {
  if (id.startsWith('JOKER_')) return makeJoker(id.slice(6))
  if (id.startsWith('BLANK_')) return makeBlank(id.slice(6))
  return { id, suit: id[0] as Suit, rank: Number(id.slice(1)) as Rank }
}
export const cardFromId = buildCard

const P1_HAND = ['H13', 'D13', 'H12', 'D12', 'C12', 'H14', 'S9', 'S10', 'S11', 'D2']

/**
 * The fixed tutorial deal. p1 = player (crafted hand), p2 = opponent (hidden
 * placeholder hand — its real piles are injected per scripted pick). p2 picks
 * first, so the player's very first action is PLACING (the reversed core).
 */
export function createTutorialGame(): GameState {
  const p1: Card[] = P1_HAND.map(buildCard)
  p1.push(makeBlank('p1'), makeJoker('p1'))
  // The opponent's hand is only ever a face-down count; scripted picks inject the
  // real cards. Fill it with hidden placeholders.
  const p2: Card[] = Array.from({ length: 12 }, (_, i) => ({ id: `oppph${i}`, suit: 'C' as Suit, rank: 2 as Rank }))

  // A draw pile of real 52-cards not used anywhere in the script (so a draw never
  // collides with a player pick, the injected opponent piles, or the swap result).
  const reserved = new Set([
    ...P1_HAND,
    'S12', 'S13', // dealt / swapped in later
    'C2', 'C4', 'C6', 'C8', 'C9', // opp flush
    'H10', 'D10', 'C10', // opp trips
    'S14', 'D14', 'C14', 'H11', 'D11', // opp full house
    'D6', 'D7', 'D8', // opp 3 cards
    'C13', // opp king (paired with joker)
  ])
  const deck: Card[] = []
  for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
    for (let r = 2 as number; r <= 14; r++) {
      const id = `${suit}${r}`
      if (!reserved.has(id)) deck.push({ id, suit, rank: r as Rank })
    }
  }
  const slots = Array.from({ length: SLOT_COUNT }, () => ({ p1: [] as Card[], p2: [] as Card[], owner: null }))

  return {
    seed: 0,
    hands: { p1, p2 },
    deck,
    drawsDone: { p1: 0, p2: 0 },
    placementsDone: { p1: 0, p2: 0 },
    slots,
    turn: 'p2' as PlayerId,
    phase: 'pick',
    pendingPick: null,
    lastShowdown: null,
    postPicker: null,
    firstPicker: 'p2',
    winner: null,
    winReason: null,
    tieBreakWinner: 'p2',
    specialUsed: { p1: false, p2: false },
  }
}

export const TUTORIAL_SWAP: SpecialCardId = 'swap'

export const TUTORIAL_NODES: TutorialNode[] = [
  {
    k: 'say',
    text: '歡迎來到七手撲克！獲勝方式有兩種：搶下 4 個金幣，或搶下的金幣連成相鄰的 3 格（例如搶下第 3、4、5 格或第 4、5、6 格之類的）。雙方各自有自己的 7 個格子。',
    hl: 'board',
  },
  {
    k: 'say',
    text: '你的起手牌會有 12 張。整場只使用一副牌（52 張），記住出過的牌就能算牌！其中有一張空白牌、一張鬼牌，等等會教。',
    hl: 'hand',
  },
  {
    k: 'say',
    text: '牌型由大到小依序為 同花順 > 鐵支(四條) > 葫蘆 > 同花 > 順子 > 三條 > 兩對 > 對子 > 高牌。規則跟梭哈、德州撲克差不多，差在雙方對決時牌數不用相同，意指你可以用 5 張牌跟別人的 2 張牌對決是可以的。',
    hl: 'hand',
  },
  {
    k: 'sort',
    text: '先試試排序！點左邊那顆切換「依點數／依花色」，再點右邊那顆切換「升冪／降冪」——兩顆都點點看，手牌會跟著重排，這很重要，對手可能依你出牌的位置來猜出你的牌。',
  },

  // ===== Round 1: the reversed placement + you can LOSE =====
  { k: 'oppPick', ids: ['C2', 'C4', 'C6', 'C8', 'C9'] },
  {
    k: 'place',
    text: '重點來了！對手選了 5 張牌（牌會推出來，推出的位置取決於他怎麼排序）。放到哪裡「由你決定」——點目前對手正在發亮的空格（對手的第一格），先幫他擺著（放到空格還不會觸發對決）。',
    slot: 0,
    hl: 'slots',
    dropHint: '把牌放這格',
  },
  { k: 'draw' },
  {
    k: 'pick',
    text: '換你出牌了！點擊下方「發亮的手牌」把牌選起來，再按右下角「送出」。要出幾張是你的策略，不必跟對手一樣多——這次只選兩張 K 即可。',
    ids: ['H13', 'D13'],
    hl: 'hand',
  },
  { k: 'oppPlace', slot: 0 },
  {
    k: 'showdown',
    text: '對手把你的牌放到第一格了！選擇跟你正面對決！他的同花勝過了你的一對 K，第 1 格金幣被他拿走了。對手選擇用必贏的牌搶下這一格——放置別人的牌堆時你可以自由選擇，不一定要跟人硬碰，挑選格子是門學問。',
  },
  { k: 'draw' },

  // ===== Round 2: the blank bluff → first coin =====
  { k: 'oppPick', ids: ['H10', 'D10', 'C10'] },
  {
    k: 'place',
    text: '對手又選了 3 張，一樣放到發亮的空格先擺著。',
    slot: 3,
    hl: 'slots',
  },
  {
    k: 'magnify',
    text: '順帶一提：牌堆右上的放大鏡可以回看放了什麼牌，左下角數字是張數。點看看對手第 1 格（發亮處）他出了什麼——對手的牌「只有對決過的那格」才能看，你自己的牌則隨時都能查閱。',
    slot: 0,
  },
  { k: 'draw' },
  {
    k: 'pick',
    text: '選三張 Q 加一張空白牌送出。空白是幌子——對手看到 4 張會以為你兩對，其實是三條（空白牌結算會被忽略），騙人又不浪費自己的真牌！',
    ids: ['H12', 'D12', 'C12', 'BLANK_p1'],
    hl: 'hand',
  },
  { k: 'oppPlace', slot: 3 },
  {
    k: 'showdown',
    text: '你的三條 Q 贏了對手的三條 10——因為使用了空白牌，牌力沒被稀釋，還騙到了對手。拿下你的第一枚金幣！',
  },
  {
    k: 'say',
    text: '補牌是固定的：不管你出幾張，前四次各補 3 張、後兩次補 2 張。所以如果你每回合都出滿 5 張，手牌只會愈來愈少！靈活性會降低唷！',
    hl: 'deck',
  },
  { k: 'draw' },

  // ===== Round 3: joker + Ace, opponent defers =====
  { k: 'oppPick', ids: ['S14', 'D14', 'C14', 'H11', 'D11'] },
  {
    k: 'place',
    text: '對手選了 5 張大牌，放到發亮的空格。',
    slot: 4,
    hl: 'slots',
  },
  { k: 'draw' },
  {
    k: 'say',
    text: '鬼牌是萬能牌，結算時會變成對你最有利的那張。搭一張 A 一起出，鬼牌就會變成 A，湊成「一對 A」。',
    hl: 'hand',
  },
  {
    k: 'pick',
    text: '選那張鬼牌和一張 A，按「送出」。',
    ids: ['JOKER_p1', 'H14'],
    hl: 'hand',
  },
  { k: 'oppPlace', slot: 2 },
  {
    k: 'say',
    text: '對手不想用他的 5 張跟你的 2 張對決，想必他對自己那五張牌很有信心，若接下來輕易地放五張牌很容易被吃掉；另外他把你的 2 張擺到第三格，自己也有機會湊第 1、2、3 格的金幣三連——看來是個心思縝密的對手。',
  },
  {
    k: 'deal',
    id: 'S12',
  },

  // ===== Round 4: swap → straight flush → second coin =====
  { k: 'oppPick', ids: ['D6', 'D7', 'D8'] },
  {
    k: 'place',
    text: '對手選了 3 張，但我們無法確定是不是三條。別急著用我們的一對 A 來對決，放到其它發亮的空格先擺著就好。',
    slot: 5,
    hl: 'slots',
  },
  { k: 'draw' },
  {
    k: 'swap',
    text: '你剛補到 ♠12，手上有四張黑桃，離同花順只差一張！點左下角「特殊牌」按鈕，用「偷天換日」賭一把看看吧。',
    target: 'D2',
    result: 'S13',
    targetText: '偷天換日：點掉那張沒用的 ♦2，把它換成一張新牌。',
  },
  {
    k: 'pick',
    text: '湊成同花順了！選 ♠9 ♠10 ♠11 ♠12 ♠13 五張送出。用對特殊牌就能翻盤——但特殊牌只有在「特殊牌局」的房間才能用，可帶三張備用，而一場只能發動其中一張，請在關鍵時刻使用它。',
    ids: ['S9', 'S10', 'S11', 'S12', 'S13'],
    hl: 'hand',
  },
  { k: 'oppPlace', slot: 4 },
  {
    k: 'showdown',
    text: '同花順 > 葫蘆！你拿下第 5 格。現在你連下第 4、5 格，只差一格就三連獲勝了。',
  },
  { k: 'draw' },

  // ===== Round 5: the Ace-over-King reveal → win =====
  { k: 'oppPick', ids: ['C13', 'JOKER_p2'] },
  {
    k: 'place',
    text: '最後關頭！對手太大意了，竟然只出了兩張，可能以為 A 都用光了。把他放到你藏著一對 A 的那格（發亮處）決勝！',
    slot: 2,
    hl: 'slots',
  },
  {
    k: 'showdown',
    text: '你的一對 A 大於對手的一對 K！你連下第 3、4、5 格——三格相連，你贏了這局！',
  },
  {
    k: 'win',
    text: '🎉 教學完成！你已學會放牌、選牌、對決搶金幣、固定補牌、算牌、特殊牌，還有空白與鬼牌。去真正的對戰試試吧！',
  },
]
