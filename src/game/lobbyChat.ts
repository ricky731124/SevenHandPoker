import { BOTS, type BotPersona } from './bots'
import { ALL_SUB_STAGE_IDS, getSubStage, subStageOrder } from './campaign'
import { SPECIAL_CARDS, type SpecialCardId } from './specialCards'
import { getAchievement, TIER_NAME_ZH } from './achievements'
import { STICKERS } from './stickers'
import CONTENT, { type Line, type LobbyCtaSpec, type ReactRule, type ThreadShape } from '../data/chatContent'
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
  ck?: string[] // 冷卻鍵（句型/劇場/主題/已播報的場次…）→ 跟訊息一起存，換 host 也接得上防重複
}

/** 大廳「當下」的全域事實（host 餵）。 */
export interface LobbyGlobals {
  onlineCount: number
  hasLive: boolean
  liveCode?: string // 當前可觀戰的 live code（spectate CTA 導向用）
  newcomerName?: string
  /** 最近一場打完的對局（精華賽事最新一筆，10 分內）→ announce_replay「剛剛誰打敗誰」。 */
  lastResult?: { id: string; winner: string; loser: string }
  /** 在大廳待一陣子、最近都沒講話的真人 → cue_idle「點名潛水的人」。 */
  lurkers?: { uid: string; name: string }[]
  now?: number
}

/** 一位真人發言者的原始資料（host 讀他的玩家資訊卡 + 訊息 payload 組出）。 */
export interface ReactInput {
  name: string
  username?: string // 帳號（判 isOwner 用；顯示名可重複、帳號穩）
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
  liveCode?: string
  newcomerName?: string
  lastWinner?: string
  lastLoser?: string
  idleName?: string
  isOwner: boolean
  morning: boolean
  afternoon: boolean
  evening: boolean
  night: boolean
}

/** 時段：早上05–11 / 下午11–17 / 晚上17–23 / 深夜23–05。 */
function timeOfDay(now?: number): Pick<Facts, 'morning' | 'afternoon' | 'evening' | 'night'> {
  const hr = new Date(now ?? Date.now()).getHours()
  return {
    morning: hr >= 5 && hr < 11,
    afternoon: hr >= 11 && hr < 17,
    evening: hr >= 17 && hr < 23,
    night: hr >= 23 || hr < 5,
  }
}
/** 帳號是否為 owner（chatContent.config.owners，不分大小寫）。聊天彩蛋與 owner 專屬 UI 共用。 */
export function isOwnerName(username: string | null | undefined): boolean {
  if (!username) return false
  const owners = (CONTENT.config.owners ?? []).map((s) => s.toLowerCase())
  return owners.includes(username.toLowerCase())
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

// ─── 全域防重複 ─────────────────────────────────────────────────────────────
//   冷卻鍵(ck)跟著每則人機訊息存進 lobbyChat → 冷卻狀態 = 「聊天室最近 N 則講過什麼」，
//   不再只存在 host 分頁的記憶體裡（以前換 host / 重整就失憶 → 十句內又出現同一句）。
//   鍵的種類：L:句型 · th:劇場 · tp:主題(特殊牌/BOSS/貼圖…) · rp:已播報的場次 · idle:已點名的人。
//   localKeys = 本分頁剛產生、還沒出現在聊天室的(排隊中的劇場後幾拍/插隊回覆)。
let chatAge = new Map<string, number>() // 鍵 → 幾則訊息前出現過(0=最新一則)
const localKeys: string[] = []
const LOCAL_CAP = 24

/** host 每次聊天室更新就餵進來（useLobby）。只看人機訊息的 ck。 */
export function syncChatHistory(msgs: LobbyMsg[]): void {
  const m = new Map<string, number>()
  for (let i = msgs.length - 1, age = 0; i >= 0; i--, age++) {
    for (const k of msgs[i].ck ?? []) if (!m.has(k)) m.set(k, age)
  }
  chatAge = m
}
/** 這個鍵多久前用過（越小越近；-1 = 本分頁剛用、還沒進聊天室；Infinity = 沒用過）。 */
function ageOf(key: string): number {
  const li = localKeys.lastIndexOf(key)
  if (li >= 0) return -1 - (localKeys.length - 1 - li) * 0.001 // 本地的都算「最新」，越後面越新
  return chatAge.get(key) ?? Infinity
}
const lineWindow = () => CONTENT.config.cooldownSize ?? 30
const topicWindow = () => CONTENT.config.topicCooldown ?? 8
function isCooled(key: string, win = lineWindow()): boolean {
  return ageOf(key) < win
}
function noteLocal(keys: string[]): void {
  localKeys.push(...keys)
  while (localKeys.length > LOCAL_CAP) localKeys.shift()
}
/** 測試用：清空所有冷卻記憶。 */
export function resetCooldownForTest(): void {
  chatAge = new Map()
  localKeys.length = 0
  onceAt.clear()
}

/** 句型 → 短鍵（存進 DB 不要整句中文那麼長）。 */
function hashKey(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}
const lineKey = (l: Line) => 'L:' + hashKey(l.t ?? 'stk:' + (l.sticker ?? ''))

/** 主題：同主題的不同句子(「X好用嗎」「X被低估」「哪張特殊牌最好用」)短時間內也算重複。
 *  優先用句子自己寫的 topic；否則從佔位/字面自動判斷。 */
const CARD_WORDS = ['特殊牌', '鬼牌', '空白牌']
function topicOf(text: string | undefined, explicit?: string): string | null {
  if (explicit) return explicit
  if (!text) return null
  if (/\{(anyCard|card|loadoutCard|bossCard)\}/.test(text) || CARD_WORDS.some((w) => text.includes(w)) || BOSS_CARD_NAMES.some((n) => text.includes(n))) return 'card'
  if (/\{(anyBoss|bossName)\}/.test(text) || BOSS_CHAR_NAMES.some((n) => text.includes(n))) return 'boss'
  if (/\{(anySticker|sticker)\}/.test(text) || text.includes('貼圖') || text.includes('商城')) return 'sticker'
  if (text.includes('回放')) return 'replay'
  if (text.includes('排行')) return 'rank'
  if (text.includes('鼓山金城武')) return 'gm'
  return null
}
const topicKey = (tp: string) => 'tp:' + tp
/** 從一群候選挑「最久沒用過」的（全部都在冷卻時的退路，不再隨機撞到剛講過的）。 */
function leastRecent<T>(arr: T[], keyOf: (x: T) => string): T[] {
  let best = -Infinity
  for (const x of arr) best = Math.max(best, ageOf(keyOf(x)))
  return arr.filter((x) => ageOf(keyOf(x)) === best)
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
    liveCode: g.liveCode,
    newcomerName: g.newcomerName,
    isOwner: isOwnerName(inp.username),
    ...timeOfDay(g.now),
  }
}

