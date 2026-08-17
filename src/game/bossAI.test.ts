import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { makeBlank, makeJoker } from './cards'
import { createGame, type GameState, type PlayerId } from './state'
import { bossChooseSpecial, bossPick, bossPlace, rollMain, type BossProfile, type BossRuntime } from './bossAI'

const c = (suit: Suit, rank: Rank): Card => ({ id: `${suit}${rank}`, suit, rank })
const R = (v: number) => () => v // constant rng

const PROFILE = (over: Partial<BossProfile> = {}): BossProfile => ({
  pickMain: { attack: 100, hoard: 0, balance: 0 },
  bluff: 0,
  draw: 0,
  jokerTiming: 0,
  insight: 0,
  ...over,
})
const RT = (main: BossRuntime['main'], execution: number, over: Partial<BossProfile> = {}): BossRuntime => ({
  profile: PROFILE(over),
  main,
  execution,
})

/** Build a state whose only meaningful part is my hand (for pick tests). */
function handState(me: PlayerId, hand: Card[]): GameState {
  const g = createGame(1, 'p1')
  g.hands[me] = hand
  return g
}

describe('rollMain — 每局抽一次主策略,依權重', () => {
  const p = PROFILE({ pickMain: { attack: 70, hoard: 10, balance: 20 } })
  it('低 rng → 強攻', () => expect(rollMain(p, R(0))).toBe('attack'))
  it('中 rng → 囤牌', () => expect(rollMain(p, R(0.75))).toBe('hoard'))
  it('高 rng → 平衡', () => expect(rollMain(p, R(0.95))).toBe('balance'))
})

describe('主策略 — 強攻 vs 囤牌 打法不同', () => {
  // clubs flush + a low pair of 3s in hand.
  const hand = [c('C', 2), c('C', 5), c('C', 7), c('C', 9), c('C', 13), c('H', 3), c('D', 3)]

  it('強攻:送出最強牌型(同花)', () => {
    const g = handState('p2', hand)
    const ids = bossPick(g, 'p2', RT('attack', 1), R(0))
    expect(ids).toHaveLength(5)
    expect(ids.every((id) => id.startsWith('C'))).toBe(true) // the flush
  })

  it('囤牌:送小對子、把同花囤起來', () => {
    const g = handState('p2', hand)
    const ids = bossPick(g, 'p2', RT('hoard', 1), R(0))
    expect(ids).toHaveLength(2)
    expect(ids.sort()).toEqual(['D3', 'H3'])
  })

  it('失手(執行力0):囤牌 boss 也會偶爾梭出最強牌', () => {
    const g = handState('p2', hand)
    const ids = bossPick(g, 'p2', RT('hoard', 0), R(0)) // sharp fails → strongest
    expect(ids).toHaveLength(5)
  })
})

describe('副技能 — 詐唬用張數偽裝', () => {
  it('把弱一對墊上空白牌 → 看起來像 3 張', () => {
    const hand = [c('S', 7), c('H', 7), c('D', 2), makeBlank('p2')]
    const g = handState('p2', hand)
    const ids = bossPick(g, 'p2', RT('attack', 1, { bluff: 100 }), R(0))
    expect(ids).toHaveLength(3)
    expect(ids).toContain('BLANK_p2')
  })
})

describe('副技能 — 鬼牌時機', () => {
  it('低槓桿時把鬼牌收起來,不拿去湊當下最大', () => {
    const hand = [c('S', 13), c('H', 13), c('D', 2), makeJoker('p2')]
    const g = handState('p2', hand)
    const ids = bossPick(g, 'p2', RT('attack', 1, { jokerTiming: 100 }), R(0))
    expect(ids).not.toContain('JOKER_p2')
    expect(ids.sort()).toEqual(['H13', 'S13'])
  })
})

