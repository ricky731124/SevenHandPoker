/**
 * 2026-11-02 這一批規則的測試:花色卡一次改 1~2 張、強迫更新可洗自己(只有第一手)、
 * 回放演出資料、人機不單出鬼 / 送格送 2 張、火力全開看得到推牌位置。
 */
import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { isJoker } from './cards'
import {
  applySpecial,
  applySuit,
  canRefresh,
  canRefreshSelf,
  createGame,
  otherPlayer,
  type GameState,
  type PlayerId,
} from './state'
import { buildFrames, suitMove, type Move } from './replay'
import { bossPick, bossReadsOf, type BossRuntime } from './bossAI'
import { aiPick } from './ai'
import { CAMPAIGN } from './campaign'
import { hidesPushPos, LIMITED_INFO } from './limited'
import { defaultLimitedBrain } from './limitedAI'
import { getSpecialCard } from './specialCards'

const card = (suit: Suit, rank: Rank): Card => ({ id: `${suit}${rank}`, suit, rank })
const JOKER: Card = { id: 'JOKER_t', suit: 'S', rank: 14, kind: 'joker' }

function withHand(me: PlayerId, hand: Card[], extra: Partial<GameState> = {}): GameState {
  const g = createGame(4242, me)
  return { ...g, turn: me, hands: { ...g.hands, [me]: hand }, ...extra }
}

describe('花色卡一次改 1~2 張', () => {
  const hand = [card('C', 5), card('C', 9), card('C', 12), card('D', 8), card('H', 3), card('S', 3)]

  it('改 2 張:兩張都變成那個花色、記得原本花色、只算用了一次', () => {
    const g = withHand('p1', hand)
    const next = applySuit(g, 'p1', ['D8', 'H3'], 'C')
    const byId = (id: string) => next.hands.p1.find((c) => c.id === id)!
    expect(byId('D8').suit).toBe('C')
    expect(byId('D8').resuitFrom).toBe('D')
    expect(byId('H3').suit).toBe('C')
    expect(next.specialUsed.p1).toBe(true)
  })

  it('改 1 張照舊(舊棋譜的 targetId 也吃)', () => {
    const g = withHand('p1', hand)
    expect(applySpecial(g, 'p1', 'clubs', { targetId: 'D8' }).hands.p1.find((c) => c.id === 'D8')!.suit).toBe('C')
    expect(applySpecial(g, 'p1', 'clubs', { targetIds: ['D8'] }).hands.p1.find((c) => c.id === 'D8')!.suit).toBe('C')
  })

  it('不合法 → 整個不生效:3 張、重複、已是那個花色、不在手上、鬼牌', () => {
    const g = withHand('p1', [...hand, JOKER])
    expect(applySuit(g, 'p1', ['D8', 'H3', 'S3'], 'C')).toBe(g)
    expect(applySuit(g, 'p1', ['D8', 'D8'], 'C')).toBe(g)
    expect(applySuit(g, 'p1', ['D8', 'C5'], 'C')).toBe(g)
    expect(applySuit(g, 'p1', ['D8', 'X9'], 'C')).toBe(g)
    expect(applySuit(g, 'p1', ['D8', JOKER.id], 'C')).toBe(g)
  })
})

describe('強迫更新可洗自己(只有自己的第一手)', () => {
  it('第一手:洗自己 → 自己手牌換了、對手不動、牌堆張數不變', () => {
    const g = createGame(99, 'p1')
    expect(canRefreshSelf(g, 'p1')).toBe(true)
    const next = applySpecial(g, 'p1', 'refresh', { self: true, rng: () => 0.37 })
    expect(next).not.toBe(g)
    expect(next.hands.p2).toBe(g.hands.p2)
    expect(next.hands.p1.length).toBe(g.hands.p1.length)
    expect(next.deck.length).toBe(g.deck.length)
    expect(next.hands.p1.map((c) => c.id).sort()).not.toEqual(g.hands.p1.map((c) => c.id).sort())
    // 開局的鬼牌 / 空白牌留在手上
    for (const c of g.hands.p1.filter((x) => x.kind)) expect(next.hands.p1.some((x) => x.id === c.id)).toBe(true)
  })

  it('出過牌之後不能洗自己,洗對手照舊可以', () => {
    const g0 = createGame(99, 'p1')
    const g = { ...g0, placementsDone: { p1: 1, p2: 1 } }
    expect(canRefreshSelf(g, 'p1')).toBe(false)
    expect(canRefresh(g, 'p1', true)).toBe(false)
    expect(applySpecial(g, 'p1', 'refresh', { self: true, rng: () => 0.37 })).toBe(g)
    expect(canRefresh(g, 'p1')).toBe(true)
    const next = applySpecial(g, 'p1', 'refresh', { rng: () => 0.37 })
    expect(next.hands.p1).toBe(g.hands.p1)
    expect(next.hands.p2).not.toBe(g.hands.p2)
  })

  it('卡片說明有寫清楚', () => {
    expect(getSpecialCard('refresh')!.desc).toContain('只有自己的第一手可以洗自己')
    for (const id of ['clubs', 'diamonds', 'hearts', 'spades']) expect(getSpecialCard(id)!.desc).toContain('1~2 張')
  })
})

