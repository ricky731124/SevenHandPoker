import { describe, it, expect } from 'vitest'
import { ambientUnit, reactUnit, matchKeywordForTest, reactRulesForTest, resetCooldownForTest, syncChatHistory, type ReactInput, type BotUtterance } from './lobbyChat'
import type { LobbyMsg } from '../net/lobby'
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
      resetCooldownForTest() // 每次當成「隔很久才又嗆一次」：測權重本身(連嗆 200 次的話防重複會讓它輪流講)
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

// ─── 防重複：模擬真實聊天室（訊息帶 ck 進 lobbyChat、常常換 host）──────────────────
describe('防重複：換 host / 重整後也接得上', () => {
  const WIN = CHAT.config.cooldownSize ?? 30
  type Sent = BotUtterance & { single: boolean }
  /** 跑 units 個環境單元；每 handoffEvery 個單元換一次 host（新分頁 = 本機記憶清空，只剩聊天紀錄）。 */
  function simulate(units: number, handoffEvery: number, syncFromChat: boolean, g = { onlineCount: 21, hasLive: false }): Sent[] {
    resetCooldownForTest()
    const log: Sent[] = []
    for (let i = 0; i < units; i++) {
      if (i > 0 && i % handoffEvery === 0) {
        resetCooldownForTest() // 換手：新 host 分頁什麼都不記得
        if (syncFromChat) syncChatHistory(log.slice(-30).map((u, j) => ({ id: String(j), ts: j, kind: 'bot', name: u.name, avatarId: u.avatarId, type: u.type, text: u.text, ck: u.ck }) as LobbyMsg))
      }
      const unit = ambientUnit(BOTS, g)
      for (const u of unit) log.push({ ...u, single: unit.length === 1 })
      if (syncFromChat) syncChatHistory(log.slice(-30).map((u, j) => ({ id: String(j), ts: j, kind: 'bot', name: u.name, avatarId: u.avatarId, type: u.type, text: u.text, ck: u.ck }) as LobbyMsg))
    }
    return log
  }
  /** 在任一連續 WIN 則裡，某類鍵重複出現幾次。 */
  function repeats(log: Sent[], pick: (u: Sent) => string[]): number {
    let n = 0
    for (let i = 0; i < log.length; i++) {
      const mine = pick(log[i])
      for (let j = Math.max(0, i - WIN + 1); j < i; j++) if (pick(log[j]).some((k) => mine.includes(k))) { n++; if (process.env.DBG) console.log('重複', i - j, '則前:', log[j].text, '→', log[i].text, log[i].ck); break }
    }
    return n
  }
  const threadKeys = (u: Sent) => (u.ck ?? []).filter((k) => k.startsWith('th:'))
  const singleKeys = (u: Sent) => (u.single && u.type === 'text' ? (u.ck ?? []).filter((k) => k.startsWith('L:')) : [])

  it('聊天紀錄有 ck：每 3 個單元就換 host，30 則內「單句」不重複；「劇場」只在 11 個全用完時才會輪回', () => {
    const log = simulate(1500, 3, true)
    // 劇場目前只有 11 個，30 則內偶爾會全部用過一輪 → 才輪到最久沒講的那個(內容量產後就會消失)
    expect(repeats(log, threadKeys)).toBeLessThanOrEqual(5)
    expect(repeats(log, singleKeys)).toBe(0)
  })

  it('對照組（舊版行為：只記在 host 分頁記憶體）→ 換 host 後真的會重複', () => {
    const log = simulate(1500, 3, false)
    expect(repeats(log, threadKeys) + repeats(log, singleKeys)).toBeGreaterThan(20)
  })

  it('同主題(特殊牌…)的閒聊單句，8 則內不會又繞回來', () => {
    const log = simulate(1500, 5, true)
    const TOPIC_WIN = CHAT.config.topicCooldown ?? 8
    let bad = 0
    log.forEach((u, i) => {
      if (!u.single) return
      const tp = (u.ck ?? []).find((k) => k.startsWith('tp:'))
      if (!tp) return
      for (let j = Math.max(0, i - TOPIC_WIN + 1); j < i; j++) if (log[j].single && log[j].ck?.includes(tp)) { bad++; if (process.env.DBG) console.log('主題', tp, i - j, '則前:', log[j].text, '→', u.text, u.ck); break }
    })
    expect(bad).toBe(0)
  })
})

describe('主動句：剛剛誰打敗誰 / 點名潛水的人', () => {
  const g0 = { onlineCount: 21, hasLive: false }
  const announce = CHAT.proactive.announce_replay
  const cue = CHAT.proactive.cue_idle

  it('有新戰績 → 會播報，名字是真的勝/敗方；同一場播過就不再播（換 host 也一樣）', () => {
    resetCooldownForTest()
    const g = { ...g0, lastResult: { id: 'r1', winner: '小美', loser: '阿明' } }
    const log: BotUtterance[] = []
    for (let i = 0; i < 400; i++) log.push(...ambientUnit(BOTS, g))
    const hits = log.filter((u) => matches(u, announce, true))
    expect(hits.length).toBe(1)
    expect(hits[0].text).toMatch(/小美/)
    // 換 host：本機記憶清空，但聊天紀錄裡那則帶著 rp:r1 → 不會再播
    resetCooldownForTest()
    syncChatHistory([{ id: 'x', ts: 1, kind: 'bot', name: 'b', avatarId: 'cat', type: 'text', text: hits[0].text, ck: hits[0].ck }])
    const again: BotUtterance[] = []
    for (let i = 0; i < 400; i++) again.push(...ambientUnit(BOTS, g))
    expect(again.filter((u) => matches(u, announce, true)).length).toBe(0)
  })

  it('沒有戰績資料 → 永遠不會出現播報句', () => {
    resetCooldownForTest()
    const log: BotUtterance[] = []
    for (let i = 0; i < 1000; i++) log.push(...ambientUnit(BOTS, g0))
    expect(log.some((u) => matches(u, announce, true))).toBe(false)
    expect(log.some((u) => matches(u, cue, true))).toBe(false)
  })

  it('潛水的人會被點名（每人一次），名字正確', () => {
    resetCooldownForTest()
    const g = { ...g0, lurkers: [{ uid: 'u1', name: '路人甲' }, { uid: 'u2', name: '路人乙' }] }
    const log: BotUtterance[] = []
    for (let i = 0; i < 600; i++) log.push(...ambientUnit(BOTS, g))
    const hits = log.filter((u) => matches(u, cue, true))
    expect(hits.length).toBe(2)
    expect(hits.some((u) => u.text!.includes('路人甲'))).toBe(true)
    expect(hits.some((u) => u.text!.includes('路人乙'))).toBe(true)
  })
})
