import { it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildFrames } from './replay'
import type { Card } from './cards'
import { hs, pileName, seekReplay } from './botReport'
import { bossPick, bossPlace, type BossRuntime, type PickMain } from './bossAI'
import { limitedPick, limitedPlace } from './limitedAI'
import { CAMPAIGN } from './campaign'
import { mulberry32 } from './rng'
import { otherPlayer, peekNextDraw, SLOT_COUNT, type GameState, type PlayerId } from './state'
import { SPECIAL_CARDS, type SpecialCardId } from './specialCards'

/**
 * 人機回報工具(.claude/skills/bot-report)。平常整套測試跑到這裡直接略過(沒給環境變數)。
 *
 *   先抓回放:powershell -File scripts/fetch-replays.ps1 -Name 鼓山金城武   → _replays/latest.json
 *   列場次:  $env:BR_LIST='1'; npx vitest run botReport
 *   情境卡:  $env:BR_CASE='a1b2c3:辛棄疾:2;a1b2c3:辛棄疾:3:放'; npx vitest run botReport
 *            = 那場(id 片段)、誰(名字或 p1/p2)、他的第幾手(出牌;加「:放」= 他的第幾次放牌)
 *   打法推測:$env:BR_STYLE='a1b2c3'; npx vitest run botReport(舊回放沒存 brain 時,從每手出牌反推)
 *   BR_FILE 換回放檔(預設 _replays/latest.json)、BR_N 抽樣次數(預設 400)。
 */

type Rec = any
const MAINS: PickMain[] = ['attack', 'hoard', 'balance']
const MAIN_ZH: Record<PickMain, string> = { attack: '強攻', hoard: '囤牌', balance: '平衡' }

const cardZh = (id: string) => SPECIAL_CARDS[id as SpecialCardId]?.name ?? id
const twTime = (t: number) => (t ? new Date(t).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hourCycle: 'h23' }) : '?')

function load(): Record<string, Rec> {
  return JSON.parse(readFileSync(process.env.BR_FILE || '_replays/latest.json', 'utf8'))
}

function findRec(all: Record<string, Rec>, frag: string): [string, Rec] {
  const hits = Object.entries(all).filter(([k]) => k.includes(frag))
  if (hits.length !== 1) throw new Error(`場次 id「${frag}」對到 ${hits.length} 場,請給更長的片段`)
  return hits[0]
}

function whoOf(r: Rec, who: string): PlayerId {
  if (who === 'p1' || who === 'p2') return who
  if (r.p1.name === who) return 'p1'
  if (r.p2.name === who) return 'p2'
  const p = (['p1', 'p2'] as PlayerId[]).find((k) => r[k].name.includes(who))
  if (!p) throw new Error(`這場沒有「${who}」(${r.p1.name} vs ${r.p2.name})`)
  return p
}

/** brain 字串("hoard 0.75 s3 卡:peek,suitClub")→ 打法 / 執行力 / 技能參數 / 帶的卡。舊回放沒有 → null。 */
function parseBrain(r: Rec, p: PlayerId) {
  const raw: string | undefined = r[p].brain
  const stageByName = CAMPAIGN.find((s) => s.bossName === r[p].name)
  if (!raw) return { main: null as PickMain | null, execution: null as number | null, stage: stageByName ?? null, cards: [] as string[], raw: '' }
  const [head, cardPart] = raw.split(' 卡:')
  const [main, exec, sid] = head.split(' ')
  const stage = CAMPAIGN.find((s) => s.id === sid) ?? stageByName ?? null
  return { main: main as PickMain, execution: Number(exec), stage, cards: cardPart ? cardPart.split(',') : [], raw }
}

function boardLines(s: GameState, me: PlayerId, seenFoe: boolean): string[] {
  const foe = otherPlayer(me)
  const out: string[] = []
  for (let i = 0; i < SLOT_COUNT; i++) {
    const sl = s.slots[i]
    const mine = sl[me]
    const theirs = sl[foe]
    const owner = sl.owner === me ? '★我的幣' : sl.owner === foe ? '☆對手的幣' : sl.owner ? '平手' : ''
    const exposedFoe = s.exposed?.[foe]?.includes(i)
    const foeShow = theirs.length ? `${theirs.length} 張 ${seenFoe || exposedFoe ? pileName(theirs) : `[蓋著:${pileName(theirs)}]`}` : '—'
    const tag = !sl.owner && theirs.length && !mine.length ? '  ← 對手等著對決' : !sl.owner && mine.length && !theirs.length ? '  ← 我等著對決' : ''
    out.push(`  第${i + 1}格 ${owner.padEnd(5)} 我:${mine.length ? `${mine.length} 張 ${pileName(mine)}` : '—'} | 對手:${foeShow}${tag}`)
  }
  return out
}

