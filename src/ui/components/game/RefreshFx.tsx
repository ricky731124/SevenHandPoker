import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useGameStore } from '../../../state/gameStore'
import type { PlayerId } from '../../../game/state'
import CardBack from '../CardBack'
import { sfx } from '../../../audio/sfx'
import './RefreshFx.css'

/** 動畫總長(ms):飛回牌堆 → 洗牌 → 發回手上。 */
const DURATION = 1700

interface Run {
  n: number
  side: 'me' | 'foe'
  /** 各張牌在手牌列上的起點(.game 內、未縮放座標) */
  from: { x: number; y: number }[]
  deck: { x: number; y: number }
}

/**
 * 強迫更新的演出:被打那一方的手牌(牌背)飛回牌堆 → 在牌堆上洗兩下 → 再發回手牌列。
 * 播放期間把真手牌藏起來(.game--rf-me / --rf-foe),結束才露出新手牌,所以不管新手牌
 * 是先到(單機/host)還是後到(guest 等同步),畫面都對得上。
 *
 * 只看 store 的 refreshFx:n 變了才播一次;掛上時已存在的舊 n 不補播。
 * 掛在 GameBoard 的 .game 裡(絕對定位),位置用 DOM 量 .game__hand / .game__ohand / 牌堆。
 */
export default function RefreshFx({ me, cardW }: { me: PlayerId; cardW: number }) {
  const fx = useGameStore((s) => s.refreshFx)
  const engine = useGameStore((s) => s.engine)
  const anchor = useRef<HTMLDivElement>(null)
  const seenN = useRef(fx?.n ?? 0)
  const [run, setRun] = useState<Run | null>(null)

  useEffect(() => {
    if (!fx || fx.n === seenN.current) return
    seenN.current = fx.n
    const root = anchor.current?.parentElement
    if (!root) return
    const side = fx.target === me ? 'me' : 'foe'
    const handEl = root.querySelector(side === 'me' ? '.game__hand' : '.game__ohand')
    const deckEl = root.querySelector('.game__deck .deck__stack') ?? root.querySelector('.game__deck')
    if (!handEl || !deckEl) return
    // .game 可能被 transform: scale(fit) 縮放 → 量到的是螢幕 px,換回 .game 內的座標
    const rr = root.getBoundingClientRect()
    const k = root.offsetWidth ? rr.width / root.offsetWidth : 1
    const hr = handEl.getBoundingClientRect()
    const dr = deckEl.getBoundingClientRect()
    const cardH = cardW * 1.4
    const count = Math.max(1, Math.min(12, engine?.hands[fx.target].length ?? 8))
    const left = (hr.left - rr.left) / k
    const span = Math.max(0, hr.width / k - cardW)
    const y = (hr.top - rr.top) / k + Math.max(0, (hr.height / k - cardH) / 2)
    const from = Array.from({ length: count }, (_, i) => ({ x: left + (count > 1 ? (span * i) / (count - 1) : span / 2), y }))
    const deck = { x: (dr.left - rr.left) / k + (dr.width / k - cardW) / 2, y: (dr.top - rr.top) / k + (dr.height / k - cardH) / 2 }
    setRun({ n: fx.n, side, from, deck })
    root.classList.add(`game--rf-${side}`)
    const tDraw = setTimeout(() => sfx.draw(Math.min(count, 5)), DURATION * 0.62)
    const tEnd = setTimeout(() => {
      root.classList.remove(`game--rf-${side}`)
      setRun(null)
    }, DURATION + 80) // 多留幾幀,讓最後一段確實落回手牌列才收掉
    return () => {
      clearTimeout(tDraw)
      clearTimeout(tEnd)
      root.classList.remove(`game--rf-${side}`)
    }
    // engine 只拿來估張數,不該讓它重觸發
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, me, cardW])

  return (
    <div ref={anchor} className="refresh-fx" aria-hidden="true">
      {run && (
        <>
          {run.from.map((p, i) => {
            const jit = (i % 2 ? 1 : -1) * cardW * 0.45 // 洗牌時左右分兩疊交錯
            const tilt = (i % 3) * 6 - 6
            return (
              <motion.div
                key={`${run.n}-${i}`}
                className="refresh-fx__card"
                initial={{ x: p.x, y: p.y, rotate: 0, opacity: 1 }}
                animate={{
                  x: [p.x, run.deck.x, run.deck.x + jit, run.deck.x - jit, run.deck.x, p.x],
                  y: [p.y, run.deck.y - i, run.deck.y - i, run.deck.y - i, run.deck.y - i, p.y],
                  rotate: [0, tilt - 14, tilt + 10, tilt - 10, 0, 0],
                }}
                transition={{ duration: DURATION / 1000, times: [0, 0.3, 0.42, 0.52, 0.62, 1], ease: 'easeInOut', delay: 0 }}
              >
                <CardBack w={cardW} />
              </motion.div>
            )
          })}
          <motion.div
            className="refresh-fx__label"
            style={{ left: run.deck.x + cardW / 2, top: run.deck.y - cardW * 0.55 }}
            initial={{ opacity: 0, scale: 0.6, x: '-50%' }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1.08, 1, 0.95], x: '-50%' }}
            transition={{ duration: DURATION / 1000, times: [0, 0.18, 0.75, 1] }}
          >
            強迫更新
          </motion.div>
        </>
      )}
    </div>
  )
}
