import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { sfx } from '../../audio/sfx'
import './Button.css'

interface Props {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'lg' | 'md' | 'sm'
  full?: boolean
  icon?: ReactNode
}

/** Wooden Q-style button (warm plank, dark border, chunky 3D base). */
export default function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  size = 'md',
  full,
  icon,
}: Props) {
  return (
    <motion.button
      className={`woodbtn woodbtn--${variant} woodbtn--${size}${full ? ' woodbtn--full' : ''}`}
      disabled={disabled}
      // pointerType guard: touch taps synthesize a mouseenter, which made every
      // mobile tap play hover+click. Only real mouse movement should hover.
      // Fire on every hover (the sweeping cue is intended) — volume is kept very
      // low instead of throttling (使用者 #1: 停留才響太怪,改壓音量).
      onPointerEnter={(e) => { if (e.pointerType === 'mouse' && !disabled) sfx.hover() }}
      onClick={() => {
        if (disabled) return
        sfx.click()
        onClick?.()
      }}
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { y: 1, scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
    >
      {icon !== undefined && <span className="woodbtn__icon">{icon}</span>}
      <span className="woodbtn__label">{children}</span>
    </motion.button>
  )
}

/** Cute paw-print icon for menu buttons. */
export function Paw() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <ellipse cx="7" cy="9" rx="2.1" ry="2.8" />
      <ellipse cx="12" cy="7.4" rx="2.1" ry="2.9" />
      <ellipse cx="17" cy="9" rx="2.1" ry="2.8" />
      <path d="M12 11.5c3 0 5.4 2.1 5.4 4.4 0 1.9-1.9 2.6-3.4 2.6-.9 0-1.4-.4-2-.4s-1.1.4-2 .4c-1.5 0-3.4-.7-3.4-2.6 0-2.3 2.4-4.4 5.4-4.4Z" />
    </svg>
  )
}

/** Monochrome shop (shopping bag) icon for the 商城 button. */
export function IconShop() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8h12l-1 12H7L6 8Z" />
      <path d="M9 8V6.2a3 3 0 0 1 6 0V8" />
    </svg>
  )
}

/* Monochrome action icons (inherit the button's wood-brown color). */
export function IconRobot() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <circle cx="9.3" cy="13" r="1.6" fill="#f7ead0" />
      <circle cx="14.7" cy="13" r="1.6" fill="#f7ead0" />
      <rect x="9" y="16" width="6" height="1.6" rx="0.8" fill="#f7ead0" />
      <rect x="11" y="3.5" width="2" height="3" rx="1" />
      <circle cx="12" cy="3" r="1.6" />
      <rect x="2.5" y="11" width="2" height="5" rx="1" />
      <rect x="19.5" y="11" width="2" height="5" rx="1" />
    </svg>
  )
}
export function IconDice() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <circle cx="8.5" cy="8.5" r="1.5" fill="#f7ead0" />
      <circle cx="15.5" cy="8.5" r="1.5" fill="#f7ead0" />
      <circle cx="12" cy="12" r="1.5" fill="#f7ead0" />
      <circle cx="8.5" cy="15.5" r="1.5" fill="#f7ead0" />
      <circle cx="15.5" cy="15.5" r="1.5" fill="#f7ead0" />
    </svg>
  )
}
export function IconKey() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="8" cy="8" r="4.5" />
      <circle cx="8" cy="8" r="1.8" fill="#f7ead0" />
      <path d="M11 11 L20 20 M17 17 l2.5 -2.5 M15 15 l2 -2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}
export function IconGlobe() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8.5" />
      <path d="M3.8 9.5h16.4M3.8 14.5h16.4" />
    </svg>
  )
}
/** Monochrome megaphone (公告). Inherits the button's wood-brown color. */
export function IconMegaphone() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 10v4a1 1 0 0 0 1 1h2l2.2 3.3a1 1 0 0 0 1.8-.6V6.3a1 1 0 0 0-1.8-.6L7 9H5a1 1 0 0 0-1 1Z" />
      <path d="M15 8.5a4 4 0 0 1 0 7" />
      <path d="M7 15v3" />
    </svg>
  )
}
/** Monochrome calendar (每日任務). Inherits the button's wood-brown color. */
export function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.2v3.4M16 3.2v3.4" />
      <path d="M7.5 13h3M7.5 16.5h3M13.5 13h3M13.5 16.5h3" strokeWidth="2.2" />
    </svg>
  )
}
