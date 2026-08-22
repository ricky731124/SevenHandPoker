import { useEffect } from 'react'
import { motion } from 'framer-motion'
import type { Seat } from '../../hooks/useSeats'
import PlayerAvatar from '../PlayerAvatar'
import { sfx } from '../../../audio/sfx'
import './VsIntro.css'

/**
 * Pre-match splash: comic-book "BATTLE" (US comic font, layered) over a deep
 * red/blue textured field; the two players charge in and collide, with a white
 * explosion between them + an impact sound. Auto-advances after 4s (or tap).
 */
export default function VsIntro({ p1, p2, onDone }: { p1: Seat; p2: Seat; onDone: () => void }) {
  useEffect(() => {
    // 進場「BATTLE」撞擊:riser-hit(build→impact 約 0.6s),對上碰撞動畫(約 0.5s)。
    sfx.battle()
    const done = setTimeout(onDone, 4000)
    return () => clearTimeout(done)
  }, [onDone])

  const charge = (fromLeft: boolean) => ({
    initial: { x: fromLeft ? -340 : 340, opacity: 0, rotate: fromLeft ? -12 : 12 },
    animate: { x: 0, opacity: 1, rotate: 0 },
    transition: { type: 'spring' as const, stiffness: 260, damping: 15, mass: 1.1 },
  })

  return (
    <div className="vs" onClick={onDone}>
      <div className="vs__rays" />
      <div className="vs__halftone" />

      <motion.div
        className="vs__titlewrap"
        initial={{ scale: 0.4, opacity: 0, rotate: -12 }}
        animate={{ scale: 1, opacity: 1, rotate: -5 }}
        transition={{ type: 'spring', stiffness: 240, damping: 12 }}
      >
        <div className="vs__title" data-text="BATTLE">
          BATTLE
        </div>
      </motion.div>

      <div className="vs__row">
        <motion.div className="vs__side" {...charge(true)}>
          <PlayerAvatar avatarId={p1.avatarId} size={130} />
          <div className="vs__name">{p1.name}</div>
        </motion.div>

        {/* explosion at the collision point — anchor centers it, inner motion
            only scales/rotates (framer's transform would otherwise clobber the
            centering translate). */}
        <div className="vs__clash-anchor">
          <motion.div
            className="vs__clash"
            initial={{ scale: 0, opacity: 0, rotate: -30 }}
            animate={{ scale: [0, 1.25, 1], opacity: 1, rotate: 0 }}
            transition={{ delay: 0.5, duration: 0.45, times: [0, 0.6, 1], ease: 'easeOut' }}
          />
        </div>

        <motion.div className="vs__side" {...charge(false)}>
          <PlayerAvatar avatarId={p2.avatarId} size={130} />
          <div className="vs__name">{p2.name}</div>
        </motion.div>
      </div>

      <div className="vs__hint">點一下繼續</div>
    </div>
  )
}
