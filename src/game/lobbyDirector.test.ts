import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createChatDirector, GAP_MIN, GREET_QUIET_MS, type ChatDirector } from './lobbyDirector'
import type { ReactInput } from './lobbyChat'
import CHAT from '../data/chatContent'

/**
 * 多分頁劇本模擬：假時鐘 + 共用聊天記錄 + 測試掌控的 host 鎖 + 可選網路延遲。
 * 每個劇本結束都檢查：
 *   ① 不是 host 不准寫（無延遲時嚴格為 0）
 *   ② 任兩則人機訊息間隔 ≥ GAP_MIN(9s) —— 不會有「兩條執行緒 2 秒內各講一句」
 *   ③ 沒有聽眾時不講
 */
interface Msg { ts: number; tab: string; text?: string; sticker?: string; isHost: boolean; audience: number }

const SEC = 1000
const MIN = 60 * SEC
const greetTexts = CHAT.greetings.map((g) => g.t!).filter(Boolean)
const isGreeting = (m: Msg) => !!m.text && greetTexts.some((g) => m.text!.endsWith(g))
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeWorld(opts: { latency?: number; seed?: number } = {}) {
  const latency = opts.latency ?? 0
  const log: Msg[] = []
  const humanTs: number[] = []
  const events: string[] = [] // 除錯追蹤：失敗時印出出事前發生了什麼
  const ev = (s: string) => events.push(`${new Date(Date.now()).toISOString().slice(11, 19)} ${s}`)
  const tabs = new Map<string, ChatDirector>()
  const audienceOf = new Map<string, number>()
  let hostTab: string | null = null

  const broadcastTs = (ts: number) => {
    const deliver = () => { for (const t of tabs.values()) t.setLastMessageTs(ts) }
    latency ? setTimeout(deliver, latency) : deliver()
  }
  const tab = (id: string) => {
    const d = createChatDirector({
      write: async (u) => {
        ev(`WRITE ${id}「${u.text ?? u.stickerId}」 host=${hostTab} aud=${audienceOf.get(id)}`)
        log.push({ ts: Date.now(), tab: id, text: u.text, sticker: u.stickerId, isHost: hostTab === id, audience: audienceOf.get(id) ?? 0 })
        broadcastTs(Date.now())
      },
      verifyHost: async () => { if (latency) await sleep(latency / 2); return hostTab === id },
      sleep,
      now: () => Date.now(),
      rand: opts.seed != null ? mulberry32(opts.seed * 101 + id.charCodeAt(0)) : undefined,
    })
    const setAud = d.setAudience
    d.setAudience = (n: number) => { if (audienceOf.get(id) !== n) ev(`aud ${id}=${n}`); audienceOf.set(id, n); setAud(n) }
    tabs.set(id, d)
    return d
  }
  /** 把 host 交給 id（null = 沒人當 host）。舊 host 失去資格；新 host 觸發 onBecameHost。 */
  const giveHost = (id: string | null, cold = false, awayMs?: number) => {
    ev(`host ${hostTab} -> ${id}${cold ? ' (cold)' : ''}${awayMs != null ? ` away=${awayMs}` : ''}`)
    if (hostTab) tabs.get(hostTab)!.setHost(false)
    hostTab = id
    if (id) tabs.get(id)!.onBecameHost(cold, awayMs)
  }
  const human = () => { humanTs.push(Date.now()); broadcastTs(Date.now()) }
  const since = (t0: number) => log.filter((m) => m.ts >= t0)
  /** 共同健康檢查 */
  const healthy = (strictHost = true) => {
    const gaps: number[] = []
    for (let i = 1; i < log.length; i++) gaps.push(log[i].ts - log[i - 1].ts)
    const around = (text?: string) => {
      const k = events.findIndex((e) => e.includes(`「${text}」`))
      return '\n' + events.slice(Math.max(0, k - 12), k + 2).join('\n')
    }
    const tooClose = gaps.map((g, i) => ({ g, i })).filter(({ g }) => g < GAP_MIN)
      .map(({ g, i }) => `「${log[i].text}」→「${log[i + 1].text}」只隔 ${(g / 1000).toFixed(1)}s` + around(log[i + 1].text))
    expect(tooClose, '間隔過近').toEqual([])
    expect(log.filter((m) => m.audience < 1).map((m) => m.text + around(m.text)), '沒聽眾還在講').toEqual([])
    if (strictHost) expect(log.filter((m) => !m.isHost).map((m) => `${m.tab}:${m.text}`), '非 host 寫訊息').toEqual([])
    return { count: log.length, minGap: gaps.length ? Math.min(...gaps) : Infinity }
  }
  return { log, tab, giveHost, human, since, healthy, get hostTab() { return hostTab } }
}

