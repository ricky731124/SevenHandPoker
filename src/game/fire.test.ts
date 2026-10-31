import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { CATEGORY, evaluate } from './evaluate'
import { rollMain, type BossRuntime, type PickMain } from './bossAI'
import { CAMPAIGN } from './campaign'
import { fireChooseSpecial, fireLearn, fireLoadout, suitPlayCheck } from './fireAI'
import { limitedPick, limitedPlace } from './limitedAI'
import { buildFrames, recordingRng, type Move } from './replay'
import { mulberry32 } from './rng'
import { FIRE_LOADOUT, FIRE_MIN_POOL, FIRE_USES, SPECIAL_CARD_LIST, firePool, firePoolSize, getSpecialCard, unlockedCount, type SpecialCardId } from './specialCards'
import {
  applyDraw,
  applyPick,
  applyPlace,
  applySpecial,
  createGame,
  fireUsedOf,
  fireUsesLeft,
  otherPlayer,
  resolveShowdown,
  type GameState,
  type PlayerId,
} from './state'
import { deserializeForGuest, serializeForGuest } from '../net/sync'

const card = (suit: Suit, rank: Rank): Card => ({ id: `${suit}${rank}`, suit, rank })

/** 把一局推進到下一次輪到 who 選牌(雙方都出 1 張、放第一個空格)。 */
function nextTurnOf(g: GameState, who: PlayerId): GameState {
  let s = g
  for (let i = 0; i < 20; i++) {
    if (s.phase === 'pick' && s.turn === who && s !== g) return s
    if (s.phase === 'pick') s = applyPick(s, s.turn, [s.hands[s.turn].find((c) => !c.kind)!.id])
    else if (s.phase === 'place') {
      const placer = otherPlayer(s.pendingPick!.by)
      const empty = s.slots.findIndex((sl) => sl[s.pendingPick!.by].length === 0)
      s = applyPlace(s, placer, empty)
    } else if (s.phase === 'showdown') s = resolveShowdown(s)
    else if (s.phase === 'draw') s = applyDraw(s)
  }
  throw new Error('沒輪到')
}

describe('火力全開引擎(§6:帶 5 用 3、每回合 1 張、每張一次)', () => {
  it('用一張 → 記進 fireUsed、這回合不能再用、下回合重開', () => {
    let g = createGame(1, 'p1', 'p2', 'fire')
    g = applySpecial(g, 'p1', 'spy')
    expect(fireUsedOf(g, 'p1')).toEqual(['spy'])
    expect(g.specialUsed.p1).toBe(true)
    expect(fireUsesLeft(g, 'p1')).toBe(FIRE_USES - 1)
    // 同一回合再用 → 不動
    expect(applySpecial(g, 'p1', 'peek')).toBe(g)
    g = nextTurnOf(g, 'p1')
    expect(g.specialUsed.p1).toBe(false)
    // 同一張不能再用
    expect(applySpecial(g, 'p1', 'spy')).toBe(g)
    g = applySpecial(g, 'p1', 'peek')
    expect(fireUsedOf(g, 'p1')).toEqual(['spy', 'peek'])
  })

  it('3 次用完後,之後的回合都不重開', () => {
    let g = createGame(2, 'p1', 'p2', 'fire')
    g = nextTurnOf(applySpecial(g, 'p1', 'spy'), 'p1')
    g = nextTurnOf(applySpecial(g, 'p1', 'peek'), 'p1')
    g = applySpecial(g, 'p1', 'swap', { targetId: g.hands.p1.find((x) => !x.kind)!.id })
    expect(fireUsedOf(g, 'p1')).toEqual(['spy', 'peek', 'swap'])
    g = nextTurnOf(g, 'p1')
    expect(fireUsedOf(g, 'p1').length).toBe(3)
    expect(fireUsesLeft(g, 'p1')).toBe(0)
    expect(g.specialUsed.p1).toBe(true)
    expect(applySpecial(g, 'p1', 'refresh')).toBe(g)
    g = nextTurnOf(g, 'p1')
    expect(g.specialUsed.p1).toBe(true)
  })

  it('對手的回合不能用(specialUsed 只在自己選牌時重開),對手用卡不影響我', () => {
    let g = createGame(3, 'p1', 'p2', 'fire')
    g = applySpecial(g, 'p1', 'spy')
    g = nextTurnOf(g, 'p2')
    expect(g.specialUsed.p1).toBe(true) // 輪到 p2,p1 的「這回合用過」還沒重開
    g = applySpecial(g, 'p2', 'spy')
    expect(fireUsedOf(g, 'p2')).toEqual(['spy'])
    expect(fireUsedOf(g, 'p1')).toEqual(['spy'])
  })

  it('其他房型不受影響:特殊房用過一次就整場用完', () => {
    let g = createGame(4, 'p1') // 一般 / 特殊房
    g = applySpecial(g, 'p1', 'spy')
    expect(g.fireUsed).toBeUndefined()
    g = nextTurnOf(g, 'p1')
    expect(g.specialUsed.p1).toBe(true)
    expect(fireUsesLeft(g, 'p1')).toBe(0)
  })

  it('guest 同步:自己用過哪幾張看得到,對手只看得到次數', () => {
    let g = createGame(5, 'p1', 'p1', 'fire')
    g = applySpecial(g, 'p1', 'spy')
    g = nextTurnOf(g, 'p2')
    g = applySpecial(g, 'p2', 'peek')
    const view = serializeForGuest(g, null)
    expect(JSON.stringify(view)).not.toContain('"spy"') // host 用了哪張不外流
    const { engine } = deserializeForGuest(JSON.parse(JSON.stringify(view)))
    expect(fireUsedOf(engine, 'p2')).toEqual(['peek'])
    expect(fireUsedOf(engine, 'p1').length).toBe(1)
    expect(fireUsesLeft(engine, 'p1')).toBe(2)
  })
})

