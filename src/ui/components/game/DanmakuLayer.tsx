import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DanmakuMsg } from '../../../net/spectate'
import './DanmakuLayer.css'

/**
 * 彈幕顯示層(§4.6 / #4):右側中間、最多同時 7 行,新的從最下面進、最舊的在最上面;每行存活
 * 5 秒(從出現在畫面上那刻起算);滿 7 行時之後的排隊,等最上面那則消失、其餘往上推,才補進來。
 * 進出場提示(system)也走這裡(#4/#8)。上推動畫用 framer-motion 的 layout。純前端,零 DB。
 * pointer-events:none → 永遠浮在最上但可穿透點到底下的按鈕。
 *
 * `feed` = append-only 的彈幕串(SpectatorGame 收到就往後加);本層自己認得哪些處理過。
 */
const MAX_LINES = 6 // 同時最多 6 行(#2)
const LIFE_MS = 6000 // 每行 6 秒(#2)

export default function DanmakuLayer({ feed }: { feed: DanmakuMsg[] }) {
  const [lines, setLines] = useState<DanmakuMsg[]>([])
  const queue = useRef<DanmakuMsg[]>([])
  const processed = useRef<Set<string>>(new Set())
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // 進料:把 feed 裡沒處理過的排進 queue。
  useEffect(() => {
    for (const m of feed) {
      if (processed.current.has(m.id)) continue
      processed.current.add(m.id)
      queue.current.push(m)
    }
    setLines((cur) => (cur.length < MAX_LINES && queue.current.length > 0 ? [...cur, queue.current.shift()!] : cur))
  }, [feed])

  // 補位:只要顯示未滿 3 行且 queue 有貨,就補一則(一次補一則,靠多次 render 連補)。
  useEffect(() => {
    if (lines.length < MAX_LINES && queue.current.length > 0) {
      setLines((cur) => (cur.length < MAX_LINES && queue.current.length > 0 ? [...cur, queue.current.shift()!] : cur))
    }
  }, [lines])

  // 每行「出現在畫面上那刻」起算 5 秒 → 到點移除;移除後上面的 useEffect 會自動補位。
  useEffect(() => {
    for (const m of lines) {
      if (timers.current[m.id]) continue
      timers.current[m.id] = setTimeout(() => {
        delete timers.current[m.id]
        setLines((cur) => cur.filter((l) => l.id !== m.id))
      }, LIFE_MS)
    }
  }, [lines])

  useEffect(
    () => () => {
      Object.values(timers.current).forEach(clearTimeout)
    },
    [],
  )

  if (lines.length === 0) return null

  return (
    <div className="danmaku-layer" aria-live="polite">
      <AnimatePresence initial={false}>
        {lines.map((m) => (
          <motion.div
            key={m.id}
            layout
            className={`danmaku-line${m.system ? ' danmaku-line--sys' : ''}`}
            initial={{ opacity: 0, x: 44 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 44 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            {!m.system && <span className="danmaku-by">{m.by}</span>}
            <span className="danmaku-text">{m.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
