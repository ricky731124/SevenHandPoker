/**
 * 限定房人機強度模擬(LIMITED-ROOM-SPEC §11.8)。平常略過;要跑:
 *   SIM=1 npx vitest run src/game/limited.sim.test.ts   (SIM_N=300 改場數)
 * 每種對手各打 N 場(先手隨機),報「限定層」勝率:
 *  - vs 原本邏輯:同樣的 boss 個性,但出牌走原本 bossPick / bossPlace(不懂多鬼牌)
 *  - vs 隨機:隨機出 1~5 張、隨機放
 *  - 快配人機 vs 對戰電腦:兩邊都走限定層(快配 = 隨機主線 boss 個性;電腦 = 預設個性)
 */
import { describe, it } from 'vitest'
import { bossPick, bossPlace, rollMain, type BossRuntime } from './bossAI'
import { CAMPAIGN } from './campaign'
import { defaultLimitedBrain, limitedPick, limitedPlace } from './limitedAI'
import { mulberry32 } from './rng'
import { applyDraw, applyPick, applyPlace, createGame, emptySlotsFor, otherPlayer, resolveShowdown, type GameState, type PlayerId } from './state'

const N = Number(process.env.SIM_N ?? 300)
type Rng = () => number
type Brain = { pick: (g: GameState, me: PlayerId, rng: Rng) => string[]; place: (g: GameState, me: PlayerId, rng: Rng) => number }

const casualRt = (rng: Rng): BossRuntime => {
  const st = CAMPAIGN[Math.floor(rng() * CAMPAIGN.length)]
  return { profile: st.profile, main: rollMain(st.profile, rng), execution: [0.6, 0.75, 0.9][Math.floor(rng() * 3)] }
}
const limited = (rt: BossRuntime): Brain => ({
  pick: (g, me, rng) => limitedPick(g, me, rt, rng),
  place: (g, me, rng) => limitedPlace(g, me, rt, rng),
})
const original = (rt: BossRuntime): Brain => ({
  pick: (g, me, rng) => bossPick(g, me, rt, rng),
  place: (g, me, rng) => bossPlace(g, me, rt, rng),
})
const random: Brain = {
  pick: (g, me, rng) => {
    const h = [...g.hands[me]].sort(() => rng() - 0.5)
    return h.slice(0, 1 + Math.floor(rng() * Math.min(5, h.length))).map((c) => c.id)
  },
  place: (g, _me, rng) => {
    const e = emptySlotsFor(g, g.pendingPick!.by)
    return e[Math.floor(rng() * e.length)]
  },
}

function play(seed: number, a: Brain, b: Brain): boolean {
  const rng = mulberry32(seed)
  const brains: Record<PlayerId, Brain> = { p1: a, p2: b }
  let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2', 'p2', 'ghost')
  for (let i = 0; i < 500 && g.phase !== 'ended'; i++) {
    if (g.phase === 'pick') g = applyPick(g, g.turn, brains[g.turn].pick(g, g.turn, rng))
    else if (g.phase === 'place') {
      const placer = otherPlayer(g.pendingPick!.by)
      g = applyPlace(g, placer, brains[placer].place(g, placer, rng))
    } else if (g.phase === 'showdown') g = resolveShowdown(g)
    else if (g.phase === 'draw') g = applyDraw(g)
  }
  return g.winner === 'p1'
}

describe.skipIf(!process.env.SIM)('限定房模擬(SIM=1 才跑)', () => {
  it(`百鬼夜行 × ${N} 場`, () => {
    const rows: [string, (r: Rng) => [Brain, Brain]][] = [
      ['快配人機(限定層) vs 同個性原本邏輯', (r) => { const rt = casualRt(r); return [limited(rt), original({ ...rt })] }],
      ['對戰電腦(限定層預設) vs 原本邏輯(預設個性)', () => [limited(defaultLimitedBrain()), original(defaultLimitedBrain())]],
      ['快配人機(限定層) vs 隨機', (r) => [limited(casualRt(r)), random]],
      ['快配人機(限定層) vs 對戰電腦(限定層預設)', (r) => [limited(casualRt(r)), limited(defaultLimitedBrain())]],
    ]
    const out: string[] = ['| 對局 | 前者勝率 |', '|---|---|']
    rows.forEach(([name, mk], k) => {
      let w = 0
      for (let i = 0; i < N; i++) {
        const [a, b] = mk(mulberry32(50_000 * (k + 1) + i))
        if (play(900_000 * (k + 1) + i, a, b)) w++
      }
      out.push(`| ${name} | ${Math.round((w / N) * 100)}% |`)
    })
    console.log('\n' + out.join('\n'))
  }, 1_800_000)
})
