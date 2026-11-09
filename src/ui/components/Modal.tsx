import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { portalRoot } from '../../platform/canvas'
import BackButton from './BackButton'
import { useRef } from 'react'
import useFitHeight from '../hooks/useFitHeight'
import './Modal.css'

interface Props {
  open: boolean
  onClose?: () => void
  title?: ReactNode
  children: ReactNode
  /** disable closing by backdrop click */
  locked?: boolean
  width?: number
  /** prominent title (e.g. the main-menu start dialog) */
  largeTitle?: boolean
  /** extra class on the panel (e.g. per-dialog desktop sizing) */
  panelClass?: string
  /** extra class on the scrim (e.g. a lighter backdrop so the board stays visible) */
  scrimClass?: string
  /** when set, a「<」back button sits at the left of the title row (same row, so it
   *  never floats over the content); plays the click SFX. */
  onBack?: () => void
  /** 觀戰對決彈窗:遮罩不吃點擊(pointer-events:none),只留面板本身可互動 → 面板外(如右下
   *  「離開觀戰」鈕)的點擊穿透到底層仍可按。視覺遮罩照舊。 */
  scrimThrough?: boolean
  /** 標題列右邊的小鈕(例:快速配對的「?」一週表),跟返回鍵對稱放第 3 欄 */
  titleAction?: ReactNode
}

/**
 * Modal with an enter animation only — it unmounts immediately on close
 * (no exit animation) so a throttled rAF can never leave a stuck overlay.
 */
export default function Modal({ open, onClose, title, children, locked, width = 420, largeTitle, panelClass, scrimClass, onBack, scrimThrough, titleAction }: Props) {
  // 放不下就整塊等比縮(內容+圖+按鈕一起,§8.2);放得下 = 1。framer 擁有 transform,
  // 所以縮放要當 animate 的目標,不能寫在 CSS。
  const panelRef = useRef<HTMLDivElement>(null)
  const mw = useFitHeight(panelRef, open)
  if (!open) return null
  // Portal 到畫布(#root)最外層:不會被困在牌桌之類的子元素裡,但仍在畫布裡 →
  // 假橫向跟著轉、網頁版跟著縮(platform/canvas.ts)。遮罩蓋滿整塊畫布(.modal__scrim / 100cqh)。
  return createPortal(
    <motion.div
      className={`modal__scrim${scrimClass ? ` ${scrimClass}` : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => !locked && onClose?.()}
      style={scrimThrough ? { pointerEvents: 'none' } : undefined}
    >
      <motion.div
        ref={panelRef}
        className={`modal__panel${panelClass ? ` ${panelClass}` : ''}`}
        style={{ maxWidth: width, ['--fit' as string]: mw, ...(scrimThrough ? { pointerEvents: 'auto' } : null) }}
        initial={{ scale: 0.85 * mw, y: 20, opacity: 0 }}
        animate={{ scale: mw, y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 340, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || onBack) && (
          <div className={`modal__titlebar${!onBack && !titleAction ? ' modal__titlebar--solo' : ''}`}>
            {onBack && <BackButton onClick={onBack} className="modal__back" />}
            {title && <h2 className={`modal__title${largeTitle ? ' modal__title--large' : ''}`}>{title}</h2>}
            {titleAction && <div className="modal__action">{titleAction}</div>}
          </div>
        )}
        <div className="modal__body">{children}</div>
      </motion.div>
    </motion.div>,
    portalRoot(),
  )
}
