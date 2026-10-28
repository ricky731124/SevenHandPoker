import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { isJoker, isBlank, isStarterSpecial, makeDeck } from './cards'
import { evaluate, compareLimited, CATEGORY } from './evaluate'
import { LIMITED_ROTA, LIMITED_TEST_MODE, TIE_STEPS, limitedModeAt, makeLimitedDeck } from './limited'
import { defaultLimitedBrain, limitedPick } from './limitedAI'
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
  it('測試期固定玩法(步驟 1 = 百鬼夜行)', () => {
    expect(LIMITED_TEST_MODE).toBe('ghost')
    for (let d = 0; d < 7; d++) expect(limitedModeAt(Date.UTC(2026, 9, 26 + d, 3))).toBe('ghost')
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
