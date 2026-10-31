import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { isJoker, isBlank, isStarterSpecial, makeDeck } from './cards'
import { evaluate, compareHands, compareLimited, CATEGORY } from './evaluate'
import { BLANK_EXAMPLES, LIMITED_ROTA, LIMITED_TEST_MODE, TIE_STEPS, limitedModeAt, makeLimitedDeck } from './limited'
import { defaultLimitedBrain, limitedPick, limitedPlace } from './limitedAI'
import { aiPick, aiPlace } from './ai'
import { buildFrames } from './replay'
import { rollMain, type BossRuntime } from './bossAI'
import { CAMPAIGN } from './campaign'
import { rollCasualBot } from './casualBots'
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
  it('測試期固定玩法(步驟 4 = 火力全開)', () => {
    expect(LIMITED_TEST_MODE).toBe('fire')
    for (let d = 0; d < 7; d++) expect(limitedModeAt(Date.UTC(2026, 9, 26 + d, 3))).toBe('fire')
  })
  it('輪值表:同玩法的星期併一列(§8.2)', () => {
    expect(LIMITED_ROTA.map((r) => [r.label, r.mode])).toEqual([
      ['星期一、四', 'ghost'],
      ['星期二、五', 'blank'],
      ['星期三、日', 'fire'],
      ['星期六', 'mixed'],
    ])
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

describe('百鬼夜行人機:每格最多 2 鬼(§11.4a)', () => {
  const B: Card = { id: 'BLANK_p2', suit: 'C', rank: 2, kind: 'blank' }
  const jk = (n: number) => Array.from({ length: n }, (_, i) => Jk(i + 1))
  it('每一手都不超過 2 張鬼(三種打法、各種時期、失手也一樣)', () => {
    for (const main of ['attack', 'hoard', 'balance'] as const) {
      for (const ex of [1, 0]) {
        for (let pd = 0; pd <= 6; pd++) {
          const g = pickState([C('C7'), C('CJ'), C('SJ'), C('SQ'), C('HA'), C('DK'), ...jk(9)], pd)
          expect(pickOf(g, brain(main, ex)).filter(isJoker).length).toBeLessThanOrEqual(2)
        }
      }
    }
  })
  it('只剩鬼牌:一次最多出 2 張', () => {
    const p = pickOf(pickState(jk(6), 2), brain('balance'))
    expect(p.every(isJoker)).toBe(true)
    expect(p.length).toBeLessThanOrEqual(2)
  })
  it('最後一手出整副手牌最大的一疊(含踢腳):♦Q ♦10 ♦8 + 空白,不是單張 ♦8', () => {
    const g = pickState([B, C('D10'), C('D8'), C('DQ')], 6)
    const p = pickOf(g, brain('balance'))
    expect(p).toHaveLength(4)
  })
  it('最後一手:♦10 + 2 鬼 = 三條(還塞 ♠8 當踢腳)', () => {
    const p = pickOf(pickState([C('D10'), C('S8'), Jk(1), Jk(2)], 6), brain('attack'))
    expect(evaluate(p).category).toBe(CATEGORY.THREE_KIND)
    expect(p).toHaveLength(4)
  })
  it('圖一:♣9 10 J + 2 鬼 同花順', () => {
    const p = pickOf(pickState([B, C('D8'), C('C9'), C('C10'), C('CJ'), C('DQ'), ...jk(6)], 3), brain('attack'))
    expect(evaluate(p).category).toBe(CATEGORY.STRAIGHT_FLUSH)
    expect(p.filter(isJoker)).toHaveLength(2)
  })
  it('圖二:♣9 J Q + 2 鬼 同花順勝過 QQ + 2 鬼 鐵支', () => {
    const p = pickOf(pickState([B, C('D8'), C('C9'), C('CJ'), C('CQ'), C('HQ'), ...jk(7)], 2), brain('attack'))
    expect(evaluate(p).category).toBe(CATEGORY.STRAIGHT_FLUSH)
  })
  it('強攻前期有牌就出:不送單張、不出對子過渡', () => {
    for (const pd of [0, 1]) {
      const p = pickOf(pickState([C('C7'), C('D7'), C('CJ'), C('SQ'), C('HA'), C('DK'), ...jk(4)], pd), brain('attack'))
      expect(evaluate(p).category).toBeGreaterThanOrEqual(CATEGORY.THREE_KIND)
    }
  })
  it('囤牌第 1 手預設送「單張 + 1 鬼」;牌很好(1 鬼內鐵支)才出', () => {
    const p = pickOf(pickState([C('C7'), C('DJ'), C('SQ'), C('HA'), C('DK'), C('C9'), ...jk(5)], 0), brain('hoard'))
    expect(p.filter((c) => !isJoker(c))).toHaveLength(1)
    expect(p.filter(isJoker)).toHaveLength(1)
    const good = pickOf(pickState([C('C7'), C('D7'), C('H7'), C('HA'), C('DK'), ...jk(5)], 0), brain('hoard'))
    expect(evaluate(good).category).toBeGreaterThanOrEqual(CATEGORY.FOUR_KIND)
  })
  it('後期(第 6 手)不送:不出單張、也不出「單張 + 鬼」過渡', () => {
    for (const main of ['attack', 'hoard', 'balance'] as const) {
      const p = pickOf(pickState([C('C7'), C('DJ'), C('SQ'), C('HA'), Jk(1), Jk(2), Jk(3)], 5), brain(main))
      expect(p.length).toBeGreaterThan(1)
      const q = pickOf(pickState([C('C9'), C('D9'), C('HQ'), C('SK'), C('D7'), Jk(1)], 5), brain(main))
      expect(q.filter((c) => !isJoker(c)).length).toBeGreaterThan(1)
    }
  })

  // §11.3 強攻棄一格 / 平衡看比分
  const own = (g: GameState, who: PlayerId, slots: number[]): GameState => ({
    ...g,
    slots: g.slots.map((s, i) => (slots.includes(i) ? { p1: [C('S8')], p2: [C('H8')], owner: who } : s)),
  })
  const withPile = (g: GameState, i: number, pile: Card[]): GameState => ({
    ...g,
    slots: g.slots.map((s, k) => (k === i ? { ...s, p2: pile } : s)),
  })
  const pickRng = (g: GameState, rt: BossRuntime) => {
    const ids = new Set(limitedPick(g, 'p2', rt, mulberry32(42)))
    return g.hands.p2.filter((c) => ids.has(c.id))
  }
  const trips9 = [C('C9'), C('D9'), C('H9'), C('SK'), C('D7')]
  it('強攻中期:這手只有三條、棄一格後下一手有機會鐵支 → 棄一格(沒鬼出純單張,不拆三條)', () => {
    const p = pickRng(pickState(trips9, 2), brain('attack'))
    expect(p).toHaveLength(1)
    expect(p[0].rank).not.toBe(9)
  })
  it('強攻:整局最多棄 1 次;前期不棄', () => {
    const used = withPile(pickState(trips9, 2), 0, [C('SA'), Jk(9)])
    expect(evaluate(pickRng(used, brain('attack'))).category).toBe(CATEGORY.THREE_KIND)
    expect(evaluate(pickRng(pickState(trips9, 1), brain('attack'))).category).toBe(CATEGORY.THREE_KIND)
  })
  it('強攻中期有鐵支就出,不棄', () => {
    const p = pickRng(pickState([...trips9, Jk(1)], 3), brain('attack'))
    expect(evaluate(p).category).toBe(CATEGORY.FOUR_KIND)
  })
  const pair9 = [C('C9'), C('D9'), C('HQ'), C('SK'), C('D7'), Jk(1)] // 最好只有三條(99 + 鬼)
  it('平衡看比分:落後三條就出、平手沒鐵支就過渡(單張 + 1 鬼)', () => {
    const behind = own(pickState(pair9, 2), 'p1', [0])
    expect(evaluate(pickOf(behind, brain('balance'))).category).toBe(CATEGORY.THREE_KIND)
    const tied = pickOf(pickState(pair9, 2), brain('balance'))
    expect(tied.filter((c) => !isJoker(c))).toHaveLength(1)
    expect(tied.filter(isJoker)).toHaveLength(1)
  })
  it('平衡領先:只有同花順或 K / A 鐵支才算好牌;已過渡 2 次就不再過渡', () => {
    const ahead = own(pickState([C('C9'), C('D9'), C('HQ'), C('SK'), C('D7'), Jk(1), Jk(2)], 2), 'p2', [0])
    expect(pickOf(ahead, brain('balance')).filter((c) => !isJoker(c))).toHaveLength(1) // 99 鐵支不夠好 → 過渡
    const aheadKK = own(pickState([C('CK'), C('DK'), C('HQ'), C('S9'), C('D7'), Jk(1), Jk(2)], 2), 'p2', [0])
    expect(evaluate(pickOf(aheadKK, brain('balance'))).category).toBe(CATEGORY.FOUR_KIND)
    const twice = withPile(withPile(pickState(pair9, 3), 0, [C('SA'), Jk(8)]), 1, [C('HA'), Jk(9)])
    expect(pickOf(twice, brain('balance')).filter((c) => !isJoker(c)).length).toBeGreaterThan(1)
  })
})

describe('百鬼執行力 + 規則卡範例(§11.4a / §8.3)', () => {
  it('百鬼快配人機 0.35 / 0.5 / 0.65、對戰電腦 0.5;一般快配照舊', () => {
    const ghost = new Set(Array.from({ length: 60 }, (_, i) => rollCasualBot(false, [], mulberry32(i), undefined, 'ghost').boss.execution))
    expect([...ghost].sort()).toEqual([0.35, 0.5, 0.65])
    const normal = new Set(Array.from({ length: 60 }, (_, i) => rollCasualBot(false, [], mulberry32(i)).boss.execution))
    expect([...normal].sort()).toEqual([0.6, 0.75, 0.9])
    expect(defaultLimitedBrain('ghost').execution).toBe(0.5)
    // 空城計:跟主線第二關一樣(2026-10-30)
    const blank = new Set(Array.from({ length: 60 }, (_, i) => rollCasualBot(false, [], mulberry32(i), undefined, 'blank').boss.execution))
    expect([...blank].sort()).toEqual([0.5, 0.65, 0.8])
    expect(defaultLimitedBrain('blank').execution).toBe(0.65)
    expect(defaultLimitedBrain('fire').execution).toBe(0.75)
  })
  it('三個範例照真的比牌規則:左邊贏,而且分在那一步', () => {
    const toCard = (id: string, k: number): Card =>
      id === 'J' ? { id: `JOKER_d${k + 30}`, suit: 'S', rank: 14, kind: 'joker' } : C(id)
    const steps = ['jokers', 'rank', 'suit'] as const
    TIE_STEPS.forEach((s, i) => {
      const r = compareLimited(s.left.map(toCard), s.right.map((id, k) => toCard(id, k + 10)))
      expect(r.cmp).toBeGreaterThan(0)
      expect(r.by).toBe(steps[i])
    })
  })
})

describe('限定房放牌(§11.9,百鬼夜行分布表)', () => {
  /** p1(真人)剛出 n 張,等 p2(電腦)放;mine[i] = 電腦在第 i 格已經有的牌。 */
  function placeState(incoming: Card[], mine: Record<number, Card[]>, foeOwns: number[] = []): GameState {
    const g = createGame(5, 'p1', 'p2', 'ghost')
    const slots = g.slots.map((_, i) => ({
      p1: foeOwns.includes(i) ? [C('S8')] : [],
      p2: foeOwns.includes(i) ? [C('H7')] : (mine[i] ?? []),
      owner: foeOwns.includes(i) ? ('p1' as const) : null,
    }))
    return { ...g, slots, pendingPick: { by: 'p1', cards: incoming }, phase: 'place' }
  }
  const quadsK = [C('SK'), C('HK'), Jk(1), Jk(2)]
  const sf = [C('C9'), C('C10'), C('CJ'), Jk(3), Jk(4)]
  const trips = [C('D9'), C('H9'), Jk(5)]
  it('對手出 4 張(≈ 鐵支):不拿三條去接,用同花順接', () => {
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      const g = placeState(quadsK, { 1: sf, 3: trips })
      expect(aiPlace(g, 'p2', brain(main))).toBe(1)
    }
  })
  it('對手出 5 張(多半同花順):不拿鐵支去撞', () => {
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      const g = placeState([C('SQ'), C('SK'), C('SA'), Jk(1), Jk(2)], { 2: [C('DQ'), C('HQ'), Jk(3), Jk(4)], 4: [C('D7'), Jk(5)] })
      expect(aiPlace(g, 'p2', brain(main))).not.toBe(2)
    }
  })
  it('擋殺:對手拿了第 2 格就 3 連 → 不把它的大牌放進第 2 格等(之後它會挑我的爛牌去接)', () => {
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      const g = placeState(quadsK, { 5: [C('D7'), Jk(5)] }, [0, 1])
      expect(aiPlace(g, 'p2', brain(main))).not.toBe(2)
    }
  })
  it('CP 值:對手出 4 張,同花順和 A 鐵支都贏 → 平衡用 A 鐵支接,同花順留著', () => {
    const g = placeState(quadsK, { 2: sf, 5: [C('DA'), C('HA'), Jk(5), Jk(6)] })
    expect(aiPlace(g, 'p2', brain('balance'))).toBe(5)
  })
})
// ---- 空城計(§11.5a) ----

