// 版面截圖 + 自動檢查(docs/MOBILE-LANDSCAPE-SPEC.md §5)。
//
//   node scripts/layout/snap.mjs shoot before            → 拍一輪,存到 _layout/before/
//   node scripts/layout/snap.mjs shoot after --quick                 → 快速檢查(7 台 × 10 個畫面,約 5 分鐘)
//   node scripts/layout/snap.mjs shoot after --only lobby,game-ai --dev ios-full   (--jobs 4 = 同時拍幾張)
//   node scripts/layout/snap.mjs sheet before            → 總覽圖(每個畫面一張,所有裝置排一起)+ index.html
//   node scripts/layout/snap.mjs compare before after    → 逐張像素比對,差異圖存 _layout/diff-before-after/
//
// 安全:截圖用的瀏覽器把 Firebase / Google 網域全部解析失敗(連 WebSocket 都連不出去),
// 不會被算進在線人數、不會當聊天主持、不會寫任何資料。登入狀態用 DEV 的 __platform 假造。
// 決定性:Math.random 固定種子、假時鐘(page.clock)、截圖前關掉 CSS 動畫。
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEVICES } from './devices.mjs'
import { SCENES, PROFILE } from './scenes.mjs'
import { pageChecks } from './checks.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(ROOT, '_layout')
const req = createRequire(path.join(ROOT, 'package.json'))
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 5190
const FIXED_TIME = new Date('2026-11-04T20:00:00+08:00').getTime()

const [cmd, ...rest] = process.argv.slice(2)
const flag = (name) => {
  const i = rest.indexOf('--' + name)
  return i >= 0 ? rest[i + 1] : null
}
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && rest[i - 1] !== '--quick'))

if (cmd === 'shoot') await shoot(positional[0] || 'snap')
else if (cmd === 'compare') await compare(positional[0], positional[1])
else if (cmd === 'sheet') await sheet(positional[0])
else if (cmd === 'rotpair') await rotpair(positional[0], positional[1], positional[2])
else {
  console.log('用法: snap.mjs shoot <label> [--only 場景,...] [--dev 裝置,...] | compare <a> <b> | sheet <label>')
  process.exit(1)
}

