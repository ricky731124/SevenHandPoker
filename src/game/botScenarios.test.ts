import { describe, expect, it } from 'vitest'
import data from './botScenarios.json'
import { pileMatches, pileName, seekReplay, type ReplayLike } from './botReport'
import { bossPick, bossPlace, type BossRuntime, type PickMain } from './bossAI'
import { limitedPick, limitedPlace } from './limitedAI'
import { CAMPAIGN } from './campaign'
import { mulberry32 } from './rng'
import type { PlayerId } from './state'
import type { Card } from './cards'

/**
 * 人機情境題庫(.claude/skills/bot-report、docs/BOT-DECISIONS.md)。
 * 每題 = 使用者從回放挑出的一手 + 期望。答案是機率範圍,不是唯一解;每次改人機都重跑全部舊題,
 * 防止「修了這題、壞了上次那題」。
 *
 * 嚴重度 → 預設門檻(expect 裡可以覆蓋):
 *  - 不行:想清楚(執行力 1)時 avoid 0%;失手也算(執行力 0.6)時 avoid ≤ 3% —— 可以換做法,不能做蠢事。
 *  - 不划算:執行力 1 時 avoid ≤ 15%(每種打法分開算)。
 *  - 偏好(可以,但我不會這樣出):執行力 1 時 prefer ≥ 30%(三種打法合計)。
 * prefer 有寫時一律檢查(預設 不行 50% / 不划算 40% / 偏好 30%)。
 * 抽樣數 SCEN_N(預設 30,調參時用 200)。
 */

type Severity = '不行' | '不划算' | '偏好'
interface Scenario {
  id: string
  title: string
  who: PlayerId
  kind: '出' | '放'
  hand: number
  severity: Severity
  styles?: PickMain[]
  stage?: string
  expect: { avoid?: string[]; prefer?: string[]; avoidMax?: number; preferMin?: number }
  reason: string
  replay: ReplayLike
}

const N = Number(process.env.SCEN_N || 30)
const MAINS: PickMain[] = ['attack', 'hoard', 'balance']
const DEFAULTS: Record<Severity, { avoidMax: number; preferMin: number }> = {
  不行: { avoidMax: 0, preferMin: 0.5 },
  不划算: { avoidMax: 0.15, preferMin: 0.4 },
  偏好: { avoidMax: 1, preferMin: 0.3 },
}

/** 這題在某打法 / 執行力下抽 N 次:每次結果 → [這疊牌(放牌題 = 空), 放的格子]。 */
function sample(sc: Scenario, main: PickMain, execution: number) {
  const seeked = seekReplay(sc.replay, sc.who, sc.hand, sc.kind === '放')
  const s = seeked.before
  const stage = CAMPAIGN.find((x) => x.id === sc.stage)
  const out: { pile: Card[]; slot?: number }[] = []
  for (let k = 0; k < N; k++) {
    const rt: BossRuntime = {
      profile: (stage ?? CAMPAIGN[k % CAMPAIGN.length]).profile,
      main,
      execution,
      spySeen: seeked.spy,
      spyHand: seeked.spyHand,
      peekDraw: seeked.peek,
    }
    const rng = mulberry32(k * 7919 + 101)
    if (sc.kind === '放') {
      out.push({ pile: [], slot: s.mode ? limitedPlace(s, sc.who, rt, rng) : bossPlace(s, sc.who, rt, rng) })
    } else {
      const ids = s.mode ? limitedPick(s, sc.who, rt, rng) : bossPick(s, sc.who, rt, rng)
      out.push({ pile: s.hands[sc.who].filter((c) => ids.includes(c.id)) })
    }
  }
  return out
}

const rate = (rows: ReturnType<typeof sample>, descs: string[]) =>
  rows.filter((r) => descs.some((d) => pileMatches(r.pile, d, r.slot))).length / rows.length

const show = (rows: ReturnType<typeof sample>) => {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = r.slot != null ? `第${r.slot + 1}格` : pileName(r.pile)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((v / rows.length) * 100)}%`).join(' | ')
}

describe('人機情境題庫', () => {
  for (const sc of (data as { scenarios: Scenario[] }).scenarios) {
    it(`${sc.id} [${sc.severity}] ${sc.title}`, () => {
      const d = { ...DEFAULTS[sc.severity], ...sc.expect }
      const styles = sc.styles ?? MAINS
      const sharp = styles.map((m) => ({ m, rows: sample(sc, m, 1) }))
      for (const { m, rows } of sharp) {
        if (sc.expect.avoid) expect(rate(rows, sc.expect.avoid), `${m} 執行力 1:${show(rows)}`).toBeLessThanOrEqual(d.avoidMax)
      }
      if (sc.severity === '不行' && sc.expect.avoid) {
        for (const m of styles) {
          const rows = sample(sc, m, 0.6)
          expect(rate(rows, sc.expect.avoid), `${m} 執行力 0.6(含失手):${show(rows)}`).toBeLessThanOrEqual(Math.max(d.avoidMax, 0.03))
        }
      }
      if (sc.expect.prefer) {
        const all = sharp.flatMap((x) => x.rows)
        expect(rate(all, sc.expect.prefer), `prefer 合計:${show(all)}`).toBeGreaterThanOrEqual(d.preferMin)
      }
    })
  }
})