describe('空城計人機(§11.5c / 11.5d)', () => {
  const Bk = (n: number): Card => ({ id: `BLANK_d${n}`, suit: 'C', rank: 2, kind: 'blank' })
  const bk = (n: number) => Array.from({ length: n }, (_, i) => Bk(i + 1))
  /** p2 選牌的空城計局面(placed = 雙方已放幾手)。 */
  function blankState(hand: Card[], placed = 0): GameState {
    const g = createGame(5, 'p2', 'p2', 'blank')
    return { ...g, hands: { ...g.hands, p2: hand }, placementsDone: { p1: placed, p2: placed }, turn: 'p2', phase: 'pick' }
  }
  const pickWith = (g: GameState, rt: BossRuntime, r: number, opts = {}) => {
    const ids = new Set(limitedPick(g, 'p2', rt, () => r, opts))
    return g.hands.p2.filter((c) => ids.has(c.id))
  }
  const realsOf = (p: Card[]) => p.filter((c) => !isBlank(c))

  it('規則卡範例照一般房比牌:三個都是右邊贏', () => {
    const toCard = (id: string, k: number): Card => (id === 'B' ? Bk(40 + k) : C(id))
    for (const s of BLANK_EXAMPLES) {
      expect(s.winner).toBe('right')
      expect(compareHands(s.left.map(toCard), s.right.map((id, k) => toCard(id, k + 10)))).toBeLessThan(0)
    }
  })
  it('每一手 1~5 張、都是手上的牌(三種打法、各種時期、失手也一樣)', () => {
    const hand = [C('C7'), C('D7'), C('CJ'), C('SQ'), C('HA'), C('DK'), C('S9'), ...bk(8)]
    for (const main of ['attack', 'hoard', 'balance'] as const) {
      for (const ex of [1, 0]) {
        for (let pd = 0; pd <= 6; pd++) {
          for (const r of [0.05, 0.5, 0.95]) {
            const p = pickWith(blankState(hand, pd), brain(main, ex), r)
            expect(p.length).toBeGreaterThanOrEqual(1)
            expect(p.length).toBeLessThanOrEqual(5)
          }
        }
      }
    }
  })
  it('不墊模式:除了全空白送格,一張空白都不出', () => {
    for (let pd = 0; pd <= 6; pd++) {
      const p = pickWith(blankState([C('C7'), C('D7'), C('HA'), C('DK'), ...bk(6)], pd), brain('attack', 0), 0.5, { noPad: true })
      if (realsOf(p).length) expect(p.some(isBlank)).toBe(false)
    }
  })
  it('三條:真牌是三條,最多墊 2 張(不再墊到 5 張)', () => {
    const hand = [C('C9'), C('D9'), C('H9'), C('SA'), C('DK'), ...bk(6)]
    for (const r of [0.05, 0.5, 0.95]) {
      const p = pickWith(blankState(hand, 2), brain('attack'), r)
      expect(evaluate(p).category).toBe(CATEGORY.THREE_KIND)
      expect(realsOf(p)).toHaveLength(3)
      expect(p.filter(isBlank).length).toBeLessThanOrEqual(2)
    }
  })
  it('強對子(J~A)最多墊 1 張;弱對子最多墊 2 張', () => {
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      for (const r of [0.05, 0.5, 0.95]) {
        const strong = pickWith(blankState([C('CK'), C('DK'), C('S7'), C('H9'), ...bk(6)], 1), brain(main), r)
        if (evaluate(strong).category === CATEGORY.PAIR && evaluate(strong).rankSeq[0] === 13) expect(strong.filter(isBlank).length).toBeLessThanOrEqual(1)
        const weak = pickWith(blankState([C('C8'), C('D8'), C('SA'), C('HJ'), ...bk(6)], 1), brain(main), r)
        if (realsOf(weak).length === 2) expect(weak.filter(isBlank).length).toBeLessThanOrEqual(2)
      }
    }
  })
  it('沒有對子:送全空白,不出單張 / 單張 + 1~2 空白(使用者 10/30:Q + 空白、單出一張 Q 都沒價值;偶爾「單張 + 3 空白」裝大可以)', () => {
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      for (let pd = 0; pd <= 4; pd++) {
        for (const r of [0.05, 0.5, 0.95]) {
          const p = pickWith(blankState([C('SQ'), C('H9'), C('DK'), C('C7'), C('SJ'), ...bk(6)], pd), brain(main), r)
          if (realsOf(p).length) {
            expect(realsOf(p)).toHaveLength(1)
            expect(p.filter(isBlank).length).toBeGreaterThanOrEqual(3)
          }
        }
        expect(realsOf(pickWith(blankState([C('SQ'), C('H9'), C('DK'), C('C7'), C('SJ'), ...bk(6)], pd), brain(main), 0.5))).toHaveLength(0)
      }
    }
  })
  it('鬼不拿去配單張湊對子;有對子就把對子補成三條', () => {
    const noPair = pickWith(blankState([C('SA'), C('H9'), C('DQ'), Jk(1), ...bk(6)], 1), brain('attack'), 0.5)
    expect(noPair.some(isJoker)).toBe(false)
    let played = 0
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      for (const pd of [1, 3, 4]) {
        for (const r of [0.05, 0.5, 0.95]) {
          const pair = pickWith(blankState([C('C8'), C('D8'), C('SA'), C('HJ'), Jk(1), ...bk(6)], pd), brain(main), r)
          if (!pair.some((c) => c.rank === 8 && !isBlank(c) && !isJoker(c))) continue
          played++
          expect(evaluate(pair).category).toBe(CATEGORY.THREE_KIND)
          expect(pair.some(isJoker)).toBe(true)
        }
      }
    }
    expect(played).toBeGreaterThan(0)
  })
  it('鐵支不墊空白', () => {
    // seed 5 時 9 的鐵支是「留著」(quadsPlan);不管拆不拆都不會墊空白
    for (const r of [0.05, 0.5, 0.95]) {
      const p = pickWith(blankState([C('C9'), C('D9'), C('H9'), C('S9'), ...bk(6)], 1), brain('attack'), r)
      if (evaluate(p).category === CATEGORY.FOUR_KIND) expect(p.some(isBlank)).toBe(false)
    }
  })
  it('前五手不出 5 張真牌的大牌(葫蘆拆成三條 + 對子)', () => {
    const hand = [C('C9'), C('D9'), C('H9'), C('SK'), C('HK'), ...bk(6)]
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      for (let pd = 0; pd <= 4; pd++) {
        for (const r of [0.05, 0.5, 0.95]) expect(realsOf(pickWith(blankState(hand, pd), brain(main), r)).length).toBeLessThanOrEqual(3)
      }
    }
  })
  it('失手 = 照實出最划算的一手:最強的資產、不墊', () => {
    const p = pickWith(blankState([C('C8'), C('D8'), C('HQ'), C('SQ'), C('CQ'), C('SA'), ...bk(6)], 1), brain('hoard', 0), 0.5)
    expect(realsOf(p).map((c) => c.rank)).toEqual([12, 12, 12])
    expect(p.some(isBlank)).toBe(false)
  })
  it('對手差一格就贏:真牌出最強的,空白照墊', () => {
    const g = blankState([C('C9'), C('D9'), C('H9'), C('S7'), C('HA'), ...bk(6)], 3)
    const slots = g.slots.map((s, i) => (i < 3 ? { p1: [C('SK')], p2: [C('C8')], owner: 'p1' as const } : s))
    const p = pickWith({ ...g, slots }, brain('hoard'), 0.95)
    expect(evaluate(p).category).toBe(CATEGORY.THREE_KIND)
    expect(p.some(isBlank)).toBe(true)
  })
  it('差一格就贏、最大是兩對:改出最大的一對(最後一手除外)', () => {
    const g = blankState([C('CK'), C('DK'), C('S7'), C('H7'), C('HA'), ...bk(6)], 3)
    const slots = g.slots.map((s, i) => (i < 3 ? { p1: [C('SK')], p2: [C('C8')], owner: 'p1' as const } : s))
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      const p = pickWith({ ...g, slots }, brain(main), 0.95)
      expect(realsOf(p).map((c) => c.rank)).toEqual([13, 13])
    }
    const last = pickWith(blankState([C('CK'), C('DK'), C('S7'), C('H7'), ...bk(3)], 6), brain('balance'), 0.95)
    expect(evaluate(last).category).toBe(CATEGORY.TWO_PAIR)
  })
  it('最好只有弱對子、又有順子:大機率直接出順子(7 8 8 9 10 J)', () => {
    const hand = [C('C7'), C('C8'), C('D8'), C('S9'), C('H10'), C('DJ'), ...bk(3)]
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      const p = pickWith(blankState(hand, 2), brain(main), 0.05)
      expect(evaluate(p).category).toBe(CATEGORY.STRAIGHT)
      expect(p).toHaveLength(5)
    }
    // 有強對子以上就不走這條
    const strong = pickWith(blankState([C('C7'), C('C8'), C('DQ'), C('SQ'), C('S9'), C('H10'), C('DJ'), ...bk(3)], 2), brain('attack'), 0.05)
    expect(realsOf(strong).length).toBeLessThan(5)
  })
  it('前兩手偶爾先送 2~3 張全空白(強攻也會),空白至少留 1 張', () => {
    for (const main of ['attack', 'balance', 'hoard'] as const) {
      const p = pickWith(blankState([C('C9'), C('D9'), C('H9'), C('SK'), ...bk(3)], 0), brain(main), 0.05)
      expect(realsOf(p)).toHaveLength(0)
      expect(p).toHaveLength(2)
    }
  })
  it('最後一手:真牌全部塞進去', () => {
    const p = pickWith(blankState([C('C9'), C('D9'), C('SA'), C('HK'), ...bk(5)], 6), brain('balance'), 0.95)
    expect(realsOf(p)).toHaveLength(4)
  })
  it('空白預算:之後補不到空白時,前期一手不會把空白全花光', () => {
    const g = blankState([C('C7'), C('HK'), ...bk(3)], 0)
    const p = pickWith({ ...g, drawsDone: { p1: 6, p2: 6 } }, brain('hoard'), 0.05)
    expect(p.filter(isBlank).length).toBeLessThan(3)
  })
})

