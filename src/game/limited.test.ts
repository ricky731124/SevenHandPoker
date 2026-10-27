import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { isJoker, isBlank, isStarterSpecial, makeDeck } from './cards'
import { evaluate, CATEGORY } from './evaluate'
import { LIMITED_TEST_MODE, limitedModeAt, makeLimitedDeck } from './limited'
import { defaultLimitedBrain, limitedPick } from './limitedAI'
import { aiPick, aiPlace } from './ai'
import { buildFrames } from './replay'
import { rollMain, type BossRuntime } from './bossAI'
import { CAMPAIGN } from './campaign'
import { mulberry32 } from './rng'
import { applyDraw, applyPick, applyPlace, createGame, otherPlayer, resolveShowdown, type GameState, type PlayerId } from './state'

// 限定房(LIMITED-ROOM-SPEC)步驟 1:牌組、引擎、排程、百鬼夜行人機。

describe('牌組', () => {
  it('沒有玩法 = 原本的 52 張,洗牌結果跟以前一樣', () => {
    expect(makeLimitedDeck(1, null)).toEqual(makeDeck())
    const a = createGame(12345, 'p1')
    expect(a.mode).toBeUndefined()
    expect('mode' in a).toBe(false) // 不寫 undefined 欄位(RTDB / 快照)
  })
  it('百鬼夜行:2~6 共 20 張全變鬼牌(新 id,不算開局那張)', () => {
    const d = makeLimitedDeck(7, 'ghost')
    expect(d).toHaveLength(52)
    const j = d.filter(isJoker)
    expect(j).toHaveLength(20)
    expect(j.every((c) => /^JOKER_d\d+$/.test(c.id) && !isStarterSpecial(c))).toBe(true)
    expect(d.filter((c) => !isJoker(c)).every((c) => c.rank >= 7)).toBe(true)
    expect(new Set(d.map((c) => c.id)).size).toBe(52)
  })
  it('空城計:20 張空白;撲朔迷離:10 鬼 10 空白,由 seed 決定', () => {
    expect(makeLimitedDeck(7, 'blank').filter(isBlank)).toHaveLength(20)
    const m1 = makeLimitedDeck(99, 'mixed')
    expect(m1.filter(isJoker)).toHaveLength(10)
    expect(m1.filter(isBlank)).toHaveLength(10)
    expect(makeLimitedDeck(99, 'mixed')).toEqual(m1) // 同 seed 一樣(回放可重現)
    const other = makeLimitedDeck(100, 'mixed').map((c) => c.id).join()
    expect(other).not.toBe(m1.map((c) => c.id).join())
  })
  it('火力全開:牌組不變', () => {
    expect(makeLimitedDeck(1, 'fire')).toEqual(makeDeck())
  })
  it('createGame 帶玩法:開局 1 鬼 1 空白照常、mode 寫進 state', () => {
    const g = createGame(42, 'p1', 'p2', 'ghost')
    expect(g.mode).toBe('ghost')
    for (const p of ['p1', 'p2'] as PlayerId[]) {
      expect(g.hands[p]).toHaveLength(12)
      expect(g.hands[p].filter(isStarterSpecial)).toHaveLength(2)
    }
    const all = [...g.hands.p1, ...g.hands.p2, ...g.deck]
    expect(all.filter(isJoker)).toHaveLength(22)
    expect(all.filter(isBlank)).toHaveLength(2)
  })
})

describe('排程', () => {
  it('測試期固定玩法(步驟 1 = 百鬼夜行)', () => {
    expect(LIMITED_TEST_MODE).toBe('ghost')
    for (let d = 0; d < 7; d++) expect(limitedModeAt(Date.UTC(2026, 9, 26 + d, 3))).toBe('ghost')
  })
})

