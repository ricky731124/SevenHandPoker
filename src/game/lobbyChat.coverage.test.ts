import { describe, it, expect } from 'vitest'
import { ambientUnit, reactUnit, matchKeywordForTest, reactRulesForTest, type ReactInput, type BotUtterance } from './lobbyChat'
import { BOTS } from './bots'
import CHAT, { type Line, type ThreadBeat } from '../data/chatContent'

/**
 * 內容覆蓋測試：確認 chatContent.ts 裡寫的每一種劇本「真的會出現」，而不是寫了但永遠抽不到。
 */
const N = 4000
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 句子模板 → 比對用正規式（{佔位} 當萬用字；prefix=允許前面多了語助詞） */
const tpl = (t: string, prefix = false) => new RegExp((prefix ? '' : '^') + esc(t).replace(/\\\{\w+\\\}/g, '.+') + '$')
const linesOf = (b: ThreadBeat): Line[] =>
  b.lines ?? (b.t != null ? [{ t: b.t }] : b.sticker != null ? [{ sticker: b.sticker }] : CHAT.beatPools[b.pool ?? ''] ?? [])
const matches = (u: BotUtterance, lines: Line[], prefix = false) =>
  lines.some((l) => (l.sticker != null ? u.stickerId === l.sticker : !!u.text && tpl(l.t!, prefix).test(u.text)))

const who = (patch: Partial<ReactInput> = {}): ReactInput => ({
  name: '阿明', registered: true, streak: 0, bestStreak: 0, wins: 0, games: 0,
  clearedOrder: -1, achvList: [], loadout: [], isSticker: false, ...patch,
})
const at = (h: number) => new Date(`2026-10-06T${String(h).padStart(2, '0')}:30:00`).getTime()

