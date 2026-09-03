import { createPortal } from 'react-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { useAppStore } from '../../state/appStore'
import { useToastStore } from '../../state/toastStore'
import {
  isAndroid,
  isIOS,
  isInAppBrowser,
  isMobile,
  isPwaInstalled,
  promptInstall,
  usePwaStore,
} from '../../platform/pwa'
import { sfx } from '../../audio/sfx'
import './PwaOnboard.css'

/**
 * Nudges players to add the game to their home screen — the only way to get
 * true fullscreen (no browser chrome) + landscape lock on mobile. The mobile
 * BROWSER view is cramped/unreliable, so as long as the player is NOT running
 * the installed app (standalone), we keep offering install every visit (使用者:
 * 沒裝就一直引導;關掉只當次隱藏,下次再進來還是提示).
 *
 * Normal entry → prominent "push". Invite entry (a /?room= deep link) → quiet
 * "soft" bar, because adding to home won't help the current room (the icon
 * opens the clean start_url, not this room) — it only helps next time.
 */
export default function InstallGuide() {
  const canInstall = usePwaStore((s) => s.canInstall)
  const standalone = usePwaStore((s) => s.standalone)
  const justInstalled = usePwaStore((s) => s.justInstalled)
  const room = useAppStore((s) => s.pendingRoom)
  const [dismissed, setDismissed] = useState(false) // 只當次隱藏,不寫 localStorage → 下次進來再提示
  // Android only: is the PWA actually installed (WebAPK) even though we're in a
  // browser tab? null = still detecting → render nothing (avoids the manual↔native flip).
  const [androidInstalled, setAndroidInstalled] = useState<boolean | null>(isAndroid() ? null : false)
  useEffect(() => {
    if (isAndroid()) void isPwaInstalled().then(setAndroidInstalled)
  }, [])

  // Running the installed app, inside an in-app browser (gate handles that), on
  // desktop, or dismissed this session → nothing to do.
  if (standalone || isInAppBrowser() || !isMobile()) return null

  // Android just finished installing (appinstalled) → the browser tab stays put,
  // which is confusing ("安裝好了怎麼還在瀏覽器"). Tell them to open from the icon.
  // Shown even if the install prompt was just dismissed; iOS never reaches here
  // (no appinstalled event — its guide already says to open from the icon). 使用者 #4。
  if (justInstalled && isAndroid()) {
    return portal(
      <div className="a2hs a2hs--push">
        <div className="a2hs__title">🎉 安裝完成！</div>
        <div className="a2hs__text">請回桌面點擊遊戲圖示開啟，即可全螢幕遊玩。</div>
        <button
          className="a2hs__close"
          aria-label="關閉"
          onClick={() => { sfx.click(); usePwaStore.setState({ justInstalled: false }) }}
          style={{ position: 'absolute', top: 6, right: 8 }}
        >
          ✕
        </button>
      </div>,
    )
  }

  if (dismissed) return null

  const soft = Boolean(room)

  // Manual ✕ — hide for THIS session only (next visit re-prompts, since the
  // browser view is bad and we want installers to keep being nudged).
  const close = () => {
    sfx.click()
    setDismissed(true)
  }

  const afterInstall = () => setDismissed(true)

  // ---- Android ---------------------------------------------------------------
  if (isAndroid()) {
    if (androidInstalled === null) return null // 偵測中,先不顯示(避免版面閃動)

    // 有裝、但用瀏覽器開 → 建議改用桌面圖示(體驗較好)。
    if (androidInstalled) {
      if (soft) {
        return portal(
          <div className="a2hs a2hs--soft">
            <span className="a2hs__soft-text">建議使用桌面圖示開啟,遊戲體驗較佳(開啟後輸入房號 {room})</span>
            <button className="a2hs__close" aria-label="關閉" onClick={close}>✕</button>
          </div>,
        )
      }
      return portal(
        <div className="a2hs a2hs--push">
          <div className="a2hs__title">(建議) 用桌面圖示開啟</div>
          <div className="a2hs__text">偵測到手機已有安裝此遊戲，<br />建議使用桌面圖示開啟，遊戲體驗較佳。</div>
          <button className="a2hs__close" aria-label="關閉" onClick={close} style={{ position: 'absolute', top: 6, right: 8 }}>✕</button>
        </div>,
      )
    }

    // 沒裝 → 安裝提示。單一版面(不因 canInstall 閃動):按鈕有原生提示就叫原生,
    // 沒有就用 toast 引導 ⋮ 選單。
    const install = async () => {
      sfx.click()
      if (canInstall) {
        const ok = await promptInstall()
        if (ok) afterInstall()
      } else {
        useToastStore.getState().show('請點瀏覽器右上角 ⋮ 選單 →「安裝應用程式」')
      }
    }
    if (soft) {
      return portal(
        <div className="a2hs a2hs--soft">
          <span className="a2hs__soft-text">安裝到主畫面,體驗全螢幕(開啟後輸入房號 {room})</span>
          <button className="a2hs__btn" onClick={install}>安裝</button>
          <button className="a2hs__close" aria-label="關閉" onClick={close}>✕</button>
        </div>,
      )
    }
    return portal(
      <div className="a2hs a2hs--push">
        <div className="a2hs__title">(建議) 安裝到主畫面，體驗全螢幕遊玩</div>
        <div className="a2hs__text">安裝到主畫面，之後使用桌面圖示開啟遊戲即可全螢幕遊玩。</div>
        <button className="a2hs__btn" onClick={install}>安裝到主畫面</button>
        <button className="a2hs__close" aria-label="關閉" onClick={close} style={{ position: 'absolute', top: 6, right: 8 }}>✕</button>
      </div>,
    )
  }

  // ---- iOS: no native prompt — guide to the Safari share button. iOS 無法偵測
  //      「是否已加到主畫面」(那只是捷徑,非真安裝) → 只要不是從主畫面圖示開啟就一律提示。
  if (isIOS()) {
    if (soft) {
      return portal(
        <div className="a2hs a2hs--soft">
          <span className="a2hs__soft-text">
            想要全螢幕?點下方分享按鈕 <ShareIcon />「加入主畫面」後開遊戲、輸入房號 {room}
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
          <div className="a2hs__title">(建議) 加到主畫面，體驗全螢幕遊玩</div>
          <div className="a2hs__text">
            點擊下方的分享按鈕 <ShareIcon /> → 往下滑，選「加入主畫面」並加入。加入後，請回主畫面點擊遊戲圖示開啟，即可全螢幕遊玩。
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

/** iOS Safari 分享按鈕圖示:一個開口向上的方框 + 往上突出的箭頭。線條 icon、無填色,
 *  跟著文字色(currentColor)。 */
function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ verticalAlign: '-0.15em', margin: '0 2px' }}
    >
      <path d="M12 15V3" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
      <path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" />
    </svg>
  )
}

function portal(node: ReactNode) {
  return createPortal(node, document.body)
}
