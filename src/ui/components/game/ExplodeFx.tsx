import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { EXPLODE_FX_MS, useGameStore } from '../../../state/gameStore'
import type { PlayerId } from '../../../game/state'
import type { Card as TCard } from '../../../game/cards'
import Card from '../Card'
import CardBack from '../CardBack'
import './ExplodeFx.css'

/** 動畫總長(ms):炸彈從頭像扔到那張牌 → 牌原地浮起抖兩下 → 爆開消失(使用者:放慢,讓人看得到炸彈)。 */
const DURATION = EXPLODE_FX_MS

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
 *  - 訂 store:牌局(engine)或 explodeFx 一變,就「趁畫面還沒重畫」同步量一次手牌 = 變動前最後的位置。
 *    連線 guest 被炸時,新手牌常比爆破通知先到 → 新手牌到的那一刻量到的就是「那張牌還在」的位置。
 *    (2026-10-14 前是每 0.4 秒一直量;改成只在牌局變動那一刻量,沒有輪詢。)
 *  - 找位置:先用牌 id(我方手牌、觀戰全開),找不到再用第幾張(對手牌背),都沒有就用手牌列中央。
 * 這裡只是疊一層演出,真手牌早就少了那張。觸發:store 的 explodeFx(單機/host/guest/觀戰/回放)。
 * 只在特殊牌對局、觀戰、回放掛載(GameBoard 決定;一般對局不會有爆破)。
 */
export default function ExplodeFx({ me, cardW }: { me: PlayerId; cardW: number }) {
  const fx = useGameStore((s) => s.explodeFx)
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
    // 用「排版上的停放位置」(offsetParent 的框 + offsetLeft/Top),不吃 transform:
    // 發牌飛入、選牌浮起的動畫跑到一半量,拿到的也是牌最後停的位置(不用等動畫跑完再量)。
    const box = (el: Element): Box => {
      const h = el as HTMLElement
      const p = h.offsetParent
      if (!p) {
        const r = el.getBoundingClientRect()
        return { x: (r.left - rr.left) / k, y: (r.top - rr.top) / k, w: r.width / k, h: r.height / k }
      }
      const pr = p.getBoundingClientRect()
      const ph = p as HTMLElement
      const pk = ph.offsetWidth ? pr.width / ph.offsetWidth : k
      const ox = (ph.clientLeft + h.offsetLeft) * pk // offsetLeft 從 padding 邊算,框是從 border 邊 → 補上邊框寬
      const oy = (ph.clientTop + h.offsetTop) * pk
      return { x: (pr.left - rr.left + ox) / k, y: (pr.top - rr.top + oy) / k, w: (h.offsetWidth * pk) / k, h: (h.offsetHeight * pk) / k }
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

  // 牌局或 explodeFx 一變 → 趁畫面還沒重畫(牌還在、前一步的動畫也早跑完了)先量。
  // zustand 的 subscribe 是 setState 當下同步呼叫,React 重畫在之後 → 這裡看到的是變動前的畫面。
  useEffect(
    () =>
      useGameStore.subscribe((s, prev) => {
        if (s.engine !== prev.engine || (s.explodeFx && s.explodeFx !== prev.explodeFx)) measure()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  // 掛載時先量一次當基準(中途進觀戰/回放第一個變動就是爆破時也有位置可用)
  useEffect(() => {
    measure()
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
  const B = 44 // 炸彈 emoji 大小(放大一點,飛行中看得出是炸彈)
  // 炸彈直線飛到牌上(使用者:直線,看得出是扔過去),等速、邊飛邊轉
  const midX = (run.from.x + cx) / 2
  const midY = (run.from.y + cy) / 2
  const dur = DURATION / 1000
  // 時間軸(秒):炸彈飛 1.1 秒 → 牌浮起 → 抖 → 爆炸 → 字留到最後
  const T = { land: 1.1, bombEnd: 1.3, risen: 1.65, boom: 2.35, cardEnd: 2.75 }
  return (
    <>
      {/* 被炸的牌:炸彈飛行時待在原位(蓋住真牌的空位)→ 炸彈落下後慢慢浮起 → 抖兩下 → 爆掉 */}
      <motion.div
        key={`card-${run.n}`}
        className="explode-fx__card"
        style={{ left: slot.x, top: slot.y }}
        initial={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
        animate={{
          opacity: [1, 1, 1, 1, 1, 1, 1, 1, 0],
          y: [0, 0, lift, lift, lift, lift, lift, lift, lift],
          x: [0, 0, 0, -6, 6, -6, 6, 0, 0],
          scale: [1, 1, 1.15, 1.15, 1.15, 1.15, 1.15, 1.18, 1.7],
          rotate: [0, 0, 0, -6, 6, -6, 6, 0, 15],
        }}
        transition={{ duration: T.cardEnd, times: [0, T.land, T.risen, 1.8, 1.95, 2.1, 2.25, T.boom, T.cardEnd].map((t) => t / T.cardEnd), ease: 'easeInOut' }}
      >
        {run.card ? <Card card={run.card} w={cardW} /> : <CardBack w={cardW} />}
      </motion.div>
      {/* 炸彈:從頭像直線飛到牌上(1.1 秒,看得清楚);落到牌上縮小消失 */}
      <motion.div
        key={`bomb-${run.n}`}
        className="explode-fx__bomb"
        style={{ left: 0, top: 0 }}
        initial={{ x: run.from.x - B / 2, y: run.from.y - B / 2, rotate: 0, scale: 0.8, opacity: 1 }}
        animate={{
          x: [run.from.x - B / 2, midX - B / 2, cx - B / 2, cx - B / 2],
          y: [run.from.y - B / 2, midY - B / 2, cy - B / 2, cy - B / 2],
          rotate: [0, 180, 360, 380],
          scale: [0.8, 1.1, 1, 0.3],
          opacity: [1, 1, 1, 0],
        }}
        transition={{ duration: T.bombEnd, times: [0, T.land / 2, T.land, T.bombEnd].map((t) => t / T.bombEnd), ease: 'linear' }}
      >
        💣
      </motion.div>
      {/* 爆炸閃光(直徑 2 張牌寬的圓)+ 碎片 + 字 */}
      <motion.div
        key={`flash-${run.n}`}
        className="explode-fx__flash"
        style={{ left: cx - cardW, top: burstY - cardW }}
        initial={{ opacity: 0, scale: 0.3 }}
        animate={{ opacity: [0, 1, 0], scale: [0.3, 1.4, 1.9] }}
        transition={{ delay: T.boom, duration: 0.6, ease: 'easeOut' }}
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
            animate={{ opacity: [0, 1, 0], x: [0, Math.cos(a) * dist * 0.7, Math.cos(a) * dist], y: [0, Math.sin(a) * dist * 0.7, Math.sin(a) * dist] }}
            transition={{ delay: T.boom, duration: 0.7, ease: 'easeOut' }}
          />
        )
      })}
      <motion.div
        key={`label-${run.n}`}
        className="explode-fx__label"
        style={{ left: cx, top: burstY + Math.sign(lift) * slot.h * 0.95 }}
        initial={{ opacity: 0, scale: 0.6, x: '-50%', y: '-50%' }}
        animate={{ opacity: [0, 1, 1, 0], scale: [0.6, 1.15, 1, 0.95], x: '-50%', y: '-50%' }}
        transition={{ delay: T.boom, duration: dur - T.boom, times: [0, 0.2, 0.85, 1], ease: 'easeOut' }}
      >
        爆破！
      </motion.div>
    </>
  )
}