const human = (patch: Partial<ReactInput>): ReactInput => ({
  name: '阿明', registered: true, streak: 0, bestStreak: 0, wins: 0, games: 0,
  clearedOrder: 4, achvList: [], loadout: ['peek'], isSticker: false, ...patch,
})

describe('大廳聊天導演：多分頁劇本模擬', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T20:00:00')) })
  afterEach(() => { vi.useRealTimers() })

  it('劇本1 冷啟動、只有我一人：立刻打招呼，聊一輪(6~9 單元)後安靜', async () => {
    const w = makeWorld()
    const A = w.tab('A')
    A.setAudience(1)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(100)
    expect(w.log.length).toBe(1)
    expect(isGreeting(w.log[0])).toBe(true)
    await vi.advanceTimersByTimeAsync(5 * MIN)
    const n = w.log.length
    expect(n).toBeGreaterThanOrEqual(6)
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(w.log.length).toBe(n)
    w.healthy()
  })

  it('劇本1b 冷啟動但聊天 2 分鐘前才講過 → 不再打招呼、直接接著聊', async () => {
    const w = makeWorld()
    const A = w.tab('A')
    A.setAudience(1)
    A.setLastMessageTs(Date.now() - 2 * MIN)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(4500)
    expect(w.log.length).toBeGreaterThanOrEqual(1)
    await vi.advanceTimersByTimeAsync(3 * MIN)
    expect(w.log.some(isGreeting)).toBe(false)
    w.healthy()
  })

  it('劇本2 我一人：聊完 → 進遊戲 5 分鐘(全程不講) → 回大廳：很快續聊 2~4 則、不打招呼', async () => {
    const w = makeWorld()
    const A = w.tab('A')
    A.setAudience(1)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(6 * MIN)
    A.setAudience(0)
    w.giveHost(null)
    const tGame = Date.now()
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(w.since(tGame).length).toBe(0)
    A.setAudience(1)
    const tBack = Date.now()
    w.giveHost('A', false)
    await vi.advanceTimersByTimeAsync(4500)
    expect(w.since(tBack).length).toBeGreaterThanOrEqual(1)
    await vi.advanceTimersByTimeAsync(3 * MIN)
    const back = w.since(tBack)
    expect(back.some(isGreeting)).toBe(false)
    expect(back.length).toBeGreaterThanOrEqual(2)
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(w.since(tBack).length).toBe(back.length)
    w.healthy()
  })

  it('劇本3 A 主持、B 在看 → A 進遊戲 → B 接手續聊（A 不再發言、不打招呼）', async () => {
    const w = makeWorld()
    const A = w.tab('A'); const B = w.tab('B')
    A.setAudience(2); B.setAudience(2)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(40 * SEC)
    A.setAudience(0)
    B.setAudience(1)
    const tSwap = Date.now() + 15 * SEC
    await vi.advanceTimersByTimeAsync(15 * SEC)
    w.giveHost('B', false)
    await vi.advanceTimersByTimeAsync(2 * MIN)
    const after = w.since(tSwap)
    expect(after.length).toBeGreaterThanOrEqual(2)
    expect(after.every((m) => m.tab === 'B')).toBe(true)
    expect(after.some(isGreeting)).toBe(false)
    w.healthy()
  })

  it('劇本4 B 主持且聊完了 → A 打完遊戲回大廳 → B 很快續聊；切分頁 20 秒 / B 被節流都不誤觸發', async () => {
    const w = makeWorld()
    const B = w.tab('B')
    B.setAudience(2)
    w.giveHost('B', true)
    const runPolls = async (ms: number, uids: string[]) => {
      for (let t = 0; t < ms; t += 6 * SEC) { B.observeActive(uids, 'uidB'); await vi.advanceTimersByTimeAsync(6 * SEC) }
    }
    await runPolls(6 * MIN, ['uidA', 'uidB'])
    B.setAudience(1)
    await runPolls(20 * SEC, ['uidB'])
    B.setAudience(2)
    const tFlick = Date.now()
    await runPolls(30 * SEC, ['uidA', 'uidB'])
    expect(w.since(tFlick).length).toBe(0)
    await vi.advanceTimersByTimeAsync(3 * MIN) // B 被節流 3 分鐘沒 poll
    const tThrottle = Date.now()
    await runPolls(30 * SEC, ['uidA', 'uidB'])
    expect(w.since(tThrottle).length).toBe(0)
    B.setAudience(1)
    await runPolls(4 * MIN, ['uidB'])
    B.setAudience(2)
    const tBack = Date.now()
    B.observeActive(['uidA', 'uidB'], 'uidB')
    await vi.advanceTimersByTimeAsync(4500)
    expect(w.since(tBack).length).toBeGreaterThanOrEqual(1)
    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(w.since(tBack).some(isGreeting)).toBe(false)
    w.healthy()
  })

  it('劇本5 真人道謝 → 回覆插隊第一個出來；15 秒內再講一次不重複回', async () => {
    const w = makeWorld()
    const B = w.tab('B')
    B.setAudience(2)
    w.giveHost('B', true)
    await vi.advanceTimersByTimeAsync(6 * MIN)
    const t0 = Date.now()
    w.human(); B.onHumanMessage('uidA', human({ text: '謝謝你們' }))
    await vi.advanceTimersByTimeAsync(5 * SEC)
    w.human(); B.onHumanMessage('uidA', human({ text: '謝謝' }))
    await vi.advanceTimersByTimeAsync(3 * MIN)
    const out = w.since(t0)
    const thanks = CHAT.kwPools.kw_thanks.map((l) => l.t!).filter(Boolean)
    const isThanks = (m: Msg) => !!m.text && thanks.some((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '.+') + '$').test(m.text!))
    expect(isThanks(out[0]), `第一句「${out[0].text}」不是道謝回覆`).toBe(true) // 回覆排第一
    expect(out.filter(isThanks).length).toBe(1)                                  // 15 秒內第二次不重複回
    w.healthy()
  })

  it('劇本6 host 點開聊天室（安靜很久）→ 4 秒內有一句、不打招呼', async () => {
    const w = makeWorld()
    const A = w.tab('A')
    A.setAudience(1)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(10 * MIN)
    const t0 = Date.now()
    A.onOpened()
    await vi.advanceTimersByTimeAsync(4500)
    expect(w.since(t0).length).toBeGreaterThanOrEqual(1)
    await vi.advanceTimersByTimeAsync(3 * MIN)
    expect(w.since(t0).some(isGreeting)).toBe(false)
    w.healthy()
  })

  it('劇本7 兩分頁搶 host（每 10 秒換一次，持續 2 分鐘）→ 永遠只有 host 在講、間隔都 ≥ GAP_MIN(9 秒)', async () => {
    const w = makeWorld()
    const A = w.tab('A'); const B = w.tab('B')
    A.setAudience(2); B.setAudience(2)
    w.giveHost('A', true)
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(10 * SEC)
      w.giveHost(w.hostTab === 'A' ? 'B' : 'A', false)
    }
    await vi.advanceTimersByTimeAsync(SEC)
    w.healthy()
  })

  // 固定種子跑 100 次：原本用 Math.random 約 1% 會撞到「睡覺期間失去又拿回 host → 醒來沒重算間隔」(seed 25/28 必中)
  it('劇本7b 同上但有網路延遲（換手瞬間舊 host 剛好在送）→ 間隔仍然 ≥ GAP_MIN(9 秒)（100 個種子）', async () => {
    for (let seed = 1; seed <= 100; seed++) {
      vi.setSystemTime(new Date('2026-10-06T20:00:00'))
      const w = makeWorld({ latency: 300, seed })
      const A = w.tab('A'); const B = w.tab('B')
      A.setAudience(2); B.setAudience(2)
      w.giveHost('A', true)
      for (let i = 0; i < 60; i++) { // 每 3~13 秒換一次，持續 ~8 分鐘
        await vi.advanceTimersByTimeAsync(3 * SEC + (i * 7919 % 10) * SEC)
        w.giveHost(w.hostTab === 'A' ? 'B' : 'A', false)
      }
      await vi.advanceTimersByTimeAsync(SEC)
      w.healthy(false) // 有延遲時，舊 host 確認完的那一則可能晚 150ms 落地（無害），只驗間隔
      vi.clearAllTimers()
    }
  }, 60_000)

  it('劇本8 大家都離開大廳 → 沒有聽眾就完全不講', async () => {
    const w = makeWorld()
    const A = w.tab('A')
    A.setAudience(1)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(20 * SEC)
    A.setAudience(0)
    const t0 = Date.now()
    await vi.advanceTimersByTimeAsync(10 * MIN)
    A.onOpened(); A.onHumanMessage('x', human({ text: 'hi' }))
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(w.since(t0).length).toBe(0)
    w.healthy()
  })

  // 2026-10-14:看一下回放/觀戰/配對(<45 秒)就回來 → 不補講,只把離開前剩下的講完
  it('劇本10 只有我、聊到一半去看回放 4 秒就回來 → 額度照離開前剩的(不補),講完就停、不再打招呼', async () => {
    const w = makeWorld({ seed: 7 })
    const A = w.tab('A')
    A.setAudience(1)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(30 * SEC) // 聊到一半
    const left = A.debug().quota
    expect(left).toBeGreaterThan(0)
    A.setAudience(0); w.giveHost(null) // 去看回放
    expect(A.debug().quota).toBe(0)
    await vi.advanceTimersByTimeAsync(4 * SEC)
    A.setAudience(1); w.giveHost('A', false, 7 * SEC) // 回來(含 3 秒開場延遲)
    // 剩多少就講多少,不補 2~4(回來那一刻可能已經開講剩下的第一段 → 少 1)
    expect(A.debug().quota).toBeLessThanOrEqual(left)
    expect(A.debug().quota).toBeGreaterThanOrEqual(left - 1)
    const t0 = Date.now()
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(w.since(t0).length).toBeGreaterThan(0) // 有把剩下的講完
    expect(A.debug().quota).toBe(0)
    expect(w.log.filter(isGreeting).length).toBe(1) // 只有最開頭那句招呼
    w.healthy()
  })

  it('劇本10b 只有我、聊完了去看回放 3 秒就回來 → 完全不講', async () => {
    const w = makeWorld()
    const A = w.tab('A')
    A.setAudience(1)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(10 * MIN)
    A.setAudience(0); w.giveHost(null)
    await vi.advanceTimersByTimeAsync(3 * SEC)
    const t0 = Date.now()
    A.setAudience(1); w.giveHost('A', false, 6 * SEC)
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(w.since(t0).length).toBe(0)
    w.healthy()
  })

  it('劇本10c 連續快速進出 5 次(每次 3 秒) → 一句都不多講', async () => {
    const w = makeWorld()
    const A = w.tab('A')
    A.setAudience(1)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(10 * MIN)
    const t0 = Date.now()
    for (let i = 0; i < 5; i++) {
      A.setAudience(0); w.giveHost(null)
      await vi.advanceTimersByTimeAsync(3 * SEC)
      A.setAudience(1); w.giveHost('A', false, 6 * SEC)
      await vi.advanceTimersByTimeAsync(20 * SEC)
    }
    await vi.advanceTimersByTimeAsync(3 * MIN)
    expect(w.since(t0).length).toBe(0)
    w.healthy()
  })

  it('劇本10d 離開超過 45 秒(打完一場)才回來 → 照舊續聊(補 2~4 段)', async () => {
    const w = makeWorld()
    const A = w.tab('A')
    A.setAudience(1)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(10 * MIN)
    A.setAudience(0); w.giveHost(null)
    await vi.advanceTimersByTimeAsync(3 * MIN)
    const t0 = Date.now()
    A.setAudience(1); w.giveHost('A', false, 3 * MIN + 3 * SEC)
    const q = A.debug().quota
    expect(q).toBeGreaterThanOrEqual(1) // 補了 2~4 段(第一段可能已經在講)
    expect(q).toBeLessThanOrEqual(4)
    await vi.advanceTimersByTimeAsync(3 * MIN)
    const back = w.since(t0)
    expect(back.length).toBeGreaterThanOrEqual(2)
    expect(back.some(isGreeting)).toBe(false)
    w.healthy()
  })

  it('劇本10e A 主持、B 在場；A 去觀戰 4 秒回來搶回自己的 host → 不補講；B 之後才接手是一般換手 → 照舊續聊', async () => {
    const w = makeWorld()
    const A = w.tab('A'); const B = w.tab('B')
    A.setAudience(2); B.setAudience(2)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(10 * MIN) // 聊完
    A.setAudience(1); B.setAudience(1); w.giveHost(null) // A 去觀戰(B 還在,15s 內不會接手)
    await vi.advanceTimersByTimeAsync(4 * SEC)
    const t0 = Date.now()
    A.setAudience(2); B.setAudience(2); w.giveHost('A', false, 7 * SEC)
    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(w.since(t0).length).toBe(0)
    // A 真的離開很久 → B 接手(B 沒離開過 → awayMs 未知)→ 一般換手,續聊
    A.setAudience(0); B.setAudience(1); w.giveHost('B', false)
    const t1 = Date.now()
    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(w.since(t1).length).toBeGreaterThanOrEqual(2)
    w.healthy()
  })

  it('劇本9 舊導演被停用(HMR) → 同一分頁不會兩條迴圈一起講', async () => {
    const w = makeWorld()
    const A1 = w.tab('A')
    A1.setAudience(1)
    w.giveHost('A', true)
    await vi.advanceTimersByTimeAsync(15 * SEC)
    A1.dispose()
    const A2 = w.tab('A') // 同一分頁的新導演
    A2.setAudience(1)
    A2.setLastMessageTs(w.log[w.log.length - 1]?.ts ?? null) // 真實 app：新導演第一次 render 就會被餵最後一則時間
    A2.onBecameHost(false)
    await vi.advanceTimersByTimeAsync(5 * MIN)
    w.healthy()
  })
})

