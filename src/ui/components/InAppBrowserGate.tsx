import { createPortal } from 'react-dom'
import { useState } from 'react'
import { isInAppBrowser, isIOS } from '../../platform/pwa'
import './PwaOnboard.css'

/**
 * Blocks LINE / Facebook / Instagram in-app browsers. These can't be made
 * fullscreen and Google blocks OAuth inside them, so we stop here and push the
 * player to a real browser. Any /?room= deep link stays in the address bar and
 * carries over when they re-open externally. See the onboarding flow.
 */
export default function InAppBrowserGate() {
  const [copied, setCopied] = useState(false)
  if (!isInAppBrowser()) return null

  const menuHint = isIOS()
    ? '點右下角的 ⋯ 選單'
    : '點右上角的 ⋮ 選單'

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — the manual steps still work */
    }
  }

  return createPortal(
    <div className="iabgate" role="dialog" aria-modal="true">
      <div className="iabgate__icon">🌐</div>
      <div className="iabgate__title">請用瀏覽器開啟</div>
      <div className="iabgate__body">
        在 LINE 內建瀏覽器無法全螢幕遊玩,也無法用 Google 登入。請改用 Safari
        或 Chrome 開啟遊戲。
      </div>
      <div className="iabgate__steps">
        1. {menuHint}
        <br />
        2. 選「用其他瀏覽器開啟」
        <br />
        3. 進入後可加到主畫面,全螢幕玩
      </div>
      <button className="iabgate__copy" onClick={copyLink}>
        {copied ? '已複製連結 ✓' : '複製遊戲連結'}
      </button>
      <div className="iabgate__muted">複製後貼到 Safari / Chrome 網址列也可以</div>
    </div>,
    document.body,
  )
}
