import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAchievementStore } from '../../state/achievementStore'
import { getAchievement, TIER_NAME_ZH, type AchTier } from '../../game/achievements'
import { getSpecialCard } from '../../game/specialCards'
import Badge from './Badge'
import PlayerAvatar from './PlayerAvatar'
import { SpecialCardArt } from './SpecialCard'
import { sfx } from '../../audio/sfx'

/**
 * Shared achievement-unlock announcer (使用者:那個小 Toast 太不起眼,成就要顯眼、
 * 可連跳). Shows queued unlocks one at a time, sliding in from the top. Mounted
 * once in App. Stage-clear unlocks can reuse this queue later.
 */
export default function AchievementToast() {
  const queue = useAchievementStore((s) => s.queue)
  const shift = useAchievementStore((s) => s.shift)
  const front = queue[0]

  useEffect(() => {
    if (!front) return
    sfx.win()
    // Rewards are quick pops; achievement unlocks linger a little longer.
    const t = setTimeout(shift, front.kind === 'reward' ? 2600 : 5200)
    return () => clearTimeout(t)
  }, [front, shift])

  // A one-off reward (e.g. PvP-win diamonds).
  if (front?.kind === 'reward') {
    return (
      <AnimatePresence>
        <motion.div
          key={`reward-${front.title}-${front.sub ?? ''}`}
          initial={{ x: '-50%', y: -70, opacity: 0 }}
          animate={{ x: '-50%', y: 0, opacity: 1 }}
          exit={{ x: '-50%', y: -70, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          style={{
            position: 'fixed',
            top: 'clamp(12px, 3vh, 28px)',
            left: '50%',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 24px',
            borderRadius: 16,
            background: 'var(--parch-100, #fbf1d9)',
            border: '3px solid var(--gold-3, #d79a24)',
            boxShadow: '0 8px 22px rgba(0,0,0,.4)',
            maxWidth: '94vw',
          }}
        >
          <RewardArtView notice={front} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--wood-800, #4a3418)', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap' }}>
              {front.title}
            </div>
            {front.sub && <div style={{ fontSize: 14, color: 'var(--wood-700, #6a4e2c)', fontFamily: 'var(--font-display)' }}>{front.sub}</div>}
          </div>
        </motion.div>
      </AnimatePresence>
    )
  }

  const fam = front ? getAchievement(front.id) : undefined
  return (
    <AnimatePresence>
      {front && fam && (
        <motion.div
          key={`${front.id}-${front.tier}`}
          // x:'-50%' lives in the motion transform (framer owns `transform`, so a
          // plain CSS translateX would be clobbered → the toast lands off-centre).
          initial={{ x: '-50%', y: -70, opacity: 0 }}
          animate={{ x: '-50%', y: 0, opacity: 1 }}
          exit={{ x: '-50%', y: -70, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          style={{
            position: 'fixed',
            top: 'clamp(12px, 3vh, 28px)',
            left: '50%',
            zIndex: 2000, // above modals (scrim = 1000) — the popup auto-dismisses
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '16px 28px 16px 18px',
            borderRadius: 18,
            background: 'var(--parch-100, #fbf1d9)',
            border: '3px solid var(--wood-700, #7d5a34)',
            boxShadow: '0 8px 22px rgba(0,0,0,.4)',
            maxWidth: '94vw',
          }}
        >
          <Badge icon={fam.icon} tier={front.tier as AchTier} size={68} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontSize: 15, color: 'var(--wood-600, #8a6a3e)', fontFamily: 'var(--font-display)' }}>
              解鎖成就 · {TIER_NAME_ZH[front.tier]}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--wood-800, #4a3418)', fontFamily: 'var(--font-display)' }}>
              {fam.name}
            </div>
            <div style={{ fontSize: 15, color: 'var(--wood-700, #6a4e2c)' }}>{fam.desc(fam.thresholds[front.tier - 1])}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The left-hand art of a reward toast: the real unlocked avatar / special-card
 *  illustration (scaled down), falling back to the emoji icon (e.g. 💎). */
function RewardArtView({ notice }: { notice: { icon?: string; art?: { kind: 'card' | 'avatar'; id: string } } }) {
  if (notice.art?.kind === 'avatar') {
    return <PlayerAvatar avatarId={notice.art.id} size={40} />
  }
  if (notice.art?.kind === 'card') {
    const def = getSpecialCard(notice.art.id)
    return (
      <span style={{ display: 'block', flex: '0 0 auto', width: 34, height: 40 }}>
        <SpecialCardArt id={notice.art.id} color={def?.accent ?? '#c9803f'} uid={`toast-${notice.art.id}`} />
      </span>
    )
  }
  return <span style={{ fontSize: 30, lineHeight: 1 }}>{notice.icon}</span>
}