describe('火力全開電腦帶卡', () => {
  it('5 張不重複;囤牌固定帶爆破 + 強迫更新、平衡固定帶讓我看看 + 死神之眼、強攻固定帶偷天換日 + 偷窺', () => {
    const rng = mulberry32(9)
    for (let i = 0; i < 300; i++) {
      for (const main of ['attack', 'hoard', 'balance'] as PickMain[]) {
        const l = fireLoadout(main, rng)
        expect(l.length).toBe(FIRE_LOADOUT)
        expect(new Set(l).size).toBe(FIRE_LOADOUT)
        if (main === 'hoard') expect(l.slice(0, 2).sort()).toEqual(['explode', 'refresh'])
        if (main === 'balance') expect(l.slice(0, 2).sort()).toEqual(['deathEye', 'spy'])
        if (main === 'attack') expect(l.slice(0, 2).sort()).toEqual(['peek', 'swap'])
      }
    }
  })

  it('卡池:照解鎖順序的前 N 張,最少 10 張(使用者 2026-11-01 的例子)', () => {
    // 解鎖順序 = 起始卡 + 每關的招牌卡
    expect(SPECIAL_CARD_LIST.map((c) => c.id)).toEqual(['swap', ...CAMPAIGN.map((s) => s.signatureCard)].slice(0, SPECIAL_CARD_LIST.length))
    expect(FIRE_MIN_POOL).toBe(10)
    // 朋友房 / 快配人機 / 對戰電腦:看自己
    expect(firePoolSize(3)).toBe(10)
    expect(firePoolSize(7)).toBe(10)
    expect(firePoolSize(16)).toBe(16)
    // 快配真人:看兩人比較少的,最少 10
    expect(firePoolSize(15, 6)).toBe(10)
    expect(firePoolSize(18, 12)).toBe(12)
    expect(firePoolSize(12, 18)).toBe(12)
    expect(firePoolSize(15, null)).toBe(10) // 還不知道對手 → 先用最少的
    // 前 N 張;超過現有張數 = 全部
    expect(firePool(10)).toEqual(SPECIAL_CARD_LIST.slice(0, 10).map((c) => c.id))
    expect(firePool(25).length).toBe(SPECIAL_CARD_LIST.length)
    expect(unlockedCount(['swap', 'peek', 'nope'])).toBe(2)
    expect(unlockedCount(null)).toBeNull()
  })

  it('電腦帶卡只從卡池裡挑(卡池沒有的固定卡就不帶)', () => {
    const rng = mulberry32(21)
    const pool: SpecialCardId[] = ['swap', 'spy', 'clubs', 'diamonds', 'hearts', 'spades', 'refresh', 'explode']
    for (let i = 0; i < 200; i++)
      for (const main of ['attack', 'hoard', 'balance'] as PickMain[]) {
        const l = fireLoadout(main, rng, pool)
        expect(l.length).toBe(FIRE_LOADOUT)
        expect(l.every((id) => pool.includes(id))).toBe(true)
        if (main === 'attack') expect(l[0]).toBe('swap')
        if (main === 'balance') expect(l[0]).toBe('spy')
      }
  })

  it('每種打法剛好 2 張固定卡,花色卡全是中立', () => {
    for (const main of ['attack', 'hoard', 'balance'] as PickMain[])
      expect(SPECIAL_CARD_LIST.filter((d) => d.fireStyle === main).length).toBe(2)
    for (const d of SPECIAL_CARD_LIST) if (d.suit) expect(d.fireStyle).toBe('neutral')
  })

  it('每張卡都有標打法(新卡忘了標會在這裡抓到)', () => {
    for (const id of ['swap', 'peek', 'spy', 'clubs', 'diamonds', 'hearts', 'spades', 'refresh', 'explode', 'deathEye'] as SpecialCardId[]) {
      expect(['attack', 'hoard', 'balance', 'neutral']).toContain(getSpecialCard(id)?.fireStyle)
    }
  })
})

