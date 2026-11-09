// 截圖場景:每個場景從剛載入的首頁開始,用 DEV 的 __app / __game / __campaign 走到指定畫面。
// 登入狀態由 snap.mjs 的 initScript 在開機時就給好(guest: true → 訪客、會看到歡迎彈窗)。
// 場景可選:wait(拍照前再等多久遊戲時間)、only(dev) 只在某些裝置拍、ua(dev) 換掉瀏覽器識別字串、
// quick(快速檢查也拍)、splash(留著開場頁,其他場景一開機就跳過它)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPLAY = JSON.parse(fs.readFileSync(path.join(HERE, 'replay-fixture.json'), 'utf8'))

/** 假造的已登入玩家(只在截圖瀏覽器裡,不會寫到 Firebase)。 */
export const PROFILE = {
  username: 'snap',
  displayName: '鼓山金城武',
  isAnonymous: false,
  createdAt: 1767196800000,
  lastActive: 1793800000000,
  progress: { maxStageCleared: '9-3', stageClearedAt: {}, activeSeries: null },
  tutorialSeen: true,
  diamonds: 1050,
  daily: { date: '2026-11-04', signin: true },
  // 打到 9-3 的玩家:十張特殊卡都解鎖、帶三張(特殊房選卡畫面才不會是空的)
  unlocked: {
    specialCards: { swap: true, peek: true, spy: true, clubs: true, diamonds: true, hearts: true, spades: true, refresh: true, explode: true, deathEye: true },
    avatars: { woodpecker: true },
    achievements: {},
    emojis: {},
  },
  equipped: { avatar: 'woodpecker', achievements: [], specialCards: ['peek', 'spy', 'hearts'] },
  stats: {},
}

const app = (fn, arg) => async (page) => {
  await page.evaluate(fn, arg)
}
const mobileWeb = (dev) => dev.mobile && !dev.standalone

// 共用的前置步驟
const openStart = async (page, { settle, click }) => {
  await click('開始遊戲')
  await settle(500)
}
const openFree = async (page, ctx) => {
  await openStart(page, ctx)
  await ctx.click('快速配對')
  await ctx.settle(500)
}
const aiGame = (cfg = { mode: 'ai', timeLimit: 50 }) => async (page, { settle }) => {
  await page.evaluate((c) => window.__app.getState().launchGame(c), cfg)
  await settle(9000)
}
const personalizeTab = (tab) => async (page, { settle, click }) => {
  await page.evaluate(() => window.__app.getState().go('personalize'))
  await settle(800)
  await click(tab)
}
const replayAt = (pick) => async (page, { settle }) => {
  await page.evaluate((rec) => window.__app.getState().openReplay(rec), REPLAY)
  await settle(1500)
  await page.evaluate((p) => {
    const g = window.__game.getState()
    const frames = g.replayFrames
    const i = p === 'end' ? frames.length - 1 : p === 'showdown' ? frames.findIndex((f) => /開牌/.test(f.action)) : p
    g.replaySeek(Math.max(0, i), true)
  }, pick)
}

/** 聊天室假訊息(src/net/lobby.ts 的 DEV 入口):人機閒聊、長句、貼圖、自己講的話都有。 */
const fakeChat = (page) =>
  page.evaluate(() =>
    window.__fakeChat([
      { name: '山石宮分', avatarId: 'cat', text: '晚安各位 今天也來輸一下' },
      { name: '我要驗牌', avatarId: 'bird', text: '剛剛被同花順打爆 七格全輸 這遊戲是不是有問題啊啊啊啊' },
      { name: '海Chris爛', avatarId: 'cat2', stickerId: 'cry' },
      { name: '鼓山金城武', avatarId: 'woodpecker', kind: 'human', uid: 'snap_uid', text: '我第 9 關打過了' },
      { name: '無法顯示名稱', avatarId: 'bear', text: '金城武好猛' },
      { name: '你在大聲什麼啦', avatarId: 'cat', stickerId: 'wow' },
      { name: '鍵盤柯南', avatarId: 'bear', text: '有人要快速配對嗎', cta: [{ label: '快速配對', action: 'quickmatch' }] },
    ]),
  )

/** 賽事回放清單:離線拍不到 Firebase 的清單 → 用 src/net/replays.ts 的 DEV 入口餵假資料(含 7 字長名字)。 */
const hlist = async (page, { settle, click }) => {
  await click('賽事回放')
  await settle(800)
  await page.evaluate((rec) => {
    const names = [['鼓山金城武本人A', '乂煞氣a屁孩卍王'], ['山石宮分', '無法顯示名稱'], ['我要驗牌', '陶敬凱'], ['動世', '金色狂蜂']]
    const avas = ['woodpecker', 'cat', 'bird', 'bear']
    window.__fakeReplays(
      names.map(([a, b], i) => ({
        ...rec,
        id: 'f' + i,
        endedAt: rec.endedAt - i * 3600e3,
        winner: i % 2 ? 'p2' : 'p1',
        p1: { ...rec.p1, name: a, avatar: avas[i] },
        p2: { ...rec.p2, name: b, avatar: avas[3 - i] },
      })),
    )
  }, REPLAY)
}

