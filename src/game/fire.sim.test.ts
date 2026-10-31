/**
 * 火力全開模擬(LIMITED-ROOM-SPEC §11.7)。平常略過;要跑:FIRE=1 npx vitest run src/game/fire.sim.test.ts
 * (SIM_N=600 改場數;ROW=正規式 只跑名稱符合的列)。
 *
 * 玩家模型 = 隨機主線 boss 個性、打法隨機、執行力 1(每手都照最佳判斷)、照打法帶 5 張、用卡跟電腦同一套。
 * 電腦 = 指定打法 × 執行力;快配線上 = 打法隨機 + 執行力 0.6/0.75/0.9 隨機;對戰電腦 = 限定房預設個性 0.75。
 * 雙方放牌都是一般房 boss 放牌(看破 0,火力全開看不到推牌位置)。先手隨機。
 */
import { describe, it } from 'vitest'
import { rollMain, type BossRuntime, type PickMain } from './bossAI'
import { CAMPAIGN } from './campaign'
import { evaluate, CATEGORY } from './evaluate'
import { FIRE_TUNE, fireChooseSpecial, fireLearn, fireLoadout, type FireTune } from './fireAI'
import { defaultLimitedBrain, limitedPick, limitedPlace } from './limitedAI'
import { mulberry32 } from './rng'
import { getSpecialCard, type SpecialCardId } from './specialCards'
import { applyDraw, applyPick, applyPlace, applySpecial, createGame, otherPlayer, resolveShowdown, type GameState, type PlayerId } from './state'

const N = Number(process.env.SIM_N ?? 400)
const ROW = process.env.ROW ? new RegExp(process.env.ROW) : null
const TUNE: FireTune = process.env.FIRE_EXP ? { ...FIRE_TUNE, ...JSON.parse(process.env.FIRE_EXP) } : FIRE_TUNE

type Rng = () => number
interface Side {
  rt: BossRuntime
  loadout: SpecialCardId[]
  cards: boolean
}
interface Stats {
  games: number
  wins: number
  uses: number[] // 電腦每場用幾張(0~3)
  card: Record<string, { carried: number; used: number }>
  byHand: number[] // 第幾手用的
  suitUses: number
  suitFlush: number
  twoInTurn: number
  overUse: number
  doneBy5: number // 自己第 5 手(含)前用完 3 張的場數
  early3: number // 前三手就用完 3 張(不該發生)
  leftWhenLost: number // 輸的場、卡還沒用完
  lost: number
}
const newStats = (): Stats => ({ games: 0, wins: 0, uses: [0, 0, 0, 0], card: {}, byHand: Array(8).fill(0), suitUses: 0, suitFlush: 0, twoInTurn: 0, overUse: 0, doneBy5: 0, early3: 0, leftWhenLost: 0, lost: 0 })

function randomProfileRt(rng: Rng, main: PickMain | null, execution: number): BossRuntime {
  const stage = CAMPAIGN[Math.floor(rng() * CAMPAIGN.length)]
  return { profile: stage.profile, main: main ?? rollMain(stage.profile, rng), execution }
}

function play(seed: number, ai: Side, player: Side, st: Stats, tune: FireTune): void {
  const rng = mulberry32(seed)
  const AI: PlayerId = 'p2'
  const sides: Record<PlayerId, Side> = { p1: { ...player, rt: { ...player.rt } }, p2: { ...ai, rt: { ...ai.rt } } }
  let g: GameState = createGame(seed, rng() < 0.5 ? 'p1' : 'p2', 'p2', 'fire')
  for (const id of ai.loadout) (st.card[id] ??= { carried: 0, used: 0 }).carried++
  let aiUses = 0
  let doneAt = -1
  for (let step = 0; step < 600 && g.phase !== 'ended'; step++) {
    if (g.phase === 'pick') {
      const me = g.turn
      const side = sides[me]
      let forced: string[] | undefined
      if (side.cards) {
        const d = fireChooseSpecial(g, me, side.loadout, side.rt, rng, tune)
        if (d) {
          const next = applySpecial(g, me, d.card, { targetId: d.targetId, rng })
          if (next !== g) {
            side.rt = fireLearn(side.rt, d.card, next, me)
            if (me === AI) {
              aiUses++
              if (aiUses === 3) doneAt = g.placementsDone[me]
              st.card[d.card].used++
              st.byHand[Math.min(7, g.placementsDone[me])]++
              if (getSpecialCard(d.card)?.suit) {
                st.suitUses++
                const cards = next.hands[me].filter((c) => d.thenPick?.includes(c.id))
                const cat = evaluate(cards).category
                if (cat === CATEGORY.FLUSH || cat === CATEGORY.STRAIGHT_FLUSH) st.suitFlush++
              }
              // 同一回合再問一次:一定要回 null
              if (fireChooseSpecial(next, me, side.loadout, side.rt, rng, tune)) st.twoInTurn++
            }
            g = next
            forced = d.thenPick
          }
        }
      }
      g = applyPick(g, me, forced ?? limitedPick(g, me, side.rt, rng))
    } else if (g.phase === 'place') {
      const placer = otherPlayer(g.pendingPick!.by)
      g = applyPlace(g, placer, limitedPlace(g, placer, sides[placer].rt, rng))
    } else if (g.phase === 'showdown') g = resolveShowdown(g)
    else if (g.phase === 'draw') g = applyDraw(g)
  }
  if (aiUses > 3) st.overUse++
  if (doneAt >= 0 && doneAt <= 4) st.doneBy5++
  if (doneAt >= 0 && doneAt <= 2) st.early3++
  if (g.winner !== AI) {
    st.lost++
    if (aiUses < 3) st.leftWhenLost++
  }
  st.games++
  st.uses[Math.min(3, aiUses)]++
  if (g.winner === AI) st.wins++
}

