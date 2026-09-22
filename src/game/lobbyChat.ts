import { BOTS, type BotPersona } from './bots'
import { ALL_SUB_STAGE_IDS, getSubStage, subStageOrder } from './campaign'
import { SPECIAL_CARDS, type SpecialCardId } from './specialCards'
import { getAchievement, TIER_NAME_ZH } from './achievements'
import { STICKERS } from './stickers'
import CONTENT, { type Line, type LobbyCtaSpec } from '../data/chatContent'
import type { LobbyMsg } from '../net/lobby'

/**
 * 大廳聊天「產句引擎 v2」(見 docs/LOBBY-AI-SPEC.md §13)。純邏輯、無 React/Firebase。
 *
 * 觀念(三層)：碎片(fragments) → 意圖模板(帶 {替代符}) → 對局勢填值 = 一句話。
 *   - 環境閒聊 ambientUnit：加權挑「劇場 / 單句 / 貼圖 / 主動」其一，組出一段(可多則)。
 *   - 反應式 reactUnit：真人發言 → ①貼圖回應池 ②關鍵字命中池 ③依狀態(訪客/連勝/成就…)的
 *     reactRules 取第一個命中 ④保底邀約；可帶 CTA；低機率再由「另一隻」人機補刀一句。
 *   - 佔位符 {name}{streak}{bossName}… 由 host「發送前」填實值 → 非 host 只顯示、不需邏輯。
 *
 * 無 persona：大腦隨機、只有身分是實的 → 一律隨機挑人機。內容全在 chatContent.ts。
 */

// ─── 對外型別 ────────────────────────────────────────────────────────────────
export interface BotUtterance {
  botId: string
  name: string
  avatarId: string
  type: 'text' | 'sticker'
  text?: string
  stickerId?: string
  cta?: NonNullable<LobbyMsg['cta']>
}

/** 大廳「當下」的全域事實（host 餵）。 */
export interface LobbyGlobals {
  onlineCount: number
  hasLive: boolean
  newcomerName?: string
  lastWinner?: string
  lastLoser?: string
  now?: number
}

/** 一位真人發言者的原始資料（host 讀他的玩家資訊卡 + 訊息 payload 組出）。 */
export interface ReactInput {
  name: string
  registered: boolean
  streak: number
  bestStreak: number
  wins: number
  games: number
  clearedOrder: number // maxStageCleared 的 subStageOrder；-1 = 什麼都沒過
  achvList: { id: string; tier: number }[] // 他「展示」的成就（族 + 銅/銀/金階）
  loadout: string[] // 他設的預設特殊牌 id（≤3）
  isSticker: boolean
  stickerId?: string
  text?: string
}

// ─── 內部：解析後的事實（供佔位符 + guard）────────────────────────────────────
interface BossFacts {
  no: string
  name: string
  card: string
  style: string
  skill: string
}
interface Facts {
  name: string
  registered: boolean
  streak: number
  bestStreak: number
  wins: number
  games: number
  winRate: number | null
  achvList: { id: string; tier: number }[]
  hasLoadout: boolean
  loadoutName: string | null
  clearedOrder: number
  boss: BossFacts | null
  onlineCount: number
  hasLive: boolean
  newcomerName?: string
  lastWinner?: string
  lastLoser?: string
  morning: boolean
  night: boolean
}

// ─── 靜態對照（從遊戲資料取真值，避免亂命名）──────────────────────────────────
/** boss 頭像 id → 角色名（= PlayerAvatar 的 AVATARS 名；此處內建以免 game 層依賴 ui）。 */
const BOSS_NAME: Record<string, string> = {
  cat: '橘貓', bird: '鳥鳥', cat2: '英國短毛貓', bear: '北極熊', dog: '紅貴賓', cat3: '波斯貓', bird2: '貓頭鷹',
}
const STYLE_LABEL: Record<string, string> = { attack: '強攻', hoard: '囤牌', balance: '平衡' }
const SKILL_LABEL: Record<string, string> = { bluff: '詐唬', draw: '拼牌', jokerTiming: '鬼牌時機', insight: '看破' }
const BOSS_CARD_NAMES = Object.values(SPECIAL_CARDS).map((c) => c.name)
const BOSS_CHAR_NAMES = ['鳥鳥', '英國短毛貓', '北極熊', '紅貴賓', '波斯貓', '貓頭鷹']
const STICKER_NAMES = STICKERS.map((s) => s.name)