describe('空城計放牌(§11.5c,玩家模型表 + 讀人 + 算牌)', () => {
  /** p1(真人)剛出 incoming,等 p2(電腦)放;mine[i] = 電腦在第 i 格已經有的牌。 */
  function placeState(incoming: Card[], mine: Record<number, Card[]>): GameState {
    const g = createGame(5, 'p1', 'p2', 'blank')
    const slots = g.slots.map((_, i) => ({ p1: [] as Card[], p2: mine[i] ?? [], owner: null }))
    return { ...g, slots, hands: { ...g.hands, p2: [] }, pendingPick: { by: 'p1', cards: incoming }, phase: 'place' }
  }
  const Bk = (n: number): Card => ({ id: `BLANK_d${n}`, suit: 'C', rank: 2, kind: 'blank' })
  it('對手出 3 張(多半三條):不拿自己的「對子 + 空白」去撞,丟給自己全空白那格', () => {
    const g = placeState([C('S7'), C('H7'), C('D7')], { 1: [C('CJ'), C('DJ'), Bk(1)], 3: [Bk(2), Bk(3), Bk(4)], 5: [C('SA'), C('HA'), C('DA')] })
    for (const main of ['attack', 'balance', 'hoard'] as const) expect(aiPlace(g, 'p2', brain(main))).not.toBe(1)
  })
  it('算點數:A 都看光了(鬼也看到了),對手 2 張就不會是一對 A', () => {
    const g = placeState([C('S8'), C('H8')], { 1: [C('CK'), C('DK')], 5: [C('SA'), C('HA')] })
    const seenA = { ...g, hands: { ...g.hands, p2: [C('DA'), C('CA'), Jk(1), { id: 'JOKER_p1', suit: 'S', rank: 14, kind: 'joker' } as Card] } }
    // 一對 K 在這時是對 2 張最強的牌之一 → 至少有一種打法拿去接
    expect(['attack', 'balance', 'hoard'].map((m) => aiPlace(seenA, 'p2', brain(m as BossRuntime['main'])))).toContain(1)
  })
  it('120 場電腦對電腦:合法、打得完', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rng = mulberry32(seed)
      const rts: Record<PlayerId, BossRuntime> = {
        p1: { profile: CAMPAIGN[seed % CAMPAIGN.length].profile, main: rollMain(CAMPAIGN[seed % CAMPAIGN.length].profile, rng), execution: [0.6, 0.75, 0.9][seed % 3] },
        p2: defaultLimitedBrain('blank'),
      }
      let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2', 'p2', 'blank')
      let steps = 0
      while (g.phase !== 'ended' && steps++ < 400) {
        if (g.phase === 'pick') {
          const ids = limitedPick(g, g.turn, rts[g.turn], rng)
          expect(ids.length).toBeGreaterThanOrEqual(1)
          expect(ids.length).toBeLessThanOrEqual(5)
          g = applyPick(g, g.turn, ids)
        } else if (g.phase === 'place') {
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

describe('撲朔迷離人機(§11.6a)', () => {
  const Bk = (n: number): Card => ({ id: `BLANK_d${n}`, suit: 'C', rank: 2, kind: 'blank' })
  const bk = (n: number) => Array.from({ length: n }, (_, i) => Bk(i + 1))
  const jk = (n: number) => Array.from({ length: n }, (_, i) => Jk(i + 1))
  function mixedState(hand: Card[], placed = 0): GameState {
    const g = createGame(5, 'p2', 'p2', 'mixed')
    return { ...g, hands: { ...g.hands, p2: hand }, placementsDone: { p1: placed, p2: placed }, turn: 'p2', phase: 'pick' }
  }
  const pickWith = (g: GameState, rt: BossRuntime, r: number) => {
    const ids = new Set(limitedPick(g, 'p2', rt, () => r))
    return g.hands.p2.filter((c) => ids.has(c.id))
  }
  const realsOf = (p: Card[]) => p.filter((c) => !isBlank(c) && !isJoker(c))
  const hand = [C('CK'), C('DK'), C('S9'), C('H9'), C('C9'), C('SQ'), C('SJ'), C('S10'), ...jk(3), ...bk(3)]
  const MAINS = ['attack', 'balance', 'hoard'] as const

  it('每一手 1~5 張、最多 2 鬼、都是手上的牌;前五手不出「單張 + 鬼」', () => {
    for (const main of MAINS) {
      for (const ex of [1, 0]) {
        for (let pd = 0; pd <= 6; pd++) {
          for (const r of [0.05, 0.5, 0.95]) {
            const p = pickWith(mixedState(hand, pd), brain(main, ex), r)
            expect(p.length).toBeGreaterThanOrEqual(1)
            expect(p.length).toBeLessThanOrEqual(5)
            expect(p.filter(isJoker).length).toBeLessThanOrEqual(2)
            if (pd <= 4 && p.some(isJoker)) expect(realsOf(p).length).not.toBe(1)
          }
        }
      }
    }
  })
  it('差一格就分勝負:出真正最大的;最大是兩對 → 沒鬼改出最大的一對、有鬼補成葫蘆', () => {
    const point = (h: Card[]) => {
      const g = mixedState(h, 3)
      return { ...g, slots: g.slots.map((s, i) => (i < 3 ? { p1: [C('SA')], p2: [C('C8')], owner: 'p1' as const } : s)) }
    }
    for (const main of MAINS) {
      expect(realsOf(pickWith(point([C('CK'), C('DK'), C('S7'), C('H7'), C('HA'), ...bk(3)]), brain(main), 0.95)).map((c) => c.rank)).toEqual([13, 13])
      expect(evaluate(pickWith(point([C('CK'), C('DK'), C('S7'), C('H7'), C('HA'), Jk(1), ...bk(3)]), brain(main), 0.95)).category).toBe(CATEGORY.FULL_HOUSE)
    }
  })
  it('鬼很少(之後也補不到)時:前五手不做 2 鬼的大牌', () => {
    const few = [C('CK'), C('DK'), C('S9'), C('H9'), C('SQ'), C('SJ'), C('S10'), ...jk(2), ...bk(3)]
    for (const main of MAINS) {
      for (let pd = 0; pd <= 4; pd++) {
        for (const r of [0.05, 0.5, 0.95]) {
          const g = { ...mixedState(few, pd), drawsDone: { p1: 6, p2: 6 } }
          expect(pickWith(g, brain(main), r).filter(isJoker).length).toBeLessThan(2)
        }
      }
    }
  })
  it('失手 = 照實出最划算的一手(三條 + 1 鬼 = 鐵支),不墊', () => {
    const p = pickWith(mixedState([C('C9'), C('D9'), C('H9'), C('SK'), C('D7'), Jk(1), ...bk(3)], 1), brain('balance', 0), 0.5)
    expect(evaluate(p).category).toBe(CATEGORY.FOUR_KIND)
    expect(p.filter(isJoker)).toHaveLength(1)
    expect(p.some(isBlank)).toBe(false)
  })
  it('最後一手:最大的一疊、最多 2 鬼', () => {
    const p = pickWith(mixedState([C('C9'), C('D9'), C('SK'), ...jk(3), ...bk(2)], 6), brain('balance'), 0.5)
    expect(p.filter(isJoker)).toHaveLength(2)
    expect(evaluate(p).category).toBe(CATEGORY.FOUR_KIND)
  })
  // ---- 使用者 10/30 回放(5 戰 5 勝)裡的局面(§11.6b)----
  const RS = [0.05, 0.3, 0.5, 0.7, 0.95]
  it('回放 1:四張 10 + 鬼,不拆成一對 10 出(要出就三張 / 四張)', () => {
    const h = [Jk(1), C('DA'), C('CQ'), C('SJ'), C('H10'), C('D10'), C('S10'), C('C10'), C('C8'), C('H7'), ...bk(2)]
    for (const main of MAINS) for (const r of RS) expect([0, 3, 4]).toContain(pickWith(mixedState(h, 0), brain(main), r).filter((c) => c.rank === 10 && !isJoker(c)).length)
  })
  it('回放 4:鐵支不帶真牌踢腳(7 鐵不帶 A)', () => {
    const h = [Jk(1), C('DA'), C('DK'), C('SJ'), C('C8'), C('D8'), C('H7'), C('S7'), C('C7'), ...bk(4)]
    for (const main of MAINS) {
      for (const r of RS) {
        const p = pickWith(mixedState(h, 3), brain(main), r)
        if (evaluate(p).category === CATEGORY.FOUR_KIND) expect(new Set(realsOf(p).map((c) => c.rank)).size).toBe(1)
      }
    }
  })
  it('回放 5 / 6:鬼夠用時,出對子 / 三條會補鬼(3 鬼不出 99 + 空白、4 鬼不出光 QQQ)', () => {
    const h5 = [...jk(3), C('DA'), C('CQ'), C('HQ'), C('D10'), C('S9'), C('C9'), C('S8'), C('H7'), ...bk(3)]
    const h6 = [...jk(4), C('DA'), C('CQ'), C('HQ'), C('DQ'), C('D10'), C('S8'), C('H7'), ...bk(3)]
    for (const main of MAINS) {
      for (const r of RS) {
        const p5 = pickWith(mixedState(h5, 1), brain(main), r)
        if (p5.some((c) => c.rank === 9 && !isJoker(c))) expect(p5.some(isJoker)).toBe(true)
        const p6 = pickWith(mixedState(h6, 2), brain(main), r)
        if (realsOf(p6).filter((c) => c.rank === 12).length === 3) expect(p6.some(isJoker)).toBe(true)
      }
    }
  })
  it('回放 3:手上有 3 張以上空白時,不送 1 張空白', () => {
    const h = [...jk(6), C('SA'), C('DK'), C('DQ'), ...bk(3)]
    for (const main of MAINS) for (let pd = 0; pd <= 4; pd++) for (const r of RS) {
      const p = pickWith(mixedState(h, pd), brain(main), r)
      expect(p.length === 1 && isBlank(p[0])).toBe(false)
    }
  })
  it('回放 2:自己的弱對子很少拿去接對方 2 張(有空格可放時)', () => {
    const g = createGame(5, 'p1', 'p2', 'mixed')
    const slots = g.slots.map((_, i) => ({ p1: [] as Card[], p2: i === 5 ? [C('D9'), C('H9')] : i === 1 ? [C('SA'), C('HA')] : [], owner: null }))
    const st: GameState = { ...g, slots, hands: { ...g.hands, p2: [] }, pendingPick: { by: 'p1', cards: [Jk(1), C('HA')] }, phase: 'place' }
    for (const main of MAINS) {
      const rng = mulberry32(77)
      let onWeak = 0
      for (let i = 0; i < 200; i++) if (limitedPlace(st, 'p2', brain(main), rng) === 5) onWeak++
      expect(onWeak / 200).toBeLessThan(0.3)
    }
  })
  it('120 場電腦對電腦:合法、打得完', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rng = mulberry32(seed)
      const rts: Record<PlayerId, BossRuntime> = {
        p1: { profile: CAMPAIGN[seed % CAMPAIGN.length].profile, main: rollMain(CAMPAIGN[seed % CAMPAIGN.length].profile, rng), execution: [0.5, 0.65, 0.8][seed % 3] },
        p2: defaultLimitedBrain('mixed'),
      }
      let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2', 'p2', 'mixed')
      let steps = 0
      while (g.phase !== 'ended' && steps++ < 400) {
        if (g.phase === 'pick') {
          const ids = limitedPick(g, g.turn, rts[g.turn], rng)
          expect(ids.length).toBeGreaterThanOrEqual(1)
          expect(ids.length).toBeLessThanOrEqual(5)
          expect(g.hands[g.turn].filter((c) => ids.includes(c.id) && isJoker(c)).length).toBeLessThanOrEqual(2)
          g = applyPick(g, g.turn, ids)
        } else if (g.phase === 'place') {
          const placer = otherPlayer(g.pendingPick!.by)
          g = applyPlace(g, placer, aiPlace(g, placer, rts[placer]))
        } else if (g.phase === 'showdown') g = resolveShowdown(g)
        else if (g.phase === 'draw') g = applyDraw(g)
      }
      expect(g.phase).toBe('ended')
      expect(g.winner).not.toBeNull()
    }
  }, 120_000)
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
        if (g.phase === 'pick') {
          const ids = limitedPick(g, g.turn, rts[g.turn], rng)
          expect(g.hands[g.turn].filter((c) => ids.includes(c.id) && isJoker(c)).length).toBeLessThanOrEqual(2) // 每格最多 2 鬼
          g = applyPick(g, g.turn, ids)
        } else if (g.phase === 'place') {
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
