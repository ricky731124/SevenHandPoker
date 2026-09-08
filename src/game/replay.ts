import {
  applyDraw,
  applyPick,
  applyPlace,
  applySuit,
  applySwap,
  createGame,
  markSpecialUsed,
  resolveShowdown,
  type GameState,
  type PlayerId,
} from './state'
import { isBlank, isJoker, rankLabel, SUIT_SYMBOL, type Card } from './cards'
import { getSpecialCard, type SpecialCardId } from './specialCards'

/**
 * 賽事精華(回放)的「棋譜」單位 —— 一場對局被拆成一串離散動作(見 docs/SPECTATE-REPLAY-SPEC.md §6.2)。
 * 回放 = `createGame(seed, firstPicker)` 後,把這些 move 依序套回 `state.ts` 的純函式即可重現整場。
 *
 * 動作只記「做了什麼」,**不記花了多久** —— 回放的節奏由播放器決定(每步固定停留/可倍速),
 * 所以「當時想一分鐘」在回放裡也只是一步,絕不會枯等。
 *
 *  - `pick`  : 選牌者選了哪幾張(手牌 id)。
 *  - `place` : 對手把該疊放到第幾格。
 *  - `special`: 誰、用了哪張特殊牌。
 *      · 偷天換日(swap)會改牌面 → 另記 `targetId`(棄掉哪張)+ `rng`(當時那次隨機抽/塞的
 *        兩個 Math.random 輸出,回放照吐一次 → 抽到的新牌、牌堆順序完全重現,決定性)。
 *      · 花色類(踏雪尋梅/正中紅心…)是決定性的,只需 `targetId`(把哪張改花色),不需 `rng`。
 *      · 偷窺/讓我看看(peek/spy)不改任何牌面,只記「有這一步、用了什麼」→ 回放照樣顯示玩家用過。
 */
export type Move =
  | { t: 'pick'; by: PlayerId; ids: string[] }
  | { t: 'place'; by: PlayerId; slot: number }
  | { t: 'special'; by: PlayerId; card: SpecialCardId; targetId?: string; rng?: number[] }

/**
 * 錄製用 rng:包一層在 `Math.random` 外,實際對局照常用真隨機(玩法一字不動),
 * 但把每次輸出**順手記下來**,存進該 swap move 的 `rng`。(只有偷天換日會用到。)
 */
export function recordingRng(base: () => number = Math.random): { rng: () => number; out: number[] } {
  const out: number[] = []
  return {
    rng: () => {
      const v = base()
      out.push(v)
      return v
    },
    out,
  }
}

/** 回放用 rng:依序吐出當初錄下的那幾個值 → applySwap 重現一模一樣的結果。 */
export function replayRng(values: number[] | undefined): () => number {
  const vals = values ?? []
  let i = 0
  return () => vals[i++] ?? 0
}

// ---- 回放:棋譜 → 一幀一幀的牌桌(§6.4)。每幀就是一個真 GameState,回放畫面直接餵進
//      觀戰的 GameBoard(applySpectate)。節奏由播放器決定,「當時想很久」在回放只是一步。 ----

/** 前進到某幀時要放的音效(§10:以下方玩家 p1 角度)。undefined = 靜音(選牌、對手補牌)。 */
export type ReplaySound = 'deal' | 'place' | 'showdown-win' | 'showdown-lose' | 'draw' | 'special' | 'win' | 'lose'

/** 回放的一「幀」= 一個牌桌狀態 + 說明。播放器在 frames 之間前進/後退/拖拉。
 *  流程字幕拆成 `actor`(誰)/`action`(做什麼) 兩行(§6.4:第N步 / 誰 / 動作);
 *  `caption` = 兩者合併(給不需拆行的地方用)。 */
export interface ReplayFrame {
  state: GameState
  caption: string
  /** 誰(顯示名);開局/結束等沒有明確行動者的幀為 undefined。 */
  actor?: string
  /** 做什麼(如「出 3 張」「將對手牌放第 4 格」「第 4 格開牌・同花 甲勝」「獲勝(四幣)」)。 */
  action: string
  /** §10:前進到這幀時放的音效(只在自動播/下一步時響,拖拉/上一步靜音)。 */
  sound?: ReplaySound
  /** draw 音效要放幾聲(補幾張)。 */
  drawN?: number
}

/** buildFrames 的輸入(不綁 net 層的 ReplayRecord,保持 game/ 純淨)。 */
export interface ReplayInput {
  seed: number
  firstPicker: PlayerId
  moves: Move[]
  /** 雙方顯示名(caption 用);缺省 → 玩家1/玩家2。 */
  names?: { p1: string; p2: string }
}

const WIN_REASON_ZH: Record<string, string> = { coins4: '四幣', line3: '三連', boardFull: '子多' }

function cardFace(c: Card): string {
  if (isJoker(c)) return '鬼牌'
  if (isBlank(c)) return '空白'
  return `${SUIT_SYMBOL[c.suit]}${rankLabel(c.rank)}`
}

