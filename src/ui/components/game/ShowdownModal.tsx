import { motion } from 'framer-motion'
import type { Slot, PlayerId, Showdown } from '../../../game/state'
import type { Card as TCard } from '../../../game/cards'
import Modal from '../Modal'
import Button from '../Button'
import Card from '../Card'

/**
 * Small gold coin, matching the in-game board Coin exactly (a bright gold rim,
 * then the darker inner ring). Earlier this drew the dark ring on the OUTSIDE,
 * which read as a red/brown circle on the green row — the board coin never has
 * that, so we mirror the board coin's ring stack here.
 */
function CoinIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: 'block' }}>
      <defs>
        <radialGradient id="sc-face" cx="38%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#fff7cf" />
          <stop offset="42%" stopColor="#ffdc6e" />
          <stop offset="78%" stopColor="#eeab24" />
          <stop offset="100%" stopColor="#cf9018" />
        </radialGradient>
        <linearGradient id="sc-ring" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe27a" />
          <stop offset="100%" stopColor="#a06c12" />
        </linearGradient>
      </defs>
      {/* outer rim (two rings) — bright gold outside, dark inside, like the board coin */}
      <circle cx="24" cy="24" r="22.5" fill="url(#sc-ring)" />
      <circle cx="24" cy="24" r="19" fill="#b9810f" />
      <circle cx="24" cy="24" r="16.5" fill="url(#sc-face)" />
      <text x="24" y="32" textAnchor="middle" fontSize="22" fontWeight="900" fill="#a5710f" stroke="#fff2c0" strokeWidth="0.8" fontFamily="var(--font-display)">
        $
      </text>
      <ellipse cx="18" cy="15" rx="7.5" ry="4" fill="rgba(255,255,255,0.6)" transform="rotate(-28 18 15)" />
    </svg>
  )
}

export default function ShowdownModal({
  open,
  showdown,
  slot,
  me,
  onClose,
}: {
  open: boolean
  showdown: Showdown | null
  slot: Slot | null
  me: PlayerId
  onClose: () => void
}) {
  if (!showdown || !slot) return <Modal open={false} onClose={onClose} children={null} />
  const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'
  const myName = me === 'p1' ? showdown.p1Name : showdown.p2Name
  const foeName = foe === 'p1' ? showdown.p1Name : showdown.p2Name
  const iWon = showdown.winner === me

  return (
    <Modal open={open} onClose={onClose} locked title={`第 ${showdown.slot + 1} 格・對決！`} width={520} panelClass="modal__panel--showdown">
      <Row label="對手" name={foeName} cards={slot[foe]} won={!iWon} />
      <div className="showdown__vs accent">VS</div>
      <Row label="你" name={myName} cards={slot[me]} won={iWon} />
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
        <Button onClick={onClose}>繼續</Button>
      </div>
    </Modal>
  )
}

function Row({ label, name, cards, won }: { label: string; name: string; cards: TCard[]; won: boolean }) {
  return (
    <div className={`showdown__row${won ? ' showdown__row--win' : ''}`}>
      <div className="showdown__meta">
        <span className="showdown__label">{label}</span>
        <span className="showdown__hand accent">{name}</span>
      </div>
      <div className="showdown__cards">
        {cards.map((c) => (
          <Card key={c.id} card={c} w={52} />
        ))}
      </div>
      {won && (
        <motion.div
          className="showdown__won"
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15 }}
        >
          <span>獲得</span>
          <CoinIcon />
        </motion.div>
      )}
    </div>
  )
}
