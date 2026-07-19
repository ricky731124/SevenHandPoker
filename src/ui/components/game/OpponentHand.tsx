import { motion } from 'framer-motion'
import CardBack from '../CardBack'

/**
 * Opponent hand shown as backs. Same size and spacing as your hand.
 * `selectedIdx` marks the cards they've pulled — pushed DOWN (mirror of yours)
 * and held until you place them. Cards deal in from the deck.
 */
export default function OpponentHand({
  count,
  selectedIdx = [],
  cardW = 46,
  maxWidth = 640,
}: {
  count: number
  selectedIdx?: number[]
  cardW?: number
  maxWidth?: number
}) {
  // same spacing rule as your hand
  const ideal = cardW + 6
  const fit = count > 1 ? (maxWidth - cardW) / (count - 1) : ideal
  const overlap = Math.max(cardW * 0.34, Math.min(ideal, fit))
  const sel = new Set(selectedIdx)
  const lift = Math.round(cardW * 0.42)
  return (
    <div className="ohand" style={{ width: overlap * (count - 1) + cardW, height: cardW * 1.4 + lift }}>
      {Array.from({ length: count }).map((_, i) => (
        <motion.div
          key={i}
          className="ohand__slot"
          style={{ left: i * overlap, zIndex: sel.has(i) ? 200 + i : i }}
          initial={{ x: -260, y: -30, opacity: 0, rotate: -12 }}
          animate={{ x: 0, y: sel.has(i) ? lift : 0, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 340, damping: 26 }}
        >
          <CardBack w={cardW} />
        </motion.div>
      ))}
    </div>
  )
}
