import { useAppStore } from '../../state/appStore'

/**
 * Full-viewport red velvet table with a fine felt weave and vignette.
 * Lightweight (tiled pattern, no full-screen turbulence). Theme-swappable.
 */
export default function TableBackground() {
  const table = useAppStore((s) => s.settings.table)
  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: -1, overflow: 'hidden' }} data-table={table}>
      <svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900" style={{ display: 'block' }}>
        <defs>
          <radialGradient id="felt" cx="50%" cy="42%" r="78%">
            <stop offset="0%" stopColor="#a8253a" />
            <stop offset="45%" stopColor="#8c1b2d" />
            <stop offset="80%" stopColor="#6d1322" />
            <stop offset="100%" stopColor="#4c0c17" />
          </radialGradient>
          <pattern id="weave" width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M0 0L6 6" stroke="rgba(0,0,0,0.07)" strokeWidth="1" />
            <path d="M6 0L0 6" stroke="rgba(255,255,255,0.045)" strokeWidth="1" />
          </pattern>
          <radialGradient id="sheen" cx="50%" cy="34%" r="55%">
            <stop offset="0%" stopColor="rgba(255,180,170,0.16)" />
            <stop offset="100%" stopColor="rgba(255,180,170,0)" />
          </radialGradient>
          <radialGradient id="vig" cx="50%" cy="50%" r="72%">
            <stop offset="58%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.6)" />
          </radialGradient>
        </defs>

        <rect width="1600" height="900" fill="url(#felt)" />
        <rect width="1600" height="900" fill="url(#weave)" />
        <rect width="1600" height="900" fill="url(#sheen)" />
        {/* subtle table rail */}
        <ellipse cx="800" cy="450" rx="740" ry="410" fill="none" stroke="rgba(255,210,190,0.10)" strokeWidth="3" />
        <rect width="1600" height="900" fill="url(#vig)" />
      </svg>
    </div>
  )
}
