import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../../../state/gameStore'
import { usePlatformStore } from '../../../state/platformStore'
import { getSticker, ownedStickers, stickerSrc, type StickerDef } from '../../../game/stickers'
import { sfx } from '../../../audio/sfx'

/**
 * 對戰貼圖 (in-match stickers). 貼圖 button (left column, 由下到上 頭像→貼圖→特殊牌→
 * 發牌) → picker tray of owned stickers → **tap one = send immediately** (使用者:
 * 不用再確認). A sent sticker floats from the SENDER's avatar toward board centre:
 *   我送出 → 我頭像(左下)右上飄;對手送 → 其頭像(右上)左下飄(再往左、飄遠一點)。
 * Online: broadcast via gameStore.sendEmote; incoming shown from incomingEmote.
 */
const FLOAT_MS = 3.1

function StickerView({ def, imgW, emojiPx }: { def: StickerDef; imgW: number | string; emojiPx: number | string }) {
  if (def.emoji) return <span style={{ fontSize: emojiPx, lineHeight: 1 }}>{def.emoji}</span>
  return <img src={stickerSrc(def.id)} alt={def.name} style={{ width: imgW, height: 'auto', display: 'block' }} />
}

export default function StickerProto() {
  const emojis = usePlatformStore((s) => s.profile?.unlocked.emojis) ?? {}
  const online = useGameStore((s) => s.online)
  const incoming = useGameStore((s) => s.incomingEmote)
  const sendEmote = useGameStore((s) => s.sendEmote)

  const owned = ownedStickers(emojis)
  const [tray, setTray] = useState(false)
  const [myShot, setMyShot] = useState<{ id: string; n: number } | null>(null)

  if (owned.length === 0) return null

  const send = (def: StickerDef) => {
    sfx.success() // 送出貼圖
    setTray(false)
    setMyShot({ id: def.id, n: Date.now() })
    if (online) sendEmote(def.id)
  }

  const myDef = myShot ? getSticker(myShot.id) : null
  const foeDef = incoming ? getSticker(incoming.id) : null

  return (
    <>
      <button type="button" className="game__emote-trigger" onClick={() => { sfx.click(); setTray((v) => !v) }} title="傳送貼圖">
        <span className="game__emote-trigger__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <circle cx="9" cy="10" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none" />
            <path d="M8.5 14c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2" strokeLinecap="round" />
          </svg>
        </span>
        貼圖
      </button>

      {/* click-catcher: tapping anywhere outside the tray closes it (like a modal) */}
      {tray && (
        <div
          onClick={() => setTray(false)}
          style={{ position: 'absolute', inset: 0, zIndex: 61 }}
        />
      )}

      {/* picker tray — tap a sticker to send at once */}
      <AnimatePresence>
        {tray && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            style={{
              position: 'absolute',
              left: 'clamp(6px, 1.4vw, 20px)',
              bottom: 'calc(clamp(76px, 0.24 * var(--stage-h, 100vh), 150px) + 46px)',
              zIndex: 62,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 50px)',
              gap: 6,
              padding: 8,
              borderRadius: 14,
              background: '#ffe9cf',
              border: '2px solid #d99a5a',
              boxShadow: '0 5px 14px rgba(0,0,0,.35)',
              maxWidth: '90vw',
            }}
          >
            {owned.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => send(s)}
                title={s.name}
                style={{ width: 50, height: 50, padding: 2, border: '1px solid #d99a5a', borderRadius: 9, background: '#fff8ef', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <StickerView def={s} imgW={42} emojiPx={28} />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* my sent sticker — from my avatar (左下) up-right, clear of the avatar */}
      <AnimatePresence>
        {myShot && myDef && (
          <motion.div
            key={`me-${myShot.n}`}
            style={{ position: 'absolute', bottom: 'clamp(30px,6vh,58px)', left: 'clamp(116px,19vw,160px)', zIndex: 250, pointerEvents: 'none', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.5))' }}
            initial={{ opacity: 0, scale: 0.3, y: 20 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.15, 1, 1], y: [20, -10, -24, -64] }}
            transition={{ duration: FLOAT_MS, times: [0, 0.14, 0.72, 1] }}
          >
            <StickerView def={myDef} imgW="clamp(120px,22vw,168px)" emojiPx="clamp(56px,11vw,84px)" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* opponent's sticker — from their avatar (右上) down-left (further left, floats further) */}
      <AnimatePresence>
        {incoming && foeDef && (
          <motion.div
            key={`foe-${incoming.n}`}
            style={{ position: 'absolute', top: 'clamp(30px,6vh,58px)', right: 'clamp(96px,18vw,150px)', zIndex: 250, pointerEvents: 'none', filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.5))' }}
            initial={{ opacity: 0, scale: 0.3, y: -20 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.15, 1, 1], y: [-20, 10, 24, 64] }}
            transition={{ duration: FLOAT_MS, times: [0, 0.14, 0.72, 1] }}
          >
            <StickerView def={foeDef} imgW="clamp(120px,22vw,168px)" emojiPx="clamp(56px,11vw,84px)" />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
