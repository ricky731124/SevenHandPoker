import { describe, expect, it } from 'vitest'
import { isStarterSpecial, type Card, type Rank, type Suit } from './cards'
import {
  applyDeathEye,
  applyDraw,
  applyPick,
  applyPlace,
  canDeathEye,
  createGame,
  deathEyeSlots,
  exposedSlots,
  resolveShowdown,
  type GameState,
  type PlayerId,
} from './state'
import { buildFrames, type Move } from './replay'
import { bossChooseSpecial, bossPick, bossPlace, deathEyeTrigger, knownFoePiles, type BossProfile, type BossRuntime } from './bossAI'
import { bossCardPool, getStage, rollBossRuntime } from './campaign'
import { SPECIAL_CARDS } from './specialCards'
import { deserializeForGuest, serializeForGuest } from '../net/sync'

const c = (suit: Suit, rank: Rank): Card => ({ id: `${suit}${rank}`, suit, rank })
const R = (v: number) => () => v
const ids = (cs: Card[]) => cs.map((x) => x.id)

function inPlay(g: GameState): Card[] {
  return [...g.deck, ...g.hands.p1, ...g.hands.p2, ...(g.pendingPick?.cards ?? []), ...g.slots.flatMap((s) => [...s.p1, ...s.p2])]
}

/** p2 = boss(用卡方),p1 = 對手。piles:對手(p1)放在第 i 格的牌堆;mine:boss 自己放好的格子。 */
function board(o: { piles?: Record<number, Card[]>; mine?: Record<number, Card[]>; picks?: number; owner?: Record<number, PlayerId>; bossHand?: Card[] }): GameState {
  const g = createGame(77, 'p1')
  const slots = g.slots.map((_, i) => ({
    p1: o.piles?.[i] ?? [],
    p2: o.mine?.[i] ?? [],
    owner: (o.owner?.[i] ?? null) as GameState['slots'][number]['owner'],
  }))
  return {
    ...g,
    turn: 'p2',
    slots,
    placementsDone: { p1: 1, p2: o.picks ?? 0 },
    hands: { p1: g.hands.p1, p2: o.bossHand ?? g.hands.p2 },
  }
}
const pile = (n: number, suit: Suit = 'C', from: Rank = 2) => Array.from({ length: n }, (_, i) => c(suit, (from + i) as Rank))

describe('applyDeathEye 死神之眼 — 引擎', () => {
  it('翻開對手所有還沒對決的牌堆;不動任何牌;用掉特殊牌', () => {
    const g = board({ piles: { 1: pile(2), 4: pile(5, 'H') } })
    expect(deathEyeSlots(g, 'p2')).toEqual([1, 4])
    const next = applyDeathEye(g, 'p2')
    expect(exposedSlots(next, 'p1')).toEqual([1, 4])
    expect(exposedSlots(next, 'p2')).toEqual([])
    expect(next.slots).toBe(g.slots)
    expect(next.hands).toBe(g.hands)
    expect(next.deck).toBe(g.deck)
    expect(next.specialUsed).toEqual({ p1: false, p2: true })
  })

  it('已對決的格子、自己的牌堆都不算;沒有可翻的 → 不能用、原樣返回', () => {
    const dueled = board({ piles: { 0: pile(2) }, mine: { 0: pile(2, 'S') }, owner: { 0: 'p1' } })
    expect(canDeathEye(dueled, 'p2')).toBe(false)
    expect(applyDeathEye(dueled, 'p2')).toBe(dueled)
    const onlyMine = board({ mine: { 3: pile(3, 'S') } })
    expect(canDeathEye(onlyMine, 'p2')).toBe(false)
    expect(canDeathEye(board({}), 'p2')).toBe(false)
    expect(canDeathEye(board({ piles: { 6: pile(1) } }), 'p2')).toBe(true)
  })

  it('之後對手新放的牌堆照舊蓋著(只翻用卡當下那幾堆)', () => {
    let g = createGame(5, 'p1')
    g = applyPick(g, 'p1', ids(g.hands.p1.slice(0, 2)))
    g = applyPlace(g, 'p2', 2)
    g = applyDraw(g) // 換 p2 出牌
    g = applyDeathEye(g, 'p2')
    expect(exposedSlots(g, 'p1')).toEqual([2])
    g = applyPick(g, 'p2', ids(g.hands.p2.slice(0, 1)))
    g = applyPlace(g, 'p1', 5)
    g = applyDraw(g)
    g = applyPick(g, 'p1', ids(g.hands.p1.slice(0, 3)))
    g = applyPlace(g, 'p2', 0) // 對手(p1)新放在第 0 格
    expect(exposedSlots(g, 'p1')).toEqual([2])
    expect(deathEyeSlots(g, 'p2')).toEqual([0]) // 還沒翻過的只剩新的那堆(但這場已經不能再用卡了)
  })
})

