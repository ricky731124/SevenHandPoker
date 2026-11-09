/**
 * 引導圖解用的小圖示:畫成手機上「實際看到的那個按鈕」,玩家照圖找就好,不用讀長句。
 * 線條圖、無填色,跟著文字色(currentColor)。
 */
const svg = {
  viewBox: '0 0 24 24',
  width: '1em',
  height: '1em',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** iOS Safari 分享鈕:開口向上的方框 + 往上的箭頭 */
export function ShareIcon() {
  return (
    <svg {...svg}>
      <path d="M12 15V3" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
      <path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" />
    </svg>
  )
}

/** iOS「加入主畫面」:圓角方框 + 加號 */
export function AddHomeIcon() {
  return (
    <svg {...svg}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}

/** iOS Safari 新版:分享鈕收在「⋯」裡 */
export function MoreIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="7.5" cy="12" r="0.6" fill="currentColor" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
      <circle cx="16.5" cy="12" r="0.6" fill="currentColor" />
    </svg>
  )
}

/** FB / IG / Threads 內建瀏覽器右上角的「⋯」 */
export function DotsIcon() {
  return (
    <svg {...svg} strokeWidth={3.4}>
      <path d="M5 12h.01M12 12h.01M19 12h.01" />
    </svg>
  )
}

/** 「在外部瀏覽器開啟」:Safari 的指南針 */
export function SafariIcon() {
  return (
    <svg {...svg}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M15.8 8.2 13.4 13.4 8.2 15.8 10.6 10.6z" fill="currentColor" fillOpacity="0.25" />
      <path d="M12 3.5v1.6M12 18.9v1.6M3.5 12h1.6M18.9 12h1.6" />
    </svg>
  )
}

/** 複製連結 */
export function CopyIcon() {
  return (
    <svg {...svg}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.2" />
      <path d="M15.5 5.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h.5" />
    </svg>
  )
}

/** 安卓瀏覽器右上角的「⋮」選單 */
export function KebabIcon() {
  return (
    <svg {...svg} strokeWidth={3.2}>
      <path d="M12 5h.01M12 12h.01M12 19h.01" />
    </svg>
  )
}

/** 安卓「安裝應用程式」:手機 + 往下的箭頭 */
export function InstallIcon() {
  return (
    <svg {...svg}>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M12 7v7M9 11.5l3 3 3-3" />
      <path d="M10.5 18.5h3" />
    </svg>
  )
}

/** 直拿手機往下滑:iOS 從右上角(控制中心)、安卓從上方中間(快速設定) */
export function SwipeDownIcon({ from = 'corner' }: { from?: 'corner' | 'top' }) {
  if (from === 'top') {
    return (
      <svg {...svg}>
        <rect x="6.5" y="3" width="11" height="18" rx="2.5" />
        <path d="M12 1.5v8M9.5 7l2.5 2.5L14.5 7" />
      </svg>
    )
  }
  return (
    <svg {...svg}>
      <rect x="5" y="3" width="11" height="18" rx="2.5" />
      <path d="M19.5 2.5v7M17.5 7.5l2 2 2-2" />
    </svg>
  )
}

/** 安卓快速設定的「自動旋轉」鈕:手機 + 兩個繞圈的箭頭 */
export function AutoRotateIcon() {
  return (
    <svg {...svg}>
      <rect x="8.5" y="6" width="7" height="12" rx="1.5" />
      <path d="M4 10a8.5 8.5 0 0 1 6-6.5M8 2.5l2 1-1 2" />
      <path d="M20 14a8.5 8.5 0 0 1-6 6.5M16 21.5l-2-1 1-2" />
    </svg>
  )
}

/** 控制中心的「直向鎖定」鈕:鎖頭 + 外圈箭頭 */
export function RotationLockIcon() {
  return (
    <svg {...svg}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M18.5 3v3.5H15" />
      <rect x="9" y="11" width="6" height="5" rx="1" />
      <path d="M10.3 11V9.6a1.7 1.7 0 0 1 3.4 0V11" />
    </svg>
  )
}

/** 把手機轉成橫的 */
export function RotateIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="8" width="18" height="10" rx="2.5" />
      <path d="M8 4.5a7 7 0 0 1 9 1.5" />
      <path d="M17.5 3v3h-3" />
    </svg>
  )
}
