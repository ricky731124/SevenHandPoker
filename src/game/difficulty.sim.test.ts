/**
 * 難度模擬:每關 × 三小關(執行力),boss 對「基礎 AI(只出最強、盲放)」打 N 場,報勝率。
 * 平常跑測試會略過;要跑:SIM=1 npx vitest run src/game/difficulty.sim.test.ts
 * (可加 SIM_N=500 改場數)。boss 照該小關真的卡池用特殊牌(x-1 無、x-2 招牌、x-3 卡池),
 * 基礎 AI 不用特殊牌;先手隨機。同一套 harness 跑全部關卡,數字才能互相比較。
 */
import { describe, it } from 'vitest'
import { aiPick, aiPlace } from './ai'
import { bossChooseSpecial, bossPick, bossPlace, type BossRuntime } from './bossAI'
import { CAMPAIGN, bossCardPool, rollBossRuntime } from './campaign'
import { mulberry32 } from './rng'
import { getSpecialCard, type SpecialCardId } from './specialCards'
import {
  applyDraw,
  applyDeathEye,
  applyExplode,
  applyPick,
  applyPlace,
  applyRefresh,
  applySuit,
  applySwap,
  createGame,
  markSpecialUsed,
  otherPlayer,
  peekNextDraw,
  resolveShowdown,
  type GameState,
  type PlayerId,
} from './state'

const N = Number(process.env.SIM_N ?? 300)

/** boss 回合開始時可能先用特殊牌(同 gameStore.aiMaybeSpecial 的效果與資訊卡記憶)。 */
function bossSpecial(g: GameState, me: PlayerId, loadout: SpecialCardId[], rt: BossRuntime, rng: () => number, used: Record<string, number>) {
  if (!loadout.length || g.specialUsed[me]) return { g, rt }
  const d = bossChooseSpecial(g, me, loadout, rt.profile, { signature: rt.signature, rng })
  if (!d) return { g, rt }
  const def = getSpecialCard(d.card)
  let next = g
  if (def?.suit && d.targetId) next = applySuit(g, me, d.targetId, def.suit)
  else if (d.card === 'swap' && d.targetId) next = applySwap(g, me, d.targetId, rng)
  else if (d.card === 'refresh') next = applyRefresh(g, me, rng)
  else if (d.card === 'explode') next = applyExplode(g, me, rng)
  else if (d.card === 'deathEye') next = applyDeathEye(g, me)
  else next = markSpecialUsed(g, me)
  if (next === g) return { g, rt }
  used[d.card] = (used[d.card] ?? 0) + 1
  if (d.card === 'spy') rt = { ...rt, spySeen: true, spyHand: next.hands[otherPlayer(me)] }
  if (d.card === 'peek') rt = { ...rt, peekDraw: peekNextDraw(next, me) }
  return { g: next, rt }
}

function playOne(seed: number, stageIdx: number, subIdx: number, used: Record<string, number>): boolean {
  const stage = CAMPAIGN[stageIdx]
  const sub = stage.subStages[subIdx]
  const rng = mulberry32(seed)
  const boss: PlayerId = 'p2'
  let rt = rollBossRuntime(stage, sub, rng)
  const loadout = sub.special ? bossCardPool(stage, sub) : []
  let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2')
  for (let step = 0; step < 500 && g.phase !== 'ended'; step++) {
    if (g.phase === 'pick') {
      const me = g.turn
      if (me === boss) ({ g, rt } = bossSpecial(g, me, loadout, rt, rng, used))
      g = applyPick(g, me, me === boss ? bossPick(g, me, rt, rng) : aiPick(g, me))
    } else if (g.phase === 'place') {
      const placer = otherPlayer(g.pendingPick!.by)
      g = applyPlace(g, placer, placer === boss ? bossPlace(g, placer, rt, rng) : aiPlace(g, placer))
    } else if (g.phase === 'showdown') g = resolveShowdown(g)
    else if (g.phase === 'draw') g = applyDraw(g)
  }
  return g.winner === boss
}

/** 單局勝率 p → BO3(先 2 勝)/ BO5(先 3 勝)系列賽勝率。 */
const bo3 = (p: number) => p * p * (3 - 2 * p)
const bo5 = (p: number) => p ** 3 * (10 - 15 * p + 6 * p * p)
const pct = (x: number) => `${Math.round(x * 100)}`

describe.skipIf(!process.env.SIM)('難度模擬(SIM=1 才跑)', () => {
  it(`每關三小關 × ${N} 場`, () => {
    const lines: string[] = [`| 關 | x-1 單局 | x-2 單局 | x-3 單局 | 玩家過關率 x-1(BO3)/x-2(BO3)/x-3(BO5) | boss 用卡(x-2 / x-3) |`, '|---|---|---|---|---|---|']
    CAMPAIGN.forEach((stage, si) => {
      const ps: number[] = []
      const cardNotes: string[] = []
      for (let k = 0; k < 3; k++) {
        const used: Record<string, number> = {}
        let wins = 0
        for (let i = 0; i < N; i++) if (playOne(100_000 * (si + 1) + 1000 * k + i, si, k, used)) wins++
        ps.push(wins / N)
        if (k > 0) cardNotes.push(Object.entries(used).map(([c, n]) => `${getSpecialCard(c)?.name}${pct(n / N)}%`).join('、') || '—')
      }
      const clear = [1 - bo3(ps[0]), 1 - bo3(ps[1]), 1 - bo5(ps[2])]
      lines.push(`| ${stage.index} ${stage.bossName} | ${pct(ps[0])}% | ${pct(ps[1])}% | ${pct(ps[2])}% | ${clear.map(pct).join('% / ')}% | ${cardNotes.join(' / ')} |`)
    })
    console.log('\n' + lines.join('\n'))
  }, 1_800_000)
})