// ─── 小工具 ──────────────────────────────────────────────────────────────────
const rng0 = Math.random
function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}
/** n 隻不同的隨機人機（從給定名單抽，預設全部）。 */
export function pickBots(n: number, rng: () => number = rng0, from: BotPersona[] = BOTS): BotPersona[] {
  const pool = [...from]
  const out: BotPersona[] = []
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
  return out
}
const mkUtter = (b: BotPersona, patch: Partial<BotUtterance>): BotUtterance => ({
  botId: b.id, name: b.name, avatarId: b.avatarId, type: 'text', ...patch,
})

// ─── 全域防重複（host 是唯一嘴巴 → 全域冷卻即可；壓的是「句型」重複感）─────────
const recent: string[] = []
function isCooled(key: string): boolean {
  return recent.includes(key)
}
function noteUsed(key: string): void {
  recent.push(key)
  const cap = CONTENT.config.cooldownSize ?? 25
  while (recent.length > cap) recent.shift()
}

// ─── 事實解析 ────────────────────────────────────────────────────────────────
function bossForOrder(order: number): BossFacts | null {
  const nextId = ALL_SUB_STAGE_IDS[order + 1] // order=-1 → index0 = 's1-1'（他在打 1-1）
  if (!nextId) return null // 已全破 → 沒有「正在打的關」
  const found = getSubStage(nextId)
  if (!found) return null
  const { stage, sub } = found
  const p = stage.profile
  const styleKey = (Object.entries(p.pickMain).sort((a, b) => b[1] - a[1])[0] ?? ['balance'])[0]
  const skills: [string, number][] = [
    ['bluff', p.bluff], ['draw', p.draw], ['jokerTiming', p.jokerTiming], ['insight', p.insight],
  ]
  const skillKey = skills.sort((a, b) => b[1] - a[1])[0][0]
  return {
    no: sub.label,
    name: BOSS_NAME[stage.bossAvatar] ?? stage.name,
    card: SPECIAL_CARDS[stage.signatureCard]?.name ?? '',
    style: STYLE_LABEL[styleKey] ?? '平衡',
    skill: SKILL_LABEL[skillKey] ?? '看破',
  }
}

function reactFacts(inp: ReactInput, g: LobbyGlobals): Facts {
  const ts = new Date(g.now ?? Date.now())
  const hr = ts.getHours()
  const loadoutName = inp.loadout.length
    ? (SPECIAL_CARDS[inp.loadout[Math.floor(rng0() * inp.loadout.length)] as SpecialCardId]?.name ?? null)
    : null
  return {
    name: inp.name || '玩家',
    registered: inp.registered,
    streak: inp.streak,
    bestStreak: inp.bestStreak,
    wins: inp.wins,
    games: inp.games,
    winRate: inp.games > 0 ? Math.round((inp.wins / inp.games) * 100) : null,
    achvList: inp.achvList ?? [],
    hasLoadout: (inp.loadout?.length ?? 0) > 0,
    loadoutName,
    clearedOrder: inp.clearedOrder,
    boss: bossForOrder(inp.clearedOrder),
    onlineCount: g.onlineCount,
    hasLive: g.hasLive,
    newcomerName: g.newcomerName,
    lastWinner: g.lastWinner,
    lastLoser: g.lastLoser,
    morning: hr >= 5 && hr < 11,
    night: hr >= 0 && hr < 5,
  }
}

/** 沒有發言者（環境閒聊 / 主動）時的事實：只有全域 + 隨機實體可用。 */
function ambientFacts(g: LobbyGlobals): Facts {
  const ts = new Date(g.now ?? Date.now())
  const hr = ts.getHours()
  return {
    name: '', registered: true, streak: 0, bestStreak: 0, wins: 0, games: 0, winRate: null,
    achvList: [], hasLoadout: false, loadoutName: null, clearedOrder: -1, boss: null,
    onlineCount: g.onlineCount, hasLive: g.hasLive, newcomerName: g.newcomerName,
    lastWinner: g.lastWinner, lastLoser: g.lastLoser,
    morning: hr >= 5 && hr < 11, night: hr >= 0 && hr < 5,
  }
}