// ---------------------------------------------------------------- shoot
async function shoot(label) {
  const quick = rest.includes('--quick') // 快速檢查:只拍標 quick 的裝置和畫面(平常改一步就跑這個)
  const only = flag('only')?.split(',')
  const devOnly = flag('dev')?.split(',')
  const scenes = SCENES.filter((s) => (!only || only.includes(s.id)) && (!quick || s.quick))
  const devices = DEVICES.filter((d) => (!devOnly || devOnly.includes(d.id)) && (!quick || d.quick))
  const dir = path.join(OUT, label)
  fs.mkdirSync(dir, { recursive: true })

  const { createServer } = await import('file:///' + path.join(ROOT, 'node_modules/vite/dist/node/index.js').replace(/\\/g, '/'))
  const { chromium } = req('playwright-core')
  const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true, hmr: false }, logLevel: 'error' })
  await server.listen()
  // 同時開太多頁 Chrome 會當掉 → 預設 3;當掉就重開瀏覽器,那張重拍一次
  const launch = () =>
    chromium.launch({
      executablePath: CHROME,
      args: [
        '--host-resolver-rules=' +
          ['*.firebaseio.com', '*.firebasedatabase.app', '*.googleapis.com', '*.google.com', '*.gstatic.com', '*.firebaseapp.com', '*.googleusercontent.com']
            .map((h) => `MAP ${h} ~NOTFOUND`)
            .join(', '),
      ],
    })
  let browser = await launch()
  let relaunching = null
  const getBrowser = async () => {
    if (browser.isConnected()) return browser
    relaunching ??= launch().then((b) => { browser = b; relaunching = null; return b })
    return relaunching
  }

  const jobs = devices.flatMap((dev) => scenes.filter((s) => !s.only || s.only(dev)).map((scene) => ({ dev, scene })))
  // 補拍(--only/--dev 拍一部分)時,這次沒拍到的照片保留原本的檢查結果,報告才是完整的
  const redo = new Set(jobs.map((j) => `${j.dev.id}__${j.scene.id}`))
  const reportFile = path.join(dir, 'report.json')
  const kept = fs.existsSync(reportFile)
    ? JSON.parse(fs.readFileSync(reportFile, 'utf8')).filter((r) => !redo.has(r.name) && SCENES.some((s) => s.id === r.scene) && DEVICES.some((d) => d.id === r.device))
    : []
  const report = []
  const nJobs = Number(flag('jobs') ?? 3)
  console.log(`共 ${jobs.length} 張,同時拍 ${nJobs} 張`)
  try {
    let next = 0
    const worker = async () => {
      while (next < jobs.length) {
        const { dev, scene } = jobs[next++]
        const name = `${dev.id}__${scene.id}`
        let entry
        for (let attempt = 1; attempt <= 2; attempt++) {
          entry = await shootOne(await getBrowser(), dev, scene, name, dir).catch((e) => ({ name, device: dev.id, scene: scene.id, fail: String(e.message || e), errors: [] }))
          if (!entry.fail) break
          if (attempt === 1) console.log(`↻ ${name}  重拍(${entry.fail.split('\n')[0]})`)
        }
        report.push(entry)
        const n = (entry.offscreen?.length || 0) + (entry.overlaps?.length || 0) + (entry.clipped?.length || 0)
        if (entry.fail) console.log(`✗ ${name}  ${entry.fail.split('\n')[0]}`)
        else console.log(`${n ? '⚠' : '✓'} ${name}${n ? `  超出${entry.offscreen.length} 重疊${entry.overlaps.length} 被切${entry.clipped.length}` : ''}${entry.errors.length ? `  錯誤${entry.errors.length}` : ''}`)
        fs.writeFileSync(reportFile, JSON.stringify([...kept, ...report], null, 1)) // 每張都存,中途停掉也留得住
      }
    }
    await Promise.all(Array.from({ length: nJobs }, worker))
    // 同時拍會打亂順序 → 照裝置、畫面清單的順序排回來
    report.unshift(...kept)
    const order = (r) => DEVICES.findIndex((d) => d.id === r.device) * 1000 + SCENES.findIndex((s) => s.id === r.scene)
    report.sort((a, b) => order(a) - order(b))
  } finally {
    await browser.close().catch(() => {})
    await server.close()
  }
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1))
  fs.writeFileSync(path.join(dir, 'report.md'), toMarkdown(label, report))
  console.log(`\n完成:這次拍 ${jobs.length} 張,報告共 ${report.length} 張 → ${dir}`)
}

/** 拍一張:開新分頁 → 走到畫面 → 截圖 + 自動檢查。出錯就丟出去(由呼叫端決定要不要重拍)。 */
async function shootOne(browser, dev, scene, name, dir) {
  const ctx = await browser.newContext({
    viewport: dev.viewport,
    screen: dev.screen,
    isMobile: dev.mobile,
    hasTouch: dev.mobile,
    deviceScaleFactor: 1,
    userAgent: scene.ua ? scene.ua(dev) : dev.ua,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  })
  try {
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e.message || e)))
    // 進行中的請求(延遲載入的畫面、圖片)→ settle 會等它們結束
    // 卡超過 8 秒的請求(長連線、轉址沒收尾的)不再等,不然整張卡死
    const pending = new Map()
    Object.defineProperty(page, '__inflight', {
      get: () => [...pending.values()].filter((t) => Date.now() - t < 8000).length,
    })
    page.on('request', (r) => { pending.set(r, Date.now()); if (r.url().includes('/deps/framer-motion.js')) page.__framerUrl = r.url() })
    page.on('requestfinished', (r) => pending.delete(r))
    page.on('requestfailed', (r) => pending.delete(r))
    await page.addInitScript(initScript, { standalone: !!dev.standalone, ios: dev.os === 'ios', profile: scene.guest ? null : PROFILE })
    // 時鐘暫停:只有 settle 的 runFor 會讓時間前進 → 每次跑的累計時間都一樣。
    // 留 10 分鐘緩衝:同時拍好幾張時電腦忙,install 到 pauseAt 之間可能過好幾秒(頁面還沒載,不影響結果)
    await page.clock.install({ time: FIXED_TIME - 600000 })
    await page.clock.pauseAt(FIXED_TIME)
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    // LINE 的導出頁會自己換網址重載 → 等它載完再來一次(最多兩次)
    for (let tries = 0; ; tries++) {
      try {
        await skipFramer(page)
        await settle(page, 1800)
        break
      } catch (e) {
        if (tries >= 2 || !/context was destroyed|navigation/i.test(String(e.message))) throw e
        await page.waitForLoadState('load')
      }
    }
    // 加主畫面提示卡:第 2 階段會整個拿掉,留著會蓋住底下、也讓前後比對全是它 → 先按掉(a2hs 畫面除外)
    if (!scene.keepA2hs) {
      await page.evaluate(() => document.querySelector('.a2hs__close')?.click())
      await settle(page, 400)
    }
    await page.evaluate(() => window.__snapReseed())
    await scene.run(page, { dev, settle: (ms) => settle(page, ms), click: (text, o) => clickText(page, text, o), clickSel: (sel) => clickSel(page, sel) })
    await settle(page, scene.wait ?? 1200)
    await freeze(page)
    await page.screenshot({ path: path.join(dir, name + '.png'), timeout: 60000 })
    const checks = await page.evaluate(pageChecks)
    const state = await page.evaluate(() => ({
      screen: window.__app?.getState?.().screen,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 160),
    }))
    return { name, device: dev.id, scene: scene.id, state, errors: errs, ...checks }
  } finally {
    await ctx.close().catch(() => {})
  }
}

