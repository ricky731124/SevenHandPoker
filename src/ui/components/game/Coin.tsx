import { motion } from 'framer-motion'
import type { PlayerId, SlotOwner } from '../../../game/state'

/** The coin's SVG face (bright gold rim, $ face, gloss, glow when won). */
function CoinFace({ won, uid }: { won: boolean; uid: string }) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 48 48" style={{ display: 'block', overflow: 'visible' }}>
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

      {won && <circle cx="24" cy="24" r="23" fill="rgba(255,214,96,0.55)" filter={`url(#glow-${uid})`} />}

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
      {won && <path d="M11 34l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" fill="#fffbe6" />}
    </svg>
  )
}

const spring = { type: 'spring' as const, stiffness: 210, damping: 15 }

/**
 * Shiny gold coin above the slot. Topples toward the winner. On a tie
 * (`owner === 'both'`) it SPLITS into two coins that topple to both sides at
 * once — each player really does take a coin (SPEC §2.3).
 */
export default function Coin({ owner, me, size = 44 }: { owner: SlotOwner; me: PlayerId; size?: number }) {
  const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'

  // Tie: two coins, one toppling to each side.
  if (owner === 'both') {
    const toward = (who: PlayerId) => (who === me ? 48 : -48)
    const rot = (who: PlayerId) => (who === me ? 26 : -26)
    return (
      <div style={{ position: 'relative', width: size, height: size }}>
        {[me, foe].map((who) => (
          <motion.div
            key={who}
            animate={{ y: toward(who), rotateX: rot(who), scale: 1.08 }}
            transition={spring}
            style={{ position: 'absolute', inset: 0, zIndex: 30 }}
          >
            <CoinFace won uid={`c${size}-${who}`} />
          </motion.div>
        ))}
      </div>
    )
  }

  const won = owner !== null
  const towardMe = owner === me
  const y = towardMe ? 48 : won ? -48 : 0
  const rot = towardMe ? 26 : won ? -26 : 0

  return (
    <motion.div
      animate={{ y, rotateX: rot, scale: won ? 1.08 : 1 }}
      transition={spring}
      style={{ width: size, height: size, position: 'relative', zIndex: 30 }}
    >
      <CoinFace won={won} uid={`c${size}`} />
    </motion.div>
  )
}
