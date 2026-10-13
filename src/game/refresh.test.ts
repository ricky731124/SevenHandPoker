import { describe, expect, it } from 'vitest'
import { isSpecial, makeBlank, makeJoker, type Card, type Rank, type Suit } from './cards'
import {
  applyDraw,
  applyPick,
  applyPlace,
  applyRefresh,
  applySuit,
  canRefresh,
  createGame,
  resolveShowdown,
  type GameState,
  type PlayerId,
} from './state'
import { buildFrames, recordingRng, replayRng, type Move } from './replay'
import { bossChooseSpecial, bossPick, bossPlace, refreshTriggers } from './bossAI'
import { CAMPAIGN, bossCardPool, getStage, rollBossRuntime } from './campaign'
import { SPECIAL_CARDS } from './specialCards'

const c = (suit: Suit, rank: Rank): Card => ({ id: `${suit}${rank}`, suit, rank })
const R = (v: number) => () => v
const normals = (cs: Card[]) => cs.filter((x) => !isSpecial(x))
const ids = (cs: Card[]) => cs.map((x) => x.id).sort()

describe('applyRefresh 強迫更新 — 引擎', () => {
  const g0 = createGame(4242, 'p1')

  it('對手普通牌全洗回去、抽回同張數;空白/鬼牌留著;牌堆張數不變;用掉特殊牌', () => {
    const next = applyRefresh(g0, 'p1', R(0.37))
    const before = g0.hands.p2
    const after = next.hands.p2
    expect(after).toHaveLength(before.length)
    expect(normals(after)).toHaveLength(normals(before).length)
    expect(after.some((x) => x.id === 'BLANK_p2')).toBe(true)
    expect(after.some((x) => x.id === 'JOKER_p2')).toBe(true)
    expect(next.deck).toHaveLength(g0.deck.length)
    expect(next.deck.some(isSpecial)).toBe(false) // 專屬牌絕不進牌堆
    expect(next.specialUsed).toEqual({ p1: true, p2: false })
    expect(next.hands.p1).toBe(g0.hands.p1) // 自己的手牌不動
  })

  it('牌的總集合守恆(對手普通牌 + 牌堆 = 同一批 52 張的子集,不多不少不重複)', () => {
    const next = applyRefresh(g0, 'p1', R(0.81))
    const pool0 = ids([...normals(g0.hands.p2), ...g0.deck])
    const pool1 = ids([...normals(next.hands.p2), ...next.deck])
    expect(pool1).toEqual(pool0)
    expect(new Set(pool1).size).toBe(pool1.length)
  })

  it('手牌與牌堆順序真的變了(換種子結果不同),同種子結果相同(回放可重現)', () => {
    const a = applyRefresh(g0, 'p1', R(0.1))
    const b = applyRefresh(g0, 'p1', R(0.9))
    const a2 = applyRefresh(g0, 'p1', R(0.1))
    expect(ids(a.hands.p2)).not.toEqual(ids(b.hands.p2))
    expect(a.deck.map((x) => x.id)).toEqual(a2.deck.map((x) => x.id))
    expect(a.hands.p2.map((x) => x.id)).toEqual(a2.hands.p2.map((x) => x.id))
  })

  it('只用一次 rng(回放只需記一個數字)', () => {
    const rec = recordingRng()
    applyRefresh(g0, 'p2', rec.rng)
    expect(rec.out).toHaveLength(1)
  })

  it('被花色卡改過的牌洗回去時恢復原花色、不留 resuitFrom', () => {
    const target = normals(g0.hands.p2).find((x) => x.suit !== 'S')!
    const resuited = applySuit({ ...g0, specialUsed: { p1: false, p2: false } }, 'p2', target.id, 'S')
    const g = { ...resuited, specialUsed: { p1: false, p2: true } }
    const next = applyRefresh(g, 'p1', R(0.5))
    const all = [...next.hands.p2, ...next.deck]
    const back = all.find((x) => x.id === target.id)!
    expect(back.suit).toBe(target.suit)
    expect('resuitFrom' in back).toBe(false)
    const everywhere = [...next.hands.p1, ...all]
    expect(everywhere.filter((x) => x.suit === 'S' && x.rank === target.rank)).toHaveLength(1) // 不會有兩張黑桃同點
  })

  it('不能用:對手只剩空白/鬼牌、或牌堆空 → canRefresh=false、applyRefresh 原樣返回', () => {
    const onlySpecials: GameState = { ...g0, hands: { ...g0.hands, p2: [makeBlank('p2'), makeJoker('p2')] } }
    expect(canRefresh(onlySpecials, 'p1')).toBe(false)
    expect(applyRefresh(onlySpecials, 'p1', R(0.3))).toBe(onlySpecials)
    const emptyDeck: GameState = { ...g0, deck: [] }
    expect(canRefresh(emptyDeck, 'p1')).toBe(false)
    expect(applyRefresh(emptyDeck, 'p1', R(0.3))).toBe(emptyDeck)
    expect(canRefresh(g0, 'p1')).toBe(true)
  })
})

