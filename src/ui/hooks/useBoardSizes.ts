import { useEffect, useState } from 'react'

export interface BoardSizes {
  /** uniform playing-card width used everywhere on the table */
  card: number
  coin: number
  avatar: number
  /** left reserve zone width (menu / my avatar / deck) */
  reserve: number
  /** right reserve for the hands — wide enough to clear the submit button */
  rightReserve: number
  /** max width available to a hand row */
  handMax: number
  /** narrowed width of the 7-slot band (frames closer together) */
  bandWidth: number
  /** width of the board box; == viewport on phones, capped on desktop (centred) */
  stageW: number
  /** height of the board box; == viewport on phones, capped on desktop (centred) */
  stageH: number
}

const clamp = (a: number, x: number, b: number) => Math.max(a, Math.min(x, b))

/**
 * Bounded-fluid layout. Phones lay out against the real viewport, exactly as
 * before. Above WCAP the board's *width* is frozen so the 7 slots stop spreading
 * across a wide desktop (the "ocean gaps"); the board is then centred with felt
 * showing on both sides (see Game.css). WCAP sits above every phone-landscape
 * width, so for phones `ew === vw` and every value below is identical to before.
 */
const WCAP = 1000
// Height cap: above this the board box stops growing and is centred vertically,
// so a tall desktop doesn't leave the hands stranded far from the centre band.
// Sits above every phone-landscape height, so phones lay out at full height.
const HCAP = 580

/** True when the portrait "fake-landscape" trick is active (#root rotated 90°,
 *  see global.css). In that state the effective width/height are SWAPPED — laying
 *  out against the raw portrait dims is exactly what cut the left/right edges. */
function isRotated(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(max-width: 900px) and (orientation: portrait) and (pointer: coarse)').matches
  )
}

function calc(): BoardSizes {
  // Lay the board out against the FULL-SCREEN viewport, then useFitScale scales
  // the whole board down to the actually-visible area. (visualViewport = the
  // shrunken visible area, used by useFitScale as the scale target — never here.)
  const de = typeof document === 'undefined' ? null : document.documentElement
  let rawW = typeof window === 'undefined' ? 1024 : Math.max(window.innerWidth, de?.clientWidth || 0)
  let rawH = typeof window === 'undefined' ? 600 : Math.max(window.innerHeight, de?.clientHeight || 0)
  const rotated = isRotated()

  // Mobile browser tab (real landscape): iOS Safari — and Android Chrome — shrink
  // BOTH innerHeight AND clientHeight down to the address-bar-reduced VISIBLE
  // height, leaving NO full-height signal at all. (Measured: an iPhone 15 Pro
  // whose landscape screen is 393 CSS-px tall reports 310 for inner/client/visual
  // alike in a browser tab — so the old max(inner,client) baseline == the visible
  // height, and fit came out 310/310 = 1, i.e. no scaling.) The physical screen's
  // SHORT edge IS the chrome-independent full landscape height (iOS keeps `screen`
  // portrait-fixed, so screen.width = 393 = the landscape full height), so adopt
  // it as the layout baseline; useFitScale then scales the whole board down to the
  // actually-visible visualViewport height (310/393 ≈ 0.79). Standalone (no chrome)
  // and desktop already report the true full height, so they are excluded and stay
  // byte-for-byte as tuned (fit = 1). The rotated fake-landscape path is a
  // different measurement regime (see isRotated / global.css) and is left as-is.
  if (typeof window !== 'undefined' && typeof screen !== 'undefined' && !rotated) {
    const coarse = !!window.matchMedia?.('(pointer: coarse)').matches
    const standalone =
      !!window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    if (coarse && !standalone) {
      rawW = Math.max(rawW, Math.max(screen.width, screen.height))
      rawH = Math.max(rawH, Math.min(screen.width, screen.height))
    }
  }

  const vw = rotated ? rawH : rawW // rotated 90° → swap so the board fills the real space
  const vh = rotated ? rawW : rawH

  // Effective width the board is laid out against (bounded on desktop only).
  const ew = Math.min(vw, WCAP)
  const desktop = vw > WCAP

  const avatar = Math.round(clamp(50, vh * 0.17, 108))
  // left clears the avatar (incl. its margin) + a little; right must also clear
  // the wider submit button.
  // The avatar is centred inside the fixed ~110px name field, so it sits a little
  // inward of the field's pinned edge; +36 clears that (plus the active-turn halo)
  // so the avatar never overlaps the hand.
  const reserve = Math.round(clamp(88, avatar + 40, 158))
  const rightReserve = Math.round(Math.max(reserve, clamp(110, ew * 0.145, 156)))
  const handMax = Math.round(ew - reserve - rightReserve - 6)

  // Card size: capped at 54 on phones (avoids over-tall stacks); desktop may go
  // a touch larger (66) so the centred table doesn't look tiny. The cap only
  // rises above WCAP, so phones are unaffected. Also limited by height and by
  // "10 cards fit the hand without overlap".
  const hCard = (handMax - 6 * 9) / 10
  const cardCap = desktop ? 66 : 54
  const card = Math.round(clamp(36, Math.min(vh * 0.15, ew * 0.078, hCard), cardCap))

  return {
    card,
    coin: Math.round(clamp(28, Math.min(vh * 0.1, card * 0.86), 58)),
    avatar,
    reserve,
    rightReserve,
    handMax,
    // narrow the 7-slot band (piles stack now, so frames can be closer)
    bandWidth: Math.round(0.85 * (ew - 2 * reserve)),
    stageW: ew,
    stageH: Math.min(vh, HCAP),
  }
}

/** Fluid, full-bleed board element sizes derived from the viewport. */
export default function useBoardSizes(): BoardSizes {
  const [sizes, setSizes] = useState<BoardSizes>(calc)
  useEffect(() => {
    const update = () => setSizes(calc())
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return sizes
}