describe('引擎:限定房比牌只套百鬼夜行 / 撲朔迷離', () => {
  // 造一個「雙方都放好、輪到最後一放」的局面,看 applyPlace 的判決
  function duel(mode: 'ghost' | null, p1: Card[], p2: Card[]): GameState {
    const g = createGame(1, 'p1', 'p2', mode)
    const slots = g.slots.map((s) => ({ ...s }))
    slots[0] = { p1, p2: [], owner: null }
    return applyPlace({ ...g, slots, phase: 'place', pendingPick: { by: 'p2', cards: p2 } }, 'p1', 0)
  }
  const c = (s: string): Card => {
    const r = s.slice(1)
    return { id: s, suit: s[0] as Suit, rank: (r === 'A' ? 14 : r === 'K' ? 13 : Number(r)) as Rank }
  }
  const J = (n: number): Card => ({ id: `JOKER_d${n}`, suit: 'S', rank: 14, kind: 'joker' })

  it('百鬼夜行:鬼+♣A 贏 鬼+鬼,攤牌記「鬼牌少的贏」+ 每張鬼牌變什麼', () => {
    const g = duel('ghost', [J(1), c('CA')], [J(2), J(3)])
    expect(g.slots[0].owner).toBe('p1')
    expect(g.lastShowdown?.note).toBe('jokers')
    expect(g.lastShowdown?.p2Wilds).toHaveLength(2)
  })
  it('一般房:單張 ♣A 對 開局鬼牌 → 鬼牌(♠A)贏,沒有說明字', () => {
    const g = duel(null, [c('CA')], [{ id: 'JOKER_p2', suit: 'S', rank: 14, kind: 'joker' }])
    expect(g.slots[0].owner).toBe('p2')
    expect(g.lastShowdown?.note).toBeUndefined()
  })
})

describe('回放:帶玩法可重現', () => {
  it('百鬼夜行整場棋譜 → buildFrames 最後一幀跟實際對局一樣', () => {
    const rng = mulberry32(3)
    let g = createGame(777, 'p2', 'p2', 'ghost')
    const moves: Parameters<typeof buildFrames>[0]['moves'] = []
    for (let i = 0; i < 400 && g.phase !== 'ended'; i++) {
      if (g.phase === 'pick') {
        const ids = aiPick(g, g.turn)
        moves.push({ t: 'pick', by: g.turn, ids })
        g = applyPick(g, g.turn, ids)
      } else if (g.phase === 'place') {
        const placer = otherPlayer(g.pendingPick!.by)
        const slot = aiPlace(g, placer, { ...defaultLimitedBrain(), execution: rng() })
        moves.push({ t: 'place', by: placer, slot })
        g = applyPlace(g, placer, slot)
      } else if (g.phase === 'showdown') g = resolveShowdown(g)
      else if (g.phase === 'draw') g = applyDraw(g)
    }
    const frames = buildFrames({ seed: 777, firstPicker: 'p2', mode: 'ghost', moves })
    const last = frames[frames.length - 1].state
    expect(last.winner).toBe(g.winner)
    expect(last.slots).toEqual(g.slots)
  })
})

// ---- 百鬼夜行人機 ----

/** 造一個 p2 選牌的局面:手牌自訂、已放 placed 手。 */
function pickState(hand: Card[], placed = 0): GameState {
  const g = createGame(5, 'p2', 'p2', 'ghost')
  return { ...g, hands: { ...g.hands, p2: hand }, placementsDone: { p1: placed, p2: placed }, turn: 'p2', phase: 'pick' }
}
const C = (s: string): Card => {
  const r = s.slice(1)
  const rank = (r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r)) as Rank
  return { id: s, suit: s[0] as Suit, rank }
}
const Jk = (n: number): Card => ({ id: `JOKER_d${n}`, suit: 'S', rank: 14, kind: 'joker' })
const brain = (main: BossRuntime['main'], execution = 1): BossRuntime => ({ ...defaultLimitedBrain(), main, execution })
const pickOf = (g: GameState, rt: BossRuntime) => {
  const ids = new Set(limitedPick(g, 'p2', rt, () => 0.5))
  return g.hands.p2.filter((c) => ids.has(c.id))
}

