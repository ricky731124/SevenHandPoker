/**
 * 手機「單一畫布」(docs/MOBILE-LANDSCAPE-SPEC.md 改動 A)。
 *
 * 整個遊戲(#root)是一塊固定大小的畫布,環境只決定「縮多少、要不要轉 90°」:
 *   - 手機:畫布高 = 這支手機橫放全螢幕的高(螢幕短邊),寬 = 填滿看得到的範圍。
 *       全螢幕真橫向 → 畫布 = 螢幕長邊 × 短邊、縮放 1、不轉(跟以前一模一樣);
 *       網頁版有網址列 → 高度等比縮到看得到的範圍,寬度補滿(兩側不留空邊);
 *       手機直拿(假橫向)→ 整塊轉 90°。
 *   - 電腦 / iPad:畫布 = 視窗(不縮不轉);iPad 直拿照舊轉 90°(以前就是這樣)。
 *
 * #root 是 CSS 尺寸容器(container-type: size),裡面一律用 cqw/cqh 取代 vw/vh、@container 取代 @media,
 * 所以轉過、縮過的畫面排版跟真橫向全螢幕完全相同。position:fixed 的東西也以 #root 為準(容器自帶 layout containment)。
 * 彈窗等 portal 一律掛在 #root 裡(portalRoot),才會跟著一起轉、一起縮。
 *
 * 瀏海/動態島:由這裡統一換算成畫布座標寫到 --sa-l/--sa-r/--sa-t/--sa-b(扣掉縮小後留的黑邊),
 * 元件用 var(--sa-l) 取代 env(safe-area-inset-left)。
 */
import { isAndroid, isStandalone } from './pwa'

export interface CanvasState {
  /** 畫布(邏輯)寬高,css px */
  w: number
  h: number
  /** 縮放 */
  s: number
  /** 0 = 不轉;90 = 順時針轉 90°(手機直拿) */
  rot: 0 | 90
  /** 畫布中心在實體畫面(版面視窗)上的位置 */
  cx: number
  cy: number
}

let state: CanvasState = { w: 1024, h: 600, s: 1, rot: 0, cx: 512, cy: 300 }
const subs = new Set<() => void>()
let frozen: () => boolean = () => false

export const getCanvas = (): CanvasState => state
export function subscribeCanvas(cb: () => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

/** 手機 = 觸控 + 螢幕短邊 < 600(iPad 短邊 ≥ 744,算電腦)。 */
export function isPhone(): boolean {
  const coarse = !!window.matchMedia?.('(pointer: coarse)').matches
  return coarse && typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 600
}

/** 螢幕現在是不是直的(不受鍵盤影響);讀不到回 null。 */
function screenPortrait(): boolean | null {
  const t = screen.orientation?.type
  if (t) return t.startsWith('portrait')
  const o = (window as unknown as { orientation?: number }).orientation // 舊版 iOS
  return typeof o === 'number' ? o === 0 || o === 180 : null
}

/** layout = true:用版面視窗(不扣鍵盤)量,打字中轉向時用 */
function compute(layout = false): CanvasState {
  const vv = layout ? null : window.visualViewport
  // 看得到的範圍(網址列、鍵盤扣掉之後)。visualViewport 剛載入可能回 0 → 退回 inner。
  const pw = vv?.width || window.innerWidth
  const ph = vv?.height || window.innerHeight
  const cx = (vv?.offsetLeft ?? 0) + pw / 2
  const cy = (vv?.offsetTop ?? 0) + ph / 2
  const portrait = ph > pw
  if (!isPhone()) {
    // 電腦 / iPad:畫布 = 版面視窗。iPad 直拿(寬 ≤ 900)照舊轉 90°。
    const lw = window.innerWidth
    const lh = window.innerHeight
    const coarse = !!window.matchMedia?.('(pointer: coarse)').matches
    if (coarse && portrait && lw <= 900) return { w: lh, h: lw, s: 1, rot: 90, cx: lw / 2, cy: lh / 2 }
    return { w: lw, h: lh, s: 1, rot: 0, cx: lw / 2, cy: lh / 2 }
  }
  const w0 = Math.max(screen.width, screen.height)
  let h = Math.min(screen.width, screen.height)
  const rot = portrait ? 90 : 0
  const availW = rot ? ph : pw
  const availH = rot ? pw : ph
  // 安卓安裝版(加到主畫面):狀態列、手勢列一直在,網頁拿到的高度比螢幕矮 → 照全螢幕排會整塊縮 ~88%。
  // 只縮一半:排版高度取「實際可用」和「全螢幕」的中間(不低於 375 = iPhone SE 的高),多出來的高度用來排版。
  // 只在安卓 + 安裝版 + 真的被系統列吃掉高度 + 沒轉 90° 時才動;iOS、電腦、網頁版、安卓全螢幕都不受影響。(2026-11-11 Pixel 10 回報)
  if (rot === 0 && availH < h && isAndroid() && isStandalone()) {
    h = Math.round(Math.min(h, Math.max(Math.min(h, 375), (availH + h) / 2)))
  }
  // 高度對齊全螢幕(版面高度分段跟全螢幕一樣),寬度補滿看得到的範圍 → 網頁版兩側不留空邊。
  // 寬度最窄 16:9(iPhone SE 的比例,再窄沒測過)、最寬 2.8 倍高;超出範圍才會留一點邊。
  // 網頁版寬度可能超過 1024 → 電腦版排版一律寫 (min-width: 1024px) and (min-height: 481px),手機高度到不了 481。
  const minW = Math.min(w0, Math.round((h * 16) / 9))
  const maxW = Math.max(w0, Math.round(h * 2.8))
  const fit = Math.min(1, availH / h)
  const w = Math.min(maxW, Math.max(minW, Math.round(availW / fit)))
  const s = Math.min(1, availH / h, availW / w)
  return { w, h, s, rot, cx, cy }
}

/** 讀瀏海/動態島(env(safe-area-inset-*))。用一個看不到的探針元素量。 */
let probe: HTMLDivElement | null = null
function readInsets(): { t: number; r: number; b: number; l: number } {
  if (!probe) {
    probe = document.createElement('div')
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
    document.documentElement.appendChild(probe)
  }
  const cs = getComputedStyle(probe)
  return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 }
}

