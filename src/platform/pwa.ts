import { create } from 'zustand'

/**
 * PWA / environment helpers. See the onboarding flow: block in-app browsers
 * (LINE/FB/IG) → push to a real browser → add-to-home for true fullscreen +
 * landscape lock. Google login (in-app browsers block OAuth) lives elsewhere.
 */

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''

export function isIOS(): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  // iPadOS 13+ reports a desktop Mac UA but exposes touch points.
  return (
    typeof navigator !== 'undefined' &&
    navigator.platform === 'MacIntel' &&
    navigator.maxTouchPoints > 1
  )
}

export function isAndroid(): boolean {
  return /Android/i.test(ua)
}

export function isMobile(): boolean {
  return isIOS() || isAndroid()
}

/** True inside an embedded webview (LINE/FB/IG/WeChat/…) — these can't be made
 *  fullscreen and Google blocks OAuth in them, so we gate them out. */
export function isInAppBrowser(): boolean {
  if (!ua) return false
  // Explicit known in-app browsers.
  if (/\bLine\//i.test(ua)) return true // LINE
  if (/FBAN|FBAV|FB_IAB|FBIOS|Messenger/i.test(ua)) return true // Facebook / Messenger
  if (/Instagram/i.test(ua)) return true // Instagram
  if (/MicroMessenger/i.test(ua)) return true // WeChat
  if (/\bGSA\//i.test(ua)) return true // Google App in-app browser
  return false
}

/** Running as an installed PWA (home-screen icon), not a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mm =
    window.matchMedia &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches)
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true
  return Boolean(mm || iosStandalone)
}

// ---- Reactive install state (Android / desktop Chrome install banner) --------

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null

interface PwaState {
  /** A native install prompt is available (Android / desktop Chrome). */
  canInstall: boolean
  /** Running from the installed home-screen icon. */
  standalone: boolean
}

export const usePwaStore = create<PwaState>(() => ({
  canInstall: false,
  standalone: isStandalone(),
}))

/** Android Chrome only: whether THIS PWA is actually installed (WebAPK), even
 *  when currently opened in a browser tab. Uses getInstalledRelatedApps() against
 *  the manifest's related_applications entry. iOS / unsupported → false (there is
 *  no way to detect an iOS home-screen shortcut). Never throws. */
export async function isPwaInstalled(): Promise<boolean> {
  try {
    const nav = navigator as unknown as { getInstalledRelatedApps?: () => Promise<unknown[]> }
    if (!nav.getInstalledRelatedApps) return false
    const apps = await nav.getInstalledRelatedApps()
    return Array.isArray(apps) && apps.length > 0
  } catch {
    return false
  }
}

/** Fire the native "install app" prompt. Returns true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  const evt = deferredPrompt
  deferredPrompt = null
  usePwaStore.setState({ canInstall: false })
  await evt.prompt()
  const { outcome } = await evt.userChoice
  return outcome === 'accepted'
}

/** Wire up install / standalone listeners. Call once at boot. */
export function initPwa(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    usePwaStore.setState({ canInstall: true })
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    usePwaStore.setState({ canInstall: false })
  })

  // display-mode can flip (e.g. user installs then opens the icon).
  if (window.matchMedia) {
    const mq = window.matchMedia('(display-mode: standalone)')
    const onChange = () => usePwaStore.setState({ standalone: isStandalone() })
    mq.addEventListener?.('change', onChange)
  }

  // Register the service worker (needed for Android installability). Prod only
  // so it never interferes with the Vite dev server / HMR.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
    })
  }
}
