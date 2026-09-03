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
}