describe('boss 特殊牌 — bossChooseSpecial', () => {
  it('x-2 招牌卡=偷窺:手上沒 value 卡→直接發動 peek', () => {
    const g = handState('p2', [c('S', 3), c('H', 9), c('D', 12)])
    expect(bossChooseSpecial(g, 'p2', ['peek'])).toEqual({ card: 'peek' })
  })

  it('x-2 招牌卡=讓我看看:直接發動 spy', () => {
    const g = handState('p2', [c('S', 3), c('H', 9), c('D', 12)])
    expect(bossChooseSpecial(g, 'p2', ['spy'])).toEqual({ card: 'spy' })
  })

  it('踏雪尋梅:已握 4 張同花→轉第 5 張湊成同花,目標=最小非梅花散牌', () => {
    const g = handState('p2', [c('C', 9), c('C', 13), c('C', 5), c('C', 7), c('D', 4), c('H', 8)])
    const d = bossChooseSpecial(g, 'p2', ['clubs'])
    expect(d?.card).toBe('clubs')
    expect(d?.targetId).toBe('D4') // lowest unpaired off-suit
  })

  it('踏雪尋梅:只有 2~3 張同花→一次轉牌湊不出同花,不亂用', () => {
    const g = handState('p2', [c('C', 9), c('C', 13), c('D', 4), c('H', 8)])
    expect(bossChooseSpecial(g, 'p2', ['clubs'])).toBeNull()
  })

  it('偷天換日:丟低的孤張死牌', () => {
    const g = handState('p2', [c('S', 3), c('H', 9), c('D', 12), c('C', 11)])
    expect(bossChooseSpecial(g, 'p2', ['swap'])).toEqual({ card: 'swap', targetId: 'S3' })
  })

  it('已用過→不再發動', () => {
    const g = handState('p2', [c('S', 3), c('H', 9)])
    g.specialUsed.p2 = true
    expect(bossChooseSpecial(g, 'p2', ['peek'])).toBeNull()
  })
})

describe('資訊卡強化打法 (#5)', () => {
  it('peek 一般化拼牌:偷窺看到下張是 K → 留 KK+33 湊葫蘆(勝過同花)、丟廢牌', () => {
    // 4-club flush draw + a strong pair KK + a weak pair 33; the drawn K makes KKK,
    // so KK+33 → 葫蘆(比同花大)。boss 應留住葫蘆的料、丟最廢的低張同花。
    const hand = [
      c('C', 2), c('C', 5), c('C', 7), c('C', 9),
      c('S', 13), c('H', 13),
      c('D', 3), c('H', 3),
    ]
    const g = handState('p2', hand)
    const rt: BossRuntime = { ...RT('attack', 1, { draw: 0 }), peekDraw: [c('C', 13)] }
    const ids = bossPick(g, 'p2', rt, R(0))
    expect(ids).toEqual(['C2']) // holds K,K,3,3 for the full house; dumps the lowest junk club
  })

  it('沒 peek(拼牌%=0)→ 直接梭出最強對子,不留同花', () => {
    const hand = [
      c('C', 2), c('C', 5), c('C', 7), c('C', 9),
      c('S', 13), c('H', 13),
      c('D', 3), c('H', 3),
    ]
    const g = handState('p2', hand)
    const ids = bossPick(g, 'p2', RT('attack', 1, { draw: 0 }), R(0))
    // no peek → cashes the strongest made hand now (two pair KK+33), doesn't hold.
    expect(ids.sort()).toEqual(['D3', 'H13', 'H3', 'S13'])
  })

  it('spy 強化看破:讓我看看後,看穿 5 張其實是廢牌(詐唬)→ 用強格搶幣', () => {
    const g = createGame(1, 'p1')
    const slots = g.slots.map((s) => ({ ...s, p1: [] as Card[], p2: [] as Card[], owner: null }))
    slots[0].p2 = [c('S', 12), c('H', 12), c('D', 12)] // trips Q (strong)
    slots[1].p2 = [c('H', 4), c('D', 4)] // pair 4 (weak)
    for (let i = 2; i < slots.length; i++) slots[i].p1 = [c('S', 2)]
    g.slots = slots
    // 5-card pile that LOOKS like a monster by count, but is busted junk (high card).
    g.pendingPick = { by: 'p1', cards: [c('C', 4), c('D', 6), c('S', 9), c('H', 11), c('D', 3)] }
    const rt: BossRuntime = { ...RT('attack', 1, { insight: 0 }), spySeen: true }
    // 看穿是廢牌 → 用「剛好夠贏的最弱牌」(對4)吃掉,留著三條 Q 去對付真正的威脅(佈局)。
    expect(bossPlace(g, 'p2', rt, R(0))).toBe(1)
  })

  it('沒 spy(看破 0)→ 被 5 張的張數嚇到,認賠丟弱格', () => {
    const g = createGame(1, 'p1')
    const slots = g.slots.map((s) => ({ ...s, p1: [] as Card[], p2: [] as Card[], owner: null }))
    slots[0].p2 = [c('S', 12), c('H', 12), c('D', 12)]
    slots[1].p2 = [c('H', 4), c('D', 4)]
    for (let i = 2; i < slots.length; i++) slots[i].p1 = [c('S', 2)]
    g.slots = slots
    g.pendingPick = { by: 'p1', cards: [c('C', 4), c('D', 6), c('S', 9), c('H', 11), c('D', 3)] }
    expect(bossPlace(g, 'p2', RT('attack', 1, { insight: 0 }), R(0))).toBe(1) // fooled by count
  })
})