describe('火力全開電腦用卡', () => {
  const rt = (main: PickMain = 'balance', execution = 1): BossRuntime => ({ profile: CAMPAIGN[0].profile, main, execution })

  it('花色卡:手上 4 張同花色 → 換第 5 張,而且這手就出那個同花', () => {
    const g0 = createGame(6, 'p2', 'p2', 'fire')
    const hand = [card('H', 2), card('H', 5), card('H', 9), card('H', 12), card('S', 3), card('C', 7), card('D', 13), ...g0.hands.p2.filter((c) => c.kind)]
    const g: GameState = { ...g0, hands: { ...g0.hands, p2: hand } }
    let hits = 0
    for (let i = 0; i < 40; i++) {
      const d = fireChooseSpecial(g, 'p2', ['hearts'], rt('attack'), mulberry32(i))
      if (!d) continue
      hits++
      expect(d.card).toBe('hearts')
      const after = applySpecial(g, 'p2', d.card, { targetId: d.targetId })
      const cards = after.hands.p2.filter((c) => d.thenPick!.includes(c.id))
      const cat = evaluate(cards).category
      expect([CATEGORY.FLUSH, CATEGORY.STRAIGHT_FLUSH]).toContain(cat)
      expect(cards.filter((c) => !c.kind).every((c) => c.suit === 'H')).toBe(true)
    }
    expect(hits).toBeGreaterThan(0)
  })

  it('花色卡:只有 2~3 張同花色 → 不換(不會「換了湊不成同花」)', () => {
    const g0 = createGame(7, 'p2', 'p2', 'fire')
    const hand = [card('H', 2), card('H', 5), card('H', 9), card('S', 3), card('C', 7), card('D', 13), card('S', 11), ...g0.hands.p2.filter((c) => c.kind)]
    const g: GameState = { ...g0, hands: { ...g0.hands, p2: hand } }
    for (let i = 0; i < 40; i++) expect(fireChooseSpecial(g, 'p2', ['hearts', 'clubs', 'spades', 'diamonds'], rt('attack'), mulberry32(i))).toBeNull()
  })

  it('suitPlayCheck:換完這手不出那個同花 → 不換', () => {
    const g0 = createGame(8, 'p2', 'p2', 'fire')
    const hand = [card('H', 2), card('H', 5), card('H', 9), card('H', 12), card('S', 3), ...g0.hands.p2.filter((c) => c.kind)]
    const g: GameState = { ...g0, hands: { ...g0.hands, p2: hand } }
    expect(suitPlayCheck(g, 'p2', 'hearts', 'S3', () => ['H2'])).toBeNull()
    expect(suitPlayCheck(g, 'p2', 'hearts', 'S3', (a) => a.hands.p2.filter((c) => c.suit === 'H' && !c.kind).map((c) => c.id))?.thenPick?.length).toBe(5)
  })

  it('開局沒有任何條件 → 不硬用(爆破 / 強迫更新 / 死神之眼都要條件)', () => {
    const g = createGame(10, 'p2', 'p2', 'fire')
    for (let i = 0; i < 50; i++) expect(fireChooseSpecial(g, 'p2', ['explode', 'deathEye'], rt(), mulberry32(i))).toBeNull()
  })

  it('節奏:前三手最多用 2 張;第 5 手還沒用完 → 挑一張有用的卡用掉', () => {
    const g0 = createGame(13, 'p2', 'p2', 'fire')
    const at = (hand: number, used: SpecialCardId[]): GameState => ({
      ...g0,
      placementsDone: { ...g0.placementsDone, p2: hand },
      fireUsed: { p1: [], p2: used },
    })
    // 第 3 手已用 2 張:條件再好也不用(rng 0 = 機率一定過)
    expect(fireChooseSpecial(at(2, ['spy', 'peek']), 'p2', ['spy', 'peek', 'explode', 'refresh', 'swap'], rt(), () => 0)).toBeNull()
    // 第 5 手還剩 1 次:機率沒過(rng 0.99)也會用一張有效果的
    expect(fireChooseSpecial(at(4, ['spy', 'peek']), 'p2', ['spy', 'peek', 'explode'], rt(), () => 0.99)?.card).toBe('explode')
    // 第 3 手一張都沒用(剩 3 次 = 到期前剩 3 手)→ 也開始趕
    expect(fireChooseSpecial(at(2, []), 'p2', ['refresh'], rt(), () => 0.99)?.card).toBe('refresh')
    // 第 2 手、進度沒落後 → 機率沒過就不用
    expect(fireChooseSpecial(at(1, []), 'p2', ['refresh'], rt(), () => 0.99)).toBeNull()
  })

  it('這回合用過 / 用過的卡 → 不再選', () => {
    let g = createGame(11, 'p2', 'p2', 'fire')
    g = applySpecial(g, 'p2', 'spy')
    expect(fireChooseSpecial(g, 'p2', ['spy', 'peek'], rt(), () => 0)).toBeNull()
    g = nextTurnOf(g, 'p2')
    for (let i = 0; i < 30; i++) expect(fireChooseSpecial(g, 'p2', ['spy'], rt(), mulberry32(i))).toBeNull()
  })

  it('強迫更新對手後,之前看過的對手手牌作廢', () => {
    const g = createGame(12, 'p2', 'p2', 'fire')
    const seen = fireLearn(rt(), 'spy', g, 'p2')
    expect(seen.spySeen).toBe(true)
    expect(fireLearn(seen, 'refresh', g, 'p2').spySeen).toBe(false)
  })

  it('整局跑 150 場(雙方都是電腦):每人 ≤3 次、每回合 ≤1 張、每張 ≤1 次、花色卡一定出同花;回放重播一模一樣', () => {
    let suitUses = 0
    let totalUses = 0
    for (let seed = 1; seed <= 150; seed++) {
      const rng = mulberry32(seed * 31)
      const rts: Record<PlayerId, BossRuntime> = { p1: rt(), p2: rt() }
      const loads: Record<PlayerId, SpecialCardId[]> = { p1: [], p2: [] }
      for (const p of ['p1', 'p2'] as PlayerId[]) {
        const stage = CAMPAIGN[Math.floor(rng() * CAMPAIGN.length)]
        rts[p] = { profile: stage.profile, main: rollMain(stage.profile, rng), execution: [0.6, 0.75, 0.9, 1][Math.floor(rng() * 4)] }
        loads[p] = fireLoadout(rts[p].main, rng)
      }
      const first: PlayerId = rng() < 0.5 ? 'p1' : 'p2'
      let g = createGame(seed, first, 'p2', 'fire')
      const moves: Move[] = []
      for (let step = 0; step < 600 && g.phase !== 'ended'; step++) {
        if (g.phase === 'pick') {
          const me = g.turn
          let forced: string[] | undefined
          const d = fireChooseSpecial(g, me, loads[me], rts[me], rng)
          if (d) {
            const rec = recordingRng(rng)
            const next = applySpecial(g, me, d.card, { targetId: d.targetId, rng: rec.rng })
            expect(next).not.toBe(g)
            expect(loads[me]).toContain(d.card)
            moves.push({ t: 'special', by: me, card: d.card, targetId: d.targetId, rng: rec.out.length ? rec.out : undefined })
            rts[me] = fireLearn(rts[me], d.card, next, me)
            totalUses++
            if (getSpecialCard(d.card)?.suit) {
              suitUses++
              const cards = next.hands[me].filter((c) => d.thenPick!.includes(c.id))
              expect([CATEGORY.FLUSH, CATEGORY.STRAIGHT_FLUSH]).toContain(evaluate(cards).category)
            }
            g = next
            forced = d.thenPick
            expect(fireChooseSpecial(g, me, loads[me], rts[me], rng)).toBeNull() // 一回合只能一張
          }
          const ids = forced ?? limitedPick(g, me, rts[me], rng)
          moves.push({ t: 'pick', by: me, ids })
          g = applyPick(g, me, ids)
        } else if (g.phase === 'place') {
          const placer = otherPlayer(g.pendingPick!.by)
          const slot = limitedPlace(g, placer, rts[placer], rng)
          moves.push({ t: 'place', by: placer, slot })
          g = applyPlace(g, placer, slot)
        } else if (g.phase === 'showdown') g = resolveShowdown(g)
        else if (g.phase === 'draw') g = applyDraw(g)
      }
      expect(g.phase).toBe('ended')
      for (const p of ['p1', 'p2'] as PlayerId[]) {
        const used = fireUsedOf(g, p)
        expect(used.length).toBeLessThanOrEqual(3)
        expect(new Set(used).size).toBe(used.length)
      }
      // 回放:同一份棋譜重播 → 最後局面(含用卡紀錄、勝負)一模一樣
      const frames = buildFrames({ seed, firstPicker: first, mode: 'fire', moves })
      const last = frames[frames.length - 1].state
      expect(frames.some((f) => f.outdated)).toBe(false)
      expect(last.winner).toBe(g.winner)
      expect(last.fireUsed ?? { p1: [], p2: [] }).toEqual({ p1: fireUsedOf(g, 'p1'), p2: fireUsedOf(g, 'p2') })
    }
    expect(totalUses / 300).toBeGreaterThan(1.5) // 每人平均有在用(模擬約 2.5)
    expect(suitUses).toBeGreaterThan(0)
  })
})
