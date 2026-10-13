import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useGameStore } from '../../../state/gameStore'
import type { PlayerId } from '../../../game/state'
import type { Card as TCard } from '../../../game/cards'
import Card from '../Card'
import CardBack from '../CardBack'
import './ExplodeFx.css'

/** 動畫總長(ms):炸彈從頭像扔到那張牌 → 牌原地浮起抖兩下 → 爆開消失。 */
const DURATION = 1800

type Box = { x: number; y: number; w: number; h: number }

interface Run {
  n: number
  card?: TCard
  /** 炸彈起點 = 出手那一方的頭像中心;落點 = 被炸那張牌的中心 */
  from: { x: number; y: number }
  /** 被炸那張牌在手牌列上的位置(.game 內未縮放座標) */
  slot: Box
  /** 浮起的方向與距離(我方往上、對手往下 = 都往牌桌中間;負=往上) */
  lift: number
}

/** 手牌位置快照:牌 id → 位置(我方手牌、觀戰全開的對手手牌),以及雙方第幾張 → 位置(牌背用)。 */
interface Snapshot {
  byId: Map<string, Box>
  byIdx: { hand: Box[]; ohand: Box[] }
}

/**
 * 爆破的演出(使用者 2026-10-13 定案):
 *  炸彈從「出手那一方的頭像」扔到「被炸那張牌原本的位置」→ 那張牌原地浮起、抖兩下 → 爆開消失 + 「爆破！」。
 *
 * 難點:效果套用的當下那張牌就從手牌拿掉了,畫面重畫後找不到它的位置。所以:
 *  - 訂 store:explodeFx 一變就同步量一次手牌(這時畫面還沒重畫,牌還在)。
 *  - 另外每次牌面變動後也量一次存起來(連線時新手牌可能比爆破通知先到,用上一次的位置)。
 *  - 找位置:先用牌 id(我方手牌、觀戰全開),找不到再用第幾張(對手牌背),都沒有就用手牌列中央。
 * 這裡只是疊一層演出,真手牌早就少了那張。觸發:store 的 explodeFx(單機/host/guest/觀戰/回放)。
 */
export default function ExplodeFx({ me, cardW }: { me: PlayerId; cardW: number }) {
  const fx = useGameStore((s) => s.explodeFx)
  const engine = useGameStore((s) => s.engine)
  const anchor = useRef<HTMLDivElement>(null)
  const seenN = useRef(fx?.n ?? 0)
  const snap = useRef<Snapshot>({ byId: new Map(), byIdx: { hand: [], ohand: [] } })
  const prevIdx = useRef<{ at: number; idx: Snapshot['byIdx'] } | null>(null)
  const [run, setRun] = useState<Run | null>(null)

  /** 量目前畫面上的手牌位置,併進快照(byId 只增不刪:被炸掉的牌還要能查到最後的位置)。 */
  const measure = () => {
    const root = anchor.current?.parentElement
    if (!root) return
    const rr = root.getBoundingClientRect()
    const k = root.offsetWidth ? rr.width / root.offsetWidth : 1
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect()
      return { x: (r.left - rr.left) / k, y: (r.top - rr.top) / k, w: r.width / k, h: r.height / k }
    }
    root.querySelectorAll('[data-card-id]').forEach((el) => {
      const id = el.getAttribute('data-card-id')
      if (id) snap.current.byId.set(id, box(el))
    })
    const next = {
      hand: [...root.querySelectorAll('.game__hand .hand__slot')].map(box),
      ohand: [...root.querySelectorAll('.game__ohand .ohand__slot')].map(box),
    }
    // 張數變了 → 把變之前的排法留一份(連線時手牌先少一張、爆破通知後到,要用少之前的位置)
    const cur = snap.current.byIdx
    if (next.hand.length !== cur.hand.length || next.ohand.length !== cur.ohand.length) prevIdx.current = { at: Date.now(), idx: cur }
    snap.current.byIdx = next
  }

  // explodeFx 一變 → 趁畫面還沒重畫(牌還在)先量
  useEffect(
    () =>
      useGameStore.subscribe((s, prev) => {
        if (s.explodeFx && s.explodeFx !== prev.explodeFx) measure()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  // 牌面變了 → 重畫後馬上量一次;平常每 0.4 秒也量一次(發牌飛入、排序等動畫跑完後位置才準)。
  // 連線 guest 被炸時,新手牌常比爆破通知先到 → 那張牌已不在畫面上,只能靠這份「最後看到的位置」。
  useEffect(() => {
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])
  useEffect(() => {
    const t = setInterval(measure, 400)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!fx || fx.n === seenN.current) return
    seenN.current = fx.n
    const root = anchor.current?.parentElement
    if (!root) return
    const rr = root.getBoundingClientRect()
    const k = root.offsetWidth ? rr.width / root.offsetWidth : 1
    const center = (sel: string) => {
      const el = root.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: (r.left - rr.left + r.width / 2) / k, y: (r.top - rr.top + r.height / 2) / k }
    }
    const targetIsMe = fx.target === me
    // 出手的是被炸那一方的對手 → 炸彈從他的頭像扔出來
    const from = center(targetIsMe ? '.game__foe-avatar .avatar-wrap' : '.game__me-avatar .avatar-wrap') ??
      center(targetIsMe ? '.game__foe-avatar' : '.game__me-avatar')
    const cardH = cardW * 1.4
    const side = targetIsMe ? 'hand' : 'ohand'
    let list = snap.current.byIdx[side]
    // 手牌剛少一張(2 秒內)→ 用少之前的排法,牌才會從它原本的位置浮起來
    const before = prevIdx.current
    if (before && Date.now() - before.at < 2000 && before.idx[side].length === list.length + 1) list = before.idx[side]
    let slot = (fx.card && snap.current.byId.get(fx.card.id)) || undefined
    if (!slot && fx.index !== undefined && list.length) slot = list[Math.max(0, Math.min(list.length - 1, fx.index))]
    if (!slot) {
      const c = center(targetIsMe ? '.game__hand' : '.game__ohand')
      if (c) slot = { x: c.x - cardW / 2, y: c.y - cardH / 2, w: cardW, h: cardH }
    }
    if (!from || !slot) return
    setRun({ n: fx.n, card: fx.card, from, slot: { ...slot, w: cardW, h: cardH }, lift: (targetIsMe ? -1 : 1) * cardH * 0.45 })
    const t = setTimeout(() => setRun(null), DURATION + 80)
    return () => clearTimeout(t)
  }, [fx, me, cardW])

  return (
    <div ref={anchor} className="explode-fx" aria-hidden="true">
      {run && <Boom run={run} cardW={cardW} />}
    </div>
  )
}