/**
 * 棋譜 → frames。`createGame(seed, firstPicker)` 後依序套 moves:
 *  - pick / special / place 各是棋譜裡的一步 → 各 snapshot 一幀。
 *  - place 之後的「開牌(showdown)、翻幣、補牌(draw)」**不在棋譜裡**(決定性,能自己推)→
 *    這裡自動往前跑 `resolveShowdown` / `applyDraw` 補出對應的幀,讓新手能停在開牌研究。
 *  - swap 用 `replayRng(move.rng)` 重放當時的隨機 → 抽到的牌、牌堆順序完全重現。
 */
export function buildFrames(input: ReplayInput): ReplayFrame[] {
  const p1 = input.names?.p1 || '玩家1'
  const p2 = input.names?.p2 || '玩家2'
  const name = (by: PlayerId) => (by === 'p1' ? p1 : p2)
  // online host 的 tieBreak 是 p1;casual 預設 p2。這只影響「鬼牌同分」極罕見平手歸屬,
  // 且錄製當時的結果已由 moves 決定 → 回放用 firstPicker 對應的預設即可(不影響一般局)。
  let g = createGame(input.seed, input.firstPicker)
  const frames: ReplayFrame[] = []
  const add = (state: GameState, actor: string | undefined, action: string, sound?: ReplaySound, drawN?: number) => {
    frames.push({ state, actor, action, caption: actor ? `${actor} ${action}` : action, sound, drawN })
  }
  add(g, undefined, '開局發牌', 'deal')

  const pushEndedIfDone = (): boolean => {
    if (g.phase === 'ended' && g.winner) {
      const why = g.winReason ? `(${WIN_REASON_ZH[g.winReason] ?? ''})` : ''
      add(g, name(g.winner), `獲勝${why}`, g.winner === 'p1' ? 'win' : 'lose')
      return true
    }
    return false
  }

  for (const m of input.moves) {
    if (m.t === 'pick') {
      g = applyPick(g, m.by, m.ids)
      add(g, name(m.by), `出 ${m.ids.length} 張`) // 選牌無音效
    } else if (m.t === 'special') {
      const def = getSpecialCard(m.card)
      const before = m.targetId ? g.hands[m.by].find((c) => c.id === m.targetId) : undefined
      if (def?.suit && m.targetId) {
        g = applySuit(g, m.by, m.targetId, def.suit)
        const after = g.hands[m.by].find((c) => c.id === m.targetId)
        const detail = before && after ? `:${cardFace(before)}→${cardFace(after)}` : ''
        add(g, name(m.by), `使用「${def.name}」${detail}`, 'special')
      } else if (m.card === 'swap' && m.targetId) {
        const prevIds = new Set(g.hands[m.by].map((c) => c.id))
        g = applySwap(g, m.by, m.targetId, replayRng(m.rng))
        const drawn = g.hands[m.by].find((c) => !prevIds.has(c.id))
        const detail = before && drawn ? `:${cardFace(before)}→${cardFace(drawn)}` : ''
        add(g, name(m.by), `使用「${def?.name ?? '偷天換日'}」${detail}`, 'special')
      } else {
        // peek / spy:不改牌面,只記用過。
        g = markSpecialUsed(g, m.by)
        add(g, name(m.by), `使用「${def?.name ?? '特殊牌'}」`, 'special')
      }
    } else if (m.t === 'place') {
      g = applyPlace(g, m.by, m.slot)
      // 有開牌 → 講開牌結果(actor=放牌者);沒開牌 → 只講「將對手牌放第幾格」。(slot 對使用者從 1 起算)
      const sd = g.lastShowdown
      if (sd) {
        const w = sd.winner === 'both' ? '雙方' : name(sd.winner)
        const p1Won = sd.winner === 'p1' || sd.winner === 'both' // §10:搶金幣以下方 p1 角度
        add(g, name(m.by), `第 ${sd.slot + 1} 格開牌・${sd.p1Name} vs ${sd.p2Name}・${w}勝`, p1Won ? 'showdown-win' : 'showdown-lose')
      } else {
        add(g, name(m.by), `將對手牌放第 ${m.slot + 1} 格`, 'place')
      }
      // 自動補出「開牌→翻幣→補牌」的後續幀(棋譜不記,決定性推得出來)。
      if (g.phase === 'showdown') {
        const resolved = resolveShowdown(g)
        if (resolved.phase === 'ended') {
          g = resolved
          pushEndedIfDone()
          break
        }
        g = resolved // → 'draw'
      }
      if (g.phase === 'draw') {
        const drawer = g.postPicker
        const after = applyDraw(g)
        const n = drawer ? after.hands[drawer].length - g.hands[drawer].length : 0
        // §10:只有下方 p1 補牌才放聲(對手補牌靜音,和正常對局一致)。
        if (n > 0) add(after, name(drawer!), `補 ${n} 張`, drawer === 'p1' ? 'draw' : undefined, n)
        g = after // → 'pick'
      }
      if (pushEndedIfDone()) break // applyPlace 直接判定結束(無開牌的保險路徑)
    }
  }

  return frames
}

/** 拖進度用:第 k 幀的牌桌狀態。frames 已內含各幀 state → O(1)、拖拉極順。 */
export function stateAtFrame(frames: ReplayFrame[], k: number): GameState | null {
  const i = Math.max(0, Math.min(k, frames.length - 1))
  return frames[i]?.state ?? null
}