function runtimes(b: ReturnType<typeof parseBrain>, main: PickMain, exec: number, k: number, extra: Partial<BossRuntime>): BossRuntime {
  const profile = (b.stage ?? CAMPAIGN[k % CAMPAIGN.length]).profile
  return { profile, main, execution: exec, ...extra }
}

function tally(n: number, f: (k: number) => string): [string, number][] {
  const m = new Map<string, number>()
  for (let k = 0; k < n; k++) {
    const key = f(k)
    m.set(key, (m.get(key) ?? 0) + 1)
  }
  return [...m].sort((a, b) => b[1] - a[1])
}

const pct = (rows: [string, number][], n: number, mark: string, top = 6) =>
  rows.slice(0, top).map(([k, v]) => `${k} ${Math.round((v / n) * 100)}%${k === mark ? ' ←實際' : ''}`).join(' | ')

function situation(all: Record<string, Rec>, spec: string) {
  const [frag, who, nS, kind] = spec.split(':')
  const [id, r] = findRec(all, frag)
  const me = whoOf(r, who)
  const foe = otherPlayer(me)
  const place = kind === '放'
  const n = Number(nS)
  const b = parseBrain(r, me)
  const { before: s, after, spy, spyHand, peek, used, log } = seekReplay(r, me, n, place, { p1: r.p1.name, p2: r.p2.name })
  const coins = (p: PlayerId) => s.slots.filter((sl) => sl.owner === p).length
  const N = Number(process.env.BR_N || 400)

  console.log(`\n================ 情境卡 ${id.slice(-6)} ================`)
  console.log(`${r.p1.name} vs ${r.p2.name}  ${twTime(r.endedAt)}  ${r.mode ? `限定房:${r.mode}` : r.special ? '特殊房' : '一般房'}  ${r.matchType}  勝:${r[r.winner].name}`)
  console.log(`看的人:${r[me].name}${r[me].isBot ? '(人機)' : '(真人 → 下面的分布 = 人機在這個位置會怎麼做)'} 的第 ${n} ${place ? '次放牌' : '手出牌'}  ※以下「我」= ${r[me].name}、「對手」= ${r[foe].name}`)
  if (r[me].isBot) {
    console.log(`  大腦:${b.raw || '(舊回放沒存 → 用 BR_STYLE 推測)'}${b.main ? `  = ${MAIN_ZH[b.main]} 執行力 ${b.execution}` : ''}${b.stage ? `  技能參數=${b.stage.bossName}` : ''}${b.cards.length ? `  帶卡:${b.cards.map(cardZh).join('、')}` : ''}`)
  }
  console.log(`比分:我 ${coins(me)} 幣 / 對手 ${coins(foe)} 幣   出牌數:我 ${s.placementsDone[me]} / 對手 ${s.placementsDone[foe]}   牌堆剩 ${s.deck.length}`)
  console.log(`特殊卡用過:${used.length ? used.map((u) => `${r[u.by].name}=${cardZh(u.card)}`).join('、') : '無'}${spy ? '  (我看過對手手牌)' : ''}${peek ? `  (我偷窺到下次補:${hs(peek)})` : ''}`)
  console.log(`我手牌(${s.hands[me].length}):${hs(s.hands[me])}`)
  console.log(`對手手牌(${s.hands[foe].length}):${hs(s.hands[foe])}${spy ? '' : '  (人機看不到)'}`)
  console.log('棋盤(我的視角):')
  for (const l of boardLines(s, me, spy)) console.log(l)
  console.log(`前面幾步:${log.slice(-6).join(' → ') || '(開局)'}`)

  const extra: Partial<BossRuntime> = { spySeen: spy, spyHand, peekDraw: peek }
  if (!place) {
    const actual = after.pendingPick!.cards
    const actualKey = pileName(actual)
    console.log(`\n實際出:${actualKey}`)
    const pickOf = (rt: BossRuntime, k: number) => {
      const rng = mulberry32(k * 7919 + 13)
      const ids = s.mode ? limitedPick(s, me, rt, rng) : bossPick(s, me, rt, rng)
      return pileName(s.hands[me].filter((c) => ids.includes(c.id)))
    }
    if (b.main && b.execution != null) {
      console.log(`照它的大腦(${MAIN_ZH[b.main]} ${b.execution})重跑 ${N} 次:${pct(tally(N, (k) => pickOf(runtimes(b, b.main!, b.execution!, k, extra), k)), N, actualKey)}`)
    }
    for (const m of MAINS) console.log(`  ${MAIN_ZH[m]} 執行力 1(想清楚): ${pct(tally(N, (k) => pickOf(runtimes(b, m, 1, k, extra), k)), N, actualKey, 4)}`)
    console.log(`  失手(執行力 0):${pct(tally(N, (k) => pickOf(runtimes(b, b.main ?? 'balance', 0, k, extra), k)), N, actualKey, 3)}`)
  } else {
    const pile = s.pendingPick!.cards
    const actualSlot = after.slots.findIndex((sl, i) => sl[foe].length !== s.slots[i][foe].length)
    console.log(`\n要放的是對手出的:${pile.length} 張 [${pileName(pile)}](人機只看得到張數)  實際放:第 ${actualSlot + 1} 格`)
    const placeOf = (rt: BossRuntime, k: number) => {
      const rng = mulberry32(k * 7919 + 17)
      return `第${(s.mode ? limitedPlace(s, me, rt, rng) : bossPlace(s, me, rt, rng)) + 1}格`
    }
    const mark = `第${actualSlot + 1}格`
    if (b.main && b.execution != null) {
      console.log(`照它的大腦重跑 ${N} 次:${pct(tally(N, (k) => placeOf(runtimes(b, b.main!, b.execution!, k, extra), k)), N, mark)}`)
    }
    for (const m of MAINS) console.log(`  ${MAIN_ZH[m]} 執行力 1: ${pct(tally(N, (k) => placeOf(runtimes(b, m, 1, k, extra), k)), N, mark, 4)}`)
  }
}

