import { motion } from 'framer-motion'
import type { Slot, PlayerId, Showdown } from '../../../game/state'
import type { Card as TCard } from '../../../game/cards'
import { SUIT_SYMBOL, SUIT_IS_RED, rankLabel } from '../../../game/cards'
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
  const myWild = me === 'p1' ? showdown.p1WildAs : showdown.p2WildAs
  const foeWild = foe === 'p1' ? showdown.p1WildAs : showdown.p2WildAs
  const tie = showdown.winner === 'both'
  const iWon = tie || showdown.winner === me
  const outcome = tie ? '平手' : showdown.winner === me ? '你獲勝！' : '對手獲勝！'

  return (
    <Modal open={open} onClose={onClose} locked title={`第 ${showdown.slot + 1} 格・對決 - ${outcome}`} width={520} panelClass="modal__panel--showdown">
      <Row label="對手" name={foeName} cards={slot[foe]} won={tie || showdown.winner === foe} wildAs={foeWild} />
      <div className="showdown__vs accent">{tie ? '平手・雙方各得' : 'VS'}</div>
      <Row label="你" name={myName} cards={slot[me]} won={iWon} wildAs={myWild} />
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
        <Button onClick={onClose}>繼續</Button>
      </div>
    </Modal>
  )
}

function Row({ label, name, cards, won, wildAs }: { label: string; name: string; cards: TCard[]; won: boolean; wildAs?: TCard }) {
  // A card whose suit was changed by a suit-bloom special (at most one per match).
  const resuited = cards.find((c) => c.resuitFrom)
  return (
    <div className={`showdown__row${won ? ' showdown__row--win' : ''}`}>
      <div className="showdown__meta">
        <span className="showdown__label">{label}</span>
        <span className="showdown__hand accent">{name}</span>
        {wildAs && (
          <span className="showdown__wild">
            鬼牌→
            <span style={{ color: SUIT_IS_RED[wildAs.suit] ? '#d21a3b' : '#1b1b1f', fontWeight: 800 }}>
              {SUIT_SYMBOL[wildAs.suit]}
              {rankLabel(wildAs.rank)}
            </span>
          </span>
        )}
        {resuited && (
          <span className="showdown__wild">
            <span style={{ color: SUIT_IS_RED[resuited.resuitFrom!] ? '#d21a3b' : '#1b1b1f', fontWeight: 800 }}>
              {SUIT_SYMBOL[resuited.resuitFrom!]}
              {rankLabel(resuited.rank)}
            </span>
            →
            <span style={{ color: SUIT_IS_RED[resuited.suit] ? '#d21a3b' : '#1b1b1f', fontWeight: 800 }}>
              {SUIT_SYMBOL[resuited.suit]}
              {rankLabel(resuited.rank)}
            </span>
          </span>
        )}
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