describe('死神之眼 — 回放與連線同步', () => {
  it('回放重現:幀上帶翻了誰的哪幾格、字幕照使用者定的', () => {
    const seed = 99
    let g = createGame(seed, 'p1')
    const moves: Move[] = []
    const pickIds = ids(g.hands.p1.slice(0, 3))
    g = applyPick(g, 'p1', pickIds)
    moves.push({ t: 'pick', by: 'p1', ids: pickIds })
    g = applyPlace(g, 'p2', 4)
    moves.push({ t: 'place', by: 'p2', slot: 4 })
    g = applyDraw(g)
    g = applyDeathEye(g, 'p2')
    moves.push({ t: 'special', by: 'p2', card: 'deathEye' })
    const frames = buildFrames({ seed, firstPicker: 'p1', moves, names: { p1: '甲', p2: '斜鷹梗' } })
    const last = frames[frames.length - 1]
    expect(last.deathEye).toEqual({ target: 'p1', slots: [4] })
    expect(last.caption).toBe('斜鷹梗 用了「死神之眼」，透視了目前決鬥區所有的牌')
    expect(last.state.exposed).toEqual(g.exposed)
    expect(last.outdated).toBeUndefined()
  })

  it('guest 透視 host:被翻開的格子送真牌,其他照舊只送張數', () => {
    const g = applyDeathEye(board({ piles: { 1: pile(2), 3: pile(3, 'D') } }), 'p2')
    const later = { ...g, slots: g.slots.map((s, i) => (i === 5 ? { ...s, p1: pile(2, 'S', 9) } : s)) } // 用卡後 host 新放的
    const { engine } = deserializeForGuest(JSON.parse(JSON.stringify(serializeForGuest(later, null))))
    expect(ids(engine.slots[1].p1)).toEqual(ids(pile(2)))
    expect(ids(engine.slots[3].p1)).toEqual(ids(pile(3, 'D')))
    expect(engine.slots[5].p1).toHaveLength(2)
    expect(engine.slots[5].p1[0].id).not.toBe('S9') // 沒翻開 → 佔位牌
    expect(engine.exposed).toEqual({ p1: [1, 3], p2: [] })
  })

  it('host 透視 guest:guest 那端知道自己哪幾格被翻開;沒用過卡的舊資料也讀得動', () => {
    const g = createGame(3, 'p1')
    const host: GameState = { ...g, exposed: { p1: [], p2: [2] } }
    expect(deserializeForGuest(serializeForGuest(host, null)).engine.exposed).toEqual({ p1: [], p2: [2] })
    expect(deserializeForGuest(serializeForGuest(g, null)).engine.exposed).toEqual({ p1: [], p2: [] })
  })
})

// ---- boss AI ---------------------------------------------------------------

describe('deathEyeTrigger — 觸發時機', () => {
  it('0 堆 → none;≥2 堆 → sure', () => {
    expect(deathEyeTrigger(board({}), 'p2')).toBe('none')
    expect(deathEyeTrigger(board({ piles: { 0: pile(1), 6: pile(2) } }), 'p2')).toBe('sure')
  })
  it('只有 1 堆:5 張 → maybe、不到 5 張 → none;boss 第 4 手起 1 堆就 sure;第 4 手 0 堆 → none(延到下一手)', () => {
    expect(deathEyeTrigger(board({ piles: { 2: pile(5) } }), 'p2')).toBe('maybe')
    expect(deathEyeTrigger(board({ piles: { 2: pile(4) } }), 'p2')).toBe('none')
    expect(deathEyeTrigger(board({ piles: { 2: pile(1) }, picks: 3 }), 'p2')).toBe('sure')
    expect(deathEyeTrigger(board({ picks: 3 }), 'p2')).toBe('none')
    expect(deathEyeTrigger(board({ piles: { 2: pile(2) }, picks: 6 }), 'p2')).toBe('sure')
  })
})