/**
 * 讓假時鐘往前走 ms(動畫/計時器跑完)。時間只照固定步數前進;等載入時用真時間、不動時鐘,
 * 所以 Vite 編譯快慢不會改變遊戲裡經過的時間。
 */
async function settle(page, ms) {
  const step = 200
  await waitIdle(page)
  for (let t = 0; t < ms; t += step) {
    await page.clock.runFor(step)
    await finishAnims(page)
    await page.waitForTimeout(20)
    if (page.__inflight > 0) await waitIdle(page)
  }
  // 最後一步觸發的延遲載入(React.lazy)載完後,再推一小段讓它真的畫出來
  await waitIdle(page)
  await page.clock.runFor(400)
  await finishAnims(page)
  await waitIdle(page)
}

/**
 * framer-motion 的動畫不歸假時鐘管 → 打開它自己的「全部跳過」開關。要拿到頁面正在用的那一份模組
 * (Vite 網址帶 ?v= 版本號),所以用頁面實際請求過的網址再 import 一次(同網址=同一份)。
 */
async function skipFramer(page) {
  if (!page.__framerUrl) throw new Error('找不到 framer-motion 模組,動畫沒辦法關')
  await page.evaluate(async (url) => {
    const m = await import(url)
    m.MotionGlobalConfig.skipAnimations = true
  }, page.__framerUrl)
}

/** 保險:還在跑的 WAAPI 動畫(framer 交給瀏覽器的 opacity/transform)直接跳到最後一格。無限循環的不動。 */
async function finishAnims(page) {
  await page
    .evaluate(() => {
      for (const a of document.getAnimations()) {
        try {
          if (a.effect?.getComputedTiming().endTime !== Infinity) a.finish()
        } catch { /* ignore */ }
      }
    })
    .catch(() => {})
}

/** 用真時間等:請求全部結束、圖片/字型載完、DOM 連續幾次不再變。時鐘不動。 */
async function waitIdle(page) {
  const until = Date.now() + 20000
  let prev = ''
  let calm = 0
  while (Date.now() < until) {
    await page.waitForTimeout(60)
    const sig = await page
      .evaluate(() => `${document.body.innerHTML.length}|${[...document.images].filter((i) => !i.complete).length}|${document.fonts?.status}`)
      .catch(() => 'x')
    calm = page.__inflight <= 0 && sig === prev && !/\|[1-9]|loading/.test(sig) ? calm + 1 : 0
    prev = sig
    if (calm >= 3) return
  }
}

/** 等文字出現再點(用固定步數推時鐘,最多 6 秒遊戲時間)。直接對元素 click(),不靠座標(假橫向是轉過的)。 */
async function clickText(page, text, { exact = true } = {}) {
  await clickLoc(page, page.getByText(text, { exact }).first())
}
async function clickSel(page, sel) {
  await clickLoc(page, page.locator(sel).first())
}
async function clickLoc(page, loc) {
  for (let i = 0; i < 30 && !(await loc.isVisible().catch(() => false)); i++) {
    await page.clock.runFor(200)
    await waitIdle(page)
  }
  await loc.evaluate((el) => (el.closest('button,[role=button]') || el).click())
}