describe('回放:新棋譜 + 演出資料', () => {
  it('花色卡 2 張 / 1 張(舊格式)/ 強迫更新洗自己 都重播得出來,而且帶演出資料', () => {
    const g = createGame(5, 'p1')
    const offClubs = g.hands.p1.filter((c) => !c.kind && c.suit !== 'C').slice(0, 2).map((c) => c.id)
    const moves: Move[] = [suitMove('p1', 'clubs', offClubs, undefined)]
    expect(moves[0]).toEqual({ t: 'special', by: 'p1', card: 'clubs', targetIds: offClubs })
    const frames = buildFrames({ seed: 5, firstPicker: 'p1', moves })
    const f = frames[frames.length - 1]
    expect(f.outdated).toBeFalsy()
    expect(f.cardFx?.kind).toBe('suit')
    expect(f.cardFx?.targets?.length).toBe(2)
    expect(f.action).toContain('、') // 兩張都寫進字幕
    for (const id of offClubs) expect(f.state.hands.p1.find((c) => c.id === id)!.suit).toBe('C')

    // 舊格式(只有 targetId)照播
    const old = buildFrames({ seed: 5, firstPicker: 'p1', moves: [{ t: 'special', by: 'p1', card: 'clubs', targetId: offClubs[0] }] })
    expect(old[old.length - 1].state.hands.p1.find((c) => c.id === offClubs[0])!.suit).toBe('C')

    // 強迫更新洗自己:字幕寫「自己」、動畫播在自己身上
    const self = buildFrames({ seed: 5, firstPicker: 'p1', moves: [{ t: 'special', by: 'p1', card: 'refresh', self: true, rng: [0.4] }] })
    const sf = self[self.length - 1]
    expect(sf.refreshTarget).toBe('p1')
    expect(sf.action).toContain('（自己）')
    expect(sf.state.hands.p2).toEqual(g.hands.p2)
  })

  it('偷窺 / 讓我看看 / 偷天換日 也帶演出資料(偷窺帶看到的牌)', () => {
    const g = createGame(6, 'p1')
    const peek = buildFrames({ seed: 6, firstPicker: 'p1', moves: [{ t: 'special', by: 'p1', card: 'peek' }] })
    const pf = peek[peek.length - 1].cardFx!
    expect(pf.kind).toBe('peek')
    expect(pf.cards?.length).toBe(3)
    expect(pf.cards![0].id).toBe(g.deck[0].id)
    const spy = buildFrames({ seed: 6, firstPicker: 'p1', moves: [{ t: 'special', by: 'p2', card: 'spy' }] })
    expect(spy[spy.length - 1].cardFx).toMatchObject({ kind: 'spy', by: 'p2' })
    const target = g.hands.p1.find((c) => !c.kind)!.id
    const swap = buildFrames({ seed: 6, firstPicker: 'p1', moves: [{ t: 'special', by: 'p1', card: 'swap', targetId: target, rng: [0.1, 0.2] }] })
    expect(swap[swap.length - 1].cardFx?.kind).toBe('swap')
  })
})

