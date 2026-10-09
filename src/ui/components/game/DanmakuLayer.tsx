import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { DanmakuMsg } from '../../../net/spectate'
import { admitLines, DANMAKU_LIFE_MS } from './danmakuLines'
import './DanmakuLayer.css'

/**
 * 彈幕顯示層(§4.6 / #4):右側中間、最多同時 6 行,新的從最下面進、最舊的在最上面、整串往上推。
 * 消失兩種規則(2026-10 使用者定案,見 danmakuLines.ts):
 *   ① 每行從出現在畫面上那刻起算 15 秒 → 自己滑掉;
 *   ② 已滿 6 行又來新的 → 最舊那行立刻被擠掉(不用等 15 秒),新的補進最下面。
 * 進出場提示(system)也走這裡(#4/#8)。上推/滑出動畫用 framer-motion 的 layout + AnimatePresence。
 * 純前端,零 DB。pointer-events:none → 永遠浮在最上但可穿透點到底下的按鈕。
 *
 * `feed` = append-only 的彈幕串(SpectatorGame 收到就往後加);本層自己認得哪些處理過。
 */
export default function DanmakuLayer({ feed }: { feed: DanmakuMsg[] }) {
  const [lines, setLines] = useState<DanmakuMsg[]>([])
  const processed = useRef<Set<string>>(new Set())
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // 進料:feed 裡沒處理過的直接上畫面;超過上限 → 最舊的擠掉(並取消它的 15 秒計時)。
  useEffect(() => {
    const fresh: DanmakuMsg[] = []
    for (const m of feed) {
      if (processed.current.has(m.id)) continue
      processed.current.add(m.id)
      fresh.push(m)
    }
    if (!fresh.length) return
    setLines((cur) => {
      const { lines: next, dropped } = admitLines(cur, fresh)
      for (const d of dropped) {
        clearTimeout(timers.current[d.id])
        delete timers.current[d.id]
      }
      return next
    })
  }, [feed])

  // 每行「出現在畫面上那刻」起算 15 秒 → 到點移除。
  useEffect(() => {
    for (const m of lines) {
      if (timers.current[m.id]) continue
      timers.current[m.id] = setTimeout(() => {
        delete timers.current[m.id]
        setLines((cur) => cur.filter((l) => l.id !== m.id))
      }, DANMAKU_LIFE_MS)
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
