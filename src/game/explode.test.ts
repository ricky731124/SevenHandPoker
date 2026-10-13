import { describe, expect, it } from 'vitest'
import { isStarterSpecial, makeBlank, makeJoker, type Card, type Rank, type Suit } from './cards'
import {
  applyDraw,
  applyExplode,
  applyPick,
  applyPlace,
  canExplode,
  createGame,
  explodeTargets,
  removedCard,
  resolveShowdown,
  type GameState,
  type PlayerId,
} from './state'
import { buildFrames, recordingRng, type Move } from './replay'
import { bossChooseSpecial, bossPick, bossPlace, explodeTriggers } from './bossAI'
import { bossCardPool, getStage, rollBossRuntime } from './campaign'
import { SPECIAL_CARDS } from './specialCards'

const c = (suit: Suit, rank: Rank): Card => ({ id: `${suit}${rank}`, suit, rank })
const R = (v: number) => () => v
const ids = (cs: Card[]) => cs.map((x) => x.id)

/** 盤面上所有還在遊戲裡的牌(牌堆 + 雙方手牌 + 待放 + 七格) */
function inPlay(g: GameState): Card[] {
  return [...g.deck, ...g.hands.p1, ...g.hands.p2, ...(g.pendingPick?.cards ?? []), ...g.slots.flatMap((s) => [...s.p1, ...s.p2])]
}

describe('applyExplode 爆破 — 引擎', () => {
  const g0 = createGame(31337, 'p1')

  it('對手少一張;被炸的牌從遊戲消失(不在牌堆、手牌、盤面);用掉特殊牌;自己手牌不動', () => {
    const next = applyExplode(g0, 'p1', R(0.42))
    const gone = removedCard(g0.hands.p2, next.hands.p2)!
    expect(gone).toBeDefined()
    expect(next.hands.p2).toHaveLength(g0.hands.p2.length - 1)
    expect(inPlay(next).some((x) => x.id === gone.id)).toBe(false)
    expect(next.deck).toBe(g0.deck)
    expect(next.hands.p1).toBe(g0.hands.p1)
    expect(next.specialUsed).toEqual({ p1: true, p2: false })
  })

  it('不會炸到開局的空白牌/鬼牌;rng 從 0 到 1 每個位置都只會炸普通牌', () => {
    for (let i = 0; i < 20; i++) {
      const next = applyExplode(g0, 'p1', R(i / 20))
      const gone = removedCard(g0.hands.p2, next.hands.p2)!
      expect(isStarterSpecial(gone)).toBe(false)
    }
    expect(applyExplode(g0, 'p1', R(0.9999999))).not.toBe(g0) // 邊界值也合法
  })

  it('「非預設型」的鬼牌/空白(未來 2~6 換成鬼牌的模式)是可以炸的', () => {
    const futureJoker: Card = { id: 'C5', suit: 'C', rank: 5, kind: 'joker' }
    const g: GameState = { ...g0, hands: { ...g0.hands, p2: [futureJoker, makeBlank('p2'), makeJoker('p2')] } }
    expect(ids(explodeTargets(g, 'p1'))).toEqual(['C5'])
    const next = applyExplode(g, 'p1', R(0.5))
    expect(ids(next.hands.p2)).toEqual(['BLANK_p2', 'JOKER_p2'])
  })

  it('同 rng 結果相同、只用一次 rng(回放只記一個數)', () => {
    const a = applyExplode(g0, 'p1', R(0.3))
    const b = applyExplode(g0, 'p1', R(0.3))
    expect(ids(a.hands.p2)).toEqual(ids(b.hands.p2))
    const rec = recordingRng()
    applyExplode(g0, 'p2', rec.rng)
    expect(rec.out).toHaveLength(1)
  })

  it('不能用:對手只剩開局空白/鬼牌 → canExplode=false、原樣返回', () => {
    const g: GameState = { ...g0, hands: { ...g0.hands, p2: [makeBlank('p2'), makeJoker('p2')] } }
    expect(canExplode(g, 'p1')).toBe(false)
    expect(applyExplode(g, 'p1', R(0.5))).toBe(g)
    expect(canExplode(g0, 'p1')).toBe(true)
  })
})

describe('爆破 — 回放重現', () => {
  it('錄下的 rng 回放炸到同一張、手牌一致,幀上帶炸到哪張', () => {
    const seed = 2024
    const g = createGame(seed, 'p2')
    const rec = recordingRng()
    const live = applyExplode(g, 'p2', rec.rng)
    const gone = removedCard(g.hands.p1, live.hands.p1)!
    const moves: Move[] = [{ t: 'special', by: 'p2', card: 'explode', rng: rec.out }]
    const frames = buildFrames({ seed, firstPicker: 'p2', moves, names: { p1: '甲', p2: '乙' } })
    const last = frames[frames.length - 1]
    expect(ids(last.state.hands.p1)).toEqual(ids(live.hands.p1))
    expect(last.explode?.target).toBe('p1')
    expect(last.explode?.card?.id).toBe(gone.id)
    expect(last.action).toContain('爆破')
    expect(last.outdated).toBeUndefined()
  })
})

