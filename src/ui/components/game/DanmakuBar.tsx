import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameStore } from '../../../state/gameStore'
import { DANMAKU_POOL } from '../../../net/spectatePools'
import { sfx } from '../../../audio/sfx'

/**
 * 觀戰彈幕按鈕(§4.6):沿用貼圖按鈕的位置/樣式(game__emote-trigger),點開一列罐頭文字下拉,
 * 點一項立即送出(spectateSend → RTDB)。比照 StickerProto 的「一顆鈕 → tray → 點即送」。
 */
export default function DanmakuBar() {
  const send = useGameStore((s) => s.spectateSend)
  const [tray, setTray] = useState(false)

  const pick = (text: string) => {
    sfx.success()
    setTray(false)
    send?.(text)
  }

  return (
    <>
      {/* 沿用貼圖鈕的既有絕對定位(game__emote-trigger,貼圖位置)→ tray 也相對 .game 彈出、可滾動,
          跟貼圖一模一樣(#1)。icon(訊息氣泡)+ 文字「訊息」。 */}
      <button type="button" className="game__emote-trigger" onClick={() => { sfx.click(); setTray((v) => !v) }} title="發訊息">
        <span className="game__emote-trigger__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1Z" />
            <path d="M8 9.5h8M8 12.5h5" />
          </svg>
        </span>
        訊息
      </button>

      {/* 點外面關閉(z 低於 tray、高於其它 → 任何外部點擊都關得掉) */}
      {tray && <div onClick={() => setTray(false)} style={{ position: 'absolute', inset: 0, zIndex: 339 }} />}

      <AnimatePresence>
        {tray && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            style={{
              position: 'absolute',
              left: 'calc(clamp(6px, 1.4vw, 20px) + env(safe-area-inset-left) * 0.7)',
              bottom: 'calc(clamp(76px, 0.24 * var(--stage-h, 100vh), 150px) + 46px)',
              zIndex: 340, // 高於對手推出的牌(z 200+)→ 不被牌擋住(#1)
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              padding: 8,
              borderRadius: 14,
              background: '#ffe9cf',
              border: '2px solid #d99a5a',
              boxShadow: '0 5px 14px rgba(0,0,0,.35)',
              maxWidth: 'min(78vw, 300px)',
              maxHeight: '56vh',
              overflowY: 'auto',
            }}
          >
            {DANMAKU_POOL.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => pick(t)}
                style={{
                  textAlign: 'left',
                  padding: '7px 11px',
                  border: '1px solid #d99a5a',
                  borderRadius: 9,
                  background: '#fff8ef',
                  color: '#5a3a1a',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {t}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