describe('強迫更新 — 回放重現', () => {
  it('錄下的 rng 回放出一模一樣的手牌與牌堆', () => {
    const seed = 777
    const g = createGame(seed, 'p1')
    const rec = recordingRng()
    const live = applyRefresh(g, 'p1', rec.rng)
    const moves: Move[] = [{ t: 'special', by: 'p1', card: 'refresh', rng: rec.out }]
    const frames = buildFrames({ seed, firstPicker: 'p1', moves, names: { p1: '甲', p2: '乙' } })
    const last = frames[frames.length - 1]
    expect(last.state.hands.p2.map((x) => x.id)).toEqual(live.hands.p2.map((x) => x.id))
    expect(last.state.deck.map((x) => x.id)).toEqual(live.deck.map((x) => x.id))
    expect(last.refreshTarget).toBe('p2')
    expect(last.action).toContain('強迫更新')
    expect(last.sound).toBe('special')
    // replayRng 吐的就是錄到的值
    expect(replayRng(rec.out)()).toBe(rec.out[0])
  })
})

describe('回放 — 舊版看新版場次不會整場打不開', () => {
  const seed = 777
  const g = createGame(seed, 'p1')
  const pick = normals(g.hands.p1).slice(0, 2).map((x) => x.id)

  it('不認得的卡 → 停在前一步、最後一幀是更新提示', () => {
    const moves = [{ t: 'special', by: 'p1', card: 'boom' }, { t: 'pick', by: 'p1', ids: pick }] as unknown as Move[]
    const frames = buildFrames({ seed, firstPicker: 'p1', moves })
    expect(frames).toHaveLength(2) // 開局 + 提示
    expect(frames[1].outdated).toBe(true)
    expect(frames[1].action).toContain('更新')
  })

  it('重放後手牌對不上(選到不在手上的牌)→ 停在最後一個正確的幀', () => {
    const moves: Move[] = [
      { t: 'pick', by: 'p1', ids: pick },
      { t: 'place', by: 'p2', slot: 0 },
      { t: 'pick', by: 'p2', ids: ['NOT_A_CARD'] },
    ]
    const frames = buildFrames({ seed, firstPicker: 'p1', moves })
    expect(frames[frames.length - 1].outdated).toBe(true)
    expect(frames.filter((f) => f.outdated)).toHaveLength(1)
    expect(frames.length).toBeGreaterThan(3) // 前面正常的幀都還在
  })

  it('正常場次不會有提示幀', () => {
    const frames = buildFrames({ seed, firstPicker: 'p1', moves: [{ t: 'pick', by: 'p1', ids: pick }] })
    expect(frames.some((f) => f.outdated)).toBe(false)
  })
})

// ---- boss AI ---------------------------------------------------------------

/** p2 = boss。可控:boss 已出幾手、對手(p1)手牌、雙方硬幣、對手是否用過特殊牌、boss 手牌。 */
function bossState(o: {
  picks?: number
  foeHand?: Card[]
  foePicks?: number
  foeUsed?: boolean
  bossHand?: Card[]
  foeCoins?: number
  myCoins?: number
}): GameState {
  const g = createGame(99, 'p1')
  const me: PlayerId = 'p2'
  const slots = g.slots.map((s) => ({ ...s }))
  for (let i = 0; i < (o.foeCoins ?? 0); i++) slots[i] = { ...slots[i], owner: 'p1' }
  for (let i = 0; i < (o.myCoins ?? 0); i++) slots[6 - i] = { ...slots[6 - i], owner: me }
  return {
    ...g,
    turn: me,
    slots,
    placementsDone: { p1: o.foePicks ?? 0, p2: o.picks ?? 0 },
    specialUsed: { p1: !!o.foeUsed, p2: false },
    hands: {
      p1: o.foeHand ?? g.hands.p1,
      // 預設給 boss 一手「好牌」(三條 K + 鬼牌)→ 不觸發「自己牌爛」
      p2: o.bossHand ?? [c('S', 13), c('H', 13), c('D', 13), c('C', 4), c('S', 6), makeJoker('p2')],
    },
  }
}
const weakHand = [c('S', 2), c('H', 5), c('D', 9), c('C', 11), c('S', 7)]

