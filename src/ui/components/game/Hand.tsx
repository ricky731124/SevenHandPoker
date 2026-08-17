import { motion } from 'framer-motion'
import type { Card as TCard } from '../../../game/cards'
import { sortHand, type SortDir, type SortMode } from '../../../game/sort'
import Card from '../Card'

interface Props {
  cards: TCard[]
  selected: string[]
  sortMode: SortMode
  sortDir: SortDir
  interactive: boolean
  onToggle: (id: string) => void
  cardW?: number
  maxWidth?: number
  /**
   * Special-card targeting mode (Phase C). When set, only cards whose id is in
   * the set are clickable (valid targets, highlighted); the rest are dimmed and
   * inert. `null`/absent ⇒ normal pick mode.
   */
  targetableIds?: Set<string> | null
}

/**
 * The player's hand.
 *  - Outer motion: one-time deal-in from the deck (staggered). Its target
 *    never changes after mount, so selecting a card never disturbs others.
 *  - Inner motion: the selection lift only — snappy and per-card, so lifting
 *    one card never jitters the rest. No hover (mobile-first).
 */
export default function Hand({ cards, selected, sortMode, sortDir, interactive, onToggle, cardW = 58, maxWidth = 640, targetableIds = null }: Props) {
  const ordered = sortHand(cards, sortMode, sortDir)
  const n = ordered.length
  // Spread with a small gap (no overlap) while it fits; only overlap when the
  // hand would exceed the available width.
  const ideal = cardW + 6
  const fit = n > 1 ? (maxWidth - cardW) / (n - 1) : ideal
  const overlap = Math.max(cardW * 0.34, Math.min(ideal, fit))
  const lift = Math.round(cardW * 0.42)

  return (
    <div className="hand" style={{ width: overlap * (n - 1) + cardW, height: cardW * 1.4 + lift }}>
      {ordered.map((c, i) => {
        const isSel = selected.includes(c.id)
        const isTarget = !!targetableIds && targetableIds.has(c.id)
        const dimmed = !!targetableIds && !isTarget
        const clickable = interactive && (!targetableIds || isTarget)
        return (
          <motion.div
            key={c.id}
            className="hand__slot"
            style={{ left: i * overlap, zIndex: i }}
            initial={{ x: -320 - i * overlap * 0.25, y: -210, rotate: -22, opacity: 0, scale: 0.82 }}
            animate={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30, delay: Math.min(i * 0.045, 0.5) }}
          >
            <motion.div
              className={`hand__card${isSel ? ' hand__card--sel' : ''}${isTarget ? ' hand__card--target' : ''}${dimmed ? ' hand__card--dim' : ''}`}
              animate={{ y: isSel ? -lift : isTarget ? -Math.round(lift * 0.5) : 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 32 }}
              onClick={() => clickable && onToggle(c.id)}
            >
              <Card card={c} w={cardW} />
            </motion.div>
          </motion.div>
        )
      })}
    </div>
  )
}
