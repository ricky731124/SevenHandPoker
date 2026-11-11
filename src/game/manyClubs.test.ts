/**
 * 第 10 關「小鹿亂撞」梅花鹿 + 招牌卡「漫天梅花」(2026-11-11):選 1~3 張非梅花的手牌變梅花。
 * 規則跟踏雪尋梅一樣,只差上限 3 張。
 */
import { describe, expect, it } from 'vitest'
import { isStarterSpecial, type Card, type Rank, type Suit } from './cards'
import { applyDraw, applyPick, applyPlace, applySpecial, createGame, resolveShowdown, type GameState, type PlayerId } from './state'
import { buildFrames, suitMove, type Move } from './replay'
import { bossChooseSpecial, bossPick, bossPlace, suitVictims } from './bossAI'
import { aiChooseSpecial } from './ai'
import { bossCardPool, getStage, rollBossRuntime } from './campaign'
import { firePool, getSpecialCard, SPECIAL_CARD_LIST, SPECIAL_CARDS, suitMaxOf } from './specialCards'
import { CATEGORY, evaluate } from './evaluate'

const card = (suit: Suit, rank: Rank): Card => ({ id: `${suit}${rank}`, suit, rank })
const JOKER: Card = { id: 'JOKER_t', suit: 'S', rank: 14, kind: 'joker' }

function withHand(me: PlayerId, hand: Card[]): GameState {
  const g = createGame(4242, me)
  return { ...g, turn: me, hands: { ...g.hands, [me]: hand } }
}
function inPlay(g: GameState): Card[] {
  return [...g.deck, ...g.hands.p1, ...g.hands.p2, ...(g.pendingPick?.cards ?? []), ...g.slots.flatMap((s) => [...s.p1, ...s.p2])]
}

describe('漫天梅花:效果', () => {
  const hand = [card('C', 5), card('C', 9), card('D', 8), card('H', 3), card('S', 11), card('D', 2), JOKER]

  it('改 3 張:都變梅花、記得原花色、只算用一次', () => {
    const g = withHand('p1', hand)
    const next = applySpecial(g, 'p1', 'manyClubs', { targetIds: ['D8', 'H3', 'S11'] })
    const byId = (id: string) => next.hands.p1.find((c) => c.id === id)!
    for (const [id, from] of [['D8', 'D'], ['H3', 'H'], ['S11', 'S']] as const) {
      expect(byId(id).suit).toBe('C')
      expect(byId(id).resuitFrom).toBe(from)
    }
    expect(next.specialUsed.p1).toBe(true)
    expect(next.deck).toBe(g.deck) // 牌堆不動
  })

  it('1 張、2 張也可以', () => {
    const g = withHand('p1', hand)
    expect(applySpecial(g, 'p1', 'manyClubs', { targetIds: ['D8'] }).hands.p1.find((c) => c.id === 'D8')!.suit).toBe('C')
    expect(applySpecial(g, 'p1', 'manyClubs', { targetIds: ['D8', 'H3'] }).hands.p1.filter((c) => c.suit === 'C').length).toBe(4)
  })

  it('不合法 → 整個不生效:4 張、重複、已是梅花、鬼牌、不在手上', () => {
    const g = withHand('p1', hand)
    expect(applySpecial(g, 'p1', 'manyClubs', { targetIds: ['D8', 'H3', 'S11', 'D2'] })).toBe(g)
    expect(applySpecial(g, 'p1', 'manyClubs', { targetIds: ['D8', 'D8'] })).toBe(g)
    expect(applySpecial(g, 'p1', 'manyClubs', { targetIds: ['D8', 'C5'] })).toBe(g)
    expect(applySpecial(g, 'p1', 'manyClubs', { targetIds: ['D8', JOKER.id] })).toBe(g)
    expect(applySpecial(g, 'p1', 'manyClubs', { targetIds: ['D8', 'X9'] })).toBe(g)
  })

  it('踏雪尋梅等舊花色卡照舊最多 2 張', () => {
    const g = withHand('p1', hand)
    expect(applySpecial(g, 'p1', 'clubs', { targetIds: ['D8', 'H3', 'S11'] })).toBe(g)
    expect(suitMaxOf('clubs')).toBe(2)
    expect(suitMaxOf('manyClubs')).toBe(3)
    expect(suitMaxOf('swap')).toBe(0)
  })

  it('火力全開:這張也算一次、用過不能再用', () => {
    const g0 = createGame(7, 'p1', 'p1', 'fire')
    const offClubs = g0.hands.p1.filter((c) => !c.kind && c.suit !== 'C').slice(0, 3).map((c) => c.id)
    const g = { ...g0, turn: 'p1' as const }
    const next = applySpecial(g, 'p1', 'manyClubs', { targetIds: offClubs })
    expect(next.fireUsed?.p1).toEqual(['manyClubs'])
  })
})

