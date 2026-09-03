import { motion } from 'framer-motion'
import type { Card as TCard } from '../../../game/cards'
import type { PlayerId, Slot } from '../../../game/state'
import Card from '../Card'
import CardBack from '../CardBack'
import Coin from './Coin'

interface Props {
  slot: Slot
  index: number
  me: PlayerId
  placeable: boolean
  onPlace: (index: number) => void
  onMagnify: (side: PlayerId, slot: number) => void
  cardW: number
  coinSize: number
  /** tutorial: pulse this slot's revealed pile + lens to say "tap the 🔍 here" */
  highlight?: boolean
  /** tutorial: only THIS side's pile is magnifiable (the other side's 🔍 is hidden
   *  / inert). Keeps the new player from tapping their own pile, which can't advance
   *  the scripted step. Undefined in the real game → both sides magnifiable. */
  magnifyOnly?: PlayerId
  /** tutorial: a short call-to-action rendered inside the glowing drop target
   *  (e.g.「把牌放這格」) on the first placement step. */
  dropHint?: string
}

function Pile({
  cards,
  faceUp,
  openable,
  onOpen,
  cardW,
  stackUp,
}: {
  cards: TCard[]
  faceUp: boolean
  openable: boolean
  onOpen: () => void
  cardW: number
  /** stack the extra cards away from the central coin (top pile up, bottom down) */
  stackUp: boolean
}) {
  const h = Math.round(cardW * 1.4)
  // Fixed footprint (= one card) so the board grid never reflows. Extra cards
  // stack with a small offset AWAY from the coin so they never cover it.
  if (cards.length === 0) return <div className="pile pile--empty" style={{ width: cardW, height: h }} />
  const off = Math.min(3.5, cardW * 0.055)
  return (
    <div
      className={`pile${openable ? ' pile--openable' : ''}`}
      onClick={openable ? onOpen : undefined}
      style={{ width: cardW, height: h }}
    >
      {cards.map((c, i) => (
        <motion.div
          key={c.id}
          className="pile__card"
          style={{ left: i * off * 0.7, top: (stackUp ? -1 : 1) * i * off, zIndex: stackUp ? cards.length - i : i }}
          initial={{ y: -34, opacity: 0, rotate: -8 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          transition={{ delay: i * 0.04, type: 'spring', stiffness: 300, damping: 22 }}
        >
          {faceUp ? <Card card={c} w={cardW} /> : <CardBack w={cardW} />}
        </motion.div>
      ))}
      {cards.length > 1 && <span className={`pile__count${stackUp ? ' pile__count--up' : ''}`}>{cards.length}</span>}
      {openable && <span className="pile__lens">🔍</span>}
    </div>
  )
}

export default function SlotView({ slot, index, me, placeable, onPlace, onMagnify, cardW, coinSize, highlight = false, magnifyOnly, dropHint }: Props) {
  const foe: PlayerId = me === 'p1' ? 'p2' : 'p1'
  const opened = slot.owner !== null
  const topCards = slot[foe]
  const bottomCards = slot[me]
  const foeMagnifiable = opened && topCards.length > 0 && (!magnifyOnly || magnifyOnly === foe)
  const myMagnifiable = bottomCards.length > 0 && (!magnifyOnly || magnifyOnly === me)

  return (
    <div className={`slot${highlight ? ' slot--maglight' : ''}`}>
      {/* Top: opponent side — a single glowing frame drop target when placing */}
      {placeable ? (
        <button
          className={`slot__drop${dropHint ? ' slot__drop--hint' : ''}`}
          onClick={() => onPlace(index)}
          aria-label={`放到對手第 ${index + 1} 格`}
          style={{ width: cardW, height: Math.round(cardW * 1.4) }}
        >
          {dropHint && <span className="slot__drop-hint">{dropHint}</span>}
        </button>
      ) : (
        <Pile cards={topCards} faceUp={opened} openable={foeMagnifiable} onOpen={() => onMagnify(foe, index)} cardW={cardW} stackUp={false} />
      )}

      <div className="slot__coin" style={{ height: coinSize }}>
        <Coin owner={slot.owner} me={me} size={coinSize} />
      </div>

      {/* Bottom: my side — face-down until this slot's showdown; always magnifiable */}
      <Pile cards={bottomCards} faceUp={opened} openable={myMagnifiable} onOpen={() => onMagnify(me, index)} cardW={cardW} stackUp={false} />
    </div>
  )
}