// ---- boss AI ---------------------------------------------------------------

/** p2 = boss。可控:boss 已出幾手、對手(p1)手牌、雙方硬幣。 */
function bossState(o: { picks?: number; foeHand?: Card[]; foeCoins?: number; myCoins?: number }): GameState {
  const g = createGame(77, 'p1')
  const slots = g.slots.map((s) => ({ ...s }))
  for (let i = 0; i < (o.foeCoins ?? 0); i++) slots[i * 2] = { ...slots[i * 2], owner: 'p1' } // 間隔放,不連線
  for (let i = 0; i < (o.myCoins ?? 0); i++) slots[i * 2 + 1] = { ...slots[i * 2 + 1], owner: 'p2' }
  return {
    ...g,
    turn: 'p2',
    slots,
    placementsDone: { p1: 1, p2: o.picks ?? 0 },
    hands: { p1: o.foeHand ?? g.hands.p1, p2: g.hands.p2 },
  }
}
const hand = (n: number) => [c('S', 2), c('S', 3), c('S', 4), c('S', 5), c('S', 6), c('S', 7), c('S', 8), c('S', 9), c('S', 10), c('S', 11)].slice(0, n)

describe('explodeTriggers — 觸發條件數', () => {
  it('開局對手 10 張、沒人有幣 → 0', () => expect(explodeTriggers(bossState({}), 'p2')).toBe(0))
  it('對手可炸的牌 ≤ 8 → +1(空白/鬼牌不算)', () => {
    expect(explodeTriggers(bossState({ foeHand: [...hand(8), makeBlank('p1'), makeJoker('p1')] }), 'p2')).toBe(1)
    expect(explodeTriggers(bossState({ foeHand: [...hand(9), makeBlank('p1')] }), 'p2')).toBe(0)
  })
  it('自己落後 +1;對手 3 幣 = 快贏了再 +1', () => {
    expect(explodeTriggers(bossState({ foeCoins: 1 }), 'p2')).toBe(1)
    expect(explodeTriggers(bossState({ foeCoins: 3 }), 'p2')).toBe(2)
  })
})

describe('bossChooseSpecial — 爆破出手時機', () => {
  const sig = { signature: 'explode' as const }
  const few = [...hand(6), makeBlank('p1'), makeJoker('p1')]

  it('8-2(只帶這張):有條件就用;沒條件前 4 手不用;第 5 手強制用', () => {
    expect(bossChooseSpecial(bossState({ foeHand: few }), 'p2', ['explode'], undefined, sig)).toEqual({ card: 'explode' })
    for (const picks of [0, 1, 2, 3]) expect(bossChooseSpecial(bossState({ picks }), 'p2', ['explode'], undefined, sig)).toBeNull()
    expect(bossChooseSpecial(bossState({ picks: 4 }), 'p2', ['explode'], undefined, sig)).toEqual({ card: 'explode' })
  })
  it('8-3(卡池):每一手有條件就用爆破(不看機率、不管第幾手)', () => {
    const pool = ['swap', 'spy', 'refresh', 'explode'] as const
    for (const picks of [0, 3, 5])
      expect(bossChooseSpecial(bossState({ picks, foeHand: few }), 'p2', [...pool], undefined, { ...sig, rng: R(0.99) })).toEqual({ card: 'explode' })
  })
  it('8-3:沒條件 → 10% 改用其他卡(照一般選卡,不會是爆破)、90% 這手不用卡', () => {
    const pool = ['swap', 'spy', 'refresh', 'explode'] as const
    for (const picks of [0, 5]) {
      const d = bossChooseSpecial(bossState({ picks }), 'p2', [...pool], undefined, { ...sig, rng: R(0.05) })
      expect(d).not.toBeNull() // 一般選卡挑到的(這裡可能是強迫更新或讓我看看)
      expect(d!.card).not.toBe('explode')
      expect(bossChooseSpecial(bossState({ picks }), 'p2', [...pool], undefined, { ...sig, rng: R(0.1) })).toBeNull()
    }
  })
  it('8-3:大量擲骰,沒條件時用其他卡的比例約 10%', () => {
    let seed = 1
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    let used = 0
    for (let i = 0; i < 4000; i++) if (bossChooseSpecial(bossState({}), 'p2', ['spy', 'explode'], undefined, { ...sig, rng })) used++
    expect(used / 4000).toBeGreaterThan(0.08)
    expect(used / 4000).toBeLessThan(0.12)
  })
  it('其他 boss / 快速配對人機:沒條件絕不用;有條件只小機率用', () => {
    expect(bossChooseSpecial(bossState({}), 'p2', ['explode'], undefined, { rng: R(0.01) })).toBeNull()
    expect(bossChooseSpecial(bossState({ foeHand: few }), 'p2', ['explode'], undefined, { rng: R(0.01) })).toEqual({ card: 'explode' })
    expect(bossChooseSpecial(bossState({ foeHand: few }), 'p2', ['explode'], undefined, { rng: R(0.5) })).toBeNull()
  })
  it('對手只剩開局空白/鬼牌 → 連 8-2 第 5 手也不用', () => {
    const s = bossState({ picks: 4, foeHand: [makeBlank('p1'), makeJoker('p1')] })
    expect(bossChooseSpecial(s, 'p2', ['explode'], undefined, sig)).toBeNull()
  })
})