function Boom({ run, cardW }: { run: Run; cardW: number }) {
  const { slot, lift } = run
  const cx = slot.x + slot.w / 2
  const cy = slot.y + slot.h / 2
  const burstY = cy + lift // 爆炸點 = 牌浮起後的中心
  const B = 36 // 炸彈 emoji 大小
  // 炸彈走拋物線:中點往上抬一點
  const midX = (run.from.x + cx) / 2
  const midY = Math.min(run.from.y, cy) - slot.h * 0.8
  const dur = DURATION / 1000
  return (
    <>
      {/* 被炸的牌:從頭到尾待在原位(蓋住已經拿掉的真牌的空位)→ 炸彈落下後浮起、抖、爆掉 */}
      <motion.div
        key={`card-${run.n}`}
        className="explode-fx__card"
        style={{ left: slot.x, top: slot.y }}
        initial={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
        animate={{
          opacity: [1, 1, 1, 1, 1, 1, 0, 0],
          y: [0, 0, lift, lift, lift, lift, lift, lift],
          x: [0, 0, 0, -6, 6, -5, 0, 0],
          scale: [1, 1, 1.15, 1.15, 1.15, 1.2, 1.6, 1.6],
          rotate: [0, 0, 0, -7, 7, -5, 18, 18],
        }}
        transition={{ duration: dur, times: [0, 0.32, 0.45, 0.52, 0.58, 0.64, 0.74, 1] }}
      >
        {run.card ? <Card card={run.card} w={cardW} /> : <CardBack w={cardW} />}
      </motion.div>
      {/* 炸彈:從頭像拋過去,落到牌上就縮小消失 */}
      <motion.div
        key={`bomb-${run.n}`}
        className="explode-fx__bomb"
        style={{ left: 0, top: 0 }}
        initial={{ x: run.from.x - B / 2, y: run.from.y - B / 2, rotate: 0, scale: 0.7, opacity: 1 }}
        animate={{
          x: [run.from.x - B / 2, midX - B / 2, cx - B / 2, cx - B / 2, cx - B / 2],
          y: [run.from.y - B / 2, midY - B / 2, cy - B / 2, cy - B / 2, cy - B / 2],
          rotate: [0, 270, 540, 600, 600],
          scale: [0.7, 1.2, 1, 0.3, 0.3],
          opacity: [1, 1, 1, 0, 0],
        }}
        transition={{ duration: dur, times: [0, 0.15, 0.3, 0.36, 1] }}
      >
        💣
      </motion.div>
      {/* 爆炸閃光(直徑 2 張牌寬的圓)+ 碎片 + 字 */}
      <motion.div
        key={`flash-${run.n}`}
        className="explode-fx__flash"
        style={{ left: cx - cardW, top: burstY - cardW }}
        initial={{ opacity: 0, scale: 0.2 }}
        animate={{ opacity: [0, 0, 1, 0, 0], scale: [0.2, 0.2, 1.3, 1.8, 1.8] }}
        transition={{ duration: dur, times: [0, 0.64, 0.72, 0.95, 1] }}
      >
        <div style={{ width: cardW * 2, height: cardW * 2 }} />
      </motion.div>
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2
        const dist = cardW * (1.1 + (i % 3) * 0.25)
        return (
          <motion.div
            key={`spark-${run.n}-${i}`}
            className={`explode-fx__spark explode-fx__spark--${i % 3}`}
            style={{ left: cx - 5, top: burstY - 5 }}
            initial={{ opacity: 0, x: 0, y: 0 }}
            animate={{
              opacity: [0, 0, 1, 0],
              x: [0, 0, Math.cos(a) * dist, Math.cos(a) * dist],
              y: [0, 0, Math.sin(a) * dist, Math.sin(a) * dist],
            }}
            transition={{ duration: dur, times: [0, 0.66, 0.92, 1] }}
          />
        )
      })}
      <motion.div
        key={`label-${run.n}`}
        className="explode-fx__label"
        style={{ left: cx, top: burstY + Math.sign(lift) * slot.h * 0.95 }}
        initial={{ opacity: 0, scale: 0.6, x: '-50%', y: '-50%' }}
        animate={{ opacity: [0, 0, 1, 1, 0], scale: [0.6, 0.6, 1.15, 1, 0.95], x: '-50%', y: '-50%' }}
        transition={{ duration: dur, times: [0, 0.66, 0.76, 0.92, 1] }}
      >
        爆破！
      </motion.div>
    </>
  )
}
