import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { PlayerId } from '../../../game/state'
import type { Seat } from '../../hooks/useSeats'
import PlayerAvatar from '../PlayerAvatar'
import { sfx } from '../../../audio/sfx'

/** Opening ceremony: a two-faced coin (p1 on front, p2 on back) flips and lands
 *  on the first picker. Faces show each seat's resolved avatar. */
export default function CoinToss({
  firstPicker,
  me,
  p1,
  p2,
  onDone,
}: {
  firstPicker: PlayerId
  me: PlayerId
  p1: Seat
  p2: Seat
  onDone: () => void
}) {
  const [phase, setPhase] = useState<'spin' | 'result'>('spin')

  useEffect(() => {
    sfx.coin() // 檔案本身已含「擲 + 落」,播一次即可(落聲約在 2.2~2.5s,對上落定動畫)
    const t1 = setTimeout(() => {
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
  const pickerName = firstPicker === 'p1' ? p1.name : p2.name
  const label = firstPicker === me ? '你先攻！' : `${pickerName} 先攻`

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
          <PlayerAvatar avatarId={p1.avatarId} size={104} bare />
        </div>
        <div className="cointoss__face cointoss__face--back">
          <PlayerAvatar avatarId={p2.avatarId} size={104} bare />
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
