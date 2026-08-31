import { useEffect, useState } from 'react'

/**
 * Uniform shrink factor for popups on the mobile browser tab (NOT standalone /
 * desktop). The address/bookmark bar eats ~20% of the height, so a full-size
 * dialog overflows and has to scroll; scaling the whole panel (and everything in
 * it — text, card art, buttons) down as one unit keeps it a proportional "shrunk"
 * version that fits on one screen.
 *
 * - Mobile browser tab → 0.8
 * - Standalone (installed PWA) / desktop → 1 (byte-for-byte unchanged)
 *
 * Mirrors the `--mw-scale` CSS var (see platform/viewport.ts); this hook exists
 * because framer-motion owns the modal panel's `transform`, so the value has to be
 * fed through its `animate` prop rather than set in CSS.
 */
function compute(): number {
  if (typeof window === 'undefined') return 1
  const coarse = !!window.matchMedia?.('(pointer: coarse)').matches
  const standalone =
    !!window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  return coarse && !standalone ? 0.8 : 1
}

export default function useMobileWebScale(): number {
  const [scale, setScale] = useState(compute)
  useEffect(() => {
    const on = () => setScale(compute())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return scale
}
