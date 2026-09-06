import { motion } from 'framer-motion'
import type { Card as TCard } from '../../../game/cards'
import Card from '../Card'
import CardBack from '../CardBack'

/**
 * Opponent hand shown as backs. Same size and spacing as your hand.
 * `selectedIdx` marks the cards they've pulled — pushed DOWN (mirror of yours)
 * and held until you place them. Cards deal in from the deck.
 *
 * `cards` (spectator, §4.3): when given, the SAME row is rendered face-up (real
 * cards) instead of backs — so the觀戰 top seat reuses this exact layout/位置 and
 * only the card faces differ. `count` is ignored when `cards` is present.
 */
export default function OpponentHand({
  count,
  cards,
  selectedIdx = [],
  cardW = 46,
  maxWidth = 640,
}: {
  count: number
  cards?: TCard[]
  selectedIdx?: number[]
  cardW?: number
  maxWidth?: number
}) {
  const n = cards ? cards.length : count
  // same spacing rule as your hand
  const ideal = cardW + 6
  const fit = n > 1 ? (maxWidth - cardW) / (n - 1) : ideal
  const overlap = Math.max(cardW * 0.34, Math.min(ideal, fit))
  const sel = new Set(selectedIdx)
  const lift = Math.round(cardW * 0.42)
  return (
    <div className="ohand" style={{ width: overlap * (n - 1) + cardW, height: cardW * 1.4 + lift }}>
      {Array.from({ length: n }).map((_, i) => (
        <motion.div
          key={cards ? cards[i].id : i}
          className="ohand__slot"
          style={{ left: i * overlap, zIndex: sel.has(i) ? 200 + i : i }}
          initial={{ x: -260, y: -30, opacity: 0, rotate: -12 }}
          animate={{ x: 0, y: sel.has(i) ? lift : 0, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 340, damping: 26 }}
        >
          {cards ? <Card card={cards[i]} w={cardW} /> : <CardBack w={cardW} />}
        </motion.div>
      ))}
    </div>
  )
}