describe('百鬼夜行人機:組牌守則(§11.4)', () => {
  it('手上有正牌就不出 5 張全鬼', () => {
    const g = pickState([C('C7'), C('D8'), ...[1, 2, 3, 4, 5, 6, 7].map(Jk)], 6) // 最後一手,全部可花
    const p = pickOf(g, brain('attack'))
    expect(p.some((c) => !isJoker(c))).toBe(true)
  })
  it('只剩鬼牌時才出鬼(分散用)', () => {
    const g = pickState([1, 2, 3, 4, 5, 6].map(Jk), 2)
    const p = pickOf(g, brain('balance'))
    expect(p.every(isJoker)).toBe(true)
    expect(p.length).toBeLessThan(5)
  })
  it('1 張小牌 + 4 鬼的同花順不出(比 5 鬼小,例 #12)', () => {
    const g = pickState([C('C7'), C('D8'), ...[1, 2, 3, 4, 5].map(Jk)], 6)
    const p = pickOf(g, brain('attack'))
    if (evaluate(p).category === CATEGORY.STRAIGHT_FLUSH) expect(p.filter((c) => !isJoker(c)).length).toBeGreaterThan(1)
  })
  it('小牌跟同花色正牌一起可以進同花順(省鬼):♣7 8 9 + 2 鬼', () => {
    const g = pickState([C('C7'), C('C8'), C('C9'), C('HQ'), C('DK'), ...[1, 2, 3, 4].map(Jk)], 3)
    const p = pickOf(g, brain('attack'))
    expect(evaluate(p).category).toBe(CATEGORY.STRAIGHT_FLUSH)
    expect(p.filter(isJoker)).toHaveLength(2)
  })
  it('同花順最多比鐵支多 1 鬼就選同花順;多 2 鬼才選鐵支', () => {
    // ♠K A + 3 鬼(同花順 3 鬼) vs ♦9 ♥9 ♣9 + 1 鬼(鐵支 1 鬼)→ 差 2 → 鐵支
    const g1 = pickState([C('SK'), C('SA'), C('D9'), C('H9'), C('C9'), ...[1, 2, 3, 4, 5].map(Jk)], 3)
    expect(evaluate(pickOf(g1, brain('attack'))).category).toBe(CATEGORY.FOUR_KIND)
    // ♠K A + 3 鬼 vs ♦9 ♥9 + 2 鬼 → 差 1 → 同花順
    const g2 = pickState([C('SK'), C('SA'), C('D9'), C('H9'), ...[1, 2, 3, 4, 5].map(Jk)], 3)
    expect(evaluate(pickOf(g2, brain('attack'))).category).toBe(CATEGORY.STRAIGHT_FLUSH)
  })
  it('不出中間牌:要嘛大牌(同花順 / 鐵支),要嘛只送 1 張', () => {
    for (const main of ['attack', 'hoard', 'balance'] as const) {
      for (let pd = 0; pd <= 4; pd++) {
        const g = pickState([C('C7'), C('D7'), C('CJ'), C('SJ'), C('SQ'), C('HA'), C('DK'), ...[1, 2, 3, 4, 5, 6].map(Jk)], pd)
        const p = pickOf(g, brain(main))
        const cat = evaluate(p).category
        expect(p.length === 1 || cat === CATEGORY.STRAIGHT_FLUSH || cat === CATEGORY.FOUR_KIND).toBe(true)
      }
    }
  })
  it('送 1 張時不拆同花順核心:♣10 J 留著,送孤牌', () => {
    const g = pickState([C('C10'), C('CJ'), C('D7'), C('D8'), C('D9'), C('DK'), ...[1, 2, 3, 4, 5].map(Jk)], 0)
    const p = pickOf(g, brain('hoard'))
    expect(p).toHaveLength(1)
    expect(['C10', 'CJ']).not.toContain(p[0].id)
  })
  it('最後一手湊不出大牌:♦10 + 2 鬼 三條,不送單張', () => {
    const g = pickState([C('D10'), C('S8'), Jk(1), Jk(2)], 6)
    expect(evaluate(pickOf(g, brain('balance'))).category).toBe(CATEGORY.THREE_KIND)
  })
  it('執行力失手也不在前期花 4 張鬼(♥K + 4 鬼)', () => {
    const g = pickState([C('HK'), C('S9'), C('H7'), C('C7'), C('H8'), C('D8'), C('SQ'), ...[1, 2, 3, 4].map(Jk)], 0)
    expect(pickOf(g, brain('balance', 0)).filter(isJoker).length).toBeLessThanOrEqual(3)
  })
  it('囤牌:先手前 2 手、後手前 1 手送 1 張,之後出大牌', () => {
    const hand = [C('C9'), C('CJ'), C('CQ'), C('SK'), C('D8'), ...[1, 2, 3, 4, 5, 6].map(Jk)]
    const g = pickState(hand, 1) // pickState 的先手是 p2(= 自己)
    expect(pickOf(g, brain('hoard'))).toHaveLength(1)
    expect(pickOf({ ...g, firstPicker: 'p1' }, brain('hoard')).length).toBeGreaterThan(1)
    expect(pickOf(pickState(hand, 2), brain('hoard')).length).toBeGreaterThan(1)
  })
})

