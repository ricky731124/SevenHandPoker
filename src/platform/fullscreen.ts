import { isAndroid, isInAppBrowser, isStandalone } from './pwa'

/**
 * 安卓瀏覽器:點「點擊開始」時進全螢幕 + 鎖橫向 → 變成真橫向、沒有網址列(跟安裝版一樣),
 * 不管有沒有開自動旋轉(docs/MOBILE-LANDSCAPE-SPEC.md 改動 B)。
 * iOS 的網頁不能進全螢幕(系統不開放);安裝版本來就全螢幕 + manifest 鎖橫;內建瀏覽器會被導出。
 * 瀏覽器不支援 → 什麼都不做,照舊假橫向(platform/canvas.ts 會轉 90°)。
 */
export function wantsFullscreen(): boolean {
  return isAndroid() && !isStandalone() && !isInAppBrowser()
}

/** 一定要在點擊裡呼叫(瀏覽器規定全螢幕要由使用者動作觸發)。 */
export function enterLandscapeFullscreen(): void {
  if (!wantsFullscreen() || document.fullscreenElement) return
  const el = document.documentElement
  if (!el.requestFullscreen) return
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {}) // 不支援全螢幕或鎖方向 → 照舊
}

let armed = false
/** 開始後呼叫一次:切出 App、返回手勢會讓系統取消全螢幕 → 下一次點畫面就默默再進一次。 */
export function keepFullscreen(): void {
  if (armed || !wantsFullscreen()) return
  armed = true
  document.addEventListener('click', enterLandscapeFullscreen, true)
}
