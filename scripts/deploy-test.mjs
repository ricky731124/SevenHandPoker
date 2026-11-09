// 推一版到測試站(不影響正式站):https://ricky731124.github.io/SevenHandPoker-test/
//
//   node scripts/deploy-test.mjs
//
// 做的事:用目前工作目錄(含沒 commit 的改動)build 一份 base=/SevenHandPoker-test/ 到 dist-test/,
// 把 manifest 改成「測試版」(id 不同 → 加到主畫面是另一個 app,不會蓋掉正式版),
// 再把 dist-test/ 整包強制推到 ricky731124/SevenHandPoker-test 的 main(那個 repo 只放 build 結果)。
// 測試站跟正式站同網域 → Google 登入照常;連的是同一個 Firebase(帳號、鑽石、配對都是真的)。
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = '/SevenHandPoker-test/'
const OUT = path.join(ROOT, 'dist-test')
const REMOTE = 'https://github.com/ricky731124/SevenHandPoker-test.git'

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts })

run('npx tsc -b')
run(`npx vite build --outDir dist-test --emptyOutDir`, { env: { ...process.env, VITE_BASE: BASE } })

const mf = path.join(OUT, 'manifest.webmanifest')
const m = JSON.parse(fs.readFileSync(mf, 'utf8'))
m.id = BASE
m.name = 'Seven Hand Poker 測試版'
m.short_name = '七手測試'
m.related_applications = [{ platform: 'webapp', url: `https://ricky731124.github.io${BASE}manifest.webmanifest` }]
fs.writeFileSync(mf, JSON.stringify(m, null, 2))
fs.writeFileSync(path.join(OUT, '.nojekyll'), '')

const stamp = new Date().toLocaleString('zh-TW', { hour12: false })
const g = (cmd) => run(cmd, { cwd: OUT })
fs.rmSync(path.join(OUT, '.git'), { recursive: true, force: true }) // vite 清空輸出資料夾時會留著 .git
g('git init -q')
g('git checkout -q -b main') // 舊版 git(2.18)沒有 init -b
g('git config user.name ricky731124')
g('git config user.email ricky731124@users.noreply.github.com')
g('git add -A')
g(`git commit -q -m "test build ${stamp}"`)
g(`git push -f ${REMOTE} main`)
console.log(`\n已推到測試站,GitHub Pages 約 1~2 分鐘後更新:https://ricky731124.github.io${BASE}`)