describe('百鬼夜行人機:使用者 2026-10-28 五張截圖(驗收)', () => {
  const B: Card = { id: 'BLANK_p2', suit: 'C', rank: 2, kind: 'blank' }
  const jk = (n: number) => Array.from({ length: n }, (_, i) => Jk(i + 1))
  const reals = (p: Card[]) => p.filter((c) => !isJoker(c)).map((c) => c.id).sort()
  // 強攻 / 平衡(執行力 1)都要出下面這手;囤牌在早期可以送 1 張,但不准出中間牌
  const cases: { name: string; hand: Card[]; pd: number; want: string[]; jokers: number }[] = [
    { name: '圖一 ♣9 10 J + 2 鬼(不是 ♣10 J + 3 鬼)', hand: [B, C('D8'), C('C9'), C('C10'), C('CJ'), C('DQ'), ...jk(6)], pd: 3, want: ['C10', 'C9', 'CJ'], jokers: 2 },
    { name: '圖二 ♣9 J Q + 2 鬼 同花順(不是 QQ + 2 鬼 鐵支)', hand: [B, C('D8'), C('C9'), C('CJ'), C('CQ'), C('HQ'), ...jk(7)], pd: 2, want: ['C9', 'CJ', 'CQ'], jokers: 2 },
    { name: '圖三 ♣9 J Q + 2 鬼(不是 K + 鬼)', hand: [B, C('D8'), C('C9'), C('CJ'), C('CQ'), C('SK'), ...jk(6)], pd: 2, want: ['C9', 'CJ', 'CQ'], jokers: 2 },
    { name: '圖四 ♠J Q + 3 鬼 同花大順(不是爛葫蘆)', hand: [B, C('C7'), C('D7'), C('CJ'), C('SJ'), C('SQ'), ...jk(6)], pd: 2, want: ['SJ', 'SQ'], jokers: 3 },
    { name: '圖五 同花大順 + 3 鬼(不是爛順子)', hand: [B, C('S10'), C('DQ'), C('SQ'), C('DK'), C('HA'), ...jk(6)], pd: 2, want: [], jokers: 3 },
  ]
  for (const k of cases) {
    it(k.name, () => {
      for (const main of ['attack', 'balance', 'hoard'] as const) {
        const p = pickOf(pickState(k.hand, k.pd), brain(main))
        const cat = evaluate(p).category
        if (main === 'hoard' && p.length === 1) continue
        expect(cat).toBe(CATEGORY.STRAIGHT_FLUSH)
        expect(p.filter(isJoker)).toHaveLength(k.jokers)
        if (k.want.length) expect(reals(p)).toEqual([...k.want].sort())
      }
    })
  }
  it('強攻第一手最多 3 張鬼', () => {
    const g = pickState([C('C7'), C('D9'), C('HJ'), ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(Jk)], 0)
    expect(pickOf(g, brain('attack')).filter(isJoker).length).toBeLessThanOrEqual(3)
  })
  it('囤牌第一手手上有對子 → 不花鬼', () => {
    const g = pickState([C('CK'), C('DK'), C('H8'), C('S9'), ...[1, 2, 3].map(Jk)], 0)
    expect(pickOf(g, brain('hoard')).filter(isJoker)).toHaveLength(0)
  })
  it('同樣能湊到的牌型,優先正牌多、鬼牌少的組法(♣A♦A 不用鬼 > 鬼鬼)', () => {
    const g = pickState([C('CA'), C('DA'), C('H8'), ...[1, 2].map(Jk)], 3)
    const p = pickOf(g, brain('balance'))
    // 用了 A 就不會再拿鬼牌去湊同樣的對子 A
    if (evaluate(p).category === CATEGORY.PAIR) expect(p.filter(isJoker)).toHaveLength(0)
  })
})

describe('百鬼夜行整場:人機出的每一手都合法、打得完', () => {
  it('120 場電腦對電腦(各種主策略 / 執行力)', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rng = mulberry32(seed)
      const rts: Record<PlayerId, BossRuntime> = {
        p1: { profile: CAMPAIGN[seed % CAMPAIGN.length].profile, main: rollMain(CAMPAIGN[seed % CAMPAIGN.length].profile, rng), execution: [0.6, 0.75, 0.9][seed % 3] },
        p2: defaultLimitedBrain(),
      }
      let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2', 'p2', 'ghost')
      let steps = 0
      while (g.phase !== 'ended' && steps++ < 400) {
        if (g.phase === 'pick') g = applyPick(g, g.turn, limitedPick(g, g.turn, rts[g.turn], rng))
        else if (g.phase === 'place') {
          const placer = otherPlayer(g.pendingPick!.by)
          g = applyPlace(g, placer, aiPlace(g, placer, rts[placer]))
        } else if (g.phase === 'showdown') g = resolveShowdown(g)
        else if (g.phase === 'draw') g = applyDraw(g)
      }
      expect(g.phase).toBe('ended')
      expect(g.winner).not.toBeNull()
    }
  })
})