describe('放牌 — 即時判斷', () => {
  // p2 (boss) has a strong pile at slot0, a weak pile at slot1; slots 2..6 are
  // taken on the picker's side so only {0,1} are valid placements.
  function placeState(incomingCount: number): GameState {
    const g = createGame(1, 'p1')
    const slots = g.slots.map((s) => ({ ...s, p1: [] as Card[], p2: [] as Card[], owner: null }))
    slots[0].p2 = [c('S', 12), c('H', 12), c('D', 12)] // trips Q (strong)
    slots[1].p2 = [c('H', 3), c('D', 3)] // pair 3 (weak)
    for (let i = 2; i < slots.length; i++) slots[i].p1 = [c('S', 2)] // picker filled → not empty
    g.slots = slots
    g.pendingPick = { by: 'p1', cards: Array.from({ length: incomingCount }, () => c('C', 4)) }
    return g
  }

  it('搶幣:對方送小牌(2張)→ 用自己強的那格對決', () => {
    const g = placeState(2)
    const slot = bossPlace(g, 'p2', RT('attack', 1, { insight: 70 }), R(0))
    expect(slot).toBe(0) // contest with trips
  })

  it('認賠(下四換上四):對方送大牌(5張)→ 丟給自己最弱的那格', () => {
    const g = placeState(5)
    const slot = bossPlace(g, 'p2', RT('attack', 1, { insight: 0 }), R(0))
    expect(slot).toBe(1) // sacrifice the weak pair, save the trips
  })

  it('搶幣用「剛好夠贏的最弱牌」:兩格都贏得了→選較弱那格吃、留強牌', () => {
    // both my piles beat a 2-card incoming; spy-known so it's a sure read.
    const g = createGame(1, 'p1')
    const slots = g.slots.map((s) => ({ ...s, p1: [] as Card[], p2: [] as Card[], owner: null }))
    slots[0].p2 = [c('S', 12), c('H', 12), c('D', 12)] // trips Q (strong)
    slots[1].p2 = [c('S', 8), c('H', 8), c('D', 8)] // trips 8 (weaker, still beats a pair)
    for (let i = 2; i < slots.length; i++) slots[i].p1 = [c('S', 2)]
    g.slots = slots
    g.pendingPick = { by: 'p1', cards: [c('C', 5), c('D', 5)] } // a pair
    const rt: BossRuntime = { ...RT('attack', 1), spySeen: true }
    expect(bossPlace(g, 'p2', rt, R(0))).toBe(1) // win with the weaker trips, keep trips Q
  })
})