function apply(): void {
  const root = document.getElementById('root')
  if (!root) return
  // 打字中(鍵盤開著)不重算:鍵盤吃掉的高度交給彈窗的 --vvh 處理,整塊畫面不跟著縮。
  // 但打字中手機轉了方向(假橫向 ↔ 真橫向)一定要重算,不然畫面卡在舊方向(縮在角落)→
  // 先照新方向(不扣鍵盤)排好,再收起鍵盤;玩家在新方向再點一次輸入框就好。
  //   方向要看「螢幕本身」(screen.orientation),不能看可視範圍:小手機直拿跳鍵盤後可視範圍會變得比寬還矮,會被誤判成轉向。
  if (!frozen()) state = compute()
  else if (isPhone() && screenPortrait() !== null && screenPortrait() !== (state.rot === 90)) {
    state = compute(true)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }
  const { w, h, s, rot, cx, cy } = state
  const lw = window.innerWidth
  const lh = window.innerHeight
  root.style.width = `${w}px`
  root.style.height = `${h}px`
  // 剛好等於視窗、不縮不轉 → 不放 transform(全螢幕、電腦版跟改版前一模一樣)
  const identity = s === 1 && rot === 0 && w === lw && h === lh && cx === lw / 2 && cy === lh / 2
  root.style.transform = identity
    ? ''
    : `translate(${cx}px, ${cy}px) rotate(${rot}deg) scale(${s}) translate(${-w / 2}px, ${-h / 2}px)`

  // 瀏海換算到畫布座標:實體 inset 扣掉畫布縮小後周圍留的黑邊,再除以縮放
  const ins = readInsets()
  const pw = rot ? h * s : w * s // 畫布在實體畫面上占的寬高
  const ph = rot ? w * s : h * s
  const gap = { l: cx - pw / 2, r: lw - (cx + pw / 2), t: cy - ph / 2, b: lh - (cy + ph / 2) }
  const over = (k: 't' | 'r' | 'b' | 'l') => Math.max(0, ins[k] - Math.max(0, gap[k])) / s
  // 順時針轉 90°:畫布左邊 = 實體上方、畫布上方 = 實體右邊、畫布右邊 = 實體下方、畫布下方 = 實體左邊
  const sa = rot ? { l: over('t'), t: over('r'), r: over('b'), b: over('l') } : { l: over('l'), t: over('t'), r: over('r'), b: over('b') }
  const de = document.documentElement.style
  de.setProperty('--app-w', `${w}px`)
  de.setProperty('--app-h', `${h}px`)
  de.setProperty('--sa-l', `${sa.l}px`)
  de.setProperty('--sa-r', `${sa.r}px`)
  de.setProperty('--sa-t', `${sa.t}px`)
  de.setProperty('--sa-b', `${sa.b}px`)
  subs.forEach((cb) => cb())
}

/** 開機時(render 前)呼叫一次;之後視窗變化自動跟。isEditing = 正在打字(鍵盤開著)時不重算畫布。 */
export function initCanvas(isEditing: () => boolean): () => void {
  frozen = isEditing
  apply()
  const vv = window.visualViewport
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  window.addEventListener('load', apply)
  return apply
}

/** 實體畫面座標(clientX/Y、getBoundingClientRect)→ 畫布座標。假橫向/縮放時拖曳、特效定位要用這個。 */
export function toCanvas(x: number, y: number): { x: number; y: number } {
  const { w, h, s, rot, cx, cy } = state
  const dx = x - cx
  const dy = y - cy
  const lx = rot ? dy : dx // 逆轉 90°:(x, y) → (y, -x)
  const ly = rot ? -dx : dy
  return { x: lx / s + w / 2, y: ly / s + h / 2 }
}

/** 實體畫面上的移動量 → 畫布上的移動量(拖曳用)。 */
export function toCanvasDelta(dx: number, dy: number): { x: number; y: number } {
  const { s, rot } = state
  return { x: (rot ? dy : dx) / s, y: (rot ? -dx : dy) / s }
}

/** getBoundingClientRect() → 畫布座標的方框。 */
export function canvasRect(r: { left: number; top: number; right: number; bottom: number }): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  const a = toCanvas(r.left, r.top)
  const b = toCanvas(r.right, r.bottom)
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const right = Math.max(a.x, b.x)
  const bottom = Math.max(a.y, b.y)
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/** 彈窗、通知等 portal 的掛載點(在畫布裡,才會跟著轉、跟著縮)。 */
export const portalRoot = (): HTMLElement => document.getElementById('root') ?? document.body