describe('bossChooseSpecial — 死神之眼出手時機', () => {
  const sig = { signature: 'deathEye' as const }
  const two = { piles: { 0: pile(2), 5: pile(3, 'H') } }
  const five = { piles: { 3: pile(5) } }

  it('9-2(只帶這張):≥2 堆一定用;1 堆 5 張 40%;1 堆不到 5 張前 3 手不用、第 4 手起用;0 堆不用', () => {
    expect(bossChooseSpecial(board(two), 'p2', ['deathEye'], undefined, { ...sig, rng: R(0.99) })).toEqual({ card: 'deathEye' })
    expect(bossChooseSpecial(board(five), 'p2', ['deathEye'], undefined, { ...sig, rng: R(0.39) })).toEqual({ card: 'deathEye' })
    expect(bossChooseSpecial(board(five), 'p2', ['deathEye'], undefined, { ...sig, rng: R(0.41) })).toBeNull()
    for (const picks of [0, 1, 2]) expect(bossChooseSpecial(board({ piles: { 3: pile(3) }, picks }), 'p2', ['deathEye'], undefined, { ...sig, rng: R(0) })).toBeNull()
    expect(bossChooseSpecial(board({ piles: { 3: pile(3) }, picks: 3 }), 'p2', ['deathEye'], undefined, { ...sig, rng: R(0.99) })).toEqual({ card: 'deathEye' })
    expect(bossChooseSpecial(board({ picks: 4 }), 'p2', ['deathEye'], undefined, { ...sig, rng: R(0) })).toBeNull()
  })

  it('9-2:大量擲骰,1 堆 5 張時用卡比例約 40%', () => {
    let seed = 3
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    let used = 0
    for (let i = 0; i < 4000; i++) if (bossChooseSpecial(board(five), 'p2', ['deathEye'], undefined, { ...sig, rng })) used++
    expect(used / 4000).toBeGreaterThan(0.37)
    expect(used / 4000).toBeLessThan(0.43)
  })

  it('9-3(卡池):有條件照樣用;這手沒用到 → 12% 改用其他卡(不會是死神之眼)、88% 不用卡', () => {
    const pool = ['swap', 'spy', 'refresh', 'explode', 'deathEye'] as const
    expect(bossChooseSpecial(board(two), 'p2', [...pool], undefined, { ...sig, rng: R(0.99) })).toEqual({ card: 'deathEye' })
    const other = bossChooseSpecial(board({}), 'p2', [...pool], undefined, { ...sig, rng: R(0.05) })
    expect(other).not.toBeNull()
    expect(other!.card).not.toBe('deathEye')
    expect(bossChooseSpecial(board({}), 'p2', [...pool], undefined, { ...sig, rng: R(0.12) })).toBeNull()
    // 1 堆 5 張、40% 沒中(rng 0.5)→ 也算這手沒用到 → 0.5 ≥ 12% → 不用卡
    expect(bossChooseSpecial(board(five), 'p2', [...pool], undefined, { ...sig, rng: R(0.5) })).toBeNull()
  })

  it('9-3 本尊排在爆破/強迫更新前面:有條件時一定先用死神之眼', () => {
    const pool = ['refresh', 'explode', 'deathEye'] as const
    expect(bossChooseSpecial(board(two), 'p2', [...pool], undefined, { ...sig, rng: R(0) })).toEqual({ card: 'deathEye' })
  })

  it('其他 boss / 快速配對人機:沒條件絕不用;有條件只小機率用', () => {
    expect(bossChooseSpecial(board({}), 'p2', ['deathEye'], undefined, { rng: R(0) })).toBeNull()
    expect(bossChooseSpecial(board(two), 'p2', ['deathEye'], undefined, { rng: R(0.07) })).toEqual({ card: 'deathEye' })
    expect(bossChooseSpecial(board(two), 'p2', ['deathEye'], undefined, { rng: R(0.09) })).toBeNull()
    expect(bossChooseSpecial(board(five), 'p2', ['deathEye'], undefined, { rng: R(0.03) })).toEqual({ card: 'deathEye' })
    expect(bossChooseSpecial(board(five), 'p2', ['deathEye'], undefined, { rng: R(0.04) })).toBeNull()
  })
})

