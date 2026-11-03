// 把一手回放加進人機情境題庫(src/game/botScenarios.json)。人機回報 skill 用。
//   node scripts/add-scenario.mjs spec.json
// spec.json(UTF-8):
//   { "replay": "tApWhr",            ← 場次 id 片段(從 _replays/latest.json 找,先跑 scripts/fetch-replays.ps1)
//     "who": "今天辛棄疾",            ← 名字或 p1 / p2
//     "kind": "出", "hand": 1,        ← 他的第幾手出牌(「放」= 第幾次放牌)
//     "severity": "不行",             ← 不行 / 不划算 / 偏好
//     "title": "…", "reason": "…",
//     "expect": { "avoid": ["10 10"], "prefer": ["A A"] },   ← 寫法見 src/game/botReport.ts pileMatches
//     "styles": ["hoard"], "stage": "s3" }                   ← 選填:只考某些打法 / 指定技能參數
import { readFileSync, writeFileSync } from 'node:fs'

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''))
const all = JSON.parse(readFileSync(process.env.BR_FILE || '_replays/latest.json', 'utf8'))
const hits = Object.entries(all).filter(([k]) => k.includes(spec.replay))
if (hits.length !== 1) throw new Error(`場次「${spec.replay}」對到 ${hits.length} 場`)
const [id, r] = hits[0]
const who = spec.who === 'p1' || spec.who === 'p2' ? spec.who : r.p1.name.includes(spec.who) ? 'p1' : r.p2.name.includes(spec.who) ? 'p2' : null
if (!who) throw new Error(`這場沒有「${spec.who}」`)

const file = 'src/game/botScenarios.json'
const bank = JSON.parse(readFileSync(file, 'utf8'))
const next = `S${String(bank.scenarios.length + 1).padStart(3, '0')}`
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
bank.scenarios.push({
  id: next,
  date: today,
  from: `${r.p1.name} vs ${r.p2.name} ${id}`,
  title: spec.title,
  who,
  kind: spec.kind ?? '出',
  hand: spec.hand,
  severity: spec.severity,
  ...(spec.styles ? { styles: spec.styles } : {}),
  ...(spec.stage ? { stage: spec.stage } : {}),
  expect: spec.expect,
  reason: spec.reason,
  replay: { seed: r.seed, firstPicker: r.firstPicker, ...(r.mode ? { mode: r.mode } : {}), moves: r.moves },
})
writeFileSync(file, JSON.stringify(bank, null, 1) + '\n')
console.log(`加入 ${next}:${spec.title}`)