// ─── guard（極小判斷式；只支援 && 串接，無 || 無括號，看不懂就當「這句何時出現」）──
function pickAchvName(list: { id: string; tier: number }[], minTier: number, rng: () => number): string {
  const cands = list.filter((a) => a.tier >= minTier)
  if (!cands.length) return ''
  const a = pick(cands, rng)
  const fam = getAchievement(a.id)
  return fam ? `${TIER_NAME_ZH[a.tier] ?? ''}${fam.name}` : ''
}
/** guard 內若提到 銀/金成就 → 挑成就時的最低階（否則 1）。 */
function achvMinTierOf(guard?: string): number {
  if (!guard) return 1
  if (guard.includes('goldAchv')) return 3
  if (guard.includes('silverAchv')) return 2
  return 1
}
function evalTerm(term: string, F: Facts): boolean {
  let neg = false
  let t = term.trim()
  if (t.startsWith('!')) { neg = true; t = t.slice(1).trim() }
  let res: boolean
  if (t.startsWith('beforeStage:')) res = F.clearedOrder < subStageOrder('s' + t.slice('beforeStage:'.length))
  else if (t.startsWith('afterStage:')) res = F.clearedOrder >= subStageOrder('s' + t.slice('afterStage:'.length))
  else if (/[<>=]/.test(t)) {
    const m = t.match(/^([a-zA-Z]+)\s*(>=|<=|==|>|<)\s*(\d+)$/)
    if (!m) res = false
    else {
      const val = ({ streak: F.streak, bestStreak: F.bestStreak, wins: F.wins, games: F.games, winRate: F.winRate ?? -1, online: F.onlineCount } as Record<string, number>)[m[1]] ?? 0
      const n = Number(m[3])
      res = m[2] === '>=' ? val >= n : m[2] === '<=' ? val <= n : m[2] === '>' ? val > n : m[2] === '<' ? val < n : val === n
    }
  } else {
    res = ({
      guest: !F.registered, registered: F.registered,
      showsAchv: F.achvList.length > 0, silverAchv: F.achvList.some((a) => a.tier >= 2), goldAchv: F.achvList.some((a) => a.tier >= 3),
      hasLoadout: F.hasLoadout, hasBoss: !!F.boss, hasLive: F.hasLive, morning: F.morning, night: F.night,
    } as Record<string, boolean>)[t] ?? false
  }
  return neg ? !res : res
}
function evalGuard(guard: string | undefined, F: Facts): boolean {
  if (!guard) return true
  return guard.split('&&').every((term) => evalTerm(term, F))
}

// ─── 佔位符解析 ──────────────────────────────────────────────────────────────
function fragment(name: string, rng: () => number): string {
  const pool = CONTENT.fragments[name]
  return pool && pool.length ? pick(pool, rng) : ''
}
/** 把 {token} 換成實值。回傳 null = 這句有無法解析的佔位符（該跳過）。 */
function resolveText(t: string, F: Facts, minTier: number, rng: () => number): string | null {
  let bad = false
  const out = t.replace(/\{(\w+)\}/g, (_, tok: string) => {
    const v = tokenValue(tok, F, minTier, rng)
    if (v === null) { bad = true; return '' }
    return v
  })
  return bad ? null : out
}
function tokenValue(tok: string, F: Facts, minTier: number, rng: () => number): string | null {
  switch (tok) {
    case 'name': return F.name || null
    case 'streak': return F.streak > 0 ? String(F.streak) : null
    case 'bestStreak': return F.bestStreak > 0 ? String(F.bestStreak) : null
    case 'wins': return String(F.wins)
    case 'games': return String(F.games)
    case 'winRate': return F.winRate != null ? String(F.winRate) : null
    case 'achv': { const a = pickAchvName(F.achvList, minTier, rng); return a || null }
    case 'loadoutCard': return F.loadoutName
    case 'stageNo': return F.boss ? F.boss.no : null
    case 'bossName': return F.boss ? F.boss.name : null
    case 'bossCard': return F.boss ? F.boss.card : null
    case 'bossStyle': return F.boss ? F.boss.style : null
    case 'bossSkill': return F.boss ? F.boss.skill : null
    case 'onlineCount': return String(F.onlineCount)
    case 'newcomerName': return F.newcomerName || null
    case 'lastWinner': return F.lastWinner || null
    case 'lastLoser': return F.lastLoser || null
    case 'anyCard': return pick(BOSS_CARD_NAMES, rng)
    case 'anyBoss': return pick(BOSS_CHAR_NAMES, rng)
    case 'anySticker': return pick(STICKER_NAMES, rng)
    case 'opener': return fragment('opener', rng)
    case 'invite': return fragment('invite', rng)
    default: { const frag = fragment(tok, rng); return frag || null }
  }
}