describe('囤牌邊界 — 收手轉攻', () => {
  const hoardHand = [c('C', 2), c('C', 5), c('C', 7), c('C', 9), c('C', 13), c('H', 3), c('D', 3)]

  it('已輸 2 硬幣 → 兌現最強牌型(同花),不再囤小對', () => {
    const g = handState('p2', hoardHand)
    g.slots[0].owner = 'p1'
    g.slots[1].owner = 'p1' // foe holds 2 coins → cash-out boundary
    const ids = bossPick(g, 'p2', RT('hoard', 1), R(0))
    expect(ids).toHaveLength(5) // flush, not the 3-pair
  })
})

describe('鬼牌 — 只在能升級牌型時才用', () => {
  it('4 張同款 + 鬼牌 → 不拿鬼牌當跳張,只出鐵支 4 張', () => {
    const hand = [c('S', 11), c('H', 11), c('D', 11), c('C', 11), makeJoker('p2')]
    const g = handState('p2', hand)
    const ids = bossPick(g, 'p2', RT('attack', 1, { jokerTiming: 0 }), R(0))
    expect(ids).not.toContain('JOKER_p2')
    expect(ids).toHaveLength(4)
  })

  it('鬼牌搜尋最佳組合:能補同花也能湊三條 A → 選 CP 較高的三條 A(非同花)', () => {
    const hand = [c('C', 2), c('C', 5), c('C', 7), c('C', 9), c('S', 14), c('H', 14), makeJoker('p2')]
    const g = handState('p2', hand)
    const ids = bossPick(g, 'p2', RT('attack', 1, { jokerTiming: 0 }), R(0)) // jokerTiming 0 → 不收起,直接看選哪組
    expect(ids).toContain('JOKER_p2')
    expect(new Set(ids)).toEqual(new Set(['S14', 'H14', 'JOKER_p2'])) // trips A (CP 高), not the flush
  })
})

describe('主策略 — 平衡(前瞻,不執著兌現)', () => {
  it('有同花可兌現,但平衡選擇領中對、把同花牌留著', () => {
    const hand = [c('C', 2), c('C', 5), c('C', 7), c('C', 9), c('C', 13), c('S', 8), c('H', 8)]
    const g = handState('p2', hand)
    const ids = bossPick(g, 'p2', RT('balance', 1), R(0))
    expect(ids.sort()).toEqual(['H8', 'S8']) // holds the flush, leads the pair
  })
})

describe('看破 — 讀出牌序,高看破看穿詐唬墊張', () => {
  // incoming 是「一對 5 + 空白」(3 張),真讀=弱一對;盲讀(張數)=像三條。
  function padState(): GameState {
    const g = createGame(1, 'p1')
    const slots = g.slots.map((s) => ({ ...s, p1: [] as Card[], p2: [] as Card[], owner: null }))
    slots[0].p2 = [c('S', 9), c('H', 9)] // boss 中一對 9(階3)
    // slot1 p2 空
    for (let i = 2; i < slots.length; i++) slots[i].p1 = [c('S', 2)]
    g.slots = slots
    g.pendingPick = { by: 'p1', cards: [c('S', 5), c('H', 5), makeBlank('p1')] } // pair5 + blank
    return g
  }
  it('高看破:看穿是弱一對 → 用中一對搶幣(slot0)', () => {
    expect(bossPlace(padState(), 'p2', RT('attack', 1, { insight: 70 }), R(0))).toBe(0)
  })
  it('低看破:被 3 張唬到當成三條 → 避戰空格(slot1)', () => {
    expect(bossPlace(padState(), 'p2', RT('attack', 1, { insight: 0 }), R(0))).toBe(1)
  })
})

describe('x-3 特殊牌 — EV 排序選卡', () => {
  it('花色湊不成 + 高看破 → 早期選 spy(遠優於 swap)', () => {
    const g = handState('p2', [c('C', 9), c('C', 13), c('D', 4), c('H', 8)])
    const d = bossChooseSpecial(g, 'p2', ['swap', 'spy', 'clubs'], PROFILE({ insight: 70 }))
    expect(d).toEqual({ card: 'spy' })
  })
})
