/**
 * 2026-11-03 回放檢討修正(PICK_TUNE.fix1103)的模擬:修正後 vs 修正前。
 * 平常略過;要跑:FIX=1 npx vitest run src/game/fix1103.sim.test.ts(SIM_N 改場數)。
 *  ① 新 vs 舊 互打(同個性)② 各打法打基本 AI:勝率 + 逐手牌型(前段順 / 花比例、後段散牌比例)
 */
import { describe, it } from 'vitest'
import { PICK_TUNE, bossPick, bossPlace, rollMain, type BossRuntime, type PickMain } from './bossAI'
import { CAMPAIGN } from './campaign'
import { CATEGORY, evaluate } from './evaluate'
import { mulberry32 } from './rng'
import { applyDraw, applyPick, applyPlace, createGame, otherPlayer, resolveShowdown, type PlayerId } from './state'
import { aiPick, aiPlace } from './ai'

const N = Number(process.env.SIM_N ?? 1200)
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`
const ZH: Record<PickMain, string> = { attack: '強攻', hoard: '囤牌', balance: '平衡' }

describe.skipIf(!process.env.FIX)('fix1103 模擬(FIX=1 才跑)', () => {
  it('新 vs 舊 互打', () => {
    const lines = ['| 對打 | 修正後勝率 | 場數 |', '|---|---|---|']
    const run = (name: string, mk: (r: () => number) => BossRuntime) => {
      let wins = 0
      for (let i = 0; i < N; i++) {
        const r = mulberry32(300_000 + i)
        const a = mk(r)
        const rts: Record<PlayerId, BossRuntime> = { p1: a, p2: { ...a } }
        const newSide: PlayerId = i % 2 ? 'p1' : 'p2'
        const rng = mulberry32(400_000 + i)
        let g = createGame(400_000 + i, rng() < 0.5 ? 'p1' : 'p2')
        for (let s = 0; s < 500 && g.phase !== 'ended'; s++) {
          if (g.phase === 'pick') {
            PICK_TUNE.fix1103 = g.turn === newSide
            g = applyPick(g, g.turn, bossPick(g, g.turn, rts[g.turn], rng))
          } else if (g.phase === 'place') {
            const placer = otherPlayer(g.pendingPick!.by)
            g = applyPlace(g, placer, bossPlace(g, placer, rts[placer], rng))
          } else if (g.phase === 'showdown') g = resolveShowdown(g)
          else if (g.phase === 'draw') g = applyDraw(g)
        }
        PICK_TUNE.fix1103 = true
        if (g.winner === newSide) wins++
      }
      lines.push(`| ${name} | ${pct(wins / N)} | ${N} |`)
    }
    const rand = (r: () => number, exec: number): BossRuntime => {
      const st = CAMPAIGN[Math.floor(r() * CAMPAIGN.length)]
      return { profile: st.profile, main: rollMain(st.profile, r), execution: exec }
    }
    for (const exec of [0.9, 0.75, 0.6]) run(`隨機打法、執行力 ${exec}`, (r) => rand(r, exec))
    for (const main of ['attack', 'hoard', 'balance'] as const) run(`都是${ZH[main]}、執行力 0.75`, (r) => ({ ...rand(r, 0.75), main }))
    console.log('\n' + lines.join('\n'))
  }, 1_800_000)

  it('打基本 AI:勝率 + 逐手牌型', () => {
    const out: string[] = []
    for (const fix of [false, true]) {
      for (const main of ['attack', 'hoard', 'balance'] as const) {
        const per = Array.from({ length: 7 }, () => ({ n: 0, cards: 0, weak: 0, five: 0, cats: {} as Record<string, number> }))
        let wins = 0
        let split = 0
        let picks = 0
        for (let i = 0; i < N; i++) {
          const seed = 50_000 + i
          const rng = mulberry32(seed)
          const st = CAMPAIGN[Math.floor(rng() * CAMPAIGN.length)]
          const rt: BossRuntime = { profile: st.profile, main, execution: 0.75 }
          let g = createGame(seed, rng() < 0.5 ? 'p1' : 'p2')
          for (let s = 0; s < 500 && g.phase !== 'ended'; s++) {
            if (g.phase === 'pick') {
              const me = g.turn
              PICK_TUNE.fix1103 = fix
              const ids = me === 'p2' ? bossPick(g, me, rt, rng) : aiPick(g, me)
              if (me === 'p2') {
                const pile = g.hands[me].filter((c) => ids.includes(c.id))
                const v = evaluate(pile)
                const p = per[Math.min(6, g.placementsDone[me])]
                p.n++
                p.cards += pile.length
                if (v.category === CATEGORY.HIGH_CARD || (v.category === CATEGORY.PAIR && (v.rankSeq[0] ?? 0) <= 6)) p.weak++
                if (v.category === CATEGORY.STRAIGHT || v.category === CATEGORY.FLUSH) p.five++
                const k = ['散', '對', '兩對', '三條', '順', '花', '葫', '鐵', '同花順'][v.category] ?? '空'
                p.cats[k] = (p.cats[k] ?? 0) + 1
                // 拆三條:手上 3 張同點、只出 2 張
                const cnt = new Map<number, number>()
                for (const c of g.hands[me]) if (!c.kind) cnt.set(c.rank, (cnt.get(c.rank) ?? 0) + 1)
                const inP = new Map<number, number>()
                for (const c of pile) if (!c.kind) inP.set(c.rank, (inP.get(c.rank) ?? 0) + 1)
                picks++
                if ([...inP].some(([r, n]) => n === 2 && cnt.get(r) === 3)) split++
              }
              g = applyPick(g, me, ids)
            } else if (g.phase === 'place') {
              const placer = otherPlayer(g.pendingPick!.by)
              g = applyPlace(g, placer, placer === 'p2' ? bossPlace(g, placer, rt, rng) : aiPlace(g, placer))
            } else if (g.phase === 'showdown') g = resolveShowdown(g)
            else if (g.phase === 'draw') g = applyDraw(g)
          }
          if (g.winner === 'p2') wins++
        }
        PICK_TUNE.fix1103 = true
        out.push(`\n### ${fix ? '修正後' : '修正前'} · ${ZH[main]} · 打基本 AI 勝率 ${pct(wins / N)} · 拆三條 ${pct(split / picks)}`)
        out.push('| 第幾手 | 平均出幾張 | 散牌或≤6 弱對 | 順 / 花 | 牌型分布 |', '|---|---|---|---|---|')
        per.forEach((p, k) => {
          if (!p.n) return
          const cats = Object.entries(p.cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${c}${Math.round((v / p.n) * 100)}`).join(' ')
          out.push(`| ${k + 1} | ${(p.cards / p.n).toFixed(2)} | ${pct(p.weak / p.n)} | ${pct(p.five / p.n)} | ${cats} |`)
        })
      }
    }
    console.log(out.join('\n'))
  }, 1_800_000)

  it('火力全開:電腦(修正前 / 後)vs 玩家模型(修正前)', async () => {
    const { fireChooseSpecial, fireLearn, fireLoadout } = await import('./fireAI')
    const { limitedPick, limitedPlace } = await import('./limitedAI')
    const { applySpecial } = await import('./state')
    const { getSpecialCard } = await import('./specialCards')
    const lines = ['| 電腦 | 勝率 | 每場花色卡 | 前 3 手出順 / 花 | 每場順 / 花 | 第 6 手後散牌或弱對 |', '|---|---|---|---|---|---|']
    for (const fix of [false, true]) {
      for (const main of [null, 'attack', 'hoard', 'balance'] as const) {
        let wins = 0
        let suit = 0
        let earlyFive = 0
        let early = 0
        let five = 0
        let late = 0
        let lateWeak = 0
        for (let i = 0; i < N; i++) {
          const r = mulberry32(7_000_000 + i)
          const mk = (m: PickMain | null, exec: number) => {
            const st = CAMPAIGN[Math.floor(r() * CAMPAIGN.length)]
            const rt: BossRuntime = { profile: st.profile, main: m ?? rollMain(st.profile, r), execution: exec }
            return { rt, loadout: fireLoadout(rt.main, r) }
          }
          const sides = { p2: mk(main, [0.6, 0.75, 0.9][i % 3]), p1: mk(null, 1) }
          const rng = mulberry32(8_000_000 + i)
          let g = createGame(8_000_000 + i, rng() < 0.5 ? 'p1' : 'p2', 'p2', 'fire')
          for (let s = 0; s < 600 && g.phase !== 'ended'; s++) {
            if (g.phase === 'pick') {
              const me = g.turn
              PICK_TUNE.fix1103 = me === 'p2' ? fix : false
              const side = sides[me]
              let forced: string[] | undefined
              const d = fireChooseSpecial(g, me, side.loadout, side.rt, rng)
              if (d) {
                const next = applySpecial(g, me, d.card, { targetId: d.targetId, targetIds: d.targetIds, rng })
                if (next !== g) {
                  side.rt = fireLearn(side.rt, d.card, next, me)
                  if (me === 'p2' && getSpecialCard(d.card)?.suit) suit++
                  g = next
                  forced = d.thenPick
                }
              }
              const ids = forced ?? limitedPick(g, me, side.rt, rng)
              if (me === 'p2') {
                const v = evaluate(g.hands[me].filter((c) => ids.includes(c.id)))
                const isFive = v.category === CATEGORY.STRAIGHT || v.category === CATEGORY.FLUSH
                const h = g.placementsDone[me]
                if (isFive) five++
                if (h < 3) {
                  early++
                  if (isFive) earlyFive++
                }
                if (h >= 5) {
                  late++
                  if (v.category <= CATEGORY.HIGH_CARD || (v.category === CATEGORY.PAIR && (v.rankSeq[0] ?? 0) <= 6)) lateWeak++
                }
              }
              g = applyPick(g, me, ids)
            } else if (g.phase === 'place') {
              const placer = otherPlayer(g.pendingPick!.by)
              PICK_TUNE.fix1103 = placer === 'p2' ? fix : false
              g = applyPlace(g, placer, limitedPlace(g, placer, sides[placer].rt, rng))
            } else if (g.phase === 'showdown') g = resolveShowdown(g)
            else if (g.phase === 'draw') g = applyDraw(g)
          }
          PICK_TUNE.fix1103 = true
          if (g.winner === 'p2') wins++
        }
        const name = `${fix ? '修正後' : '修正前'} ${main ? ZH[main] : '隨機打法'}`
        lines.push(`| ${name} | ${pct(wins / N)} | ${(suit / N).toFixed(2)} | ${pct(earlyFive / Math.max(1, early))} | ${(five / N).toFixed(2)} | ${pct(lateWeak / Math.max(1, late))} |`)
      }
    }
    console.log('\n' + lines.join('\n'))
  }, 1_800_000)
})