describe('refreshTriggers — 觸發條件數', () => {
  it('開局什麼都沒有 → 0', () => expect(refreshTriggers(bossState({}), 'p2')).toBe(0))
  it('對手用過特殊牌 +1', () => expect(refreshTriggers(bossState({ foeUsed: true }), 'p2')).toBe(1))
  it('對手出過牌且手上普通牌 ≥10(囤牌)+1;還沒出過牌不算', () => {
    expect(refreshTriggers(bossState({ foePicks: 1 }), 'p2')).toBe(1) // createGame 的 10 張普通牌
    expect(refreshTriggers(bossState({ foePicks: 0 }), 'p2')).toBe(0)
  })
  it('自己落後(硬幣少)+1', () => expect(refreshTriggers(bossState({ foeCoins: 1 }), 'p2')).toBe(1))
  it('自己牌爛(湊不到三條)+1', () => expect(refreshTriggers(bossState({ bossHand: weakHand }), 'p2')).toBe(1))
  it('全中 → 4', () =>
    expect(refreshTriggers(bossState({ foeUsed: true, foePicks: 1, foeCoins: 2, bossHand: weakHand }), 'p2')).toBe(4))
})

describe('bossChooseSpecial — 強迫更新出手時機', () => {
  const sig = { signature: 'refresh' as const }

  it('7-2(只帶這張):有條件就用', () => {
    expect(bossChooseSpecial(bossState({ foeUsed: true }), 'p2', ['refresh'], undefined, sig)).toEqual({ card: 'refresh' })
  })
  it('7-2:沒條件 → 前 3 手先不用,第 4 手強制用', () => {
    for (const picks of [0, 1, 2]) expect(bossChooseSpecial(bossState({ picks }), 'p2', ['refresh'], undefined, sig)).toBeNull()
    expect(bossChooseSpecial(bossState({ picks: 3 }), 'p2', ['refresh'], undefined, sig)).toEqual({ card: 'refresh' })
  })
  it('過了前 4 手就不再用', () => {
    expect(bossChooseSpecial(bossState({ picks: 4, foeUsed: true }), 'p2', ['refresh'], undefined, sig)).toBeNull()
  })
  it('7-3(卡池):前 4 手只等強迫更新(擲到才用,沒擲到也不改用別張)', () => {
    const pool = ['swap', 'spy', 'peek', 'refresh'] as const
    expect(bossChooseSpecial(bossState({}), 'p2', [...pool], undefined, { ...sig, rng: R(0.1) })).toEqual({ card: 'refresh' })
    expect(bossChooseSpecial(bossState({}), 'p2', [...pool], undefined, { ...sig, rng: R(0.99) })).toBeNull()
  })
  it('7-3:第 5 手起換回其他卡(spy)', () => {
    const d = bossChooseSpecial(bossState({ picks: 4 }), 'p2', ['spy', 'refresh'], undefined, sig)
    expect(d).toEqual({ card: 'spy' })
  })
  it('其他 boss / 快速配對人機:沒條件絕不用;有條件只小機率用', () => {
    const lo = { rng: R(0.01) }
    const hi = { rng: R(0.5) }
    expect(bossChooseSpecial(bossState({}), 'p2', ['refresh'], undefined, lo)).toBeNull()
    expect(bossChooseSpecial(bossState({ foeUsed: true }), 'p2', ['refresh'], undefined, lo)).toEqual({ card: 'refresh' })
    expect(bossChooseSpecial(bossState({ foeUsed: true }), 'p2', ['refresh'], undefined, hi)).toBeNull()
  })
  it('對手只剩空白/鬼牌 → 連 7-2 第 4 手也不用(不能用)', () => {
    const s = bossState({ picks: 3, foeHand: [makeBlank('p1'), makeJoker('p1')] })
    expect(bossChooseSpecial(s, 'p2', ['refresh'], undefined, sig)).toBeNull()
  })
})

