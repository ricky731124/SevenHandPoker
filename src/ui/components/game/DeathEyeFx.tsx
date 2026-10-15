import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { DEATH_EYE_FX_MS, useGameStore } from '../../../state/gameStore'
import type { PlayerId } from '../../../game/state'
import CardBack from '../CardBack'
import './DeathEyeFx.css'

const DUR = DEATH_EYE_FX_MS / 1000

type Box = { x: number; y: number; w: number; h: number }

interface Run {
  n: number
  /** 眼睛中心(決鬥區中央) */
  eye: { x: number; y: number }
  /** 被翻開的每一堆:位置 + 張數(蓋牌照原本疊法畫,翻走後露出底下的真牌) */
  piles: { box: Box; count: number }[]
}

/**
 * 死神之眼的演出(約 3.2 秒,使用者 2026-10-15 定案「眼睛閃一下、蓋牌依序翻開」):
 *  0~1.4 秒:畫面微暗,決鬥區中央一隻金色的眼睛睜開、閃一下 +「死神之眼」;
 *  1.3~3.0 秒:被看的那幾堆依序金框一閃、蓋牌翻走 → 露出底下(已翻成正面)的真牌。
 * 效果套用的同一刻真牌就已經翻正了,所以先用一疊牌背蓋住再翻走(useLayoutEffect:畫面還沒畫出來就蓋上,
 * 不會先閃一下正面)。觸發:store 的 deathEyeFx(單機/host/guest/觀戰/回放)。
 */
export default function DeathEyeFx({ me, cardW }: { me: PlayerId; cardW: number }) {
  const fx = useGameStore((s) => s.deathEyeFx)
  const anchor = useRef<HTMLDivElement>(null)
  const seenN = useRef(fx?.n ?? 0) // 掛上時已存在的舊 n 不補播
  const [run, setRun] = useState<Run | null>(null)

  useLayoutEffect(() => {
    if (!fx || fx.n === seenN.current) return
    seenN.current = fx.n
    const root = anchor.current?.parentElement
    if (!root) return
    const rr = root.getBoundingClientRect()
    const k = root.offsetWidth ? rr.width / root.offsetWidth : 1
    const boxOf = (el: Element): Box => {
      const r = el.getBoundingClientRect()
      return { x: (r.left - rr.left) / k, y: (r.top - rr.top) / k, w: r.width / k, h: r.height / k }
    }
    const band = root.querySelector('.game__band')
    if (!band) return
    const b = boxOf(band)
    const engine = useGameStore.getState().engine
    const piles = [...fx.slots]
      .sort((a, c) => a - c)
      .map((i) => {
        const el = root.querySelector(`[data-pile="${i}-${fx.target}"]`)
        return el ? { box: boxOf(el), count: engine?.slots[i]?.[fx.target].length ?? 1 } : null
      })
      .filter((p): p is { box: Box; count: number } => !!p)
    setRun({ n: fx.n, eye: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, piles })
    const t = setTimeout(() => setRun(null), DEATH_EYE_FX_MS + 80)
    return () => clearTimeout(t)
  }, [fx, me, cardW])

  return (
    <div ref={anchor} className="eye-fx" aria-hidden="true">
      {run && <Eye run={run} cardW={cardW} />}
    </div>
  )
}

function Eye({ run, cardW }: { run: Run; cardW: number }) {
  const W = cardW * 4.4
  const H = W * 0.55
  const t = (s: number) => s / DUR // 秒 → keyframe times
  const n = run.piles.length
  const step = n > 1 ? Math.min(0.35, 1.2 / (n - 1)) : 0
  const off = Math.min(3.5, cardW * 0.055) // 跟 SlotView 的疊牌位移一樣
  return (
    <>
      <motion.div
        key={`veil-${run.n}`}
        className="eye-fx__veil"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: DUR, times: [0, t(0.3), t(2.7), 1] }}
      />
      {/* 眼睛:睜開(scaleY)→ 閃一下 → 收起 */}
      <motion.div
        key={`eye-${run.n}`}
        className="eye-fx__eye"
        style={{ left: run.eye.x - W / 2, top: run.eye.y - H / 2, width: W, height: H }}
        initial={{ opacity: 0, scaleY: 0.05, scale: 0.7 }}
        animate={{
          opacity: [0, 1, 1, 1, 0],
          scaleY: [0.05, 0.05, 1, 1, 0.05],
          scale: [0.7, 1, 1, 1.15, 1.15],
        }}
        transition={{ duration: 1.45, times: [0, 0.14, 0.4, 0.75, 1], ease: 'easeInOut' }}
      >
        <svg viewBox="0 0 200 110" width={W} height={H}>
          <defs>
            <radialGradient id={`iris-${run.n}`} cx="50%" cy="45%" r="55%">
              <stop offset="0%" stopColor="#fff3b0" />
              <stop offset="45%" stopColor="#f5c542" />
              <stop offset="100%" stopColor="#b5560b" />
            </radialGradient>
          </defs>
          <path d="M6 55 Q100 -18 194 55 Q100 128 6 55 Z" fill="#1c0d02" stroke="#f5c542" strokeWidth="5" />
          <circle cx="100" cy="55" r="36" fill={`url(#iris-${run.n})`} />
          <ellipse cx="100" cy="55" rx="7" ry="30" fill="#120600" />
          <circle cx="88" cy="42" r="6" fill="#fff" opacity="0.9" />
        </svg>
      </motion.div>
      <motion.div
        key={`label-${run.n}`}
        className="eye-fx__label"
        style={{ left: run.eye.x, top: run.eye.y + H / 2 + 10 }}
        initial={{ opacity: 0, scale: 0.6, x: '-50%', y: 0 }}
        animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1.1, 1, 1], x: '-50%', y: 0 }}
        transition={{ delay: 0.35, duration: 1.15, times: [0, 0.25, 0.8, 1] }}
      >
        死神之眼
      </motion.div>
      {/* 被看的牌堆:蓋牌依序翻走(露出底下的真牌)+ 金框一閃 */}
      {run.piles.map((p, k) => {
        const start = 1.3 + k * step
        return (
          <div key={`pile-${run.n}-${k}`}>
            <motion.div
              className="eye-fx__beam"
              style={{ left: p.box.x - 4, top: p.box.y - 4, width: p.box.w + 8 + p.count * off, height: p.box.h + 8 + p.count * off }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 1, 0] }}
              transition={{ delay: start, duration: DUR - start, times: [0, 0.15, 0.7, 1] }}
            />
            <motion.div
              className="eye-fx__cover"
              style={{ left: p.box.x, top: p.box.y, width: p.box.w, height: p.box.h }}
              initial={{ scaleX: 1, opacity: 1 }}
              animate={{ scaleX: [1, 1, 0], opacity: [1, 1, 0] }}
              transition={{ duration: start + 0.4, times: [0, start / (start + 0.4), 1], ease: 'easeIn' }}
            >
              {Array.from({ length: p.count }, (_, i) => (
                <div key={i} style={{ position: 'absolute', left: i * off * 0.7, top: i * off, zIndex: i }}>
                  <CardBack w={cardW} />
                </div>
              ))}
            </motion.div>
          </div>
        )
      })}
    </>
  )
}
