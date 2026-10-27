import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from './cards'
import { makeBlank } from './cards'
import { CATEGORY, compareLimited, compareValue, evaluate, evaluateConcrete, type HandValue } from './evaluate'

// 限定房比牌驗收(LIMITED-ROOM-SPEC §4.3 全部例子 + 多鬼估值對拍)。

function c(s: string): Card {
  const suit = s[0] as Suit
  const r = s.slice(1)
  const rank = (r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r)) as Rank
  return { id: `${suit}${rank}`, suit, rank }
}
let jid = 0
/** 牌組變出來的鬼牌(限定房 id 形式)。 */
const J = (): Card => ({ id: `JOKER_d${++jid}`, suit: 'S', rank: 14, kind: 'joker' })
const js = (n: number) => Array.from({ length: n }, J)
const h = (...ss: string[]) => ss.map(c)

type Verdict = 'a' | 'b' | 'tie'
const verdict = (a: Card[], b: Card[]) => {
  const r = compareLimited(a, b)
  return { who: (r.cmp > 0 ? 'a' : r.cmp < 0 ? 'b' : 'tie') as Verdict, by: r.by }
}

describe('§4.3 邊界例子', () => {
  const cases: { n: string; a: Card[]; b: Card[]; who: Verdict; by: ReturnType<typeof verdict>['by'] }[] = [
    { n: '#1 5鬼 vs 5鬼', a: js(5), b: js(5), who: 'tie', by: 'tie' },
    { n: '#2 5鬼 vs 4鬼+♠A', a: js(5), b: [...js(4), c('SA')], who: 'b', by: 'jokers' },
    { n: '#3 ♠10JQ+2鬼 vs 3鬼+♠KA', a: [...h('S10', 'SJ', 'SQ'), ...js(2)], b: [...js(3), ...h('SK', 'SA')], who: 'a', by: 'jokers' },
    { n: '#4 ♠JQ+3鬼 vs ♠10A+3鬼', a: [...h('SJ', 'SQ'), ...js(3)], b: [...h('S10', 'SA'), ...js(3)], who: 'b', by: 'rank' },
    { n: '#5 鬼+♣A vs 鬼+鬼', a: [J(), c('CA')], b: js(2), who: 'a', by: 'jokers' },
    // spec 寫「決定在 2(踢腳)」,實際上 2 鬼+♣7 = 三條 7,第 1 步牌型就贏了;判決一樣是後者。
    { n: '#6 鬼+♣A vs 鬼鬼+♣7', a: [J(), c('CA')], b: [...js(2), c('C7')], who: 'b', by: undefined },
    { n: '#7 ♠9♦9+鬼 vs ♥9♣9+鬼', a: [...h('S9', 'D9'), J()], b: [...h('H9', 'C9'), J()], who: 'a', by: 'suit' },
    { n: '#8 ♠9+鬼鬼 vs ♥9♣9+鬼', a: [c('S9'), ...js(2)], b: [...h('H9', 'C9'), J()], who: 'b', by: 'jokers' },
    { n: '#9 單張♣A vs 單張鬼', a: [c('CA')], b: [J()], who: 'a', by: 'jokers' },
    { n: '#10 單張♣K vs 單張鬼', a: [c('CK')], b: [J()], who: 'b', by: undefined },
    { n: '#11 ♣A♦A vs 鬼鬼', a: h('CA', 'DA'), b: js(2), who: 'a', by: 'jokers' },
    { n: '#12 4鬼+♣7 vs 5鬼', a: [...js(4), c('C7')], b: js(5), who: 'b', by: undefined },
    { n: '#12b 4鬼+♣J vs 5鬼', a: [...js(4), c('CJ')], b: js(5), who: 'a', by: 'jokers' },
    { n: '#13 ♥A♥K+3鬼 vs ♠Q♠J+3鬼', a: [...h('HA', 'HK'), ...js(3)], b: [...h('SQ', 'SJ'), ...js(3)], who: 'a', by: 'rank' },
    { n: '#14 ♥10♥J+3鬼 vs ♠10♠J+3鬼', a: [...h('H10', 'HJ'), ...js(3)], b: [...h('S10', 'SJ'), ...js(3)], who: 'b', by: 'suit' },
    { n: '#15 ♥10JQKA vs 5鬼', a: h('H10', 'HJ', 'HQ', 'HK', 'HA'), b: js(5), who: 'a', by: 'jokers' },
    { n: '#16 鬼+空白 vs 單張鬼', a: [J(), makeBlank('p1')], b: [J()], who: 'tie', by: 'tie' },
    { n: '#17 全空白 vs 全空白', a: [makeBlank('p1'), { ...makeBlank('p2'), id: 'BLANK_d1' }], b: [makeBlank('p2')], who: 'tie', by: 'tie' },
  ]
  for (const t of cases) {
    it(t.n, () => {
      const r = verdict(t.a, t.b)
      expect(r.who).toBe(t.who)
      expect(r.by).toBe(t.by)
      // 對稱:反過來比結果相反
      const back = verdict(t.b, t.a)
      expect(back.who).toBe(t.who === 'tie' ? 'tie' : t.who === 'a' ? 'b' : 'a')
    })
  }
})