// ─── CTA 解析 ────────────────────────────────────────────────────────────────
const CTA_LABEL: Record<string, string> = {
  register: '遊戲帳號註冊', google: 'Google 登入', quickmatch: '快速配對', campaign: '前往主線',
  tutorial: '新手教學', personalize: '個人化設定', loadout: '設定預設特殊牌', achvShow: '展示成就',
  leaderboard: '排行榜', replays: '賽事回放', daily: '每日任務', shop: '前往商城', spectate: '去看戰況',
}
type CtaOut = NonNullable<LobbyMsg['cta']>[number]
/** 把 line 的 cta 規格 → LobbyMsg cta 陣列（依 ctaChance 決定要不要掛；不掛回 undefined）。 */
function resolveCtas(spec: LobbyCtaSpec | undefined, lineChance: number | undefined, F: Facts, rng: () => number): CtaOut[] | undefined {
  if (!spec) return undefined
  const raw = Array.isArray(spec) ? spec : [spec]
  const names = raw.map((s) => String(s))
  const base = names[0].split('-')[0]
  const chance = lineChance ?? CONTENT.config.ctaChance?.[base] ?? 1
  if (rng() >= chance) return undefined
  const out: CtaOut[] = []
  for (const n of names) {
    if (n === 'quickmatch') out.push({ action: 'quickmatch', room: rng() < 0.5 ? 'normal' : 'special', label: CTA_LABEL.quickmatch })
    else if (n === 'quickmatch-normal') out.push({ action: 'quickmatch', room: 'normal', label: '快速配對（一般）' })
    else if (n === 'quickmatch-special') out.push({ action: 'quickmatch', room: 'special', label: '快速配對（特殊）' })
    else if (n === 'spectate') { if (F.hasLive) out.push({ action: 'spectate', label: CTA_LABEL.spectate }) } // 沒 live 就不掛觀戰鈕
    else out.push({ action: n as CtaOut['action'], label: CTA_LABEL[n] ?? n })
  }
  return out.length ? out : undefined
}

// ─── 從 Line[] 挑一句（guard 過濾 + 佔位可解析 + 冷卻 + 加權）───────────────────
interface Resolved { text?: string; stickerId?: string; cta?: CtaOut[] }
function pickLine(pool: Line[] | undefined, F: Facts, minTier: number, rng: () => number, ruleCta?: LobbyCtaSpec, ruleChance?: number): Resolved | null {
  if (!pool || !pool.length) return null
  const ok = pool.filter((l) => evalGuard(l.guard, F) && (l.sticker != null || l.t == null || resolveText(l.t, F, minTier, rng) != null))
  if (!ok.length) return null
  const fresh = ok.filter((l) => !isCooled(l.t ?? l.sticker ?? ''))
  const cands = fresh.length ? fresh : ok
  // 加權挑
  const total = cands.reduce((s, l) => s + (l.w ?? 1), 0)
  let r = rng() * total
  let chosen = cands[0]
  for (const l of cands) { r -= l.w ?? 1; if (r <= 0) { chosen = l; break } }
  noteUsed(chosen.t ?? chosen.sticker ?? '')
  const cta = resolveCtas(chosen.cta ?? ruleCta, chosen.ctaChance ?? ruleChance, F, rng)
  if (chosen.sticker != null) return { stickerId: chosen.sticker, cta }
  let text = resolveText(chosen.t ?? '', F, minTier, rng) ?? ''
  // 單句可自動前綴語助詞（opener≠false 且句子沒自帶 {opener}）
  if (chosen.opener !== false && !(chosen.t ?? '').includes('{opener}') && rng() < (CONTENT.config.openerChance ?? 0.4)) {
    const op = fragment('opener', rng)
    if (op) text = `${op}${text}`
  }
  return { text, cta }
}

