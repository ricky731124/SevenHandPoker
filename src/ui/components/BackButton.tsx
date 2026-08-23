import { sfx } from '../../audio/sfx'
import './BackButton.css'

/**
 * The shared round wooden「<」back button (same look as the screen top-bar's
 * .pz-back). Used inside modals (玩家資訊 / 每日任務 / 公告) — the Modal panel is
 * position:relative, so this parks at its top-left. Always plays the click SFX.
 */
export default function BackButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={`backbtn${className ? ` ${className}` : ''}`}
      onClick={() => { sfx.click(); onClick() }}
      aria-label="返回"
      title="返回"
    >
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
        <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
