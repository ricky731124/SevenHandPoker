import { useState } from 'react'
import type { PlayerId } from '../../game/state'

/** Fixed character art: p1 (host) = cat, p2 (guest) = bird.
 *  Falls back to an emoji if the PNG isn't present yet. */
const KIND: Record<PlayerId, { img: string; emoji: string; label: string }> = {
  p1: { img: 'cat.png', emoji: '🐱', label: '貓' },
  p2: { img: 'bird.png', emoji: '🐦', label: '鳥' },
}

export function characterSrc(player: PlayerId): string {
  return `${import.meta.env.BASE_URL}${KIND[player].img}`
}

export default function PlayerAvatar({
  player,
  size = 54,
  bare = false,
}: {
  player: PlayerId
  size?: number
  /** no gold ring / background — for use inside the coin faces */
  bare?: boolean
}) {
  const [ok, setOk] = useState(true)
  const k = KIND[player]
  return (
    <div className={`pavatar${bare ? ' pavatar--bare' : ''}`} style={{ width: size, height: size }}>
      {ok ? (
        <img
          src={characterSrc(player)}
          alt={k.label}
          width={size}
          height={size}
          onError={() => setOk(false)}
          style={{
            width: size,
            height: size,
            objectFit: 'contain',
            // The art has transparent padding; zoom a touch so the face fills the frame.
            transform: bare ? 'scale(1.05)' : 'scale(1.28)',
          }}
        />
      ) : (
        <div className="pavatar__fallback" style={{ fontSize: size * 0.52 }}>
          {k.emoji}
        </div>
      )}
    </div>
  )
}