/** 截圖前:CSS 動畫/轉場直接停在最後一格、輸入游標不閃。 */
async function freeze(page) {
  await page.addStyleTag({
    content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important;caret-color:transparent!important}',
  })
  await page.clock.runFor(100)
  await finishAnims(page)
  await page.waitForTimeout(150)
}

/** 在頁面裡跑(addInitScript):固定亂數、假登入、模擬「從主畫面開」(display-mode: standalone)。 */
function initScript({ standalone, ios, profile }) {
  // platformStore 一掛上 window.__platform 就接手:不跑 Firebase 登入監聽,直接給定登入狀態
  // (profile = null → 訪客,會看到歡迎彈窗)。
  let store
  Object.defineProperty(window, '__platform', {
    configurable: true,
    get: () => store,
    set: (v) => {
      store = v
      v.setState({
        init: () => {},
        ready: true,
        uid: profile ? 'snap_uid' : null,
        isAnonymous: false,
        username: profile ? profile.username : null,
        displayName: profile ? profile.displayName : null,
        email: null,
        profile,
      })
    },
  })
  // 固定種子。Firebase 連不上時重試的時間點跟著真時間走、也會吃亂數 → 讓它用原本的亂數,
  // 不然它多抽幾次就把遊戲的發牌序列推歪了。
  let s = 20261104
  // 場景開始前再重設一次種子:開機期間大廳聊天之類的偶發呼叫不會影響之後的發牌
  window.__snapReseed = () => { s = 20261104 }
  const realRandom = Math.random
  Math.random = () => {
    if (/firebase/.test(new Error().stack)) return realRandom()
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  try { localStorage.setItem('shp.settings', JSON.stringify({ sfx: false, music: false })) } catch { /* ignore */ }
  // CSS 動畫走真時間、不歸假時鐘管,而程式會等 animationend 才進下一步(VS 開場 → 規則彈窗)
  // → 一開機就把動畫/轉場設成 0 秒,結束事件立刻觸發,流程只跟假時鐘走。
  const noAnim = () => {
    const st = document.createElement('style')
    st.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important}'
    document.documentElement.appendChild(st)
  }
  if (document.documentElement) noAnim()
  else document.addEventListener('readystatechange', noAnim, { once: true })
  if (!standalone) return
  // Chrome 模擬不了 display-mode → 把查詢字串換掉:standalone 恆真、browser 恆假。
  const swap = (q) => q.replace(/\(\s*display-mode\s*:\s*standalone\s*\)/g, '(min-width: 0px)').replace(/\(\s*display-mode\s*:\s*browser\s*\)/g, '(max-width: 0px)')
  const mm = window.matchMedia.bind(window)
  window.matchMedia = (q) => mm(swap(q))
  if (ios) Object.defineProperty(navigator, 'standalone', { get: () => true })
  const patchSheets = () => {
    for (const sheet of document.styleSheets) {
      let rules
      try { rules = sheet.cssRules } catch { continue }
      const walk = (list) => {
        for (const r of list) {
          if (r.media && /display-mode/.test(r.media.mediaText)) {
            const next = swap(r.media.mediaText)
            if (next !== r.media.mediaText) r.media.mediaText = next
          }
          if (r.cssRules) walk(r.cssRules)
        }
      }
      walk(rules)
    }
  }
  new MutationObserver(patchSheets).observe(document, { childList: true, subtree: true })
  document.addEventListener('DOMContentLoaded', patchSheets)
}