describe('大廳聊天導演：隨機壓力測試（3 分頁亂進亂出、亂換手、亂發言）', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T19:00:00')) })
  afterEach(() => { vi.useRealTimers() })

  const SEEDS = 20
  const HOURS = 2
  const TEXTS = ['謝謝', '怎麼玩', '你好爛', '安安', '先走了', '哈哈哈', '今天天氣不錯', '有人嗎']

  for (const latency of [0, 300]) {
    it(`${SEEDS} 個種子 × ${HOURS} 小時（網路延遲 ${latency}ms）：間隔永遠 ≥9s、沒聽眾不講、招呼只在安靜 ≥10 分後`, async () => {
      const stats: string[] = []
      for (let seed = 1; seed <= SEEDS; seed++) {
        vi.setSystemTime(new Date('2026-10-06T19:00:00'))
        const rnd = mulberry32(seed)
        const w = makeWorld({ latency, seed })
        const ids = ['A', 'B', 'C']
        const dirs = Object.fromEntries(ids.map((id) => [id, w.tab(id)]))
        const present: Record<string, boolean> = { A: true, B: rnd() < 0.5, C: false }
        let hostGoneAt = -Infinity
        const aud = () => ids.filter((i) => present[i]).length
        const syncAud = () => ids.forEach((i) => dirs[i].setAudience(present[i] ? aud() : 0))
        syncAud()
        w.giveHost('A', true)
        const ticks = (HOURS * 60 * MIN) / (6 * SEC)
        for (let k = 0; k < ticks; k++) {
          for (const i of ids) { // 進出大廳（打一場、切分頁、離線）
            if (present[i] && rnd() < 0.02) present[i] = false
            else if (!present[i] && rnd() < 0.05) present[i] = true
          }
          syncAud()
          const h = w.hostTab
          if (h && !present[h]) { w.giveHost(null); hostGoneAt = Date.now() }
          if (!w.hostTab) {
            const cand = ids.filter((i) => present[i])
            if (cand.length && Date.now() - hostGoneAt >= 15 * SEC) {
              w.giveHost(cand[Math.floor(rnd() * cand.length)], Date.now() - hostGoneAt > 30 * SEC)
            }
          } else if (rnd() < 0.01) { // 偶發兩分頁互搶
            const others = ids.filter((i) => present[i] && i !== w.hostTab)
            if (others.length) w.giveHost(others[Math.floor(rnd() * others.length)], false)
          }
          const host = w.hostTab
          if (host) {
            dirs[host].observeActive(ids.filter((i) => present[i]).map((i) => 'uid' + i), 'uid' + host)
            if (rnd() < 0.03) { // 有人發言
              const speaker = ids.filter((i) => present[i])[0]
              w.human()
              dirs[host].onHumanMessage('uid' + speaker, human({ text: TEXTS[Math.floor(rnd() * TEXTS.length)] }))
            }
            if (rnd() < 0.01) dirs[host].onOpened()
          }
          await vi.advanceTimersByTimeAsync(6 * SEC)
        }
        const { count, minGap } = w.healthy(latency === 0)
        // 招呼只出現在「前面安靜 ≥10 分」之後
        const allTs = [...w.log.map((m) => m.ts)].sort((a, b) => a - b)
        for (const m of w.log.filter(isGreeting)) {
          const prev = allTs.filter((t) => t < m.ts).pop()
          if (prev != null) expect(m.ts - prev, `seed ${seed} 招呼前只安靜 ${((m.ts - prev) / 1000).toFixed(0)}s`).toBeGreaterThanOrEqual(GREET_QUIET_MS)
        }
        stats.push(`seed${seed}:${count}則/最小間隔${(minGap / 1000).toFixed(1)}s`)
      }
      console.log(`[壓力測試 延遲${latency}ms] ` + stats.join('  '))
    }, 120_000)
  }
})
