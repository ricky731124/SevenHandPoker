import { createPortal } from 'react-dom'
import { portalRoot } from '../../platform/canvas'
import { useEffect, useState } from 'react'
import { inAppName, isInAppBrowser, isLineInApp, isAndroid, isStandalone } from '../../platform/pwa'
import { sfx } from '../../audio/sfx'
import { IAB_TEXT, IabSteps } from '../splash/guides'
import { CopyIcon } from '../splash/icons'
import './PwaOnboard.css'

/**
 * In-app-webview router. Facebook / Messenger / Instagram / Threads / LINE webviews can't go
 * landscape-fullscreen and Google blocks OAuth inside them, so we get the player
 * OUT to a real browser. What that takes differs by app + platform:
 *
 *   • LINE (iOS/Android) — honours `?openExternalBrowser=1`: silently reopen there
 *     in the system browser. No UI (the user never notices).
 *   • Android FB/Messenger/IG/Threads/… — jump to Chrome via an `intent:` URL (with an
 *     https fallback). Show a one-line "opening Chrome" notice while it fires.
 *   • iOS FB/Messenger/IG/Threads/… — CANNOT be escaped programmatically (Meta blocks every
 *     x-safari-https / x-web-search trick; confirmed by testing). Show a manual
 *     guide: 右上角 ⋯ → 在外部瀏覽器開啟(圖示步驟 + 彈跳箭頭指著 ⋯ + 複製連結備案)。
 *     這個畫面掛在 <body>(不跟著畫布轉):玩家在 FB 裡多半直拿,⋯ 在實體螢幕右上角,箭頭要指對地方。
 *
 * Standalone (installed PWA) and desktop are never gated. A /?room= deep link is
 * preserved through the LINE/Android redirects (buildExternalUrl / the intent path
 * both carry the current query) and in the copied link.
 * 文字都在 ui/splash/guides.tsx 的 IAB_TEXT。
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

/** 複製目前網址:先試 Clipboard API,不行再用舊方法(內建瀏覽器常常擋新的)。 */
async function copyUrl(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = url
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, url.length)
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

export default function InAppBrowserGate() {
  // UA is static, so the case is fixed for this load.
  const active = isInAppBrowser() && !isStandalone()
  const line = isLineInApp()
  const android = isAndroid()
  const app = inAppName()
  const [copied, setCopied] = useState<null | boolean>(null)

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
        <div className="iabgate__title">{IAB_TEXT.androidTitle}</div>
        <div className="iabgate__body">{IAB_TEXT.why(app)}</div>
        <button className="iabgate__copy" onClick={() => { sfx.click(); window.location.href = buildChromeIntent() }}>
          {IAB_TEXT.androidBtn}
        </button>
      </div>,
      portalRoot(), // 掛在畫布裡,跟著轉、跟著縮(platform/canvas.ts)
    )
  }

  // iOS in-app (FB/Messenger/IG/Threads…): manual guide — can't be escaped in code.
  const url = window.location.href
  const doCopy = async () => {
    sfx.unlock()
    sfx.click()
    setCopied(await copyUrl(url))
  }
  return createPortal(
    <div className="iabg" role="dialog" aria-modal="true">
      {/* 指著內建瀏覽器右上角的 ⋯ */}
      <div className="iabg__arrow" aria-hidden>
        <span className="iabg__arrow-label">{IAB_TEXT.arrow}</span>
        <svg viewBox="0 0 40 40" width="38" height="38">
          <path d="M8 34 C 12 20, 20 12, 32 8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <path d="M22 6 L33 7.5 L29 18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="iabg__card">
        <div className="iabg__title">{IAB_TEXT.iosTitle}</div>
        <p className="iabg__why">{IAB_TEXT.why(app)}</p>
        <IabSteps />
        <div className="iabg__or">{IAB_TEXT.fallback}</div>
        <button type="button" className="iabg__copy" onClick={() => void doCopy()}>
          <CopyIcon />
          {IAB_TEXT.copy}
        </button>
        {copied !== null && <div className={`iabg__copied${copied ? '' : ' is-fail'}`}>{copied ? IAB_TEXT.copied : IAB_TEXT.copyFail}</div>}
        {copied === false && <div className="iabg__url">{url}</div>}
      </div>
    </div>,
    document.body,
  )
}