describe('boss 看牌後怎麼出(eyeAdjust)', () => {
  const PROFILE: BossProfile = { pickMain: { attack: 100, hoard: 0, balance: 0 }, bluff: 0, draw: 0, jokerTiming: 0, insight: 0 }
  const rt = (execution = 1): BossRuntime => ({ profile: PROFILE, main: 'attack', execution })
  const seen = (g: GameState) => applyDeathEye(g, 'p2')

  it('沒看過(沒有翻開的牌堆)→ 照平常打', () => {
    const hand = [c('C', 6), c('D', 6), c('S', 9), c('H', 9), c('D', 9), c('C', 2), c('H', 4)]
    const g = board({ piles: { 1: [c('S', 5), c('H', 5)] }, bossHand: hand })
    expect(knownFoePiles(g, 'p2')).toEqual([])
    expect(bossPick(g, 'p2', rt(), R(0)).length).toBe(5) // 強攻 → 葫蘆
  })

  it('打得過最強那堆 → 出剛好打得過的(一對 5 → 出一對 6,不砸葫蘆)', () => {
    const hand = [c('C', 6), c('D', 6), c('S', 9), c('H', 9), c('D', 9), c('C', 2), c('H', 4)]
    const g = seen(board({ piles: { 1: [c('S', 5), c('H', 5)], 3: [c('S', 3)] }, bossHand: hand }))
    expect(bossPick(g, 'p2', rt(), R(0)).sort()).toEqual(['C6', 'D6'])
  })

  it('打不過 → 忍住不出大牌改出小散牌;最多連續忍 2 手,第 3 手照平常打', () => {
    const hand = [c('S', 9), c('H', 9), c('D', 9), c('C', 2), c('H', 4), c('S', 7), c('D', 11)]
    const sf = pile(5, 'D', 2) // 同花順
    const brain = rt()
    const at = (picks: number) => seen(board({ piles: { 1: sf, 5: pile(1, 'H', 13) }, bossHand: hand, picks }))
    expect(bossPick(at(0), 'p2', brain, R(0))).toEqual(['C2'])
    expect(bossPick(at(0), 'p2', brain, R(0))).toEqual(['C2']) // 同一手重算不重複累加
    expect(bossPick(at(1), 'p2', brain, R(0))).toEqual(['C2'])
    expect(bossPick(at(2), 'p2', brain, R(0))).toHaveLength(3) // 停損:三條照出
  })

  it('boss 第 4 手起不忍;對手只差一格就贏也不忍;執行力沒發揮 → 照平常打', () => {
    const hand = [c('S', 9), c('H', 9), c('D', 9), c('C', 2), c('H', 4), c('S', 7), c('D', 11)]
    const sf = pile(5, 'D', 2)
    expect(bossPick(seen(board({ piles: { 1: sf }, bossHand: hand, picks: 3 })), 'p2', rt(), R(0))).toHaveLength(3)
    const matchPoint = seen(board({ piles: { 1: sf }, bossHand: hand, owner: { 4: 'p1', 5: 'p1' } }))
    expect(bossPick(matchPoint, 'p2', rt(), R(0))).toHaveLength(3)
    expect(bossPick(seen(board({ piles: { 1: sf }, bossHand: hand })), 'p2', rt(0), R(0.5))).toHaveLength(3)
  })
})