it('人機回報:列場次 / 情境卡 / 打法推測', () => {
  const list = process.env.BR_LIST
  const cases = process.env.BR_CASE
  const style = process.env.BR_STYLE
  if (!list && !cases && !style) return
  const all = load()

  if (list) {
    const rows = Object.entries(all).sort((a, b) => (b[1].endedAt ?? 0) - (a[1].endedAt ?? 0))
    for (const [id, r] of rows) {
      const bot = (['p1', 'p2'] as PlayerId[]).filter((p) => r[p].isBot).map((p) => `${r[p].name}=${r[p].brain ?? '?'}`)
      console.log(`${id.slice(-6)}  ${twTime(r.endedAt)}  ${r.p1.name} vs ${r.p2.name}  ${r.mode ?? (r.special ? '特殊' : '一般')}/${r.matchType}  勝:${r[r.winner].name}${r.abandoned ? '(中離)' : ''}  ${bot.join(' ')}`)
    }
  }

  for (const spec of (cases ?? '').split(';').filter(Boolean)) situation(all, spec.trim())

  for (const frag of (style ?? '').split(',').filter(Boolean)) {
    const [id, r] = findRec(all, frag)
    const bot: PlayerId = r.p2.isBot ? 'p2' : 'p1'
    const b = parseBrain(r, bot)
    const frames = buildFrames({ seed: r.seed, firstPicker: r.firstPicker, mode: r.mode, moves: r.moves })
    const logL: Record<PickMain, number> = { attack: 0, hoard: 0, balance: 0 }
    let prev = frames[0].state
    let spy = false
    let peek: Card[] | null = null
    const NS = 150
    let picks = 0
    let same = 0 // 現在的程式重現得出來的手數(程式改過後舊回放會對不上 → 推測不準)
    for (const f of frames) {
      const fx = f.cardFx
      if (fx && fx.by === bot && fx.kind === 'spy') spy = true
      if (fx && fx.by === bot && fx.kind === 'peek') peek = peekNextDraw(prev, bot)
      if (/^出 /.test(f.action) && f.state.pendingPick!.by === bot) {
        const want = f.state.pendingPick!.cards.map((c) => c.id).sort().join()
        picks++
        let any = false
        for (const m of MAINS) {
          let hit = 0
          for (let k = 0; k < NS; k++) {
            const rt = runtimes(b, m, [0.6, 0.75, 0.9][k % 3], k, { spySeen: spy, spyHand: spy ? prev.hands[otherPlayer(bot)] : null, peekDraw: peek })
            const rng = mulberry32(k * 7919 + 1)
            const ids = prev.mode ? limitedPick(prev, bot, rt, rng) : bossPick(prev, bot, rt, rng)
            if (ids.sort().join() === want) hit++
          }
          logL[m] += Math.log((hit + 0.5) / (NS + 1))
          if (hit) any = true
        }
        if (any) same++
        peek = null
      }
      prev = f.state
    }
    const mx = Math.max(...Object.values(logL))
    const z = Object.values(logL).reduce((s, v) => s + Math.exp(v - mx), 0)
    console.log(`\n${id.slice(-6)} ${r.p1.name} vs ${r.p2.name} 人機=${r[bot].name} 打法推測:${MAINS.map((m) => `${MAIN_ZH[m]} ${Math.round((Math.exp(logL[m] - mx) / z) * 100)}%`).join(' / ')}  (現在的程式重現得出 ${same}/${picks} 手${same < picks / 2 ? ' → 程式改過,這場推不準' : ''})`)
  }
})
