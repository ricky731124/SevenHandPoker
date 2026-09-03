import { motion } from 'framer-motion'
import type { SortDir, SortMode } from '../../../game/sort'
import { sfx } from '../../../audio/sfx'

interface Props {
  mode: SortMode
  dir: SortDir
  onToggleMode: () => void
  onToggleDir: () => void
  /** tutorial spotlight — pulses the 依點數/依花色 button until it's been tapped. */
  hlMode?: boolean
  /** tutorial spotlight — pulses the 升冪/降冪 button until it's been tapped. */
  hlDir?: boolean
}

function RoundBtn({
  onClick,
  title,
  highlight,
  children,
}: {
  onClick: () => void
  title: string
  highlight?: boolean
  children: React.ReactNode
}) {
  return (
    <motion.button
      // `sort-hl` (box-shadow + transform on the button only) — NOT `tut-hl`: the
      // latter animates `filter` on the container, which would make the static
      // .sortbtns a containing block and drop the absolute buttons to the wrong place.
      className={`sortbtn${highlight ? ' sort-hl' : ''}`}
      title={title}
      aria-label={title}
      onClick={() => {
        sfx.click()
        onClick()
      }}
      whileTap={{ scale: 0.9 }}
    >
      <svg viewBox="0 0 24 24" width="58%" height="58%">
        {children}
      </svg>
    </motion.button>
  )
}

export default function SortButtons({ mode, dir, onToggleMode, onToggleDir, hlMode, hlDir }: Props) {
  return (
    <div className="sortbtns">
      {/* tutorial: label the pair so new players know these two are the thing to tap */}
      {(hlMode || hlDir) && <span className="sortbtns__label">點擊這兩顆 👇</span>}
      {/* field (upper-left): rank (bars) vs suit (pips) */}
      <RoundBtn onClick={onToggleMode} title="切換排序依據（點數 / 花色）" highlight={hlMode}>
        {mode === 'rank' ? (
          <g fill="currentColor">
            <rect x="4" y="13" width="3.6" height="7" rx="1" />
            <rect x="10.2" y="9" width="3.6" height="11" rx="1" />
            <rect x="16.4" y="5" width="3.6" height="15" rx="1" />
          </g>
        ) : (
          <g fill="currentColor">
            <path d="M8 3.5c0 2.6 3.4 3.4 3.4 5.2 0 1-.9 1.6-1.8 1.2.2.8.5 1.4 1 1.9H6.4c.5-.5.8-1.1 1-1.9-.9.4-1.8-.2-1.8-1.2C5.6 6.9 8 6.1 8 3.5Z" />
            <path d="M16.5 12.5 20 16.5 16.5 20.5 13 16.5Z" />
          </g>
        )}
      </RoundBtn>

      {/* direction (lower-right, further down): big→small vs small→big */}
      <RoundBtn onClick={onToggleDir} title="切換排序方向（大↔小）" highlight={hlDir}>
        <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          {dir === 'desc' ? <path d="M12 4v15M6 13l6 6 6-6" /> : <path d="M12 20V5M6 11l6-6 6 6" />}
        </g>
      </RoundBtn>
    </div>
  )
}