describe('壓力測試 — 300 場 boss 對 boss(雙方都帶死神之眼)', () => {
  it('52 張普通牌不重不漏、專屬牌不進牌堆、翻開的格子都是對方的牌堆、每場打得完、回放重現', () => {
    const s9 = getStage('s9')!
    let used = 0
    for (let k = 0; k < 300; k++) {
      let seed = 4000 + k
      const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
      const first: PlayerId = k % 2 ? 'p1' : 'p2'
      let g = createGame(6000 + k, first)
      const rts = { p1: rollBossRuntime(s9, s9.subStages[2], rng), p2: rollBossRuntime(s9, s9.subStages[1], rng) }
      const loadouts = { p1: bossCardPool(s9, s9.subStages[2]), p2: ['deathEye' as const] }
      const moves: Move[] = []
      for (let step = 0; step < 400 && g.phase !== 'ended'; step++) {
        if (g.phase === 'pick') {
          const me = g.turn
          const d = bossChooseSpecial(g, me, [...loadouts[me]], rts[me].profile, { signature: rts[me].signature, rng })
          if (d?.card === 'deathEye') {
            g = applyDeathEye(g, me)
            moves.push({ t: 'special', by: me, card: 'deathEye' })
            used++
          }
          const pick = bossPick(g, me, rts[me], rng)
          g = applyPick(g, me, pick)
          moves.push({ t: 'pick', by: me, ids: pick })
        } else if (g.phase === 'place') {
          const placer: PlayerId = g.pendingPick!.by === 'p1' ? 'p2' : 'p1'
          const slot = bossPlace(g, placer, rts[placer], rng)
          g = applyPlace(g, placer, slot)
          moves.push({ t: 'place', by: placer, slot })
        } else if (g.phase === 'showdown') g = resolveShowdown(g)
        else if (g.phase === 'draw') g = applyDraw(g)
        const n = inPlay(g).filter((x) => !isStarterSpecial(x)).map((x) => x.id)
        expect(new Set(n).size).toBe(n.length)
        expect(n.length).toBe(52)
        expect(g.deck.some(isStarterSpecial)).toBe(false)
        for (const p of ['p1', 'p2'] as const) for (const i of exposedSlots(g, p)) expect(g.slots[i][p].length).toBeGreaterThan(0)
      }
      expect(g.phase).toBe('ended')
      const last = buildFrames({ seed: 6000 + k, firstPicker: first, moves }).pop()!
      expect(last.state.slots).toEqual(g.slots)
      expect(last.state.exposed).toEqual(g.exposed)
      expect(last.state.winner).toBe(g.winner)
    }
    expect(used).toBeGreaterThan(250)
  })
})

describe('第 9 關資料', () => {
  const s9 = getStage('s9')!
  it('關卡名/角色名/招牌卡/參數照使用者填的表', () => {
    expect(s9.index).toBe(9)
    expect(s9.name).toBe('合法的流氓')
    expect(s9.bossName).toBe('斜鷹梗')
    expect(s9.bossAvatar).toBe('eagle')
    expect(s9.signatureCard).toBe('deathEye')
    expect(s9.profile).toEqual({ pickMain: { attack: 20, hoard: 80, balance: 0 }, bluff: 20, draw: 70, jokerTiming: 10, insight: 60 })
    expect(s9.subStages.map((s) => s.execution)).toEqual([0.6, 0.75, 0.9])
  })
  it('9-2 獎勵死神之眼、9-3 獎勵老鷹頭像;9-3 卡池含死神之眼 + 爆破', () => {
    expect(s9.subStages[1].reward.card).toBe('deathEye')
    expect(s9.subStages[2].reward.avatar).toBe('eagle')
    expect(bossCardPool(s9, s9.subStages[1])).toEqual(['deathEye'])
    expect(bossCardPool(s9, s9.subStages[2])).toEqual(expect.arrayContaining(['deathEye', 'explode', 'refresh']))
    expect(rollBossRuntime(s9, s9.subStages[1], R(0)).signature).toBe('deathEye')
  })
  it('卡片定義(說明文字照使用者定的)', () => {
    expect(SPECIAL_CARDS.deathEye.name).toBe('死神之眼')
    expect(SPECIAL_CARDS.deathEye.short).toBe('透視對手目前已放在決鬥區的所有牌')
    expect(SPECIAL_CARDS.deathEye.desc).toBe('翻開對手目前已放在決鬥區的所有牌（之後放的不算）。對手會被告知。')
    expect(SPECIAL_CARDS.deathEye.affectsFoe).toBe(true)
    expect(SPECIAL_CARDS.deathEye.needsTarget).toBe(false)
  })
})
