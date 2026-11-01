/**
 * 送格打法模擬(使用者 2026-11-02):新打法(不單出鬼、送格送 2 張最沒用的、沒成牌收手期出鬼 + 最大)
 * vs 舊打法(送 1 張、沒成牌就單出鬼 / 最大兩張)。同一套 boss 個性,只差 PICK_TUNE.dumpTwo。
 * 平常略過;要跑:DUMP=1 npx vitest run src/game/dump.sim.test.ts(SIM_N=2000 改場數)。
 *
 * 注意:模擬裡的對手是 boss 放牌(只看張數 + 看破),不會像真人一樣「看到送 1 張就拿最便宜的牌吃」,
 * 所以「送 2 張讓對手猜不透」的好處模擬只看得到一部分;數字當下限看。
 */
import { describe, it } from 'vitest'
import { PICK_TUNE, bossPick, bossPlace, rollMain, type BossRuntime } from './bossAI'
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
  return g.winner
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`

describe.skipIf(!process.env.DUMP)('送格打法模擬(DUMP=1 才跑)', () => {
  it(`新打法 vs 舊打法 × ${N} 場`, () => {
    const lines = ['| 對打 | 新打法勝率 | 場數 | 舊打法單出鬼的手數比例 |', '|---|---|---|---|']
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
