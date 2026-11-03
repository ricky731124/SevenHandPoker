import { buildFrames, type Move } from './replay'
import { isBlank, isJoker, rankLabel, SUIT_SYMBOL, type Card } from './cards'
import { evaluate } from './evaluate'
import { otherPlayer, peekNextDraw, type GameState, type PlayerId } from './state'
import type { LimitedMode } from './limited'

/**
 * 人機回報(.claude/skills/bot-report)共用:把回放重播到「某人的第 N 手出牌 / 放牌」之前,
 * 以及情境題庫(botScenarios.json)用的「這疊牌符不符合描述」比對。只給工具和測試用,遊戲不會載入。
 */

export interface ReplayLike {
  seed: number
  firstPicker: PlayerId
  mode?: LimitedMode
  moves: Move[]
}

export const face = (c: Card) => (isJoker(c) ? '鬼' : isBlank(c) ? '空' : `${SUIT_SYMBOL[c.suit]}${rankLabel(c.rank)}`)
export const hs = (cs: Card[]) => [...cs].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).map(face).join(' ')
export const pileName = (cs: Card[]) => (cs.length ? `${hs(cs)}(${evaluate(cs).name})` : '—')

/** 不看花色的點數(鬼 / 空 照寫)。 */
const rankOf = (c: Card) => (isJoker(c) ? '鬼' : isBlank(c) ? '空' : rankLabel(c.rank))

export interface Seeked {
  /** 這一步之前的局面(人機做決定時看到的) */
  before: GameState
  /** 這一步之後(出牌 = pendingPick 是實際出的那疊;放牌 = 對手那疊已放好) */
  after: GameState
  action: string
  /** 這個人用過讓我看看 → 看過對手手牌 */
  spy: boolean
  spyHand: Card[] | null
  /** 這個人偷窺到的下次補牌(只管偷窺後的下一手) */
  peek: Card[] | null
  used: { by: PlayerId; card: string }[]
  log: string[]
}

/** 重播到 p 的第 n 手出牌(place = 第 n 次放牌)那一步。 */
export function seekReplay(r: ReplayLike, p: PlayerId, n: number, place = false, names?: { p1: string; p2: string }): Seeked {
  const frames = buildFrames({ seed: r.seed, firstPicker: r.firstPicker, mode: r.mode, moves: r.moves, names })
  let prev = frames[0].state
  let count = 0
  let spy = false
  let spyHand: Card[] | null = null
  let peek: Card[] | null = null
  const used: { by: PlayerId; card: string }[] = []
  const log: string[] = []
  for (const f of frames) {
    const fx = f.cardFx
    if (fx) {
      used.push({ by: fx.by, card: fx.card })
      if (fx.by === p && fx.kind === 'spy') {
        spy = true
        spyHand = prev.hands[otherPlayer(p)]
      }
      if (fx.by === p && fx.kind === 'peek') peek = peekNextDraw(prev, p)
    }
    const isPick = /^出 /.test(f.action) && f.state.pendingPick?.by === p
    const isPlace = !!prev.pendingPick && !f.state.pendingPick && prev.pendingPick.by !== p && /放/.test(f.action)
    if (place ? isPlace : isPick) {
      count++
      if (count === n) return { before: prev, after: f.state, action: f.action, spy, spyHand, peek, used, log }
    }
    if (isPick) peek = null // 偷窺只管偷窺後的下一手
    if (/^出 /.test(f.action)) log.push(`${f.actor ?? ''} ${f.action}:${hs(f.state.pendingPick!.cards)}`)
    else if (f.action && !/補/.test(f.action)) log.push(`${f.actor ?? ''} ${f.action}`)
    prev = f.state
  }
  throw new Error(`${p} 沒有第 ${n} ${place ? '次放牌' : '手出牌'}(只到 ${count})`)
}

/**
 * 題庫用的描述比對。一個描述可以用「&」串多個條件,全部成立才算:
 *  - `A A`、`10 10 鬼`:點數剛好是這幾張(不看花色、不管順序)
 *  - `類:對子`:牌型名(高牌 / 對子 / 兩對 / 三條 / 順子 / 同花 / 葫蘆 / 鐵支 / 同花順)
 *  - `含:A`、`含:鬼`:有這個點數
 *  - `張:5`、`張:<=2`、`張:>=5`:張數
 *  - `送格`:沒有一對以上(只有高牌 / 空白)
 *  - `格:3`(放牌題):放在第 3 格
 */
export function pileMatches(pile: Card[], desc: string, slot?: number): boolean {
  return desc.split('&').every((raw) => {
    const d = raw.trim()
    if (d.startsWith('格:')) return slot != null && slot + 1 === Number(d.slice(2))
    if (d === '送格') return evaluate(pile).name === '高牌'
    if (d.startsWith('類:')) return evaluate(pile).name === d.slice(2)
    if (d.startsWith('含:')) return pile.some((c) => rankOf(c) === d.slice(2))
    if (d.startsWith('張:')) {
      const m = /^(<=|>=)?(\d+)$/.exec(d.slice(2))
      if (!m) throw new Error(`看不懂「${d}」`)
      const n = Number(m[2])
      return m[1] === '<=' ? pile.length <= n : m[1] === '>=' ? pile.length >= n : pile.length === n
    }
    const want = d.split(/\s+/).sort().join(' ')
    return pile.map(rankOf).sort().join(' ') === want
  })
}
