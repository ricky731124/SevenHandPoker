import { motion } from 'framer-motion'
import type { PlayerId } from '../../../game/state'

/**
 * Shiny gold coin: a thick two-ring rim, a $ face, gloss and glow.
 * Topples toward the winner and sits ABOVE the cards so the win is clear.
 */
export default function Coin({ owner, me, size = 44 }: { owner: PlayerId | null; me: PlayerId; size?: number }) {
  const towardMe = owner === me
  const y = owner ? (towardMe ? 48 : -48) : 0
  const rot = owner ? (towardMe ? 26 : -26) : 0
  const uid = `c${size}`

  return (
    <motion.div
      animate={{ y, rotateX: rot, scale: owner ? 1.08 : 1 }}
      transition={{ type: 'spring', stiffness: 210, damping: 15 }}
      style={{ width: size, height: size, position: 'relative', zIndex: 30 }}
    >
      <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <radialGradient id={`face-${uid}`} cx="38%" cy="32%" r="72%">
            <stop offset="0%" stopColor="#fff7cf" />
            <stop offset="42%" stopColor="#ffdc6e" />
            <stop offset="78%" stopColor="#eeab24" />
            <stop offset="100%" stopColor="#cf9018" />
          </radialGradient>
          <linearGradient id={`ring-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe27a" />
            <stop offset="100%" stopColor="#a06c12" />
          </linearGradient>
          <filter id={`glow-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {owner && <circle cx="24" cy="24" r="23" fill="rgba(255,214,96,0.55)" filter={`url(#glow-${uid})`} />}

        {/* outer rim (two rings) */}
        <circle cx="24" cy="24" r="22.5" fill={`url(#ring-${uid})`} />
        <circle cx="24" cy="24" r="19" fill="#b9810f" />
        {/* face */}
        <circle cx="24" cy="24" r="16.5" fill={`url(#face-${uid})`} />
        {/* $ */}
        <text
          x="24"
          y="32"
          textAnchor="middle"
          fontSize="22"
          fontWeight="900"
          fill="#a5710f"
          fontFamily="var(--font-display)"
          style={{ paintOrder: 'stroke' }}
          stroke="#fff2c0"
          strokeWidth="0.8"
        >
          $
        </text>
        {/* gloss */}
        <ellipse cx="18" cy="15" rx="7.5" ry="4" fill="rgba(255,255,255,0.6)" transform="rotate(-28 18 15)" />
        {/* idle sparkle (top-right) — always shining */}
        <path d="M37 11l1.2 2.9 2.9 1.2-2.9 1.2-1.2 2.9-1.2-2.9-2.9-1.2 2.9-1.2z" fill="#fffbe6" />
        {/* second sparkle (bottom-left) when won */}
        {owner && <path d="M11 34l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" fill="#fffbe6" />}
      </svg>
    </motion.div>
  )
}