describe('多張鬼牌的估值', () => {
  it('參考值:2 鬼 = 對子 A、3 鬼 = 三條 A、4 鬼 = 鐵支 A、5 鬼 = ♠ 同花大順', () => {
    expect(evaluate(js(2))).toMatchObject({ category: CATEGORY.PAIR, rankSeq: [14, 14] })
    expect(evaluate(js(3))).toMatchObject({ category: CATEGORY.THREE_KIND, rankSeq: [14, 14, 14] })
    expect(evaluate(js(4))).toMatchObject({ category: CATEGORY.FOUR_KIND, rankSeq: [14, 14, 14, 14] })
    const five = evaluate(js(5))
    expect(five.category).toBe(CATEGORY.STRAIGHT_FLUSH)
    expect(five.rankSeq).toEqual([14, 13, 12, 11, 10])
    expect(five.wildsAs?.every((w) => w.suit === 'S')).toBe(true)
  })
  it('每張鬼牌都記下變成什麼(攤牌顯示用)', () => {
    const v = evaluate([...h('S10', 'SJ', 'SQ'), ...js(2)])
    expect(v.wildsAs?.map((w) => `${w.suit}${w.rank}`).sort()).toEqual(['S13', 'S14'])
    expect(v.wildAs).toEqual(v.wildsAs?.[0])
  })
  it('沒有五條:3 張 A + 2 鬼 = 鐵支 A 帶 K', () => {
    const v = evaluate([...h('SA', 'HA', 'DA'), ...js(2)])
    expect(v.category).toBe(CATEGORY.FOUR_KIND)
    expect(v.rankSeq).toEqual([14, 14, 14, 14, 13])
  })
  it('一張鬼牌照舊(一般房邏輯不變,沒有 wildsAs)', () => {
    const v = evaluate([c('CA'), J()])
    expect(v.category).toBe(CATEGORY.PAIR)
    expect(v.wildsAs).toBeUndefined()
  })
})

// ---- 對拍:直接推算 vs 暴力窮舉(spec:k ≤ 2 全部組合) ----

const SUITS: Suit[] = ['S', 'H', 'D', 'C']
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
const ALL: Card[] = SUITS.flatMap((s) => RANKS.map((r) => ({ id: `w${s}${r}`, suit: s, rank: r })))

/** 每張鬼牌在 52 張裡任選(可重複)的最大值。 */
function brute(reals: Card[], k: number): HandValue {
  let best: HandValue | null = null
  const pick: Card[] = []
  const walk = (from: number) => {
    if (pick.length === k) {
      const hv = evaluateConcrete([...reals, ...pick])
      if (!best || compareValue(hv, best) > 0) best = hv
      return
    }
    for (let i = from; i < ALL.length; i++) {
      pick.push(ALL[i])
      walk(i)
      pick.pop()
    }
  }
  walk(0)
  return best!
}

/** 決定性的小亂數(測試可重現)。 */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
}

function randomReals(rng: () => number, n: number, pool: Card[]): Card[] {
  const deck = [...pool]
  const out: Card[] = []
  for (let i = 0; i < n; i++) out.push(deck.splice(Math.floor(rng() * deck.length), 1)[0])
  return out
}

const REAL_DECK: Card[] = SUITS.flatMap((s) => RANKS.map((r) => ({ id: `${s}${r}`, suit: s, rank: r })))
const LIMITED_DECK = REAL_DECK.filter((x) => x.rank >= 7)

describe('多鬼估值 = 暴力窮舉(牌型 + 點數)', () => {
  const same = (a: HandValue, b: HandValue) => {
    expect(a.category).toBe(b.category)
    expect(a.rankSeq).toEqual(b.rankSeq)
  }
  it('k = 2:0~3 張正牌,隨機 400 組(含 2~6)', () => {
    const rng = lcg(7)
    for (let t = 0; t < 400; t++) {
      const r = Math.floor(rng() * 4)
      const reals = randomReals(rng, r, rng() < 0.5 ? REAL_DECK : LIMITED_DECK)
      same(evaluate([...reals, ...js(2)]), brute(reals, 2))
    }
  })
  it('k = 2:同花色正牌(同花 / 同花順)全部窗口', () => {
    for (const s of SUITS) {
      for (let a = 2; a <= 14; a++) {
        for (let b = a + 1; b <= 14; b++) {
          for (let d = b + 1; d <= 14; d += 3) {
            const reals = [a, b, d].map((r) => ({ id: `${s}${r}`, suit: s, rank: r as Rank }))
            same(evaluate([...reals, ...js(2)]), brute(reals, 2))
          }
        }
      }
    }
  })
  it('k = 3、4:跟「只試有用值」以外的較大候選集對拍', () => {
    // 52^3 太慢 → 用 ♠ + 正牌花色 × 13 個點數當候選(包含所有可能有用的值)
    const rng = lcg(11)
    for (let t = 0; t < 120; t++) {
      const k = rng() < 0.6 ? 3 : 4
      const reals = randomReals(rng, Math.floor(rng() * (6 - k)), LIMITED_DECK)
      const suits = [...new Set<Suit>(['S', ...reals.map((x) => x.suit)])]
      const cand = suits.flatMap((s) => RANKS.map((r) => ({ id: `w${s}${r}`, suit: s, rank: r })))
      let best: HandValue | null = null
      const pick: Card[] = []
      const walk = (from: number) => {
        if (pick.length === k) {
          const hv = evaluateConcrete([...reals, ...pick])
          if (!best || compareValue(hv, best) > 0) best = hv
          return
        }
        for (let i = from; i < cand.length; i++) {
          pick.push(cand[i])
          walk(i)
          pick.pop()
        }
      }
      walk(0)
      same(evaluate([...reals, ...js(k)]), best!)
    }
  })
})