// ─── 對外：冷場首句（招呼）─────────────────────────────────────────────────────
export function greetingUtter(bots: BotPersona[] = BOTS, rng: () => number = rng0): BotUtterance {
  const b = pick(bots.length ? bots : BOTS, rng)
  const pool = CONTENT.greetings.length ? CONTENT.greetings : CONTENT.singles
  const F = ambientFacts({ onlineCount: 0, hasLive: false })
  const line = pickLine(pool, F, 1, rng)
  return mkUtter(b, line?.stickerId ? { type: 'sticker', stickerId: line.stickerId } : { text: line?.text ?? '' })
}

// ─── 對外：有人上線的招呼（帶名字）────────────────────────────────────────────
export function arrivalGreeting(name: string, bots: BotPersona[] = BOTS, g?: LobbyGlobals, rng: () => number = rng0): BotUtterance | null {
  const F = ambientFacts({ ...(g ?? { onlineCount: 0, hasLive: false }), newcomerName: name })
  const line = pickLine(CONTENT.proactive.greet_newcomer, F, 1, rng)
  if (!line) return null
  const b = pick(bots.length ? bots : BOTS, rng)
  return mkUtter(b, line.stickerId ? { type: 'sticker', stickerId: line.stickerId, cta: line.cta } : { text: line.text, cta: line.cta })
}

// ─── 對外：一個環境閒聊單元（劇場 / 單句 / 貼圖 / 主動）────────────────────────
export function ambientUnit(bots: BotPersona[] = BOTS, g?: LobbyGlobals, rng: () => number = rng0): BotUtterance[] {
  const roster = bots.length ? bots : BOTS
  const F = ambientFacts(g ?? { onlineCount: 0, hasLive: false })
  const w = CONTENT.config.ambientWeights ?? { thread: 5, single: 3, sticker: 1, proactive: 2 }
  const cat = weightedCat(w, rng)

  if (cat === 'thread' && CONTENT.threads.length) {
    const shape = pick(CONTENT.threads, rng)
    const roles = [...new Set(shape.beats.map((b) => b.role))]
    const cast = pickBots(roles.length, rng, roster)
    const byRole: Record<string, BotPersona> = {}
    roles.forEach((r, i) => (byRole[r] = cast[i] ?? cast[0] ?? pick(roster, rng)))
    // thread 內共用槽（例：同一張牌名貫穿問→答→反應）→ 先鎖定一個隨機值
    const slotVals: Record<string, string> = {}
    for (const [k, kind] of Object.entries(shape.slots ?? {})) {
      slotVals[k] = kind === 'anyCard' ? pick(BOSS_CARD_NAMES, rng) : kind === 'anyBoss' ? pick(BOSS_CHAR_NAMES, rng) : kind === 'anySticker' ? pick(STICKER_NAMES, rng) : ''
    }
    const out: BotUtterance[] = []
    for (const beat of shape.beats) {
      const b = byRole[beat.role] ?? pick(roster, rng)
      const line = pickLine(CONTENT.beatPools[beat.pool], F, 1, rng)
      if (!line) continue
      let text = line.text
      if (text) for (const [k, v] of Object.entries(slotVals)) text = text!.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
      out.push(mkUtter(b, line.stickerId ? { type: 'sticker', stickerId: line.stickerId } : { text }))
    }
    return out
  }

  if (cat === 'sticker' && CONTENT.ambientStickers.length) {
    return [mkUtter(pick(roster, rng), { type: 'sticker', stickerId: pick(CONTENT.ambientStickers, rng) })]
  }

  if (cat === 'proactive') {
    const u = ambientProactive(roster, F, rng)
    if (u) return [u]
  }

  // 預設：單句
  const line = pickLine(CONTENT.singles, F, 1, rng)
  return line ? [mkUtter(pick(roster, rng), line.stickerId ? { type: 'sticker', stickerId: line.stickerId, cta: line.cta } : { text: line.text, cta: line.cta })] : []
}

