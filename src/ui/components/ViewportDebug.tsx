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

  const rows = [
    `inner ${window.innerWidth}x${window.innerHeight}`,
    `client ${de.clientWidth}x${de.clientHeight}`,
    `visual ${Math.round(vv?.width || 0)}x${Math.round(vv?.height || 0)}`,
    `screen ${screen.width}x${screen.height}  avail ${screen.availWidth}x${screen.availHeight}`,
    `dpr ${window.devicePixelRatio}  --vvh ${vvh || '(unset)'}  standalone ${standalone ? 1 : 0}`,
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