describe('人機不單出鬼 / 送格送 2 張(2026-11-02)', () => {
  const rt = (main: BossRuntime['main'] = 'balance', execution = 1): BossRuntime => ({ profile: CAMPAIGN[0].profile, main, execution })
  // 使用者舉的那手:鬼、A、10、3,另外兩張沒成牌的(♠7 ♠5 跟 ♠A 同花色)
  const hand = [JOKER, card('S', 14), card('H', 10), card('C', 3), card('S', 7), card('S', 5)]

  it('沒成牌、還沒到收手期 → 送 2 張最沒用的(3 + 10),鬼和 A 留著', () => {
    const g = withHand('p2', hand)
    for (const main of ['attack', 'hoard', 'balance'] as const) {
      const ids = bossPick(g, 'p2', rt(main), () => 0)
      expect(ids.sort()).toEqual(['C3', 'H10'])
    }
  })

  it('沒成牌、收手期(對手 ≥ 2 幣)→ 鬼 + 最大那張 = 一對 A', () => {
    const g0 = withHand('p2', hand)
    const slots = g0.slots.map((s, i) => (i < 2 ? { ...s, owner: 'p1' as const } : s))
    const g = { ...g0, slots }
    expect(bossPick(g, 'p2', rt(), () => 0).sort()).toEqual([JOKER.id, 'S14'].sort())
  })

  it('任何情況都不單出一張鬼(隨機 2000 手)', () => {
    let rng = 12345
    const r = () => ((rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let i = 0; i < 2000; i++) {
      const g = createGame(i + 1, 'p2')
      const ids = bossPick(g, 'p2', rt((['attack', 'hoard', 'balance'] as const)[i % 3], r()), r)
      const hand2 = g.hands.p2
      expect(ids.length === 1 && isJoker(hand2.find((c) => c.id === ids[0])!)).toBe(false)
    }
  })

  it('對戰電腦(一般房)沒成牌又有鬼 → 鬼 + 最大那張,不單出鬼', () => {
    const g = withHand('p2', [JOKER, card('S', 14), card('H', 10), card('C', 3)])
    expect(aiPick(g, 'p2').sort()).toEqual([JOKER.id, 'S14'].sort())
  })
})

describe('看棋盤 + 反推(一般牌組,2026-11-02 第二輪)', () => {
  const brain = (main: BossRuntime['main']): BossRuntime => ({ profile: { ...CAMPAIGN[0].profile, jokerTiming: 0, draw: 0 }, main, execution: 1 })
  // 兩對(KK、55)+ 鬼 + 散牌:舊打法鬼一用就升到葫蘆(5 張)
  const hand = [card('S', 13), card('H', 13), card('D', 5), card('C', 5), card('H', 9), card('S', 3), JOKER]
  /** 對手第 slot 格放了 n 張等著(牌本身 boss 看不到,只看張數) */
  const withFoe = (piles: Record<number, number>): GameState => {
    const g = withHand('p2', hand)
    const slots = g.slots.map((s, i) => (piles[i] ? { ...s, p1: Array.from({ length: piles[i] }, (_, k) => card((['S', 'H', 'D', 'C'] as Suit[])[k % 4], (2 + k) as Rank)) } : s))
    return { ...g, slots, placementsDone: { p1: Object.keys(piles).length, p2: 0 } }
  }
  const fullHouseRate = (g: GameState, main: BossRuntime['main']) => {
    let fh = 0
    for (let i = 0; i < 60; i++) {
      let s = i * 7919 + 1
      const rng = () => ((s = (s * 48271) % 2147483647) / 2147483647)
      if (bossPick(g, 'p2', brain(main), rng).length === 5) fh++
    }
    return fh / 60
  }

  it('對手等著的都是 2 張的小牌:平衡打法不會每次都用鬼升到葫蘆', () => {
    expect(fullHouseRate(withFoe({ 1: 2, 4: 2 }), 'balance')).toBeLessThan(0.9)
  })

  it('反推:我出強牌,對手沒拿他等著的那疊來撞 → 記下「那疊大概打不過我」', () => {
    const rt = brain('attack')
    // 對手第 2 格等著 5 張;我出一疊鐵支 9
    const quads = [card('S', 9), card('H', 9), card('D', 9), card('C', 9)]
    const g0 = withHand('p2', [...quads, card('S', 3), card('H', 4)])
    const five = [card('S', 2), card('H', 4), card('D', 6), card('C', 8), card('S', 10)]
    const a: GameState = { ...g0, slots: g0.slots.map((s, i) => (i === 2 ? { ...s, p1: five } : s)), placementsDone: { p1: 1, p2: 0 } }
    const ids = bossPick(a, 'p2', rt, () => 0.5)
    const sent = a.hands.p2.filter((c) => ids.includes(c.id))
    // 對手把我這疊放到第 4 格(空的),沒拿第 2 格那疊來撞
    const b: GameState = {
      ...a,
      hands: { ...a.hands, p2: a.hands.p2.filter((c) => !ids.includes(c.id)) },
      slots: a.slots.map((s, i) => (i === 4 ? { ...s, p2: sent } : s)),
    }
    bossPick(b, 'p2', rt, () => 0.5)
    const reads = bossReadsOf(rt)
    if (sent.length >= 4) expect(reads.some((r) => r.slot === 2 && r.count === 5)).toBe(true)
    else expect(reads.length).toBe(0) // 沒出強牌就不算讀到
  })
})

describe('火力全開:看得到推牌位置、對戰電腦副技能恢復', () => {
  it('只有牌組變了的玩法才隱藏推牌位置;火力全開規則卡不再寫那行', () => {
    expect(hidesPushPos('ghost')).toBe(true)
    expect(hidesPushPos('blank')).toBe(true)
    expect(hidesPushPos('mixed')).toBe(true)
    expect(hidesPushPos('fire')).toBe(false)
    expect(hidesPushPos(null)).toBe(false)
    expect(LIMITED_INFO.fire.rules.join('')).not.toContain('實際出牌的位置')
  })

  it('火力全開對戰電腦:拼牌 / 鬼牌時機 / 看破 30;其他限定房照舊 0', () => {
    expect(defaultLimitedBrain('fire').profile).toMatchObject({ draw: 30, jokerTiming: 30, insight: 30 })
    expect(defaultLimitedBrain('ghost').profile).toMatchObject({ draw: 0, jokerTiming: 0, insight: 0 })
    expect(otherPlayer('p1')).toBe('p2')
  })
})
