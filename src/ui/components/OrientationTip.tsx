import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const MQ = '(max-width: 900px) and (orientation: portrait) and (pointer: coarse)'

/**
 * Small tip shown ONLY while the phone is held portrait (the fake-landscape
 * rotate trick in global.css is active). Rendered via a portal to <body> so it
 * sits OUTSIDE the 90°-rotated #root → the text reads upright while the phone is
 * upright. It disappears the moment the phone is turned landscape (auto-rotate
 * on). 使用者:先做這個保險;若之後確認橫開已完全正確,可再拿掉。
 */
export default function OrientationTip() {
  const [portrait, setPortrait] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(MQ).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(MQ)
    const on = () => setPortrait(mq.matches)
    mq.addEventListener?.('change', on)
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      mq.removeEventListener?.('change', on)
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])

  if (!portrait) return null
  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 'env(safe-area-inset-top, 0px)',
        left: 0,
        right: 0,
        zIndex: 4000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: '10px 16px',
        background: 'rgba(20,6,8,0.92)',
        color: '#fbe6c0',
        borderBottom: '2px solid #d79a24',
        fontFamily: 'var(--font-display, sans-serif)',
        textAlign: 'center',
        pointerEvents: 'none',
      }}
      role="status"
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>🔄</span>
      <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>
        請將手機轉為橫向,並確認已開啟「自動旋轉」,以享受良好的遊戲體驗。
      </span>
    </div>,
    document.body,
  )
}
