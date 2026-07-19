import { useAppStore } from '../../state/appStore'

/** Card back: the cat mascot on a blue or green backing. Theme-swappable.
 *  Pass `theme` to override the current setting (used for previews). */
export default function CardBack({ w = 58, theme }: { w?: number; theme?: string }) {
  const current = useAppStore((s) => s.settings.cardBack)
  const t = theme ?? current
  const h = Math.round(w * 1.4)
  const [c1, c2, edge] =
    t === 'green' ? ['#2aa25a', '#0f5f32', '#0b5e2f'] : ['#3568d6', '#123a86', '#0d2a63']
  const catSrc = `${import.meta.env.BASE_URL}cat.png`

  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 8,
        position: 'relative',
        overflow: 'hidden',
        border: '2px solid #fbfbf6',
        background: `radial-gradient(circle at 50% 38%, ${c1}, ${c2})`,
        boxShadow: `inset 0 0 0 2px ${edge}`,
      }}
    >
      {/* subtle dotted texture */}
      <div
        style={{
          position: 'absolute',
          inset: 4,
          borderRadius: 5,
          border: '1px solid rgba(255,255,255,0.45)',
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)',
          backgroundSize: '7px 7px',
        }}
      />
      <img
        src={catSrc}
        alt=""
        style={{
          position: 'absolute',
          left: '50%',
          top: '52%',
          width: w * 0.72,
          transform: 'translate(-50%, -50%)',
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