describe('內容覆蓋：每種劇本都真的會出現', () => {
  it('每一個多句劇場都抽得到，而且照順序由不同人講（前兩拍）', () => {
    const units: BotUtterance[][] = []
    for (let i = 0; i < N; i++) units.push(ambientUnit(BOTS, { onlineCount: 21, hasLive: false }))
    const missing = CHAT.threads.filter((th) => {
      const [b0, b1] = th.beats
      return !units.some((u) => u[0] && matches(u[0], linesOf(b0)) && (!b1 || b1.chance != null || (u[1] && matches(u[1], linesOf(b1)))))
    })
    expect(missing.map((t) => t.id)).toEqual([])
  })

  it('每一個關鍵字單獨打出來，都會命中自己的那一類（沒有被別條搶走）', () => {
    const bad: string[] = []
    for (const k of CHAT.keywords) {
      for (const s of k.any ?? ['']) {
        const text = (k.all ?? []).join('') + s
        const got = matchKeywordForTest(text)
        if (got !== k.intent) bad.push(`「${text}」→ ${got}（應為 ${k.intent}）`)
      }
    }
    expect(bad).toEqual([])
  })

  it('關鍵字命中後，回覆真的來自那一類的池', () => {
    const bad: string[] = []
    for (const k of CHAT.keywords) {
      const text = (k.all ?? []).join('') + (k.any?.[0] ?? '')
      const pool = CHAT.kwPools[k.intent]
      for (let i = 0; i < 30; i++) {
        const u = reactUnit(who({ clearedOrder: 4, loadout: ['peek'], text }), BOTS, { onlineCount: 21, hasLive: false })[0]
        if (!u || !matches(u, pool, true)) { bad.push(`${k.intent}：「${u?.text ?? u?.stickerId}」`); break }
      }
    }
    expect(bad).toEqual([])
  })

  it('每一條「發言者狀態」規則（含保底）都有人會用到', () => {
    const hit = new Set<number>()
    for (const username of [undefined, 'ricky'])
      for (const registered of [false, true])
        for (let cleared = -1; cleared <= 17; cleared++)
          for (const streak of [0, 1, 3, 7, 12])
            for (const achv of [[], [{ id: 'wins', tier: 1 }], [{ id: 'wins', tier: 2 }], [{ id: 'quads', tier: 3 }]])
              for (const loadout of [[], ['peek']])
                reactRulesForTest(who({ username, registered, clearedOrder: cleared, streak, achvList: achv, loadout })).forEach((i) => hit.add(i))
    const unreachable = CHAT.reactRules.map((r, i) => `#${i} ${r.when ?? '（保底）'}`).filter((_, i) => !hit.has(i))
    expect(unreachable).toEqual([])
  })

  it('訪客 / owner 獨佔：只會拿到自己那條的句子', () => {
    const ix = (pred: (when?: string) => boolean) => CHAT.reactRules.findIndex((r) => pred(r.when))
    expect(reactRulesForTest(who({ registered: false, clearedOrder: 4, streak: 7 }))).toEqual([ix((w) => w === 'guest')])
    expect(reactRulesForTest(who({ username: 'ricky', clearedOrder: 4, streak: 7 }))).toEqual([ix((w) => w === 'isOwner')])
    const guestLines = CHAT.reactRules.find((r) => r.when === 'guest')!.say
    for (let i = 0; i < 100; i++) {
      const u = reactUnit(who({ registered: false, clearedOrder: 4, text: '今天天氣不錯' }), BOTS, { onlineCount: 21, hasLive: false })[0]
      expect(matches(u, guestLines, true)).toBe(true)
    }
  })

  it('老手不再只有 2 句：會從多條符合的規則（含保底）一起抽', () => {
    const vet = who({ clearedOrder: 6, loadout: [], achvList: [{ id: 'wins', tier: 2 }], text: '今天天氣不錯' })
    const used = reactRulesForTest(vet)
    expect(used.length).toBeGreaterThanOrEqual(3)
    expect(used).toContain(CHAT.reactRules.length - 1) // 保底混進來了
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) {
      const u = reactUnit(vet, BOTS, { onlineCount: 21, hasLive: false })[0]
      if (u?.text) seen.add(u.text.replace(/^.{0,6}?(?=\p{Script=Han}|\{)/u, ''))
    }
    expect(seen.size).toBeGreaterThanOrEqual(6)
  })

  it('主線進度 → BOSS 情報用真實關卡資料（過 1-3 → 第 2 關英國短毛貓、囤牌、讓我看看）', () => {
    const line = CHAT.kwPools.kw_bossask.find((l) => l.guard === 'hasBoss')!
    let seen = ''
    for (let i = 0; i < 300 && !seen; i++) {
      const u = reactUnit(who({ clearedOrder: 2, text: '打不過' }), BOTS, { onlineCount: 21, hasLive: false })[0]
      if (u?.text && tpl(line.t!, true).test(u.text)) seen = u.text
    }
    expect(seen).toContain('英國短毛貓')
    expect(seen).toContain('囤牌')
    expect(seen).toContain('讓我看看')
  })

  it('時段：早/午/晚/深夜各自的主動句會出現，而且不會跑錯時段', () => {
    const buckets: [string, number, string][] = [['time_morning', 8, 'morning'], ['time_afternoon', 14, 'afternoon'], ['time_evening', 20, 'evening'], ['time_night', 2, 'night']]
    for (const [key, hour, guard] of buckets) {
      const outs: BotUtterance[] = []
      for (let i = 0; i < N; i++) outs.push(...ambientUnit(BOTS, { onlineCount: 21, hasLive: false, now: at(hour) }))
      expect(outs.some((u) => matches(u, CHAT.proactive[key], true)), key).toBe(true)
      // 別的時段專屬單句不該出現
      const wrong = CHAT.singles.filter((l) => l.guard && ['morning', 'afternoon', 'evening', 'night'].includes(l.guard) && l.guard !== guard)
      expect(outs.some((u) => matches(u, wrong, true)), `${key} 出現了別的時段的句子`).toBe(false)
    }
  })

  it('線上人數 / 鼓山金城武梗 這些主動句會出現，且人數是傳進來的數字', () => {
    const outs: BotUtterance[] = []
    for (let i = 0; i < N; i++) outs.push(...ambientUnit(BOTS, { onlineCount: 23, hasLive: false }))
    expect(outs.some((u) => matches(u, CHAT.proactive.gossip_gm, true))).toBe(true)
    const online = outs.filter((u) => matches(u, CHAT.proactive.online_count, true))
    expect(online.length).toBeGreaterThan(0)
    expect(online.every((u) => u.text!.includes('23'))).toBe(true)
  })

  it('owner(ricky) 嗆聲 → 幾乎都是專屬彩蛋；別人嗆聲 → 永遠不會拿到彩蛋', () => {
    const ownerLines = CHAT.kwPools.kw_taunt.filter((l) => l.guard === 'isOwner')
    let ownerHits = 0
    for (let i = 0; i < 200; i++) {
      const u = reactUnit(who({ username: 'ricky', text: '你好爛', clearedOrder: 4 }), BOTS, { onlineCount: 21, hasLive: false })[0]
      if (u && matches(u, ownerLines, true)) ownerHits++
    }
    expect(ownerHits).toBeGreaterThan(150)
    for (let i = 0; i < 200; i++) {
      const u = reactUnit(who({ username: 'someone', text: '你好爛', clearedOrder: 4 }), BOTS, { onlineCount: 21, hasLive: false })[0]
      expect(u && matches(u, ownerLines, true)).toBe(false)
    }
  })

  it('觀戰：有 live 才出現「有人在對決」的句子，按鈕帶當下那場的 code；沒 live 完全不出現', () => {
    const liveOnly = CHAT.singles.filter((l) => l.guard === 'hasLive')
    const withLive: BotUtterance[] = []
    const noLive: BotUtterance[] = []
    for (let i = 0; i < N; i++) {
      withLive.push(...ambientUnit(BOTS, { onlineCount: 21, hasLive: true, liveCode: 'spec_abc' }))
      noLive.push(...ambientUnit(BOTS, { onlineCount: 21, hasLive: false }))
    }
    const shown = withLive.filter((u) => matches(u, liveOnly, true))
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.some((u) => u.cta?.some((c) => c.action === 'spectate' && c.code === 'spec_abc'))).toBe(true)
    expect(noLive.some((u) => matches(u, liveOnly, true))).toBe(false)
    expect(noLive.some((u) => u.cta?.some((c) => c.action === 'spectate'))).toBe(false)
  })

  it('每一張貼圖都會得到自己那一池的回應', () => {
    for (const [id, pool] of Object.entries(CHAT.stickerReplies)) {
      if (id === '*') continue
      for (let i = 0; i < 20; i++) {
        const u = reactUnit(who({ isSticker: true, stickerId: id, clearedOrder: 4 }), BOTS, { onlineCount: 21, hasLive: false })[0]
        expect(u && matches(u, pool, true), `貼圖 ${id}`).toBe(true)
      }
    }
  })
})