const pct = (x: number) => `${Math.round(x * 100)}%`

function row(name: string, mk: (rng: Rng) => { ai: Side; player: Side }, tune = TUNE): string | null {
  if (ROW && !ROW.test(name)) return null
  const st = newStats()
  for (let i = 0; i < N; i++) {
    const seed = 7_000_000 + i
    const { ai, player } = mk(mulberry32(seed ^ 0x9e3779b9))
    play(seed, ai, player, st, tune)
  }
  const avg = (st.uses[1] + 2 * st.uses[2] + 3 * st.uses[3]) / st.games
  const perCard = Object.entries(st.card)
    .sort((a, b) => b[1].used / Math.max(1, b[1].carried) - a[1].used / Math.max(1, a[1].carried))
    .map(([id, c]) => `${getSpecialCard(id)?.name}${pct(c.used / Math.max(1, c.carried))}`)
    .join(' ')
  const hands = st.byHand.map((n) => n).join('/')
  const bugs =
    st.twoInTurn || st.overUse || st.early3 || st.suitFlush !== st.suitUses
      ? ` ⚠️ 一回合兩張${st.twoInTurn} 超過3次${st.overUse} 前三手用完${st.early3} 花色沒出同花${st.suitUses - st.suitFlush}`
      : ''
  return `| ${name} | ${pct(st.wins / st.games)} | ${avg.toFixed(2)} | ${st.uses.map((n) => pct(n / st.games)).join(' / ')} | ${pct(st.doneBy5 / st.games)} | ${pct(st.leftWhenLost / Math.max(1, st.lost))} | ${hands} | ${perCard}${bugs} |`
}

const STYLES: PickMain[] = ['attack', 'balance', 'hoard']
const STYLE_ZH: Record<PickMain, string> = { attack: '強攻', balance: '平衡', hoard: '囤牌' }
const EXECS = process.env.EXECS ? JSON.parse(process.env.EXECS) as number[] : [1, 0.9, 0.75, 0.6]

/** 玩家模型:隨機個性、執行力 1、照打法帶卡。 */
function playerSide(rng: Rng, cards = true): Side {
  const rt = randomProfileRt(rng, null, 1)
  return { rt, loadout: fireLoadout(rt.main, rng), cards }
}
function aiSide(rng: Rng, main: PickMain | null, exec: number, cards = true): Side {
  const rt = randomProfileRt(rng, main, exec)
  return { rt, loadout: fireLoadout(rt.main, rng), cards }
}

describe.skipIf(!process.env.FIRE)('火力全開模擬(FIRE=1 才跑)', () => {
  it(`電腦 vs 玩家模型 × ${N} 場`, () => {
    const lines = [
      `| 電腦 | 勝率 | 平均用卡 | 用 0/1/2/3 張 | 第 5 手前用完 | 輸的場沒用完 | 第 1~8 手用卡次數 | 帶了有用到的比例 |`,
      '|---|---|---|---|---|---|---|---|',
    ]
    const push = (l: string | null) => l && lines.push(l)
    for (const s of STYLES) for (const e of EXECS) push(row(`${STYLE_ZH[s]} ${e}`, (rng) => ({ ai: aiSide(rng, s, e), player: playerSide(rng) })))
    push(
      row('快配線上(打法隨機、0.6/0.75/0.9)', (rng) => ({
        ai: aiSide(rng, null, [0.6, 0.75, 0.9][Math.floor(rng() * 3)]),
        player: playerSide(rng),
      })),
    )
    push(
      row('對戰電腦(預設個性 0.75)', (rng) => {
        const main = STYLES[Math.floor(rng() * 3)]
        const rt = { ...defaultLimitedBrain('fire'), main }
        return { ai: { rt, loadout: fireLoadout(main, rng), cards: true }, player: playerSide(rng) }
      }),
    )
    // 參考:特殊卡的影響
    for (const e of [1, 0.5, 0]) push(row(`參考:雙方都不用卡(電腦 ${e})`, (rng) => ({ ai: aiSide(rng, null, e, false), player: playerSide(rng, false) })))
    push(row('參考:只有電腦用卡(電腦 1)', (rng) => ({ ai: aiSide(rng, null, 1), player: playerSide(rng, false) })))
    push(row('參考:只有玩家用卡(電腦 1)', (rng) => ({ ai: aiSide(rng, null, 1, false), player: playerSide(rng) })))
    for (const a of STYLES)
      for (const b of STYLES)
        if (a !== b) push(row(`打法互打:${STYLE_ZH[a]} vs ${STYLE_ZH[b]}(都 0.75)`, (rng) => ({ ai: aiSide(rng, a, 0.75), player: { ...aiSide(rng, b, 0.75) } })))
    console.log('\n' + lines.join('\n'))
  }, 3_600_000)
})
