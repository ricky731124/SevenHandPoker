import { createPortal } from 'react-dom'
import { useEffect } from 'react'
import { isInAppBrowser, isLineInApp, isIOS, isAndroid, isStandalone } from '../../platform/pwa'
import { sfx } from '../../audio/sfx'
import './PwaOnboard.css'

/**
 * In-app-webview router. Facebook / Messenger / Instagram / LINE webviews can't go
 * landscape-fullscreen and Google blocks OAuth inside them, so we get the player
 * OUT to a real browser. What that takes differs by app + platform:
 *
 *   • LINE (iOS/Android) — honours `?openExternalBrowser=1`: silently reopen there
 *     in the system browser. No UI (the user never notices).
 *   • Android FB/Messenger/IG/… — jump to Chrome via an `intent:` URL (with an
 *     https fallback). Show a one-line "opening Chrome" notice while it fires.
 *   • iOS FB/Messenger/IG/… — CANNOT be escaped programmatically (Meta blocks every
 *     x-safari-https / x-web-search trick; confirmed by testing). Show a manual
 *     guide: tap ⋯ (top-right) → 使用外部瀏覽器開啟.
 *
 * Standalone (installed PWA) and desktop are never gated. A /?room= deep link is
 * preserved through the LINE/Android redirects (buildExternalUrl / the intent path
 * both carry the current query).
 */

const EXTERNAL_PARAM = 'openExternalBrowser'

/** Current URL with `?openExternalBrowser=1` added (LINE opens it externally). */
function buildExternalUrl(): string {
  const u = new URL(window.location.href)
  u.searchParams.set(EXTERNAL_PARAM, '1')
  return u.toString()
}

/** An intent: URL that opens the current page in Chrome, falling back to the plain
 *  https URL if Chrome can't handle it. */
function buildChromeIntent(): string {
  const host = window.location.host
  const path = window.location.pathname + window.location.search
  const fallback = encodeURIComponent(window.location.href)
  return (
    `intent://${host}${path}#Intent;scheme=https;package=com.android.chrome;` +
    `action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;` +
    `S.browser_fallback_url=${fallback};end`
  )
}

export default function InAppBrowserGate() {
  // UA is static, so the case is fixed for this load.
  const active = isInAppBrowser() && !isStandalone()
  const line = isLineInApp()
  const android = isAndroid()
  const ios = isIOS()

  useEffect(() => {
    if (!active) return
    if (line) {
      // Silent: reopen in the system browser (guard the param so it can't loop).
      if (!new URLSearchParams(window.location.search).has(EXTERNAL_PARAM)) {
        window.location.replace(buildExternalUrl())
      }
      return
    }
    if (android) {
      // Jump straight to Chrome — but only ONCE per session. If Chrome is missing,
      // the intent's browser_fallback_url reloads this page inside the FB webview;
      // without the guard the gate would re-fire and loop. On the second landing the
      // notice + manual「改用 Chrome 開啟」button below take over.
      let fired = false
      try { fired = sessionStorage.getItem('shp_intent_fired') === '1' } catch { /* private mode */ }
      if (!fired) {
        try { sessionStorage.setItem('shp_intent_fired', '1') } catch { /* ignore */ }
        window.location.href = buildChromeIntent()
      }
    }
    // iOS (and non-LINE desktopless edge cases): nothing to fire — show the guide.
  }, [active, line, android])

  if (!active || line) return null // LINE redirects silently in the effect

  if (android) {
    // Feedback while Chrome opens (the page is navigating away); the button is a
    // manual re-fire if the auto-jump didn't take (e.g. Chrome not default).
    return createPortal(
      <div className="iabgate" role="dialog" aria-modal="true">
        <div className="iabgate__icon">🌐</div>
        <div className="iabgate__title">正在開啟外部瀏覽器</div>
        <div className="iabgate__body">
          你目前正使用 Facebook 內建瀏覽器開啟遊戲，內建瀏覽器無法正常橫向與 Google
          登入。正引導你使用外部瀏覽器（Chrome）開啟。
        </div>
        <button className="iabgate__copy" onClick={() => { sfx.click(); window.location.href = buildChromeIntent() }}>
          改用 Chrome 開啟
        </button>
      </div>,
      document.body,
    )
  }

  // iOS in-app (FB/Messenger/IG…): manual guide — can't be escaped in code.
  void ios
  return createPortal(
    <div className="iabgate" role="dialog" aria-modal="true">
      <div className="iabgate__more-arrow" aria-hidden>⤴ 右上角 ⋯</div>
      <div className="iabgate__icon">🧭</div>
      <div className="iabgate__title">請使用外部瀏覽器開啟</div>
      <div className="iabgate__body">
        你目前正使用 Facebook 內建瀏覽器開啟遊戲，內建瀏覽器無法正常橫向與 Google
        登入。請點右上角 ⋯ → 選「使用外部瀏覽器開啟」。
      </div>
      <div className="iabgate__steps">
        ① 點右上角的 ⋯
        <br />② 選「使用外部瀏覽器開啟」
      </div>
    </div>,
    document.body,
  )
}
