/**
 * 送格打法模擬(使用者 2026-11-02):新打法(不單出鬼、送格送 2 張最沒用的、沒成牌收手期出鬼 + 最大)
 * vs 舊打法(送 1 張、沒成牌就單出鬼 / 最大兩張)。同一套 boss 個性,只差 PICK_TUNE.dumpTwo。
 * 平常略過;要跑:DUMP=1 npx vitest run src/game/dump.sim.test.ts(SIM_N=2000 改場數)。
 *
 * 注意:模擬裡的對手是 boss 放牌(只看張數 + 看破),不會像真人一樣「看到送 1 張就拿最便宜的牌吃」,
 * 所以「送 2 張讓對手猜不透」的好處模擬只看得到一部分;數字當下限看。
 */
import { describe, it } from 'vitest'
import { BOARD_TUNE, PICK_TUNE, bossPick, bossPlace, rollMain, type BossRuntime } from './bossAI'
import { CAMPAIGN } from './campaign'
import { mulberry32 } from './rng'
import { applyDraw, applyPick, applyPlace, createGame, otherPlayer, resolveShowdown, type PlayerId } from './state'

const N = Number(process.env.SIM_N ?? 1500)
type Rng = () => number

function play(seed: number, rts: Record<PlayerId, BossRuntime>, newSide: PlayerId, stats: { lone: number; picks: number }): PlayerId | null {
  const rng = mulberry32(seed)
  let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2')
  for (let step = 0; step < 500 && g.phase !== 'ended'; step++) {
    if (g.phase === 'pick') {
      const me = g.turn
      PICK_TUNE.dumpTwo = me === newSide
      BOARD_TUNE.on = me === newSide
      const ids = bossPick(g, me, rts[me], rng)
      if (me !== newSide) {
        stats.picks++
        if (ids.length === 1 && g.hands[me].find((c) => c.id === ids[0])?.kind === 'joker') stats.lone++
      }
      g = applyPick(g, me, ids)
    } else if (g.phase === 'place') {
      const placer = otherPlayer(g.pendingPick!.by)
      g = applyPlace(g, placer, bossPlace(g, placer, rts[placer], rng))
    } else if (g.phase === 'showdown') g = resolveShowdown(g)
    else if (g.phase === 'draw') g = applyDraw(g)
  }
  PICK_TUNE.dumpTwo = true
  BOARD_TUNE.on = true
  return g.winner
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`

/**
 * 一般牌組的「張數 → 牌型分布表」(看棋盤用,2026-11-02):快配人機互打,統計每一疊的(牌型, 最大點數, 用幾張鬼)。
 * GENN=1 npx vitest run src/game/dump.sim.test.ts → 印成 limitedPlace.ts 的 NORMAL_TABLE 貼回去;出牌邏輯大改要重產。
 */
describe.skipIf(!process.env.GENN)('一般牌組分布表(GENN=1 才跑)', () => {
  it('產表', async () => {
    const { evaluate } = await import('./evaluate')
    const G = Number(process.env.SIM_N ?? 3000)
    const tally: Map<string, number>[] = Array.from({ length: 6 }, () => new Map())
    const counts = [0, 0, 0, 0, 0, 0]
    for (let i = 0; i < G; i++) {
      const r = mulberry32(7_100_000 + i)
      const mk = (): BossRuntime => {
        const st = CAMPAIGN[Math.floor(r() * CAMPAIGN.length)]
        return { profile: st.profile, main: rollMain(st.profile, r), execution: [0.6, 0.75, 0.9][Math.floor(r() * 3)] }
      }
      const rts: Record<PlayerId, BossRuntime> = { p1: mk(), p2: mk() }
      const rng = mulberry32(8_100_000 + i)
      let g = createGame(8_100_000 + i, rng() < 0.5 ? 'p1' : 'p2')
      for (let k = 0; k < 500 && g.phase !== 'ended'; k++) {
        if (g.phase === 'pick') {
          const ids = bossPick(g, g.turn, rts[g.turn], rng)
          const cards = g.hands[g.turn].filter((c) => ids.includes(c.id))
          const v = evaluate(cards)
          const n = Math.min(5, cards.length)
          const key = `${v.category},${v.rankSeq[0] ?? 0},${cards.filter((c) => c.kind === 'joker').length}`
          tally[n].set(key, (tally[n].get(key) ?? 0) + 1)
          counts[n]++
          g = applyPick(g, g.turn, ids)
        } else if (g.phase === 'place') {
          const placer = otherPlayer(g.pendingPick!.by)
          g = applyPlace(g, placer, bossPlace(g, placer, rts[placer], rng))
        } else if (g.phase === 'showdown') g = resolveShowdown(g)
        else if (g.phase === 'draw') g = applyDraw(g)
      }
    }
    const lines = tally.slice(1).map((m) => {
      const tot = [...m.values()].reduce((s, n) => s + n, 0)
      const rows = [...m.entries()].filter(([, n]) => n / tot >= 0.003).sort((a, b) => b[1] - a[1])
      const kept = rows.reduce((s, [, n]) => s + n, 0)
      return '  [' + rows.map(([k, n]) => `[${k},${(n / kept).toFixed(3)}]`).join(', ') + '],'
    })
    const all = counts.slice(1).reduce((s, n) => s + n, 0)
    console.log('\nNORMAL_TABLE = [\n' + lines.join('\n') + '\n]\nNORMAL_COUNT_MIX = [' + counts.slice(1).map((n) => (n / all).toFixed(3)).join(', ') + ']')
  }, 1_800_000)
})

/**
 * 診斷(DIAG=1):boss(新 / 舊送格)打基本 AI(aiPick 出最強 + aiPlace),逐手統計 boss 出的牌:
 * 第幾手出了什麼牌型、出幾張、出牌前手上幾張普通牌、這疊最後有沒有拿下那格。看「後段沒牌可打」是不是真的。
 */
describe.skipIf(!process.env.DIAG)('逐手出牌診斷(DIAG=1 才跑)', () => {
  it(`boss vs 基本 AI × ${N} 場`, async () => {
    const { aiPick, aiPlace } = await import('./ai')
    const { evaluate, CATEGORY } = await import('./evaluate')
    const CAT_ZH: Record<number, string> = { [CATEGORY.HIGH_CARD]: '散', [CATEGORY.PAIR]: '對', [CATEGORY.TWO_PAIR]: '兩對', [CATEGORY.THREE_KIND]: '三條', [CATEGORY.STRAIGHT]: '順', [CATEGORY.FLUSH]: '花', [CATEGORY.FULL_HOUSE]: '葫', [CATEGORY.FOUR_KIND]: '鐵', [CATEGORY.STRAIGHT_FLUSH]: '同花順' }
    const out: string[] = []
    for (const dumpTwo of [false, true]) {
      for (const main of ['attack', 'hoard', 'balance'] as const) {
        const per = Array.from({ length: 7 }, () => ({ n: 0, cards: 0, hand: 0, weak: 0, won: 0, cats: {} as Record<string, number> }))
        let wins = 0
        for (let i = 0; i < N; i++) {
          const seed = 50_000 + i
          const rng = mulberry32(seed)
          const st = CAMPAIGN[Math.floor(rng() * CAMPAIGN.length)]
          const rt: BossRuntime = { profile: st.profile, main, execution: 0.75 }
          const boss: PlayerId = 'p2'
          let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2')
          const mine: { idx: number; slot: number | null }[] = []
          for (let step = 0; step < 500 && g.phase !== 'ended'; step++) {
            if (g.phase === 'pick') {
              const me = g.turn
              PICK_TUNE.dumpTwo = dumpTwo
              BOARD_TUNE.on = dumpTwo
              const ids = me === boss ? bossPick(g, me, rt, rng) : aiPick(g, me)
              if (me === boss) {
                const k = Math.min(6, g.placementsDone[me])
                const pile = g.hands[me].filter((c) => ids.includes(c.id))
                const cat = evaluate(pile).category
                const p = per[k]
                p.n++
                p.cards += pile.length
                p.hand += g.hands[me].filter((c) => !c.kind).length
                if (cat <= CATEGORY.PAIR && (cat === CATEGORY.HIGH_CARD || (evaluate(pile).rankSeq[0] ?? 0) <= 6)) p.weak++
                p.cats[CAT_ZH[cat] ?? '?'] = (p.cats[CAT_ZH[cat] ?? '?'] ?? 0) + 1
                mine.push({ idx: k, slot: null })
              }
              g = applyPick(g, me, ids)
            } else if (g.phase === 'place') {
              const placer = otherPlayer(g.pendingPick!.by)
              const slot = placer === boss ? bossPlace(g, placer, rt, rng) : aiPlace(g, placer)
              if (g.pendingPick!.by === boss) mine[mine.length - 1].slot = slot
              g = applyPlace(g, placer, slot)
            } else if (g.phase === 'showdown') g = resolveShowdown(g)
            else if (g.phase === 'draw') g = applyDraw(g)
          }
          for (const m of mine) if (m.slot !== null && g.slots[m.slot].owner && (g.slots[m.slot].owner === boss || g.slots[m.slot].owner === 'both')) per[m.idx].won++
          if (g.winner === boss) wins++
        }
        PICK_TUNE.dumpTwo = true
        BOARD_TUNE.on = true
        out.push(`\n### ${dumpTwo ? '新(看棋盤 + 反推)' : '舊(今天以前)'} · ${{ attack: '強攻', hoard: '囤牌', balance: '平衡' }[main]} · 勝率 ${pct(wins / N)}`)
        out.push('| 第幾手 | 手數 | 出牌前手上普通牌 | 平均出幾張 | 散牌或≤6 弱對 | 拿下那格 | 牌型分布 |', '|---|---|---|---|---|---|---|')
        per.forEach((p, k) => {
          if (!p.n) return
          const cats = Object.entries(p.cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c}${Math.round((v / p.n) * 100)}`).join(' ')
          out.push(`| ${k + 1} | ${p.n} | ${(p.hand / p.n).toFixed(1)} | ${(p.cards / p.n).toFixed(2)} | ${pct(p.weak / p.n)} | ${pct(p.won / p.n)} | ${cats} |`)
        })
      }
    }
    console.log(out.join('\n'))
  }, 1_800_000)
})

describe.skipIf(!process.env.DUMP)('送格打法模擬(DUMP=1 才跑)', () => {
  it(`新打法 vs 舊打法 × ${N} 場`, () => {
    const lines = ['| 對打 | 新打法(看棋盤)勝率 | 場數 | 舊打法單出鬼的手數比例 |', '|---|---|---|---|']
    const run = (name: string, mk: (rng: Rng) => [BossRuntime, BossRuntime]) => {
      let wins = 0
      const stats = { lone: 0, picks: 0 }
      for (let i = 0; i < N; i++) {
        const r = mulberry32(900_000 + i)
        const [a, b] = mk(r)
        const newSide: PlayerId = i % 2 ? 'p1' : 'p2' // 輪流坐 p1 / p2
        const rts = { [newSide]: a, [otherPlayer(newSide)]: b } as Record<PlayerId, BossRuntime>
        if (play(10_000 + i, rts, newSide, stats) === newSide) wins++
      }
      lines.push(`| ${name} | ${pct(wins / N)} | ${N} | ${pct(stats.lone / Math.max(1, stats.picks))} |`)
    }
    const randRt = (r: Rng, exec: number): BossRuntime => {
      const st = CAMPAIGN[Math.floor(r() * CAMPAIGN.length)]
      return { profile: st.profile, main: rollMain(st.profile, r), execution: exec }
    }
    for (const exec of [1, 0.9, 0.75, 0.6]) {
      run(`同個性、執行力 ${exec}`, (r) => {
        const rt = randRt(r, exec)
        return [rt, { ...rt }]
      })
    }
    for (const main of ['attack', 'hoard', 'balance'] as const) {
      run(`都是${{ attack: '強攻', hoard: '囤牌', balance: '平衡' }[main]}、執行力 0.75`, (r) => {
        const rt = { ...randRt(r, 0.75), main }
        return [rt, { ...rt }]
      })
    }
    console.log('\n' + lines.join('\n'))
  }, 1_800_000)
})
