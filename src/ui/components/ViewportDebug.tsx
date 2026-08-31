import { useEffect, useState } from 'react'

/**
 * TEMPORARY diagnostic overlay — shows the raw viewport numbers so we can see
 * what THIS device actually reports (iOS Safari's full-vs-visible values are
 * unreliable, which is why board scaling wasn't kicking in). Remove once the
 * scale math is fixed. Rendered top-left in App.tsx.
 */
export default function ViewportDebug() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const on = () => setTick((t) => t + 1)
    const vv = window.visualViewport
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    vv?.addEventListener('resize', on)
    vv?.addEventListener('scroll', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
      vv?.removeEventListener('resize', on)
      vv?.removeEventListener('scroll', on)
    }
  }, [])

  const de = document.documentElement
  const vv = window.visualViewport
  const vvh = getComputedStyle(de).getPropertyValue('--vvh').trim()
  const standalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as unknown as { standalone?: boolean }).standalone === true

  // Mirror the board-fit math (useBoardSizes + useFitScale) so we can confirm the
  // fix on-device: browser tab should now read <1, standalone/desktop == 1.00.
  const coarse = !!window.matchMedia?.('(pointer: coarse)').matches
  const useScreen = coarse && !standalone
  const fullW = Math.max(window.innerWidth, de.clientWidth, useScreen ? Math.max(screen.width, screen.height) : 0)
  const fullH = Math.max(window.innerHeight, de.clientHeight, useScreen ? Math.min(screen.width, screen.height) : 0)
  const stageW = Math.min(fullW, 1000)
  const stageH = Math.min(fullH, 580)
  const availW = vv?.width || window.innerWidth
  const availH = vv?.height || window.innerHeight
  const fit = Math.min(1, availW / stageW, availH / stageH)

  const rows = [
    `inner ${window.innerWidth}x${window.innerHeight}`,
    `client ${de.clientWidth}x${de.clientHeight}`,
    `visual ${Math.round(vv?.width || 0)}x${Math.round(vv?.height || 0)}`,
    `screen ${screen.width}x${screen.height}  avail ${screen.availWidth}x${screen.availHeight}`,
    `dpr ${window.devicePixelRatio}  --vvh ${vvh || '(unset)'}  standalone ${standalone ? 1 : 0}`,
    `full ${Math.round(fullH)}  stageH ${Math.round(stageH)}  FIT ${fit.toFixed(3)}`,
  ]

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.82)',
        color: '#39ff14',
        font: '11px/1.35 ui-monospace, Menlo, monospace',
        padding: '3px 7px',
        borderBottomRightRadius: 8,
        pointerEvents: 'none',
        maxWidth: '100vw',
        whiteSpace: 'pre',
      }}
    >
      {rows.map((r, i) => (
        <div key={i}>{r}</div>
      ))}
    </div>
  )
}
