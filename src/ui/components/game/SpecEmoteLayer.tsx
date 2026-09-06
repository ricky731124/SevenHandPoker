import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../../../state/gameStore'
import { getSticker, stickerSrc } from '../../../game/stickers'

/**
 * 觀戰貼圖層(#6):讀廣播來的 spectateLive.emote(誰 by + id + n),讓觀戰者也吃到雙方玩家的
 * 貼圖效果 —— p1(廣播端,下方)從左下往右上飄、p2(對手,上方)從右上往左下飄,比照 StickerProto。
 */
const FLOAT_MS = 3.1

function StickerView({ id }: { id: string }) {
  const def = getSticker(id)
  if (!def) return null
  if (def.emoji) return <span style={{ fontSize: 'clamp(56px,11vw,84px)', lineHeight: 1 }}>{def.emoji}</span>
  return <img src={stickerSrc(def.id)} alt={def.name} style={{ width: 'clamp(120px,22vw,168px)', height: 'auto', display: 'block' }} />
}

export default function SpecEmoteLayer() {
  const emote = useGameStore((s) => s.spectateLive?.emote ?? null)
  const [shot, setShot] = useState<{ by: string; id: string; n: number } | null>(null)
  const lastN = useRef(0)
  // 進場「第一個」emote 是**進場前**玩家最後送的那張(在 lastExtras 裡持續被廣播)→ 只記 n、不飄;
  // 之後 n 有變(進場後新送的)才飄。否則觀戰者一進來就吃到玩家上一張舊貼圖(使用者回報)。
  const primed = useRef(false)

  useEffect(() => {
    if (!primed.current) {
      primed.current = true
      lastN.current = emote?.n ?? 0
      return
    }
    if (emote && emote.n !== lastN.current) {
      lastN.current = emote.n
      setShot(emote)
    }
  }, [emote])

  if (!shot) return null
  const fromP1 = shot.by === 'p1' // p1 = 廣播端 = 觀戰版面的下方

  return (
    <AnimatePresence>
      {shot && (
        <motion.div
          key={`${shot.by}-${shot.n}`}
          style={{
            position: 'absolute',
            zIndex: 250,
            pointerEvents: 'none',
            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.5))',
            ...(fromP1
              ? { bottom: 'clamp(30px,6vh,58px)', left: 'clamp(116px,19vw,160px)' }
              : { top: 'clamp(30px,6vh,58px)', right: 'clamp(96px,18vw,150px)' }),
          }}
          initial={{ opacity: 0, scale: 0.3, y: fromP1 ? 20 : -20 }}
          animate={
            fromP1
              ? { opacity: [0, 1, 1, 0], scale: [0.3, 1.15, 1, 1], y: [20, -10, -24, -64] }
              : { opacity: [0, 1, 1, 0], scale: [0.3, 1.15, 1, 1], y: [-20, 10, 24, 64] }
          }
          transition={{ duration: FLOAT_MS, times: [0, 0.14, 0.72, 1] }}
          onAnimationComplete={() => setShot(null)}
        >
          <StickerView id={shot.id} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