function toMarkdown(label, report) {
  const lines = [`# 版面檢查 ${label}`, '', `共 ${report.length} 張。`, '']
  for (const r of report) {
    const issues = (r.offscreen?.length || 0) + (r.overlaps?.length || 0) + (r.clipped?.length || 0)
    if (!issues && !r.fail && !r.errors?.length) continue
    lines.push(`## ${r.name}`)
    if (r.fail) lines.push(`- ✗ 失敗:${r.fail.split('\n')[0]}`)
    for (const e of r.errors || []) lines.push(`- 頁面錯誤:${e.split('\n')[0]}`)
    for (const o of r.offscreen || []) lines.push(`- 超出畫面:${o}`)
    for (const o of r.overlaps || []) lines.push(`- 重疊:${o}`)
    for (const o of r.clipped || []) lines.push(`- 被切:${o}`)
    lines.push('')
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------- sheet
/**
 * 總覽圖:同一個畫面的所有裝置排在一張圖上(附裝置名、自動檢查的問題數),一個畫面一張,
 * 存到 _layout/<label>/_sheets/<畫面>.png;另外產一頁 index.html 可以直接在瀏覽器翻。
 */
async function sheet(label) {
  const dir = path.join(OUT, label)
  const sheets = path.join(dir, '_sheets')
  fs.mkdirSync(sheets, { recursive: true })
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8'))
  const issues = (r) => (r.fail ? '✗ 失敗' : '') + [['超出', r.offscreen], ['重疊', r.overlaps], ['被切', r.clipped]].filter(([, x]) => x?.length).map(([k, x]) => `${k}${x.length}`).join(' ')
  const byScene = new Map()
  for (const r of report) {
    if (!byScene.has(r.scene)) byScene.set(r.scene, [])
    byScene.get(r.scene).push(r)
  }
  const fig = (r, src) => `<figure><img src="${src}"><figcaption><b>${r.device}</b> <span>${issues(r)}</span></figcaption></figure>`
  const css = `body{margin:0;padding:16px;background:#222;color:#eee;font:14px/1.4 "Microsoft JhengHei",sans-serif}
h2{margin:18px 0 8px;font-size:18px}.grid{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
figure{margin:0;background:#333;padding:6px;border-radius:6px}img{display:block;max-height:300px;max-width:560px}
figcaption{margin-top:4px}figcaption span{color:#fb6}`
  const { chromium } = req('playwright-core')
  const browser = await chromium.launch({ executablePath: CHROME })
  const page = await browser.newPage({ viewport: { width: 1800, height: 900 } })
  const index = []
  for (const [scene, rows] of byScene) {
    // 要從 file:// 頁面才讀得到本機圖片(setContent 的空白頁讀不到)→ 先存成檔再開
    const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><h2>${scene}</h2><div class="grid">${rows
      .map((r) => fig(r, '../' + r.name + '.png'))
      .join('')}</div>`
    const tmp = path.join(sheets, '_tmp.html')
    fs.writeFileSync(tmp, html)
    await page.goto('file:///' + tmp.replace(/\\/g, '/'), { waitUntil: 'load' })
    await page.screenshot({ path: path.join(sheets, scene + '.png'), fullPage: true })
    index.push(`<h2 id="${scene}">${scene}</h2><div class="grid">${rows.map((r) => fig(r, r.name + '.png')).join('')}</div>`)
  }
  await browser.close()
  fs.rmSync(path.join(sheets, '_tmp.html'), { force: true })
  const nav = [...byScene.keys()].map((s) => `<a href="#${s}" style="color:#9cf;margin-right:10px">${s}</a>`).join('')
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>版面 ${label}</title><style>${css}</style><p>${nav}</p>${index.join('')}`)
  console.log(`總覽圖 ${byScene.size} 張 → ${sheets}`)
}

// ---------------------------------------------------------------- rotpair
/** 假橫向 vs 真橫向:把直拿的照片轉回來(畫布是順時針轉 90° → 逆轉回來),跟全螢幕那台逐像素比。
 *  node snap.mjs rotpair <名稱> ios-fake ios-full */
async function rotpair(label, fakeDev, fullDev) {
  const { PNG } = req('pngjs')
  const dir = path.join(OUT, label)
  const dd = path.join(OUT, `rot-${label}-${fakeDev}`)
  fs.rmSync(dd, { recursive: true, force: true })
  fs.mkdirSync(dd, { recursive: true })
  const rows = []
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith(fakeDev + '__') && x.endsWith('.png'))) {
    const scene = f.slice(fakeDev.length + 2)
    const fullFile = path.join(dir, `${fullDev}__${scene}`)
    if (!fs.existsSync(fullFile)) continue
    const F = PNG.sync.read(fs.readFileSync(path.join(dir, f)))
    const B = PNG.sync.read(fs.readFileSync(fullFile))
    if (F.width !== B.height || F.height !== B.width) { rows.push(`- ${scene}:尺寸對不上 ${F.width}x${F.height} vs ${B.width}x${B.height}`); continue }
    const D = new PNG({ width: B.width, height: B.height })
    let diff = 0
    for (let y = 0; y < B.height; y++) {
      for (let x = 0; x < B.width; x++) {
        const i = (y * B.width + x) * 4
        const j = (x * F.width + (F.width - 1 - y)) * 4 // 畫布 (x,y) 在直拿照片上的位置
        const d = Math.max(Math.abs(F.data[j] - B.data[i]), Math.abs(F.data[j + 1] - B.data[i + 1]), Math.abs(F.data[j + 2] - B.data[i + 2]))
        const g = (B.data[i] + B.data[i + 1] + B.data[i + 2]) / 3
        if (d > 8) { diff++; D.data[i] = 255; D.data[i + 1] = 0; D.data[i + 2] = 60 } else { D.data[i] = D.data[i + 1] = D.data[i + 2] = g * 0.35 + 160 }
        D.data[i + 3] = 255
      }
    }
    if (diff) fs.writeFileSync(path.join(dd, scene), PNG.sync.write(D))
    rows.push(`- ${scene}:${diff ? `${diff} px 不同(${((diff / (B.width * B.height)) * 100).toFixed(2)}%)` : '相同'}`)
  }
  const md = [`# 假橫向 ${fakeDev} 轉回來 vs ${fullDev}(${label})`, '', ...rows].join('\n')
  fs.writeFileSync(path.join(dd, 'compare.md'), md)
  console.log(md)
}

