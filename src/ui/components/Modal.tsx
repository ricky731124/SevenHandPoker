import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
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
}

/**
 * Modal with an enter animation only — it unmounts immediately on close
 * (no exit animation) so a throttled rAF can never leave a stuck overlay.
 */
export default function Modal({ open, onClose, title, children, locked, width = 420, largeTitle, panelClass }: Props) {
  if (!open) return null
  return (
    <motion.div
      className="modal__scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={() => !locked && onClose?.()}
    >
      <motion.div
        className={`modal__panel${panelClass ? ` ${panelClass}` : ''}`}
        style={{ maxWidth: width }}
        initial={{ scale: 0.85, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 340, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <h2 className={`modal__title${largeTitle ? ' modal__title--large' : ''}`}>{title}</h2>}
        <div className="modal__body">{children}</div>
      </motion.div>
    </motion.div>
  )
}
