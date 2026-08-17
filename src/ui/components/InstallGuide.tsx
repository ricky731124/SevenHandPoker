import { createPortal } from 'react-dom'
import { useState, type ReactNode } from 'react'
import { useAppStore } from '../../state/appStore'
import {
  isAndroid,
  isIOS,
  isInAppBrowser,
  isMobile,
  promptInstall,
  usePwaStore,
} from '../../platform/pwa'
import './PwaOnboard.css'

const DISMISS_KEY = 'shp.a2hs.dismissed'

/**
 * Nudges players to add the game to their home screen — the only way to get
 * true fullscreen (no browser chrome) + landscape lock on mobile.
 *
 * Normal entry → prominent "push". Invite entry (a /?room= deep link) → quiet
 * "soft" bar, because adding to home won't help the current room (the icon
 * opens the clean start_url, not this room) — it only helps next time.
 */
export default function InstallGuide() {
  const canInstall = usePwaStore((s) => s.canInstall)
  const standalone = usePwaStore((s) => s.standalone)
  const room = useAppStore((s) => s.pendingRoom)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  // Already an installed app, inside an in-app browser (gate handles that), on
  // desktop, or dismissed → nothing to do.
  if (standalone || isInAppBrowser() || !isMobile() || dismissed) return null

  const soft = Boolean(room)

  const close = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  // ---- Android: fire the native install prompt ------------------------------
  if (isAndroid()) {
    if (!canInstall) return null // prompt not offered (yet) — nothing we can force
    const install = async () => {
      const ok = await promptInstall()
      if (ok) close()
    }
    if (soft) {
      return portal(
        <div className="a2hs a2hs--soft">
          <span className="a2hs__soft-text">
            想要全螢幕?安裝遊戲後開啟、輸入房號 {room}
          </span>
          <button className="a2hs__btn" onClick={install}>
            安裝
          </button>
          <button className="a2hs__close" aria-label="關閉" onClick={close}>
            ✕
          </button>
        </div>,
      )
    }
    return portal(
      <div className="a2hs a2hs--push">
        <div className="a2hs__title">安裝遊戲 · 全螢幕玩</div>
        <div className="a2hs__text">加到主畫面,像 App 一樣開啟,沒有網址列。</div>
        <button className="a2hs__btn" onClick={install}>
          安裝到主畫面
        </button>
        <button className="a2hs__close" aria-label="關閉" onClick={close} style={{ position: 'absolute', top: 6, right: 8 }}>
          ✕
        </button>
      </div>,
    )
  }

  // ---- iOS: no native prompt — guide to the Safari share button -------------
  if (isIOS()) {
    if (soft) {
      return portal(
        <div className="a2hs a2hs--soft">
          <span className="a2hs__soft-text">
            想要全螢幕?點下方<span className="a2hs__share">⬆️</span>「加入主畫面」後開遊戲、輸入房號 {room}
          </span>
          <button className="a2hs__close" aria-label="關閉" onClick={close}>
            ✕
          </button>
        </div>,
      )
    }
    return portal(
      <>
        <div className="a2hs a2hs--push">
          <div className="a2hs__title">加到主畫面 · 全螢幕玩</div>
          <div className="a2hs__text">
            點下方的<span className="a2hs__share">⬆️</span>分享鍵 → 選「加入主畫面」,
            之後點桌面圖示就是全螢幕。
          </div>
          <button className="a2hs__close" aria-label="關閉" onClick={close} style={{ position: 'absolute', top: 6, right: 8 }}>
            ✕
          </button>
        </div>
        <div className="a2hs__arrow" aria-hidden="true">⬇️</div>
      </>,
    )
  }

  return null
}

function portal(node: ReactNode) {
  return createPortal(node, document.body)
}
