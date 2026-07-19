import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { PlayerId } from '../../../game/state'
import PlayerAvatar from '../PlayerAvatar'
import { sfx } from '../../../audio/sfx'

/** Opening ceremony: a two-faced coin (cat on front, bird on back) flips and
 *  lands on the first picker. */
export default function CoinToss({
  firstPicker,
  me,
  onDone,
}: {
  firstPicker: PlayerId
  me: PlayerId
  onDone: () => void
}) {
  const [phase, setPhase] = useState<'spin' | 'result'>('spin')

  useEffect(() => {
    sfx.coin()
    const t1 = setTimeout(() => {
      sfx.coin()
      setPhase('result')
    }, 2200)
    const t2 = setTimeout(onDone, 3800)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [onDone])

  // Land showing the first picker's face (p1 on front / p2 on back).
  const finalFlip = firstPicker === 'p1' ? 1800 : 1980
  const label = firstPicker === me ? '你先攻！' : '對手先攻'

  return (
    <div className="cointoss">
      <div className="cointoss__title gold-text">擲硬幣決定先攻</div>
      <motion.div
        className="cointoss__coin"
        initial={{ rotateY: 0 }}
        animate={{ rotateY: phase === 'spin' ? finalFlip : finalFlip, y: phase === 'spin' ? [-10, -120, 0] : 0 }}
        transition={{ rotateY: { duration: 2.2, ease: 'easeOut' }, y: { duration: 2.2, ease: 'easeOut' } }}
        style={{ transformStyle: 'preserve-3d' }}
      >
        <div className="cointoss__face cointoss__face--front">
          <PlayerAvatar player="p1" size={104} bare />
        </div>
        <div className="cointoss__face cointoss__face--back">
          <PlayerAvatar player="p2" size={104} bare />
        </div>
      </motion.div>
      {phase === 'result' && (
        <motion.div
          className="cointoss__result gold-text"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
        >
          {label}
        </motion.div>
      )}
    </div>
  )
}