/** 對手名字換成上限長度(7 個中文),看會不會被右側的鈕壓到。 */
const longFoe = (page) =>
  page.evaluate(() => window.__game.setState({ casualFoe: { name: '鼓山金城武本人', avatarId: 'bird' } }))
/** 火力全開:看完規則 → 用預設帶的 5 張確認出戰 → 進牌局。 */
const fireBoard = async (page, ctx) => {
  await aiGame({ mode: 'ai', limited: 'fire', timeLimit: 50 })(page, ctx)
  await ctx.click('知道了')
  await ctx.settle(500)
  await ctx.click('確認出戰')
  await ctx.settle(2500)
  await longFoe(page)
}

/** 觀戰要連線才進得去 → 借回放的牌桌,關掉回放旗標讓它顯示成觀戰模式,再灌幾則彈幕。 */
const spectate = async (page, ctx) => {
  await replayAt(22)(page, ctx)
  await ctx.settle(800)
  await page.evaluate(() => {
    const g = window.__game
    g.setState({ replay: null })
    const msgs = ['這手好猛', '鬼牌留著幹嘛', '+1', '金城武加油!!', '哈哈哈哈哈']
    msgs.forEach((text, i) => g.getState().feedDanmaku({ id: 'dm' + i, text, by: '路人' + i }))
  })
}

