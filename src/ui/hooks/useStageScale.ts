import { useEffect, useState } from 'react'

/** Scale factor to fit a fixed design-size stage into the viewport (with margin). */
export default function useStageScale(designW: number, designH: number, margin = 0.96): number {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const update = () => {
      const s = Math.min(window.innerWidth / designW, window.innerHeight / designH) * margin
      setScale(s)
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [designW, designH, margin])
  return scale
}
