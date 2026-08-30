import { useEffect, useState } from 'react'

/**
 * Uniform scale factor to fit a fixed-size stage (designW × designH, laid out
 * against the STABLE layout viewport — see useBoardSizes) into the ACTUAL
 * visible area (window.visualViewport).
 *
 * - Fullscreen / standalone / desktop: the visible area == the layout viewport,
 *   so this returns 1 → the board renders at its tuned size, byte-for-byte
 *   unchanged (no transform is applied by the caller when scale === 1).
 * - Mobile browser tab: the address/bookmark bar shrinks the visible height, so
 *   this returns <1 and the caller scales the WHOLE board down as one unit —
 *   keeping the tuned proportions instead of letting elements overlap or fall
 *   off-screen.
 *
 * Never upscales past 1 (a tall desktop keeps the board centred with felt margins,
 * exactly as before).
 */
export default function useFitScale(designW: number, designH: number): number {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const compute = () => {
      if (!designW || !designH) return 1
      const availW = vv?.width ?? window.innerWidth
      const availH = vv?.height ?? window.innerHeight
      return Math.min(1, availW / designW, availH / designH)
    }
    const update = () => setScale(compute())
    update()
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [designW, designH])
  return scale
}