// ---------------------------------------------------------------- compare
async function compare(a, b) {
  const { PNG } = req('pngjs')
  const da = path.join(OUT, a)
  const db = path.join(OUT, b)
  const dd = path.join(OUT, `diff-${a}-${b}`)
  fs.rmSync(dd, { recursive: true, force: true }) // 上次比對留下的差異圖先清掉
  fs.mkdirSync(dd, { recursive: true })
  const files = fs.readdirSync(da).filter((f) => f.endsWith('.png'))
  let same = 0
  let missing = 0
  const rows = []
  for (const f of files) {
    const fb = path.join(db, f)
    if (!fs.existsSync(fb)) { missing++; continue } // 只拍一部分(抽查)時,沒有的不算
    const A = PNG.sync.read(fs.readFileSync(path.join(da, f)))
    const B = PNG.sync.read(fs.readFileSync(fb))
    if (A.width !== B.width || A.height !== B.height) { rows.push(`- ${f}:尺寸不同 ${A.width}x${A.height} vs ${B.width}x${B.height}`); continue }
    const D = new PNG({ width: A.width, height: A.height })
    let diff = 0
    for (let i = 0; i < A.data.length; i += 4) {
      const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]))
      const g = (A.data[i] + A.data[i + 1] + A.data[i + 2]) / 3
      if (d > 8) {
        diff++
        D.data[i] = 255; D.data[i + 1] = 0; D.data[i + 2] = 60
      } else {
        D.data[i] = D.data[i + 1] = D.data[i + 2] = g * 0.35 + 160
      }
      D.data[i + 3] = 255
    }
    if (!diff) { same++; continue }
    fs.writeFileSync(path.join(dd, f), PNG.sync.write(D))
    const pct = (diff / (A.width * A.height)) * 100
    rows.push({ pct, line: `- ${f}:${diff} px 不同(${pct.toFixed(2)}%)` })
  }
  // 1% 以下多半是大圖解碼的零星雜點(主線地圖),分開列;要看還是看得到差異圖
  const big = rows.filter((r) => typeof r === 'string' || r.pct >= 1).map((r) => r.line ?? r)
  const small = rows.filter((r) => typeof r !== 'string' && r.pct < 1).map((r) => r.line)
  const md = [
    `# 比對 ${a} vs ${b}`, '', `相同 ${same} / ${files.length - missing} 張`, '',
    '## 明顯不同', ...(big.length ? big : ['(無)']), '',
    '## 細微(<1%,多半是雜點;差異圖在同資料夾)', ...(small.length ? small : ['(無)']),
  ].join('\n')
  fs.writeFileSync(path.join(dd, 'compare.md'), md)
  console.log(md)
}