describe('壓力測試 — 300 場 boss 對 boss(雙方都帶爆破)', () => {
  it('每一步:還在遊戲裡的普通牌 + 已炸掉的 = 52、不重複、炸掉的不再出現;每場打得完', () => {
    const s8 = getStage('s8')!
    let used = 0
    for (let k = 0; k < 300; k++) {
      let seed = 7000 + k
      const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
      let g = createGame(9000 + k, k % 2 ? 'p1' : 'p2')
      const rts = { p1: rollBossRuntime(s8, s8.subStages[2], rng), p2: rollBossRuntime(s8, s8.subStages[1], rng) }
      const loadouts = { p1: ['swap', 'spy', 'explode'] as const, p2: ['explode'] as const }
      const blown = new Set<string>()
      for (let step = 0; step < 400 && g.phase !== 'ended'; step++) {
        if (g.phase === 'pick') {
          const me = g.turn
          const d = bossChooseSpecial(g, me, [...loadouts[me]], rts[me].profile, { signature: rts[me].signature, rng })
          if (d?.card === 'explode') {
            const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'
            const next = applyExplode(g, me, rng)
            blown.add(removedCard(g.hands[foe], next.hands[foe])!.id)
            g = next
            used++
          }
          g = applyPick(g, me, bossPick(g, me, rts[me], rng))
        } else if (g.phase === 'place') {
          const placer: PlayerId = g.pendingPick!.by === 'p1' ? 'p2' : 'p1'
          g = applyPlace(g, placer, bossPlace(g, placer, rts[placer], rng))
        } else if (g.phase === 'showdown') g = resolveShowdown(g)
        else if (g.phase === 'draw') g = applyDraw(g)
        const n = inPlay(g).filter((x) => !isStarterSpecial(x)).map((x) => x.id)
        expect(new Set(n).size).toBe(n.length)
        expect(n.length + blown.size).toBe(52)
        expect(n.some((id) => blown.has(id))).toBe(false)
        expect(g.deck.some(isStarterSpecial)).toBe(false)
      }
      expect(g.phase).toBe('ended')
    }
    expect(used).toBeGreaterThan(300) // 8-2 那方每場必用 → 至少 300 次
  })
})

describe('第 8 關資料', () => {
  const s8 = getStage('s8')!
  it('關卡名/角色名/招牌卡/參數照使用者填的表', () => {
    expect(s8.index).toBe(8)
    expect(s8.name).toBe('沒事就小啄一下')
    expect(s8.bossName).toBe('啄木鳥')
    expect(s8.bossAvatar).toBe('woodpecker')
    expect(s8.signatureCard).toBe('explode')
    expect(s8.profile).toEqual({ pickMain: { attack: 90, hoard: 0, balance: 10 }, bluff: 10, draw: 60, jokerTiming: 40, insight: 50 })
    expect(s8.subStages.map((s) => s.execution)).toEqual([0.6, 0.75, 0.9])
  })
  it('8-2 獎勵爆破、8-3 獎勵啄木鳥頭像;8-3 卡池含強迫更新 + 爆破', () => {
    expect(s8.subStages[1].reward.card).toBe('explode')
    expect(s8.subStages[2].reward.avatar).toBe('woodpecker')
    expect(bossCardPool(s8, s8.subStages[1])).toEqual(['explode'])
    expect(bossCardPool(s8, s8.subStages[2])).toEqual(expect.arrayContaining(['refresh', 'explode', 'spy']))
    expect(rollBossRuntime(s8, s8.subStages[1], R(0)).signature).toBe('explode')
  })
  it('卡片定義', () => {
    expect(SPECIAL_CARDS.explode.affectsFoe).toBe(true)
    expect(SPECIAL_CARDS.explode.needsTarget).toBe(false)
  })
})