type Cat = 'thread' | 'single' | 'sticker' | 'proactive'
function weightedCat(w: Partial<Record<Cat, number>>, rng: () => number): Cat {
  const entries: [Cat, number][] = (['thread', 'single', 'sticker', 'proactive'] as Cat[]).map((c) => [c, w[c] ?? 0])
  const total = entries.reduce((s, e) => s + e[1], 0) || 1
  let r = rng() * total
  for (const [c, ww] of entries) { r -= ww; if (r <= 0) return c }
  return 'single'
}

/** 只用全域事實的主動句（線上人數 / 虛構強者梗 / 時段）。有名字的招呼在 arrivalGreeting。 */
function ambientProactive(roster: BotPersona[], F: Facts, rng: () => number): BotUtterance | null {
  const kinds: string[] = ['online_count', 'gossip_gm']
  if (F.morning) kinds.push('time_morning')
  if (F.night) kinds.push('time_night')
  if (F.lastWinner && F.lastLoser) kinds.push('announce_replay')
  const kind = pick(kinds, rng)
  const line = pickLine(CONTENT.proactive[kind], F, 1, rng)
  if (!line) return null
  return mkUtter(pick(roster, rng), line.stickerId ? { type: 'sticker', stickerId: line.stickerId, cta: line.cta } : { text: line.text, cta: line.cta })
}

// ─── 對外：真人發言 → 一則(或兩則:補刀)回覆 ─────────────────────────────────────
export function reactUnit(inp: ReactInput, bots: BotPersona[] = BOTS, g?: LobbyGlobals, rng: () => number = rng0): BotUtterance[] {
  const roster = bots.length ? bots : BOTS
  const F = reactFacts(inp, g ?? { onlineCount: 0, hasLive: false })

  let pool: Line[] | undefined
  let ruleCta: LobbyCtaSpec | undefined
  let ruleChance: number | undefined
  let minTier = 1

  if (inp.isSticker && inp.stickerId) {
    // ① 收到貼圖 → 該貼圖的回應池（沒有就用通用 sticker 池）
    pool = CONTENT.stickerReplies[inp.stickerId] ?? CONTENT.stickerReplies['*']
  }
  if (!pool || !pool.length) {
    // ② 關鍵字命中（有序 + 加權，取第一個命中）
    const hit = matchKeyword(inp.text ?? '')
    if (hit) pool = CONTENT.kwPools[hit]
  }
  if (!pool || !pool.length) {
    // ③ 依狀態的 reactRules（有序，第一個 guard 通過者）
    for (const rule of CONTENT.reactRules) {
      if (!evalGuard(rule.when, F)) continue
      pool = rule.say
      ruleCta = rule.cta
      ruleChance = rule.ctaChance
      minTier = achvMinTierOf(rule.when)
      break
    }
  }
  const line = pickLine(pool, F, minTier, rng, ruleCta, ruleChance)
  if (!line) return []
  const b0 = pick(roster, rng)
  const reply = mkUtter(b0, line.stickerId ? { type: 'sticker', stickerId: line.stickerId, cta: line.cta } : { text: line.text, cta: line.cta })
  const out = [reply]

  // ④ 低機率「補刀」：換一隻人機接一句短的（純附和/吐槽，不帶 CTA）
  if (rng() < (CONTENT.config.pileOnChance ?? 0.15) && CONTENT.pileOn?.length) {
    const pileLine = pickLine(CONTENT.pileOn, F, 1, rng)
    if (pileLine) {
      const others = roster.filter((b) => b.id !== b0.id)
      const b1 = others.length ? pick(others, rng) : b0
      out.push(mkUtter(b1, pileLine.stickerId ? { type: 'sticker', stickerId: pileLine.stickerId } : { text: pileLine.text }))
    }
  }
  return out
}

/** 中文關鍵字比對：字元共現（any=任一命中、all=全部要有）。有序 + 加權，回命中的池名。 */
function matchKeyword(text: string): string | null {
  if (!text) return null
  const t = text.toLowerCase()
  const hits = CONTENT.keywords.filter((k) => {
    const anyOk = !k.any || k.any.some((s) => t.includes(s.toLowerCase()))
    const allOk = !k.all || k.all.every((s) => t.includes(s.toLowerCase()))
    return anyOk && allOk
  })
  if (!hits.length) return null
  hits.sort((a, b) => (b.w ?? 1) - (a.w ?? 1))
  return hits[0].intent
}