describe('漫天梅花:回放', () => {
  it('3 張棋譜重播得出來,字幕三張都寫、帶演出資料', () => {
    const g = createGame(5, 'p1')
    const off = g.hands.p1.filter((c) => !c.kind && c.suit !== 'C').slice(0, 3).map((c) => c.id)
    expect(off).toHaveLength(3)
    const moves: Move[] = [suitMove('p1', 'manyClubs', off, undefined)]
    const f = buildFrames({ seed: 5, firstPicker: 'p1', moves }).pop()!
    expect(f.outdated).toBeFalsy()
    expect(f.cardFx?.kind).toBe('suit')
    expect(f.cardFx?.targets?.length).toBe(3)
    expect(f.action).toContain('漫天梅花')
    expect(f.action.split('、')).toHaveLength(3)
    for (const id of off) expect(f.state.hands.p1.find((c) => c.id === id)!.suit).toBe('C')
  })
})

describe('漫天梅花:電腦怎麼用', () => {
  // 握 2 張梅花 + 3 張落單低散牌 → 換 3 張湊同花
  const two = [card('C', 14), card('C', 10), card('D', 3), card('H', 5), card('S', 7), card('D', 12), card('H', 13)]

  it('握 2 張梅花:漫天梅花換 3 張最小的落單散牌;踏雪尋梅不換(只能改 2 張不夠)', () => {
    const g = withHand('p2', two)
    expect(suitVictims(g, 'p2', 'C', undefined, 3)?.map((c) => c.id)).toEqual(['D3', 'H5', 'S7'])
    expect(suitVictims(g, 'p2', 'C', undefined, 2)).toBeNull()
    const after = applySpecial(g, 'p2', 'manyClubs', { targetIds: ['D3', 'H5', 'S7'] })
    const clubs = after.hands.p2.filter((c) => c.suit === 'C')
    expect(evaluate(clubs).category).toBe(CATEGORY.FLUSH)
  })

  it('握 3、4 張照舊(換 2 / 1 張)', () => {
    const three = withHand('p2', [card('C', 14), card('C', 10), card('C', 8), card('D', 3), card('H', 5), card('S', 12), card('D', 13)])
    expect(suitVictims(three, 'p2', 'C', undefined, 3)?.map((c) => c.id)).toEqual(['D3', 'H5'])
    const four = withHand('p2', [card('C', 14), card('C', 10), card('C', 8), card('C', 6), card('D', 3), card('H', 13)])
    expect(suitVictims(four, 'p2', 'C', undefined, 3)?.map((c) => c.id)).toEqual(['D3'])
  })

  it('握 1 張梅花 / 散牌不夠 → 不用', () => {
    expect(suitVictims(withHand('p2', [card('C', 14), card('D', 3), card('H', 5), card('S', 7), card('D', 9)]), 'p2', 'C', undefined, 3)).toBeNull()
    // 2 張梅花但其他都成對 → 沒有 3 張落單散牌(沒給 rng = 不拆對子)
    expect(suitVictims(withHand('p2', [card('C', 14), card('C', 10), card('D', 3), card('H', 3), card('S', 7), card('D', 7)]), 'p2', 'C', undefined, 3)).toBeNull()
  })

  it('boss 本尊(10-2 只帶漫天梅花)握 2 張梅花就用、目標 3 張', () => {
    const g = withHand('p2', two)
    expect(bossChooseSpecial(g, 'p2', ['manyClubs'], undefined, { signature: 'manyClubs', rng: () => 0.5 })).toEqual({
      card: 'manyClubs',
      targetIds: ['D3', 'H5', 'S7'],
    })
  })

  it('對戰電腦(基本 AI)帶漫天梅花也會用', () => {
    expect(aiChooseSpecial(withHand('p2', two), 'p2', ['manyClubs'])).toEqual({ card: 'manyClubs', targetIds: ['D3', 'H5', 'S7'] })
  })
})

