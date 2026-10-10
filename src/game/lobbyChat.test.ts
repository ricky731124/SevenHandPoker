import { describe, it, expect } from 'vitest'
import { ambientUnit, reactUnit, lintChatContent, estimateVariety, type ReactInput } from './lobbyChat'
import { BOTS } from './bots'
import CHAT from '../data/chatContent'
import { STICKERS } from './stickers'

const RUNS = 3000

const speaker = (patch: Partial<ReactInput> = {}): ReactInput => ({
  name: '測試員', registered: true, streak: 0, bestStreak: 0, wins: 0, games: 0,
  clearedOrder: -1, achvList: [], loadout: [], isSticker: false, ...patch,
})

describe('chatContent 內容檢查', () => {
  it('沒有會讓程式跑不動的錯誤（pool/關鍵字/佔位/條件/按鈕/貼圖都對得上）', () => {
    const { errors, warnings } = lintChatContent()
    if (warnings.length) console.warn('[chatContent 提醒]\n' + warnings.join('\n'))
    expect(errors, errors.join('\n')).toEqual([])
  })
})

describe('chatContent 變化數（量產進度）', () => {
  it('印出目前估算的變化數', () => {
    const v = estimateVariety()
    console.log(`[chatContent 變化數] ≈ ${v.total}（句型 ${v.templates}）`, v.parts)
    expect(v.total).toBeGreaterThan(0)
  })
})

describe('貼圖在句子裡：免費 → 表情符號；商城 → 只講付費貼圖名', () => {
  it('不會出現「生氣」這種免費貼圖名，句子裡是 😠 這類表情；商城劇場只講付費貼圖', () => {
    const freeNames = STICKERS.filter((s) => s.free).map((s) => s.name)
    const freeEmoji = STICKERS.filter((s) => s.free).map((s) => s.emoji!)
    const paidNames = STICKERS.filter((s) => !s.free).map((s) => s.name)
    const texts: string[] = []
    for (let i = 0; i < RUNS * 3; i++) for (const u of ambientUnit(BOTS, { onlineCount: 21, hasLive: false })) if (u.text) texts.push(u.text)
    for (let i = 0; i < 400; i++) for (const u of reactUnit(speaker({ text: '貼圖好用嗎', clearedOrder: 4 }), BOTS, { onlineCount: 21, hasLive: false })) if (u.text) texts.push(u.text)
    // 「XX」裡包的若是免費貼圖名 → 錯
    const bad = texts.filter((t) => freeNames.some((n) => t.includes(`「${n}」`)))
    expect(bad).toEqual([])
    // 確實有句子帶免費表情、也確實有商城劇場講付費貼圖名(且不含純符號名 !! / ...)
    expect(texts.some((t) => freeEmoji.some((e) => t.includes(e)) && /貼圖|那張|輸的人/.test(t))).toBe(true)
    const shop = texts.filter((t) => /必買|貼圖好用嗎|洗一排/.test(t))
    expect(shop.length).toBeGreaterThan(0)
    expect(shop.every((t) => paidNames.some((n) => t.includes(`「${n}」`)))).toBe(true)
    expect(shop.some((t) => t.includes('「!!」') || t.includes('「...」'))).toBe(false)
  })
})

describe('lobbyChat 產句引擎', () => {
  it('環境閒聊實跑多次，沒有任何 {佔位} 漏到畫面上', () => {
    for (let i = 0; i < RUNS; i++) {
      for (const u of ambientUnit(BOTS, { onlineCount: 21, hasLive: i % 2 === 0, liveCode: 'spec_x' })) {
        if (u.text) expect(u.text).not.toMatch(/\{\w+\}/)
      }
    }
  })

  it('反應式實跑多次（訪客/新手/連勝/老手/貼圖），沒有 {佔位} 漏出來', () => {
    const inputs: ReactInput[] = [
      speaker({ registered: false, name: '訪客' }),
      speaker({ clearedOrder: 0 }),
      speaker({ clearedOrder: 4, streak: 7, games: 20, wins: 12, achvList: [{ id: 'wins', tier: 2 }], loadout: ['peek'] }),
      speaker({ text: '請問這個要怎麼玩' }),
      speaker({ text: '你好爛', username: 'ricky' }),
      speaker({ isSticker: true, stickerId: 'cry' }),
    ]
    for (let i = 0; i < RUNS; i++) {
      for (const u of reactUnit(inputs[i % inputs.length], BOTS, { onlineCount: 21, hasLive: false })) {
        if (u.text) expect(u.text).not.toMatch(/\{\w+\}/)
      }
    }
  })

  it('劇場共用槽 {card} 的句子會被講出來（聊特殊卡劇場的 B 不再消失）', () => {
    const answers = CHAT.beatPools.answer_card.map((l) => (l.t ?? '').split('{card}'))
    let seen = false
    for (let i = 0; i < RUNS * 3 && !seen; i++) {
      for (const u of ambientUnit(BOTS, { onlineCount: 21, hasLive: false })) {
        if (u.text && answers.some(([pre, post]) => u.text!.startsWith(pre) && u.text!.endsWith(post))) seen = true
      }
    }
    expect(seen).toBe(true)
  })

  it('多句劇場不加語助詞 opener', () => {
    const fixed = CHAT.threads.flatMap((th) => th.beats.map((b) => b.t).filter((t): t is string => !!t && !t.includes('{')))
    for (let i = 0; i < RUNS; i++) {
      for (const u of ambientUnit(BOTS, { onlineCount: 21, hasLive: false })) {
        const hit = u.text && fixed.find((f) => u.text!.endsWith(f))
        if (hit) expect(u.text).toBe(hit)
      }
    }
  })
})
