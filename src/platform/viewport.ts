/**
 * Write the ACTUAL visible viewport size to CSS vars (--vvh / --vvw) on <html>,
 * kept in sync via visualViewport. This is the reliable cross-browser source of
 * the visible area — `dvh`/`vh` on `position:fixed` elements is buggy on iOS
 * Safari (fixed boxes can size to the LARGE viewport, ignoring the address bar),
 * which was clipping modal panels top & bottom on mobile web.
 *
 * CSS falls back to `100dvh` until the first measurement lands:
 *   height: var(--vvh, 100dvh);
 */
/** 目前正在打字的欄位（null = 鍵盤沒開）。 */
let editingEl: HTMLElement | null = null

const TEXT_TYPES = new Set(['', 'text', 'password', 'search', 'email', 'tel', 'url', 'number'])
function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
  if (el instanceof HTMLInputElement) return TEXT_TYPES.has(el.type) && !el.disabled && !el.readOnly
  return el.isContentEditable
}

/** 把正在打字的欄位(連同它的標籤)捲到所在捲動容器(彈窗)的正中間。彈窗被 transform 縮放過 → 換算回未縮放的 px。 */
function revealField(el: HTMLElement): void {
  const target = (el.closest('label, .acct-field') as HTMLElement | null) ?? el
  for (let p = target.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY
    if ((oy !== 'auto' && oy !== 'scroll') || p.scrollHeight <= p.clientHeight + 1) continue
    const pr = p.getBoundingClientRect()
    const tr = target.getBoundingClientRect()
    const scale = p.offsetHeight ? pr.height / p.offsetHeight : 1
    const delta = (tr.top + tr.height / 2 - (pr.top + pr.height / 2)) / (scale || 1)
    if (Math.abs(delta) > 2) p.scrollTop += delta
    return
  }
}

/** 頁面本體永遠不該被捲動(#root 是 fixed 全版)；鍵盤收起後手機常把頁面留在偏移位置 → 拉回 0。 */
function resetPageScroll(): void {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
  const se = document.scrollingElement as HTMLElement | null
  if (se && (se.scrollTop || se.scrollLeft)) { se.scrollTop = 0; se.scrollLeft = 0 }
  if (document.body.scrollTop) document.body.scrollTop = 0
}

/**
 * 「鍵盤感知」——全站所有會跳鍵盤的輸入框(現在跟未來新加的)都自動套用，不用每個地方各寫：
 *   ① 打字中：彈窗跟著「鍵盤上方實際看得到的那塊區域」(VisualViewport API：height + offsetTop → --vvh/--vvt)，
 *      彈窗高度縮到塞得下，再把「正在打的那一欄」捲到彈窗中間 → 在密碼欄就看得到密碼欄、打了幾碼。
 *   ② 鍵盤收起：頁面偏移拉回 0、--vvt 歸 0 → 之後滑動不會把背後的黑色遮罩拖開。
 * 只在觸控裝置做「捲到中間」；桌機點輸入框行為不變。
 */
function initKeyboardAware(apply: () => void): void {
  const coarse = () => !!window.matchMedia?.('(pointer: coarse)').matches
  const timers: ReturnType<typeof setTimeout>[] = []
  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))
  const clearLater = () => { while (timers.length) clearTimeout(timers.pop()) }

  document.addEventListener('focusin', (e) => {
    if (!isEditable(e.target)) return
    const el = e.target
    editingEl = el
    clearLater()
    apply()
    if (!coarse()) return
    // 鍵盤升起要一點時間(且各家不同) → 分幾次對位；鍵盤動畫期間 visualViewport resize 也會再對位(見下)
    for (const ms of [60, 300, 650]) later(ms, () => { if (editingEl === el) { apply(); revealField(el) } })
  })
  document.addEventListener('focusout', () => {
    // 換到另一個欄位時 focusout 後馬上 focusin → 等一下再判斷「真的沒在打字了」
    later(120, () => {
      if (isEditable(document.activeElement)) return
      editingEl = null
      apply()
      resetPageScroll()
      later(450, () => { if (!editingEl) { resetPageScroll(); apply() } }) // 鍵盤收起動畫結束後再保險一次
    })
  })
  const onVV = () => { if (editingEl && coarse()) revealField(editingEl) }
  window.visualViewport?.addEventListener('resize', onVV)
  // 沒在打字時頁面本體被捲動(鍵盤殘留的偏移/滑動) → 立刻拉回
  window.addEventListener('scroll', () => { if (!editingEl) resetPageScroll() }, { passive: true })
}

export function initViewportVars(): void {
  if (typeof window === 'undefined') return
  const de = document.documentElement
  const vv = window.visualViewport

  const apply = (): boolean => {
    // visualViewport.height can read 0 before first layout — fall back to
    // innerHeight (|| not ??, so a 0 falls through), and never write a 0.
    const h = vv?.height || window.innerHeight
    const w = vv?.width || window.innerWidth
    if (h > 0) de.style.setProperty('--vvh', `${h}px`)
    if (w > 0) de.style.setProperty('--vvw', `${w}px`)
    // Where the visible area starts inside the layout viewport. Normally 0; when the
    // on-screen keyboard opens, iOS Safari / Android Chrome PAN the visible area down
    // to the focused input (offsetTop > 0). Popups pin their scrim here so they sit
    // in the strip above the keyboard instead of at the (now off-screen) page top —
    // otherwise you see the main menu's bottom-left behind the keyboard, not the input.
    // ONLY while typing: once the keyboard is gone the page may stay panned (iOS) and a
    // swipe would then drag the backdrop around → with no field focused it's pinned at 0.
    de.style.setProperty('--vvt', `${editingEl ? Math.max(0, vv?.offsetTop ?? 0) : 0}px`)
    // Mobile browser tab (not standalone / desktop): scale every popup down to a
    // "shrunk" version so panel + images + buttons fit the reduced visible area as
    // one uniform unit (see .modal__panel / .cstages__panel — transform:scale).
    // Standalone & desktop stay 1 (byte-for-byte unchanged). Mirrors useMobileWebScale.
    const coarse = !!window.matchMedia?.('(pointer: coarse)').matches
    const standalone =
      !!window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    const mobileWeb = coarse && !standalone
    de.style.setProperty('--mw-scale', mobileWeb ? '0.8' : '1')
    // Popup iOS safe-area only applies at full size (fullscreen/desktop). On mobile
    // web the popup is already shrunk 0.8, so it clears the notch on its own → 0.
    de.style.setProperty('--safe-mult', mobileWeb ? '0' : '1')
    return h > 0 && w > 0
  }

  // Keep retrying early on until the viewport reports a real size (some browsers
  // report 0 for a few frames after load); then the listeners keep it in sync.
  let tries = 0
  const seed = () => {
    if (apply() || tries++ > 30) return
    setTimeout(seed, 100)
  }
  seed()
  window.addEventListener('load', apply)
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', apply)
  initKeyboardAware(apply)
}
