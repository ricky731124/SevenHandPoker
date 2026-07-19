import type { Card as TCard, Suit } from '../../game/cards'
import { SUIT_IS_RED, rankLabel } from '../../game/cards'

const BLACK = '#1b1b1f'
const RED = '#d21a3b'

/** Crisp custom suit shape, centered at (cx,cy) scaled from a 24-unit base. */
function SuitShape({ suit, cx, cy, s, color }: { suit: Suit; cx: number; cy: number; s: number; color: string }) {
  const t = `translate(${cx - 12 * s} ${cy - 12 * s}) scale(${s})`
  switch (suit) {
    case 'H':
      return (
        <path
          transform={t}
          fill={color}
          d="M12 21C12 21 2.8 14.4 2.8 8.4 2.8 5.2 5.2 3.2 8 3.2 10.1 3.2 11.5 4.7 12 5.9 12.5 4.7 13.9 3.2 16 3.2 18.8 3.2 21.2 5.2 21.2 8.4 21.2 14.4 12 21 12 21Z"
        />
      )
    case 'D':
      return <path transform={t} fill={color} d="M12 2.4C15 6.6 17.4 9.4 20.4 12 17.4 14.6 15 17.4 12 21.6 9 17.4 6.6 14.6 3.6 12 6.6 9.4 9 6.6 12 2.4Z" />
    case 'S':
      return (
        <path
          transform={t}
          fill={color}
          d="M12 2.4S3 9.2 3 14.6c0 3 2.3 4.3 4.1 3.4 1.1-.5 1.9-1.5 2.2-2.5.2 2-.4 4-1.7 5.5h8.8c-1.3-1.5-1.9-3.5-1.7-5.5.3 1 1.1 2 2.2 2.5 1.8.9 4.1-.4 4.1-3.4 0-5.4-9-12.2-9-12.2Z"
        />
      )
    case 'C':
      return (
        <g transform={t} fill={color}>
          <circle cx="12" cy="8.2" r="4.3" />
          <circle cx="8" cy="13.4" r="4.3" />
          <circle cx="16" cy="13.4" r="4.3" />
          <circle cx="12" cy="12.4" r="3.6" />
          <path d="M11 13.5h2l1 7.7h-4z" />
        </g>
      )
  }
}

/** A face-up playing card: large rank + one large suit, single orientation. */
export default function Card({ card, w = 58 }: { card: TCard; w?: number }) {
  const h = Math.round(w * 1.4)
  const red = SUIT_IS_RED[card.suit]
  const color = red ? RED : BLACK
  const label = rankLabel(card.rank)
  const rankFont = label === '10' ? 22 : 26

  return (
    <svg width={w} height={h} viewBox="0 0 60 84" style={{ display: 'block' }}>
      <rect x="1.5" y="1.5" width="57" height="81" rx="8" fill="#fcfcf7" stroke="rgba(0,0,0,0.28)" strokeWidth="1.2" />
      {/* corner rank */}
      <text
        x="8"
        y="26"
        fontSize={rankFont}
        fontWeight="900"
        fill={color}
        fontFamily="var(--font-display)"
        style={{ letterSpacing: '-1px' }}
      >
        {label}
      </text>
      {/* dominant center suit */}
      <SuitShape suit={card.suit} cx={35} cy={55} s={2.05} color={color} />
    </svg>
  )
}