/** 沒有發言者（環境閒聊 / 主動）時的事實：只有全域 + 隨機實體可用。 */
function ambientFacts(g: LobbyGlobals): Facts {
  return {
    name: '', registered: true, streak: 0, bestStreak: 0, wins: 0, games: 0, winRate: null,
    achvList: [], hasLoadout: false, loadoutName: null, clearedOrder: -1, boss: null,
    onlineCount: g.onlineCount, hasLive: g.hasLive, liveCode: g.liveCode, newcomerName: g.newcomerName,
    isOwner: false, // lastWinner/lastLoser/idleName 只在挑到那類主動句時才填(ambientProactive)
    ...timeOfDay(g.now),
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
      guest: !F.registered, registered: F.registered, isOwner: F.isOwner,
      showsAchv: F.achvList.length > 0, silverAchv: F.achvList.some((a) => a.tier >= 2), goldAchv: F.achvList.some((a) => a.tier >= 3),
      hasLoadout: F.hasLoadout, hasBoss: !!F.boss, hasLive: F.hasLive,
      morning: F.morning, afternoon: F.afternoon, evening: F.evening, night: F.night,
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
/** 把 {token} 換成實值。回傳 null = 這句有無法解析的佔位符（該跳過）。
 *  `slots` = 劇場共用槽(例 {card}/{sticker})，優先於一般佔位符解析。 */
function resolveText(t: string, F: Facts, minTier: number, rng: () => number, slots?: Record<string, string>): string | null {
  let bad = false
  const out = t.replace(/\{(\w+)\}/g, (_, tok: string) => {
    const v = slots && tok in slots ? slots[tok] || null : tokenValue(tok, F, minTier, rng)
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
    case 'idleName': return F.idleName || null
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
    else if (n === 'spectate') { if (F.hasLive && F.liveCode) out.push({ action: 'spectate', label: CTA_LABEL.spectate, code: F.liveCode }) } // 有 live 才掛觀戰鈕 + 帶當前 code
    else out.push({ action: n as CtaOut['action'], label: CTA_LABEL[n] ?? n })
  }
  return out.length ? out : undefined
}

// ─── 從 Line[] 挑一句（guard 過濾 + 佔位可解析 + 冷卻 + 加權）───────────────────
interface Resolved { text?: string; stickerId?: string; cta?: CtaOut[]; ck: string[] }
interface PickOpts {
  minTier?: number
  ruleCta?: LobbyCtaSpec
  ruleChance?: number
  slots?: Record<string, string> // 劇場共用槽
  noOpener?: boolean             // 劇場句不加語助詞
  avoidTopic?: boolean           // 環境閒聊：最近聊過的主題也先避開（回真人時不避，人家問特殊牌就答特殊牌）
}
function pickLine(pool: Line[] | undefined, F: Facts, rng: () => number, o: PickOpts = {}): Resolved | null {
  if (!pool || !pool.length) return null
  const minTier = o.minTier ?? 1
  const ok = pool.filter((l) => evalGuard(l.guard, F) && (l.sticker != null || l.t == null || resolveText(l.t, F, minTier, rng, o.slots) != null))
  if (!ok.length) return null
  // 冷卻退路：句型+主題都沒用過 → 句型沒用過 → 全都用過就挑「最久以前」的那幾句
  const fresh = ok.filter((l) => !isCooled(lineKey(l)))
  const freshTopic = o.avoidTopic ? fresh.filter((l) => { const tp = topicOf(l.t, l.topic); return !tp || !isCooled(topicKey(tp), topicWindow()) }) : fresh
  const cands = freshTopic.length ? freshTopic : fresh.length ? fresh : leastRecent(ok, lineKey)
  // 加權挑
  const total = cands.reduce((s, l) => s + (l.w ?? 1), 0)
  let r = rng() * total
  let chosen = cands[0]
  for (const l of cands) { r -= l.w ?? 1; if (r <= 0) { chosen = l; break } }
  const tp = topicOf(chosen.t, chosen.topic)
  const ck = [lineKey(chosen), ...(tp ? [topicKey(tp)] : [])]
  noteLocal(ck)
  const cta = resolveCtas(chosen.cta ?? o.ruleCta, chosen.ctaChance ?? o.ruleChance, F, rng)
  if (chosen.sticker != null) return { stickerId: chosen.sticker, cta, ck }
  let text = resolveText(chosen.t ?? '', F, minTier, rng, o.slots) ?? ''
  // 單句可自動前綴語助詞（非劇場、opener≠false、句子沒自帶 {opener}）
  if (!o.noOpener && chosen.opener !== false && !(chosen.t ?? '').includes('{opener}') && rng() < (CONTENT.config.openerChance ?? 0.4)) {
    const op = fragment('opener', rng)
    if (op) text = `${op}${text}`
  }
  return { text, cta, ck }
}
/** 挑好的句子 → 一則人機訊息（extraCk = 額外要記的冷卻鍵，例：劇場 id、場次）。 */
function utterOf(b: BotPersona, line: Resolved, extraCk: string[] = []): BotUtterance {
  const ck = [...new Set([...line.ck, ...extraCk])]
  return mkUtter(b, line.stickerId ? { type: 'sticker', stickerId: line.stickerId, cta: line.cta, ck } : { text: line.text, cta: line.cta, ck })
}

// ─── 對外：冷場首句（招呼）─────────────────────────────────────────────────────
export function greetingUtter(bots: BotPersona[] = BOTS, rng: () => number = rng0): BotUtterance {
  const b = pick(bots.length ? bots : BOTS, rng)
  const pool = CONTENT.greetings.length ? CONTENT.greetings : CONTENT.singles
  const F = ambientFacts({ onlineCount: 0, hasLive: false })
  const line = pickLine(pool, F, rng)
  if (!line) return mkUtter(b, { text: '' })
  return utterOf(b, { ...line, cta: undefined })
}

// ─── 對外：有人上線的招呼（帶名字）────────────────────────────────────────────
export function arrivalGreeting(name: string, bots: BotPersona[] = BOTS, g?: LobbyGlobals, rng: () => number = rng0): BotUtterance | null {
  const F = ambientFacts({ ...(g ?? { onlineCount: 0, hasLive: false }), newcomerName: name })
  const line = pickLine(CONTENT.proactive.greet_newcomer, F, rng)
  if (!line) return null
  return utterOf(pick(bots.length ? bots : BOTS, rng), line)
}

/** 劇場的冷卻鍵與主題（主題：自己寫的 topic → 共用槽的種類 → 無）。 */
const threadKey = (th: ThreadShape) => 'th:' + (th.id ?? hashKey(JSON.stringify(th.beats)))
function threadTopic(th: ThreadShape): string | null {
  if (th.topic) return th.topic
  const kinds = Object.values(th.slots ?? {})
  return kinds.includes('anyCard') ? 'card' : kinds.includes('anyBoss') ? 'boss' : kinds.includes('anySticker') ? 'sticker' : null
}
function pickThread(rng: () => number): ThreadShape {
  const all = CONTENT.threads
  const fresh = all.filter((th) => !isCooled(threadKey(th)))
  const freshTopic = fresh.filter((th) => { const tp = threadTopic(th); return !tp || !isCooled(topicKey(tp), topicWindow()) })
  return pick(freshTopic.length ? freshTopic : fresh.length ? fresh : leastRecent(all, threadKey), rng)
}

// ─── 對外：一個環境閒聊單元（劇場 / 單句 / 貼圖 / 主動）────────────────────────
export function ambientUnit(bots: BotPersona[] = BOTS, g?: LobbyGlobals, rng: () => number = rng0): BotUtterance[] {
  const roster = bots.length ? bots : BOTS
  const F = ambientFacts(g ?? { onlineCount: 0, hasLive: false })
  const w = CONTENT.config.ambientWeights ?? { thread: 5, single: 3, sticker: 1, proactive: 2 }
  const cat = weightedCat(w, rng)

  if (cat === 'thread' && CONTENT.threads.length) {
    const shape = pickThread(rng)
    const tp = threadTopic(shape)
    const thCk = [threadKey(shape), ...(tp ? [topicKey(tp)] : [])]
    noteLocal(thCk)
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
      if (beat.chance != null && rng() >= beat.chance) continue // 這拍「不一定出現」(例：不一定有 C)
      const b = byRole[beat.role] ?? pick(roster, rng)
      // beat 可以四選一：lines(內嵌加權) / t(固定句) / sticker(固定貼圖) / pool(從 beatPools 抽)
      const pool: Line[] | undefined =
        beat.lines ? beat.lines
          : beat.t != null ? [{ t: beat.t }]
            : beat.sticker != null ? [{ sticker: beat.sticker }]
              : beat.pool ? CONTENT.beatPools[beat.pool]
                : undefined
      // 槽位在「挑句之前」就帶入(否則含 {card} 的句會被當成無法解析而濾掉);劇場不加 opener。
      const line = pickLine(pool, F, rng, { slots: slotVals, noOpener: true })
      if (!line) continue
      out.push(utterOf(b, line, out.length ? [] : thCk)) // 劇場鍵記在第一則
    }
    return out
  }

  if (cat === 'sticker' && CONTENT.ambientStickers.length) {
    const stkKey = (id: string) => 'stk:' + id
    const fresh = CONTENT.ambientStickers.filter((id) => !isCooled(stkKey(id), topicWindow()))
    const id = pick(fresh.length ? fresh : leastRecent(CONTENT.ambientStickers, stkKey), rng)
    noteLocal([stkKey(id)])
    return [mkUtter(pick(roster, rng), { type: 'sticker', stickerId: id, ck: [stkKey(id)] })]
  }

  if (cat === 'proactive') {
    const u = ambientProactive(roster, g ?? { onlineCount: 0, hasLive: false }, rng)
    if (u) return [u]
  }

  // 預設：單句
  const line = pickLine(CONTENT.singles, F, rng, { avoidTopic: true })
  return line ? [utterOf(pick(roster, rng), line)] : []
}

type Cat = 'thread' | 'single' | 'sticker' | 'proactive'
function weightedCat(w: Partial<Record<Cat, number>>, rng: () => number): Cat {
  const entries: [Cat, number][] = (['thread', 'single', 'sticker', 'proactive'] as Cat[]).map((c) => [c, w[c] ?? 0])
  const total = entries.reduce((s, e) => s + e[1], 0) || 1
  let r = rng() * total
  for (const [c, ww] of entries) { r -= ww; if (r <= 0) return c }
  return 'single'
}

/** 主動句（線上人數 / 虛構強者梗 / 時段 / 剛剛誰打敗誰 / 點名潛水的人）。有名字的招呼在 arrivalGreeting。
 *  「剛剛誰打敗誰」每場只播一次、「點名」每人一段時間只點一次（記在聊天室的 ck → 換 host 也算數）。 */
const EVER = 1e9 // 聊天室看得到的範圍內都算「已用過」
const IDLE_RECUE_MS = 30 * 60_000 // 同一個人 30 分鐘內最多點名一次
const onceAt = new Map<string, number>() // 本分頁播過/點過的(聊天室只留 50 則，捲掉後靠這個記住)
function usedOnce(key: string, ttl: number, now: number): boolean {
  if (isCooled(key, EVER)) return true
  const t = onceAt.get(key)
  return t != null && now - t < ttl
}
function ambientProactive(roster: BotPersona[], g: LobbyGlobals, rng: () => number): BotUtterance | null {
  const now = g.now ?? Date.now()
  const base = ambientFacts(g)
  const kinds: [string, number][] = [['online_count', 1], ['gossip_gm', 1]]
  if (base.morning) kinds.push(['time_morning', 1])
  if (base.afternoon) kinds.push(['time_afternoon', 1])
  if (base.evening) kinds.push(['time_evening', 1])
  if (base.night) kinds.push(['time_night', 1])
  const res = g.lastResult
  const rpKey = res ? 'rp:' + res.id : ''
  if (res && CONTENT.proactive.announce_replay?.length && !usedOnce(rpKey, Infinity, now)) kinds.push(['announce_replay', 3]) // 新鮮戰報優先
  const lurkers = (g.lurkers ?? []).filter((l) => !usedOnce('idle:' + l.uid, IDLE_RECUE_MS, now))
  if (lurkers.length && CONTENT.proactive.cue_idle?.length) kinds.push(['cue_idle', 2])

  // 同類主動句(例：線上人數)最近講過、或那類的句子全都最近講過 → 先換別類（句子少的類別才不會一直重複）
  const hasFreshLine = (k: string) => (CONTENT.proactive[k] ?? []).some((l) => !isCooled(lineKey(l)))
  const pool = kinds.filter(([k]) => !isCooled('pk:' + k, topicWindow()) && hasFreshLine(k))
  if (!pool.length) return null // 能講的主動句最近都講過了 → 這輪改講單句(不硬擠同一類)
  const total = pool.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  let kind = pool[0][0]
  for (const [k, w] of pool) { r -= w; if (r <= 0) { kind = k; break } }

  let F = base
  const extra = ['pk:' + kind]
  if (kind === 'announce_replay' && res) { F = { ...base, lastWinner: res.winner, lastLoser: res.loser }; extra.push(rpKey) }
  if (kind === 'cue_idle') { const who = pick(lurkers, rng); F = { ...base, idleName: who.name }; extra.push('idle:' + who.uid) }
  const line = pickLine(CONTENT.proactive[kind], F, rng)
  if (!line) return null
  noteLocal(extra)
  for (const k of extra) if (k.startsWith('rp:') || k.startsWith('idle:')) onceAt.set(k, now)
  return utterOf(pick(roster, rng), line, extra)
}

/** 這位發言者會用到哪些 reactRules：符合的 exclusive 規則(第一條)獨佔；否則所有符合的非 exclusive 規則。 */
function selectReactRules(F: Facts): ReactRule[] {
  const ok = CONTENT.reactRules.filter((r) => evalGuard(r.when, F))
  const excl = ok.find((r) => r.exclusive)
  return excl ? [excl] : ok.filter((r) => !r.exclusive)
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
    // ③ 依狀態的 reactRules：exclusive 獨佔（先中先用）；否則所有符合的規則合併成一個大池
    const rules = selectReactRules(F)
    if (rules.length === 1) {
      pool = rules[0].say
      ruleCta = rules[0].cta
      ruleChance = rules[0].ctaChance
    } else {
      // 合併：每句帶上自己規則的按鈕設定（句子自己的優先）
      pool = rules.flatMap((r) => r.say.map((l) => ({ ...l, cta: l.cta ?? r.cta, ctaChance: l.ctaChance ?? r.ctaChance })))
    }
    minTier = Math.max(1, ...rules.map((r) => achvMinTierOf(r.when))) // 符合的規則都成立 → 取最高階要求
  }
  const line = pickLine(pool, F, rng, { minTier, ruleCta, ruleChance })
  if (!line) return []
  const b0 = pick(roster, rng)
  const out = [utterOf(b0, line)]

  // ④ 低機率「補刀」：換一隻人機接一句短的（純附和/吐槽，不帶 CTA）
  if (rng() < (CONTENT.config.pileOnChance ?? 0.15) && CONTENT.pileOn?.length) {
    const pileLine = pickLine(CONTENT.pileOn, F, rng)
    if (pileLine) {
      const others = roster.filter((b) => b.id !== b0.id)
      const b1 = others.length ? pick(others, rng) : b0
      out.push(utterOf(b1, { ...pileLine, cta: undefined }))
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
export const matchKeywordForTest = matchKeyword
/** 測試用：這位發言者的回覆會從 reactRules 的哪幾條抽（索引）。 */
export function reactRulesForTest(inp: ReactInput, g: LobbyGlobals = { onlineCount: 0, hasLive: false }): number[] {
  return selectReactRules(reactFacts(inp, g)).map((r) => CONTENT.reactRules.indexOf(r))
}

// ─── 內容檢查器（lint）：chatContent.ts 改完後自動檢查「程式跑不跑得動」────────────
//   DEV 啟動時印在 F12 Console；`npm test` 也會跑（有 error 就測試失敗）。
//   規則跟上面的引擎放同一個檔，新增佔位/條件/按鈕時兩邊一起改，才不會不同步。
const SPEAKER_TOKENS = ['name', 'streak', 'bestStreak', 'wins', 'games', 'winRate', 'achv', 'loadoutCard', 'stageNo', 'bossName', 'bossCard', 'bossStyle', 'bossSkill']
const GLOBAL_TOKENS = ['onlineCount', 'anyCard', 'anyBoss', 'anySticker', 'opener', 'invite']
const SPEAKER_GUARDS = ['guest', 'registered', 'isOwner', 'showsAchv', 'silverAchv', 'goldAchv', 'hasLoadout', 'hasBoss']
const GLOBAL_GUARDS = ['hasLive', 'morning', 'afternoon', 'evening', 'night']
const SPEAKER_NUMS = ['streak', 'bestStreak', 'wins', 'games', 'winRate']
const GLOBAL_NUMS = ['online']
const CTA_NAMES = [...Object.keys(CTA_LABEL), 'quickmatch-normal', 'quickmatch-special']
const SLOT_KINDS = ['anyCard', 'anyBoss', 'anySticker']
const PROACTIVE_KEYS = ['greet_newcomer', 'online_count', 'gossip_gm', 'announce_replay', 'cue_idle', 'time_morning', 'time_afternoon', 'time_evening', 'time_night']
const PROACTIVE_EXTRA: Record<string, string[]> = { greet_newcomer: ['newcomerName'], announce_replay: ['lastWinner', 'lastLoser'], cue_idle: ['idleName'] }

export interface LintResult { errors: string[]; warnings: string[] }

export function lintChatContent(C: typeof CONTENT = CONTENT): LintResult {
  const errors: string[] = []
  const warnings: string[] = []
  const stickerIds = new Set(STICKERS.map((s) => s.id))
  const fragKeys = Object.keys(C.fragments ?? {})

  /** speaker=有發言者(反應式)；extra=此處額外合法的佔位(劇場槽 / newcomerName…) */
  const checkGuard = (g: string | undefined, where: string, speaker: boolean) => {
    if (!g) return
    for (const raw of g.split('&&')) {
      const t = raw.trim().replace(/^!\s*/, '')
      if (!t) { errors.push(`${where}：條件「${g}」有空的 && 段`); continue }
      const stage = t.match(/^(beforeStage|afterStage):(\d+-\d+)$/)
      if (stage) {
        if (subStageOrder('s' + stage[2]) < 0) errors.push(`${where}：條件「${t}」的關卡 ${stage[2]} 不存在`)
        else if (!speaker) errors.push(`${where}：這裡沒有發言者，條件「${t}」永遠不成立`)
        continue
      }
      if (/[<>=]/.test(t)) {
        const m = t.match(/^([a-zA-Z]+)\s*(>=|<=|==|>|<)\s*(\d+)$/)
        if (!m) { errors.push(`${where}：條件「${t}」格式錯（要像 streak>=2）`); continue }
        if (GLOBAL_NUMS.includes(m[1])) continue
        if (!SPEAKER_NUMS.includes(m[1])) errors.push(`${where}：條件「${t}」的「${m[1]}」不認得`)
        else if (!speaker) errors.push(`${where}：這裡沒有發言者，條件「${t}」無意義`)
        continue
      }
      if (GLOBAL_GUARDS.includes(t)) continue
      if (!SPEAKER_GUARDS.includes(t)) errors.push(`${where}：條件「${t}」不認得`)
      else if (!speaker) errors.push(`${where}：這裡沒有發言者，條件「${t}」永遠不成立`)
    }
  }
  const checkLine = (l: Line, where: string, speaker: boolean, extra: string[] = []) => {
    if (l.t == null && l.sticker == null) errors.push(`${where}：這句沒有 t 也沒有 sticker`)
    if (l.t != null && l.sticker != null) warnings.push(`${where}：同時有 t 和 sticker，只會送貼圖`)
    if (l.sticker != null && !stickerIds.has(l.sticker)) errors.push(`${where}：貼圖「${l.sticker}」不存在`)
    if (l.w != null && !(l.w > 0)) errors.push(`${where}：w 要大於 0`)
    if (l.ctaChance != null && (l.ctaChance < 0 || l.ctaChance > 1)) errors.push(`${where}：ctaChance 要在 0~1`)
    for (const c of l.cta == null ? [] : Array.isArray(l.cta) ? l.cta : [l.cta]) {
      if (!CTA_NAMES.includes(c)) errors.push(`${where}：按鈕「${c}」不存在（可用：${CTA_NAMES.join('/')}）`)
    }
    for (const m of (l.t ?? '').matchAll(/\{(\w+)\}/g)) {
      const tok = m[1]
      if (extra.includes(tok) || GLOBAL_TOKENS.includes(tok) || fragKeys.includes(tok)) continue
      if (SPEAKER_TOKENS.includes(tok)) { if (!speaker) errors.push(`${where}：這裡沒有發言者，{${tok}} 取不到 → 這句永遠不會出現`); continue }
      errors.push(`${where}：佔位 {${tok}} 不認得`)
    }
    checkGuard(l.guard, where, speaker)
  }
  const checkLines = (arr: Line[] | undefined, where: string, speaker: boolean, extra: string[] = []) => {
    if (!arr || !arr.length) { errors.push(`${where}：是空的`); return }
    arr.forEach((l, i) => checkLine(l, `${where}[${i}]「${l.t ?? l.sticker ?? ''}」`, speaker, extra))
  }

  if (!C.fragments?.opener?.length) warnings.push('fragments.opener 是空的')
  if (!C.fragments?.invite?.length) warnings.push('fragments.invite 是空的')
  checkLines(C.greetings, 'greetings', false)
  checkLines(C.singles, 'singles', false)

  // 劇場：每拍恰好一種來源、pool 要存在、槽位要合法
  const poolSlots: Record<string, Set<string>> = {}
  const seenIds = new Set<string>()
  C.threads.forEach((th, ti) => {
    const tw = `threads[${ti}]${th.id ? `(${th.id})` : ''}`
    if (th.id) { if (seenIds.has(th.id)) warnings.push(`${tw}：id 重複`); seenIds.add(th.id) }
    const slotNames = Object.keys(th.slots ?? {})
    for (const [k, kind] of Object.entries(th.slots ?? {})) if (!SLOT_KINDS.includes(kind)) errors.push(`${tw}：槽 ${k} 的種類「${kind}」不認得`)
    if (!th.beats?.length) errors.push(`${tw}：沒有任何 beat`)
    th.beats?.forEach((b, bi) => {
      const bw = `${tw}.beats[${bi}](${b.role})`
      const n = [b.pool, b.t, b.sticker, b.lines].filter((v) => v != null).length
      if (n !== 1) errors.push(`${bw}：pool / t / sticker / lines 要「恰好一個」（現在 ${n} 個）`)
      if (b.chance != null && !(b.chance > 0 && b.chance <= 1)) errors.push(`${bw}：chance 要在 0~1`)
      if (b.pool != null) {
        if (!C.beatPools[b.pool]) errors.push(`${bw}：pool「${b.pool}」在 beatPools 裡找不到`)
        ;(poolSlots[b.pool] ??= new Set()).add('')
        slotNames.forEach((s) => poolSlots[b.pool!].add(s))
      }
      if (b.t != null) checkLine({ t: b.t }, `${bw}「${b.t}」`, false, slotNames)
      if (b.sticker != null) checkLine({ sticker: b.sticker }, bw, false)
      if (b.lines) checkLines(b.lines, `${bw}.lines`, false, slotNames)
    })
  })
  for (const [k, arr] of Object.entries(C.beatPools)) {
    if (!poolSlots[k]) warnings.push(`beatPools.${k}：沒有任何劇場用到`)
    checkLines(arr, `beatPools.${k}`, false, [...(poolSlots[k] ?? [])].filter(Boolean))
  }

  for (const id of C.ambientStickers) if (!stickerIds.has(id)) errors.push(`ambientStickers：貼圖「${id}」不存在`)
  for (const [k, arr] of Object.entries(C.stickerReplies)) {
    if (k !== '*' && !stickerIds.has(k)) errors.push(`stickerReplies.${k}：沒有這張貼圖（key 要是貼圖 id 或 '*'）`)
    checkLines(arr, `stickerReplies.${k}`, true)
  }

  // 關鍵字：intent 要有池；池要有人用；偵測「這個字會被別條優先度更高的搶走」
  const usedIntents = new Set<string>()
  C.keywords.forEach((k, ki) => {
    const kw = `keywords[${ki}](${k.intent})`
    usedIntents.add(k.intent)
    if (!C.kwPools[k.intent]) errors.push(`${kw}：kwPools 裡沒有「${k.intent}」這個池`)
    if (!k.any?.length && !k.all?.length) errors.push(`${kw}：any 跟 all 都是空的`)
    for (const s of k.any ?? []) {
      C.keywords.forEach((o, oi) => {
        if (oi === ki || o.intent === k.intent || o.all?.length) return
        const beats = (o.w ?? 1) > (k.w ?? 1) || ((o.w ?? 1) === (k.w ?? 1) && oi < ki)
        const u = (o.any ?? []).find((x) => s.toLowerCase().includes(x.toLowerCase()))
        if (beats && u) warnings.push(`${kw}：關鍵字「${s}」會被 ${o.intent} 的「${u}」(w${o.w ?? 1}) 搶走 → 想讓它生效就把 w 調高`)
      })
    }
  })
  for (const [k, arr] of Object.entries(C.kwPools)) {
    if (!usedIntents.has(k)) warnings.push(`kwPools.${k}：沒有任何關鍵字指到這個池`)
    checkLines(arr, `kwPools.${k}`, true)
  }

  C.reactRules.forEach((r, ri) => {
    const rw = `reactRules[${ri}](${r.when ?? '保底'})`
    checkGuard(r.when, rw, true)
    for (const c of r.cta == null ? [] : Array.isArray(r.cta) ? r.cta : [r.cta]) if (!CTA_NAMES.includes(c)) errors.push(`${rw}：按鈕「${c}」不存在`)
    checkLines(r.say, `${rw}.say`, true)
  })
  if (C.reactRules.length && C.reactRules[C.reactRules.length - 1].when) warnings.push('reactRules：最後一條建議不寫 when（保底），不然有人講話可能沒人回')

  for (const [k, arr] of Object.entries(C.proactive)) {
    if (!PROACTIVE_KEYS.includes(k)) warnings.push(`proactive.${k}：程式不認得這個 key，永遠不會用到（可用：${PROACTIVE_KEYS.join('/')}）`)
    checkLines(arr, `proactive.${k}`, false, PROACTIVE_EXTRA[k] ?? [])
  }
  checkLines(C.pileOn, 'pileOn', true)

  // 同一個陣列裡一字不差的重複句（等於權重偷偷 ×2，冷卻也只算一句）
  const dupCheck = (arr: Line[] | undefined, where: string) => {
    const seen = new Set<string>()
    for (const l of arr ?? []) {
      const k = l.t ?? 'stk:' + l.sticker
      if (seen.has(k)) warnings.push(`${where}：「${l.t ?? l.sticker}」重複了（想讓它常出現請改 w）`)
      seen.add(k)
    }
  }
  dupCheck(C.greetings, 'greetings')
  dupCheck(C.singles, 'singles')
  for (const [k, arr] of Object.entries(C.beatPools)) dupCheck(arr, `beatPools.${k}`)
  for (const [k, arr] of Object.entries(C.kwPools)) dupCheck(arr, `kwPools.${k}`)
  for (const [k, arr] of Object.entries(C.proactive)) dupCheck(arr, `proactive.${k}`)
  return { errors, warnings }
}

// ─── 變化數估算（量產進度：目標 ≥3000）──────────────────────────────────────────
//   一句的變化 = 句中每個隨機佔位的選項數相乘（{anyCard}=特殊牌數、{anyBoss}=6…；{name} 這類「對方的資料」算 1）。
//   劇場 = 每拍選項數相乘（不一定出現的拍 +1 種「沒出現」；共用槽只算一次）。
//   ⚠️ 不含自動前綴的語助詞(opener)——那個會把數字灌水，不算「有效變化」。
export interface VarietyReport { total: number; parts: Record<string, number>; templates: number }
export function estimateVariety(C: typeof CONTENT = CONTENT): VarietyReport {
  const fragN = (k: string) => C.fragments[k]?.length ?? 0
  const tokN = (tok: string, slots: string[] = []): number => {
    if (slots.includes(tok)) return 1 // 共用槽在劇場層級算
    if (tok === 'anyCard') return BOSS_CARD_NAMES.length
    if (tok === 'anyBoss') return BOSS_CHAR_NAMES.length
    if (tok === 'anySticker') return STICKER_NAMES.length
    if (fragN(tok)) return fragN(tok)
    return 1
  }
  const lineN = (l: Line, slots: string[] = []) =>
    [...(l.t ?? '').matchAll(/\{(\w+)\}/g)].reduce((p, m) => p * tokN(m[1], slots), 1)
  const sum = (arr: Line[] | undefined, slots: string[] = []) => (arr ?? []).reduce((s, l) => s + lineN(l, slots), 0)
  let templates = 0
  const count = (arr: Line[] | undefined) => { templates += arr?.length ?? 0; return sum(arr) }
  const parts: Record<string, number> = {}
  parts['招呼 greetings'] = count(C.greetings)
  parts['單句 singles'] = count(C.singles)
  let th = 0
  for (const t of C.threads) {
    const slots = Object.keys(t.slots ?? {})
    const slotMul = Object.values(t.slots ?? {}).reduce((p, k) => p * tokN(k), 1)
    let n = slotMul
    for (const b of t.beats) {
      const opts = b.lines ? sum(b.lines, slots) : b.t != null ? lineN({ t: b.t }, slots) : b.sticker != null ? 1 : sum(C.beatPools[b.pool ?? ''], slots)
      n *= Math.max(1, opts) + (b.chance != null && b.chance < 1 ? 1 : 0)
    }
    th += n
  }
  templates += Object.values(C.beatPools).reduce((s, a) => s + a.length, 0)
  parts['劇場 threads'] = th
  parts['貼圖回應 stickerReplies'] = Object.values(C.stickerReplies).reduce((s, a) => s + count(a), 0)
  parts['關鍵字回應 kwPools'] = Object.values(C.kwPools).reduce((s, a) => s + count(a), 0)
  parts['狀態回應 reactRules'] = C.reactRules.reduce((s, r) => s + count(r.say), 0)
  parts['主動句 proactive'] = Object.values(C.proactive).reduce((s, a) => s + count(a), 0)
  parts['補刀 pileOn'] = count(C.pileOn)
  return { total: Object.values(parts).reduce((a, b) => a + b, 0), parts, templates }
}

if (import.meta.env.DEV) {
  const v = estimateVariety()
  console.log(`%c[chatContent] 變化數 ≈ ${v.total}（目標 3000；句型 ${v.templates} 句）`, 'color:#69c', v.parts)
  const { errors, warnings } = lintChatContent()
  if (errors.length) console.warn(`%c[chatContent] ❌ ${errors.length} 個錯誤（這些句子/規則跑不動）\n` + errors.join('\n'), 'color:#e55')
  if (warnings.length) console.warn(`%c[chatContent] ⚠️ ${warnings.length} 個提醒\n` + warnings.join('\n'), 'color:#c90')
}