describe('壓力測試 — 300 場 boss 對 boss(雙方都帶強迫更新)', () => {
  it('每一步牌都守恆(52 張普通牌不重不漏、專屬牌不進牌堆),每場都打得完', () => {
    const s7 = getStage('s7')!
    let used = 0
    for (let k = 0; k < 300; k++) {
      let seed = 1000 + k
      const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
      let g = createGame(5000 + k, k % 2 ? 'p1' : 'p2')
      const rts = { p1: rollBossRuntime(s7, s7.subStages[2], rng), p2: rollBossRuntime(s7, s7.subStages[1], rng) }
      const loadouts = { p1: ['swap', 'spy', 'refresh'] as const, p2: ['refresh'] as const }
      for (let step = 0; step < 400 && g.phase !== 'ended'; step++) {
        if (g.phase === 'pick') {
          const me = g.turn
          const d = bossChooseSpecial(g, me, [...loadouts[me]], rts[me].profile, { signature: rts[me].signature, rng })
          if (d?.card === 'refresh') {
            g = applyRefresh(g, me, rng)
            used++
          }
          g = applyPick(g, me, bossPick(g, me, rts[me], rng))
        } else if (g.phase === 'place') {
          const placer = g.pendingPick!.by === 'p1' ? 'p2' : 'p1'
          g = applyPlace(g, placer, bossPlace(g, placer, rts[placer], rng))
        } else if (g.phase === 'showdown') g = resolveShowdown(g)
        else if (g.phase === 'draw') g = applyDraw(g)
        // 守恆檢查
        const inPlay = [...g.deck, ...g.hands.p1, ...g.hands.p2, ...(g.pendingPick?.cards ?? []), ...g.slots.flatMap((s) => [...s.p1, ...s.p2])]
        const n = normals(inPlay).map((x) => x.id)
        expect(new Set(n).size).toBe(n.length)
        expect(n.length).toBe(52)
        expect(g.deck.some(isSpecial)).toBe(false)
      }
      expect(g.phase).toBe('ended')
    }
    expect(used).toBeGreaterThan(300) // 7-2 那方每場必用 → 至少 300 次
  })
})

describe('第 7 關資料', () => {
  const s7 = getStage('s7')!
  it('關卡名/角色名/招牌卡/參數照使用者填的表', () => {
    expect(s7.index).toBe(7)
    expect(s7.name).toBe('不可以色色')
    expect(s7.bossName).toBe('柴柴')
    expect(s7.bossAvatar).toBe('shiba')
    expect(s7.signatureCard).toBe('refresh')
    expect(s7.profile).toEqual({ pickMain: { attack: 30, hoard: 60, balance: 10 }, bluff: 40, draw: 20, jokerTiming: 30, insight: 90 })
    expect(s7.subStages.map((s) => s.execution)).toEqual([0.6, 0.75, 0.9])
  })
  it('7-2 獎勵強迫更新、7-3 獎勵柴柴頭像;7-3 卡池含所有前面招牌卡 + 強迫更新', () => {
    expect(s7.subStages[1].reward.card).toBe('refresh')
    expect(s7.subStages[2].reward.avatar).toBe('shiba')
    expect(bossCardPool(s7, s7.subStages[1])).toEqual(['refresh'])
    const pool = bossCardPool(s7, s7.subStages[2])
    expect(pool).toEqual(expect.arrayContaining(['swap', 'peek', 'spy', 'clubs', 'diamonds', 'hearts', 'spades', 'refresh']))
  })
  it('boss runtime 帶上招牌卡(讓 AI 分辨柴柴本尊)', () => {
    expect(rollBossRuntime(s7, s7.subStages[1], R(0)).signature).toBe('refresh')
  })
  it('每關都有角色名、卡片定義齊全', () => {
    for (const s of CAMPAIGN) expect(s.bossName.length).toBeGreaterThan(0)
    expect(SPECIAL_CARDS.refresh.affectsFoe).toBe(true)
    expect(SPECIAL_CARDS.refresh.needsTarget).toBe(false)
  })
})