describe('第 10 關資料', () => {
  const s10 = getStage('s10')!
  it('關卡名/角色名/招牌卡/參數照使用者填的表', () => {
    expect(s10.index).toBe(10)
    expect(s10.name).toBe('小鹿亂撞')
    expect(s10.bossName).toBe('梅花鹿')
    expect(s10.bossAvatar).toBe('deer')
    expect(s10.signatureCard).toBe('manyClubs')
    expect(s10.profile).toEqual({ pickMain: { attack: 30, hoard: 40, balance: 30 }, bluff: 50, draw: 50, jokerTiming: 10, insight: 50 })
    expect(s10.subStages.map((s) => s.execution)).toEqual([0.6, 0.75, 0.9])
  })
  it('10-2 獎勵漫天梅花、10-3 獎勵鹿頭像;卡池', () => {
    expect(s10.subStages[1].reward.card).toBe('manyClubs')
    expect(s10.subStages[2].reward.avatar).toBe('deer')
    expect(bossCardPool(s10, s10.subStages[1])).toEqual(['manyClubs'])
    expect(bossCardPool(s10, s10.subStages[2])).toEqual(expect.arrayContaining(['manyClubs', 'clubs', 'deathEye', 'explode']))
  })
  it('卡片定義:中立、接在最後面(解鎖順序)、火力全開解鎖 11 張才開', () => {
    const d = SPECIAL_CARDS.manyClubs
    expect(d.name).toBe('漫天梅花')
    expect(d.suit).toBe('C')
    expect(d.fireStyle).toBe('neutral')
    expect(d.affectsFoe).toBe(false)
    expect(d.desc).toContain('1~3 張')
    expect(SPECIAL_CARD_LIST[SPECIAL_CARD_LIST.length - 1].id).toBe('manyClubs')
    expect(firePool(10)).not.toContain('manyClubs')
    expect(firePool(11)).toContain('manyClubs')
    expect(getSpecialCard('manyClubs')?.needsTarget).toBe(true)
  })
})

describe('壓力測試 — 300 場 boss 對 boss(10-3 卡池 vs 10-2 只帶漫天梅花)', () => {
  it('52 張普通牌不重不漏、專屬牌不進牌堆、每場打得完、回放重現', () => {
    const s10 = getStage('s10')!
    let used = 0
    let three = 0
    for (let k = 0; k < 300; k++) {
      let seed = 9000 + k
      const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
      const first: PlayerId = k % 2 ? 'p1' : 'p2'
      let g = createGame(7000 + k, first)
      const rts = { p1: rollBossRuntime(s10, s10.subStages[2], rng), p2: rollBossRuntime(s10, s10.subStages[1], rng) }
      const loadouts = { p1: bossCardPool(s10, s10.subStages[2]), p2: ['manyClubs' as const] }
      const moves: Move[] = []
      for (let step = 0; step < 400 && g.phase !== 'ended'; step++) {
        if (g.phase === 'pick') {
          const me = g.turn
          const d = bossChooseSpecial(g, me, [...loadouts[me]], rts[me].profile, { signature: rts[me].signature, rng })
          // 只套花色卡(決定性);其他卡不套,回放才不用記 rng
          if (d?.targetIds && getSpecialCard(d.card)?.suit) {
            const next = applySpecial(g, me, d.card, { targetIds: d.targetIds })
            expect(next).not.toBe(g)
            g = next
            moves.push(suitMove(me, d.card, d.targetIds, undefined))
            if (d.card === 'manyClubs') {
              used++
              if (d.targetIds.length === 3) three++
            }
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
      }
      expect(g.phase).toBe('ended')
      const last = buildFrames({ seed: 7000 + k, firstPicker: first, moves }).pop()!
      expect(last.outdated).toBeFalsy()
      expect(last.state.slots).toEqual(g.slots)
      expect(last.state.winner).toBe(g.winner)
    }
    console.log(`[漫天梅花壓力測試] 300 場用了 ${used} 次,其中換 3 張 ${three} 次`)
    expect(used).toBeGreaterThan(30)
    expect(three).toBeGreaterThan(0)
  })
})
