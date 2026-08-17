import type { MatchResult } from '../../../game/campaign'

/**
 * The BO progress track: `bestOf` pips in play order — a win is a green ✓, a
 * loss a red ✗, a not-yet-played match an empty circle. Shared by the map node,
 * the pre-match / resume dialog, the between-match result screen, and the board.
 */
export default function SeriesTrack({
  bestOf,
  results,
  size = 22,
}: {
  bestOf: number
  results: MatchResult[]
  size?: number
}) {
  return (
    <div style={{ display: 'inline-flex', gap: Math.max(3, size * 0.28) }}>
      {Array.from({ length: bestOf }).map((_, i) => {
        const r = results[i]
        const bg = r === 'win' ? '#4b9e4b' : r === 'lose' ? '#c0392b' : 'rgba(255,255,255,0.15)'
        const border = r === 'win' ? '#2f7a2f' : r === 'lose' ? '#8a2018' : 'rgba(255,255,255,0.55)'
        return (
          <span
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              background: bg,
              border: `2px solid ${border}`,
              color: '#fff',
              fontSize: size * 0.62,
              fontWeight: 900,
              lineHeight: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
            }}
          >
            {r === 'win' ? '✓' : r === 'lose' ? '✗' : ''}
          </span>
        )
      })}
    </div>
  )
}