export const SCENES = [
  // ---------------------------------------------------------------- 大廳
  { id: 'welcome', guest: true, run: async () => {} },
  { id: 'lobby', quick: true, run: async () => {} },
  // 開場頁(其他場景都跳過它):每台都拍,看「最佳體驗設定」看板有沒有出現在對的裝置上
  { id: 'splash', splash: true, run: async () => {} },
  // 看板的按鈕 → 圖解彈窗(只有手機網頁版有看板)
  { id: 'splash-guide', splash: true, only: (dev) => mobileWeb(dev), run: async (page, { clickSel }) => clickSel('.ssetup__btn') },
  // 進入遊戲 → 淡入大廳(看開場頁有沒有收乾淨)
  { id: 'splash-start', splash: true, wait: 1500, run: async (page, { clickSel }) => clickSel('.splash__enter') },
  { id: 'ann', run: async (page, { click }) => click('公告', { exact: false }) },
  { id: 'chat', run: async (page, ctx) => { await fakeChat(page); await ctx.clickSel('.lchat-fab') } },
  {
    // 打字:真的鍵盤模擬不了,至少看輸入框聚焦、有字時的樣子
    id: 'chat-type',
    quick: true,
    run: async (page, { settle, clickSel }) => {
      await fakeChat(page)
      await clickSel('.lchat-fab')
      await settle(800)
      const box = page.locator('input:visible, textarea:visible').last()
      await box.focus()
      await page.keyboard.type('測試打字看看')
    },
  },
  { id: 'start', quick: true, run: openStart },
  { id: 'free', run: openFree },
  { id: 'rota', run: async (page, ctx) => { await openFree(page, ctx); await ctx.clickSel('.menu__qbtn') } },
  {
    id: 'matchmaking',
    wait: 3000,
    run: async (page, ctx) => {
      await openFree(page, ctx)
      await ctx.click('一般房配對')
    },
  },
  { id: 'create', run: async (page, ctx) => { await openStart(page, ctx); await ctx.click('建立房間') } },
  { id: 'join', run: async (page, ctx) => { await openStart(page, ctx); await ctx.click('加入房間') } },
  { id: 'shop', quick: true, run: app(() => window.__app.getState().openShop()) },
  { id: 'daily', run: app(() => window.__app.getState().openDaily()) },
  { id: 'personalize', run: app(() => window.__app.getState().go('personalize')) },
  { id: 'pz-ach', run: personalizeTab('成就') },
  { id: 'pz-deck', run: personalizeTab('牌組') },
  { id: 'pz-avatar', run: personalizeTab('頭像') },
  { id: 'pz-sticker', run: personalizeTab('貼圖') },
  { id: 'leaderboard', run: app(() => window.__app.getState().go('leaderboard')) },
  { id: 'chapter', quick: true, run: app(() => window.__app.getState().go('campaignStages')) },
  {
    id: 'stage-pick',
    run: async (page, { settle, clickSel }) => {
      await page.evaluate(() => window.__app.getState().go('campaignStages'))
      await settle(1500)
      await clickSel('.chnode__btn')
    },
  },
  { id: 'howto', run: app(() => window.__app.getState().go('howto')) },
  { id: 'settings', quick: true, run: app(() => window.__app.getState().go('settings')) },
  { id: 'tutorial', wait: 2500, run: app(() => window.__app.getState().go('tutorial')) },

  // ---------------------------------------------------------------- 牌局
  { id: 'game-ai', quick: true, run: aiGame() },
  { id: 'game-special', run: aiGame({ mode: 'ai', special: true, timeLimit: 50 }) },
  { id: 'game-fire', run: aiGame({ mode: 'ai', limited: 'fire', timeLimit: 50 }) },
  {
    id: 'fire-loadout',
    quick: true,
    run: async (page, ctx) => {
      await aiGame({ mode: 'ai', limited: 'fire', timeLimit: 50 })(page, ctx)
      await ctx.click('知道了')
    },
  },
  // 限定房進到牌局後:對手用名字上限(7 個中文)→ 看右側玩法方鈕會不會壓到名字
  { id: 'fire-board', run: fireBoard },
  {
    id: 'fire-tray',
    run: async (page, ctx) => {
      await fireBoard(page, ctx)
      await page.evaluate(() => window.__game.setState({ specialTrayOpen: true }))
    },
  },
  {
    id: 'ghost-board',
    run: async (page, ctx) => {
      await aiGame({ mode: 'ai', limited: 'ghost', timeLimit: 50 })(page, ctx)
      await ctx.click('知道了')
      await longFoe(page)
    },
  },
  { id: 'game-ghost', run: aiGame({ mode: 'ai', limited: 'ghost', timeLimit: 50 }) },
  { id: 'game-blank', run: aiGame({ mode: 'ai', limited: 'blank', timeLimit: 50 }) },
  { id: 'game-mixed', run: aiGame({ mode: 'ai', limited: 'mixed', timeLimit: 50 }) },
  { id: 'game-sticker', run: async (page, ctx) => { await aiGame()(page, ctx); await ctx.click('貼圖') } },
  { id: 'game-pause', run: async (page, ctx) => { await aiGame()(page, ctx); await ctx.clickSel('.game__pausebtn') } },
  { id: 'game-hands', run: async (page, ctx) => { await aiGame()(page, ctx); await ctx.click('?') } },
  {
    id: 'game-boss',
    run: async (page, { settle }) => {
      await page.evaluate(() => window.__campaign.getState().startSeries('s3-1'))
      await settle(9000)
    },
  },

  // ---------------------------------------------------------------- 回放 / 觀戰
  // 回放的計時器鏈跨好幾次 render,假時鐘下步數不穩 → 直接跳到指定步並暫停
  { id: 'hlist', run: hlist },
  {
    // 花色卡指定中:提示框要在花色/大小鈕上層
    id: 'game-target',
    run: async (page, ctx) => {
      await fireBoard(page, ctx)
      await page.evaluate(() => window.__game.setState({ specialTargeting: 'spades', specialPicks: [] }))
    },
  },
  { id: 'replay', wait: 2500, run: replayAt(22) },
  { id: 'replay-showdown', quick: true, wait: 2500, run: replayAt('showdown') },
  { id: 'replay-end', wait: 2500, run: replayAt('end') },
  { id: 'spectate', quick: true, wait: 1500, run: spectate },
  // 沒拍:貼圖飛出(動畫關掉後瞬間就結束)、玩家名片(資料在 Firebase,離線只會「載入中」)


  // ---------------------------------------------------------------- 內建瀏覽器(只有手機網頁版會遇到)
  // LINE 是無聲轉址、安卓 FB 直接跳 Chrome,都沒有畫面可拍;只有 iOS FB 是手動教學頁
  { id: 'gate-fb', only: (dev) => mobileWeb(dev) && dev.os === 'ios', ua: (dev) => dev.ua + ' [FBAN/FBIOS;FBAV/480.0.0]', run: async () => {} },
  { id: 'gate-threads', only: (dev) => mobileWeb(dev) && dev.os === 'ios', ua: (dev) => dev.ua + ' Barcelona 289.0.0.77.109 (iPhone15,2; iOS 17_5; zh_TW)', run: async () => {} },
  // 複製連結失敗時會多一行網址(最長的版面)
  {
    id: 'gate-copyfail',
    only: (dev) => mobileWeb(dev) && dev.os === 'ios',
    ua: (dev) => dev.ua + ' Instagram 340.0.0.22.109 (iPhone15,2; iOS 17_5)',
    run: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) }, configurable: true })
        document.execCommand = () => false
      })
      await page.click('.iabg__copy')
      await page.waitForTimeout(200)
    },
  },
]
