import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { cardFxMs, useGameStore, type CardFxRun } from '../../../state/gameStore'
import type { PlayerId } from '../../../game/state'
import type { Card as TCard, Suit } from '../../../game/cards'
import { getSpecialCard } from '../../../game/specialCards'
import Card from '../Card'
import CardBack from '../CardBack'
import { sfx } from '../../../audio/sfx'
import './CardFx.css'

/**
 * 舊特殊卡的演出(2026-10-27 使用者定):
 *  - 四張花色卡:牌浮起 → 各自的特效(梅花=飄雪+梅花瓣、方塊=天上一道光降下來、紅心=一箭射中、黑桃=小鴨「快逃呀～」跑過)
 *    → 牌翻一圈換成新花色 → 落回手牌位置。targets 可以多張(之後「一次改兩張」直接用)。
 *  - 偷天換日:牌飛進牌堆 → 牌堆洗一下 → 抽一張飛回來翻開。targets 可以多張(之後「選 1~3 張」)。
 *  - 偷窺:放大鏡在牌堆上掃,要補的那幾張從牌堆掀起來 → 播完才跳結果彈窗。
 *  - 讓我看看:探照燈掃過對手手牌 → 播完才跳結果彈窗;被看的那一方:自己手牌上一雙眼睛左看右看。
 * 誰看得到:自己用的自己看;讓我看看被看的人也看。對手用花色卡/偷天換日/偷窺(沒動到你)→ 你看不到(只有原本的提示)。
 * 只是疊一層演出:真牌在播放時先藏起來(新牌面已經算好了),播完就露出來。
 */

type Box = { x: number; y: number; w: number; h: number }
type Pt = { x: number; y: number }
interface Item {
  before: TCard
  after?: TCard
  /** 改之前在手牌的位置 */
  from: Box
  /** 改完之後在手牌的位置(花色卡排序可能換位置;偷天換日 = 新牌的位置) */
  to: Box
}
interface Run {
  fx: CardFxRun
  view: 'self' | 'victim'
  items: Item[]
  deck: Pt | null
  foeSlots: Box[]
  mySlots: Box[]
}

export default function CardFx({ me, cardW }: { me: PlayerId; cardW: number }) {
  const fx = useGameStore((s) => s.cardFx)
  const anchor = useRef<HTMLDivElement>(null)
  const seenN = useRef(fx?.n ?? 0)
  const snap = useRef(new Map<string, Box>())
  const [run, setRun] = useState<Run | null>(null)

  const root = () => anchor.current?.parentElement ?? null
  /** 元素在 .game 內「未縮放」座標的停放位置(跟 ExplodeFx 同一套:用排版位置,不吃進行中的 transform) */
  const boxOf = (r: HTMLElement, el: Element): Box => {
    const rr = r.getBoundingClientRect()
    const k = r.offsetWidth ? rr.width / r.offsetWidth : 1
    const h = el as HTMLElement
    const p = h.offsetParent as HTMLElement | null
    if (!p) {
      const b = el.getBoundingClientRect()
      return { x: (b.left - rr.left) / k, y: (b.top - rr.top) / k, w: b.width / k, h: b.height / k }
    }
    const pr = p.getBoundingClientRect()
    const pk = p.offsetWidth ? pr.width / p.offsetWidth : k
    return {
      x: (pr.left - rr.left + (p.clientLeft + h.offsetLeft) * pk) / k,
      y: (pr.top - rr.top + (p.clientTop + h.offsetTop) * pk) / k,
      w: (h.offsetWidth * pk) / k,
      h: (h.offsetHeight * pk) / k,
    }
  }
  const measureHand = () => {
    const r = root()
    if (!r) return
    r.querySelectorAll('.game__hand [data-card-id]').forEach((el) => {
      const id = el.getAttribute('data-card-id')
      if (id) snap.current.set(id, boxOf(r, el))
    })
  }

  // 牌局或演出觸發一變 → 趁畫面還沒重畫先量手牌(= 改之前的位置)
  useEffect(
    () =>
      useGameStore.subscribe((s, prev) => {
        if (s.engine !== prev.engine || (s.cardFx && s.cardFx !== prev.cardFx)) measureHand()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => {
    measureHand()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!fx || fx.n === seenN.current) return
    seenN.current = fx.n
    const view: Run['view'] | null = fx.by === me ? 'self' : fx.kind === 'spy' ? 'victim' : null
    if (!view) return // 對手對自己手牌做的事 → 看不到
    // effect 跑的時候新牌面已經畫進 DOM 了(React commit 之後)→ 直接量終點。
    // (之前等兩個 requestAnimationFrame,分頁在背景/面板被蓋住時 rAF 會停,演出晚一秒才出現)
    const r = root()
    if (!r) return
    const cardH = cardW * 1.4
    const center = (sel: string): Pt | null => {
      const el = r.querySelector(sel)
      if (!el) return null
      const b = boxOf(r, el)
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    }
    const handC = center('.game__hand') ?? { x: r.offsetWidth / 2, y: r.offsetHeight * 0.8 }
    const fallback: Box = { x: handC.x - cardW / 2, y: handC.y - cardH / 2, w: cardW, h: cardH }
    const items = (fx.targets ?? []).map((t) => {
      const from = snap.current.get(t.before.id) ?? fallback
      const el = t.after ? r.querySelector(`.game__hand [data-card-id="${CSS.escape(t.after.id)}"]`) : null
      const to = el ? boxOf(r, el) : from
      return { ...t, from: { ...from, w: cardW, h: cardH }, to: { ...to, w: cardW, h: cardH } }
    })
    const slots = (sel: string) => [...r.querySelectorAll(sel)].map((el) => boxOf(r, el))
    setRun({
      fx,
      view,
      items,
      deck: center('.game__deck .deck__stack') ?? center('.game__deck'),
      foeSlots: slots('.game__ohand .ohand__slot'),
      mySlots: slots('.game__hand .hand__slot'),
    })
    const t = setTimeout(() => setRun(null), cardFxMs(fx.kind) + 80)
    return () => clearTimeout(t)
  }, [fx, me, cardW])

  // 播放中把真牌(已經是新牌面)先藏起來,播完露出來
  const hideIds = run && (run.fx.kind === 'suit' || run.fx.kind === 'swap') ? run.items.map((i) => i.after?.id).filter(Boolean) : []
  const def = run ? getSpecialCard(run.fx.card) : undefined

  return (
    <div ref={anchor} className="card-fx" aria-hidden="true">
      {hideIds.length > 0 && (
        <style>{hideIds.map((id) => `.game__hand [data-card-id="${CSS.escape(id!)}"]{visibility:hidden!important}`).join('')}</style>
      )}
      {run?.fx.kind === 'suit' &&
        run.items.map((it, i) => <SuitRun key={`${run.fx.n}-${i}`} it={it} suit={def?.suit ?? 'C'} cardW={cardW} delay={i * 0.15} />)}
      {run?.fx.kind === 'swap' &&
        run.items.map((it, i) => <SwapRun key={`${run.fx.n}-${i}`} it={it} deck={run.deck} cardW={cardW} delay={i * 0.18} />)}
      {run?.fx.kind === 'peek' && run.deck && <PeekRun key={run.fx.n} deck={run.deck} count={run.fx.count ?? 2} cardW={cardW} />}
      {run?.fx.kind === 'spy' && run.view === 'self' && <SpyRun key={run.fx.n} slots={run.foeSlots} cardW={cardW} />}
      {run?.fx.kind === 'spy' && run.view === 'victim' && <SpiedRun key={run.fx.n} slots={run.mySlots} cardW={cardW} />}
      {run && def && (
        <motion.div
          key={`label-${run.fx.n}`}
          className={`card-fx__label${run.view === 'victim' ? ' is-victim' : ''}`}
          style={labelPos(run, cardW)}
          initial={{ opacity: 0, scale: 0.7, x: '-50%', y: '-50%' }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.7, 1.1, 1, 0.95], x: '-50%', y: '-50%' }}
          transition={{ duration: cardFxMs(run.fx.kind) / 1000, times: [0, 0.12, 0.85, 1] }}
        >
          {run.view === 'victim' ? '對手正在偷看你的手牌…' : def.name}
        </motion.div>
      )}
    </div>
  )
}

/** 卡名標籤放哪:花色/偷天換日 = 第一張牌上方;偷窺 = 牌堆上方;讓我看看 = 被看的那排手牌上方 */
function labelPos(run: Run, cardW: number): { left: number; top: number } {
  const h = cardW * 1.4
  if ((run.fx.kind === 'suit' || run.fx.kind === 'swap') && run.items[0]) {
    const b = run.items[0].from
    return { left: b.x + b.w / 2, top: b.y - h * 0.95 }
  }
  // 牌堆在左上角:標籤放在掀起那排牌的下面(放上面會出畫面)
  if (run.fx.kind === 'peek' && run.deck) return { left: run.deck.x + cardW * 2, top: run.deck.y + h * 0.95 }
  const s = run.view === 'victim' ? run.mySlots : run.foeSlots
  if (s.length) {
    const mid = (s[0].x + s[s.length - 1].x + s[s.length - 1].w) / 2
    return run.view === 'victim' ? { left: mid, top: s[0].y - h * 0.8 } : { left: mid, top: s[0].y + s[0].h + h * 0.45 }
  }
  return { left: 0, top: 0 }
}

/** 決定性的「亂數」(同一張演出每次都一樣) */
const rnd = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return v - Math.floor(v)
}

// ---- 花色卡 ---------------------------------------------------------------

const SUIT_DUR = cardFxMs('suit') / 1000

/** 一張牌:浮起 → 特效 → 翻一圈換新花色 → 落回(可能排序後換了位置)→ 淡出露出真牌 */
function SuitRun({ it, suit, cardW, delay }: { it: Item; suit: Suit; cardW: number; delay: number }) {
  const h = cardW * 1.4
  const L = h * 0.5 // 浮起多高
  const cx = it.from.x + cardW / 2
  const cy = it.from.y + h / 2 - L
  const dx = it.to.x - it.from.x
  const dy = it.to.y - it.from.y
  const after = it.after ?? it.before
  useEffect(() => {
    const t = setTimeout(() => sfx.place(), (delay + SUIT_DUR * 0.6) * 1000)
    return () => clearTimeout(t)
  }, [delay])
  return (
    <>
      <motion.div
        className="card-fx__card"
        style={{ left: it.from.x, top: it.from.y, width: cardW, height: h }}
        initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
        animate={{
          x: [0, 0, 0, 0, dx, dx],
          y: [0, -L, -L, -L, dy, dy],
          scale: [1, 1.14, 1.14, 1.14, 1, 1],
          opacity: [1, 1, 1, 1, 1, 0],
        }}
        transition={{ delay, duration: SUIT_DUR - delay, times: [0, 0.12, 0.5, 0.74, 0.9, 1], ease: 'easeInOut' }}
      >
        <Flip before={<Card card={it.before} w={cardW} />} after={<Card card={after} w={cardW} />} at={[0.5, 0.6, 0.7]} dur={SUIT_DUR - delay} delay={delay} />
      </motion.div>
      {/* 特效畫在牌前面(箭、愛心、雪花才不會被牌蓋住) */}
      <SuitTheme suit={suit} cx={cx} cy={cy} cardW={cardW} delay={delay} />
    </>
  )
}

/** 翻牌:繞 Y 軸翻到 90° 那一瞬間換牌面,再翻回來。at = [開始, 翻到側面(換面), 翻完] 佔總長的比例 */
function Flip({ before, after, at, dur, delay }: { before: React.ReactNode; after: React.ReactNode; at: [number, number, number]; dur: number; delay: number }) {
  const [a, b, c] = at
  return (
    <motion.div
      className="card-fx__flip"
      initial={{ rotateY: 0 }}
      animate={{ rotateY: [0, 0, 90, 0, 0] }}
      transition={{ delay, duration: dur, times: [0, a, b, c, 1], ease: 'easeInOut' }}
    >
      <motion.div className="card-fx__face" initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0, 0] }} transition={{ delay, duration: dur, times: [0, b - 0.001, b, 1] }}>
        {before}
      </motion.div>
      <motion.div className="card-fx__face" initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 1, 1] }} transition={{ delay, duration: dur, times: [0, b - 0.001, b, 1] }}>
        {after}
      </motion.div>
    </motion.div>
  )
}

/** 各花色的特效(圍著浮起後的牌心 cx, cy) */
function SuitTheme({ suit, cx, cy, cardW, delay }: { suit: Suit; cx: number; cy: number; cardW: number; delay: number }) {
  const h = cardW * 1.4
  const D = SUIT_DUR - delay
  if (suit === 'C') {
    // 踏雪尋梅:雪花從上面飄下來 + 梅花瓣繞著牌轉
    return (
      <>
        {Array.from({ length: 14 }, (_, i) => {
          const x0 = cx + (rnd(i, 1) - 0.5) * cardW * 2.6
          const drift = (rnd(i, 2) - 0.5) * cardW * 0.8
          const s = 0.55 + rnd(i, 3) * 0.6
          return (
            <motion.span
              key={`snow-${i}`}
              className="card-fx__emoji"
              style={{ left: x0, top: cy - h * 1.6, fontSize: cardW * 0.45 * s }}
              initial={{ opacity: 0, x: 0, y: 0, rotate: 0 }}
              animate={{ opacity: [0, 1, 1, 0], x: [0, drift * 0.5, drift], y: [0, h * 1.2, h * 2.2], rotate: [0, 180, 360] }}
              transition={{ delay: delay + 0.1 + rnd(i, 4) * 0.7, duration: 1.3, ease: 'linear' }}
            >
              <span className="is-glow">❄️</span>
            </motion.span>
          )
        })}
        {Array.from({ length: 6 }, (_, i) => {
          const a0 = (i / 6) * Math.PI * 2
          const R = cardW * 0.95
          const pts = [0, 1, 2, 3].map((k) => a0 + k * 0.9)
          return (
            <motion.span
              key={`plum-${i}`}
              className="card-fx__emoji"
              style={{ left: cx, top: cy, fontSize: cardW * 0.3 }}
              initial={{ opacity: 0, x: 0, y: 0 }}
              animate={{ opacity: [0, 1, 1, 0], x: pts.map((a) => Math.cos(a) * R - cardW * 0.15), y: pts.map((a) => Math.sin(a) * R * 1.2 - cardW * 0.15), rotate: [0, 90, 180, 270] }}
              transition={{ delay: delay + 0.35, duration: 1.4, ease: 'easeInOut' }}
            >
              🌸
            </motion.span>
          )
        })}
      </>
    )
  }
  if (suit === 'D') {
    // 永恆鑽石:天上一道光降下來打在牌上 → 牌閃一下 + 四周亮晶晶
    return (
      <>
        <motion.div
          className="card-fx__beam"
          style={{ left: cx - cardW * 0.55, top: 0, width: cardW * 1.1, height: Math.max(0, cy + h * 0.55) }}
          initial={{ opacity: 0, scaleY: 0 }}
          animate={{ opacity: [0, 1, 1, 0], scaleY: [0, 1, 1, 1] }}
          transition={{ delay: delay + 0.25, duration: 1.6, times: [0, 0.3, 0.75, 1], ease: 'easeOut' }}
        />
        <motion.div
          className="card-fx__flash"
          style={{ left: cx - cardW, top: cy - cardW, width: cardW * 2, height: cardW * 2 }}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: [0, 0.9, 0], scale: [0.4, 1.3, 1.6] }}
          transition={{ delay: delay + 0.75, duration: 0.7, ease: 'easeOut' }}
        />
        {Array.from({ length: 9 }, (_, i) => {
          const a = (i / 9) * Math.PI * 2 + rnd(i, 5)
          const R = cardW * (0.8 + rnd(i, 6) * 0.5)
          return (
            <motion.span
              key={`spk-${i}`}
              className="card-fx__emoji"
              style={{ left: cx + Math.cos(a) * R - cardW * 0.14, top: cy + Math.sin(a) * R * 1.2 - cardW * 0.14, fontSize: cardW * 0.28 }}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: [0, 1, 0], scale: [0, 1.2, 0.6] }}
              transition={{ delay: delay + 0.9 + rnd(i, 7) * 0.9, duration: 0.6 }}
            >
              ✨
            </motion.span>
          )
        })}
      </>
    )
  }
  if (suit === 'H') {
    // 正中紅心:一支箭從左邊飛來射中牌 → 牌晃一下 → 愛心爆開
    const startX = cx - cardW * 3.2
    return (
      <>
        <motion.div
          className="card-fx__arrow"
          style={{ left: 0, top: 0, width: cardW * 1.2 }}
          initial={{ opacity: 0, x: startX, y: cy - cardW * 0.1 }}
          animate={{ opacity: [0, 1, 1, 1, 0], x: [startX, cx - cardW * 1.05, cx - cardW * 1.05, cx - cardW * 1.05, cx - cardW * 1.05] }}
          transition={{ delay: delay + 0.25, duration: 1.5, times: [0, 0.3, 0.5, 0.85, 1], ease: 'easeIn' }}
        >
          <span className="card-fx__arrow-shaft" />
          <span className="card-fx__arrow-tip" style={{ fontSize: cardW * 0.42 }}>
            💗
          </span>
        </motion.div>
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2
          const R = cardW * (1.05 + (i % 3) * 0.3)
          return (
            <motion.span
              key={`heart-${i}`}
              className="card-fx__emoji"
              style={{ left: cx - cardW * 0.2, top: cy - cardW * 0.2, fontSize: cardW * 0.42 }}
              initial={{ opacity: 0, x: 0, y: 0, scale: 0.4 }}
              animate={{ opacity: [0, 1, 0], x: [0, Math.cos(a) * R], y: [0, Math.sin(a) * R * 1.2], scale: [0.4, 1.1, 0.8] }}
              transition={{ delay: delay + 0.75 + rnd(i, 8) * 0.15, duration: 0.9, ease: 'easeOut' }}
            >
              {/* 牌桌是紅的,紅心會看不見 → 用粉紅亮色 + 白光暈(CSS .is-glow) */}
              <span className="is-glow">💖</span>
            </motion.span>
          )
        })}
      </>
    )
  }
  // 塊桃鴨:一隻小鴨從牌前面跑過去,喊「快逃呀～」(塊桃鴨 = 快逃呀的諧音)
  const y = cy + h * 0.42
  const x0 = cx - cardW * 2.4
  const x1 = cx + cardW * 2.4
  const hops = 8
  return (
    <motion.div
      className="card-fx__duck"
      style={{ left: 0, top: 0 }}
      initial={{ opacity: 0, x: x0, y }}
      animate={{
        opacity: [0, 1, 1, 1, 0],
        x: Array.from({ length: hops + 1 }, (_, k) => x0 + ((x1 - x0) * k) / hops),
        y: Array.from({ length: hops + 1 }, (_, k) => y - (k % 2 ? cardW * 0.12 : 0)),
      }}
      transition={{ delay: delay + 0.3, duration: Math.min(1.7, D - 0.4), ease: 'linear', opacity: { delay: delay + 0.3, duration: Math.min(1.7, D - 0.4), times: [0, 0.08, 0.5, 0.92, 1] } }}
    >
      <span className="card-fx__duck-body" style={{ fontSize: cardW * 0.55 }}>
        🦆
      </span>
      <span className="card-fx__bubble" style={{ fontSize: Math.max(11, cardW * 0.2) }}>
        快逃呀～
      </span>
    </motion.div>
  )
}

// ---- 偷天換日 -------------------------------------------------------------

const SWAP_DUR = cardFxMs('swap') / 1000

/** 牌飛進牌堆 → 牌堆洗一下 → 抽一張飛回來 → 翻開(連線 guest 還不知道新牌 → 牌背落下就淡出,露出真牌) */
function SwapRun({ it, deck, cardW, delay }: { it: Item; deck: Pt | null; cardW: number; delay: number }) {
  const h = cardW * 1.4
  const D = SWAP_DUR - delay
  const dk = deck ?? { x: it.from.x + cardW / 2, y: it.from.y - h * 2 }
  const toDeck = { x: dk.x - cardW / 2 - it.from.x, y: dk.y - h / 2 - it.from.y }
  const fromDeck = { x: dk.x - cardW / 2 - it.to.x, y: dk.y - h / 2 - it.to.y }
  useEffect(() => {
    const t1 = setTimeout(() => sfx.draw(1), (delay + D * 0.38) * 1000)
    const t2 = setTimeout(() => sfx.place(), (delay + D * 0.8) * 1000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [delay, D])
  return (
    <>
      {/* 舊牌:浮起 → 翻成牌背飛進牌堆 */}
      <motion.div
        className="card-fx__card"
        style={{ left: it.from.x, top: it.from.y, width: cardW, height: h }}
        initial={{ x: 0, y: 0, scale: 1, opacity: 1, rotate: 0 }}
        animate={{ x: [0, 0, toDeck.x], y: [0, -h * 0.35, toDeck.y], scale: [1, 1.1, 0.85], rotate: [0, 0, -12], opacity: [1, 1, 1, 0] }}
        transition={{ delay, duration: D * 0.36, times: [0, 0.3, 1], ease: 'easeInOut', opacity: { delay, duration: D * 0.38, times: [0, 0.3, 0.95, 1] } }}
      >
        <Flip before={<Card card={it.before} w={cardW} />} after={<CardBack w={cardW} />} at={[0.3, 0.5, 0.7]} dur={D * 0.36} delay={delay} />
      </motion.div>
      {/* 牌堆洗一下:三張牌背左右錯開又疊回去 */}
      {[0, 1, 2].map((k) => (
        <motion.div
          key={`shuf-${k}`}
          className="card-fx__card"
          style={{ left: dk.x - cardW / 2, top: dk.y - h / 2, width: cardW, height: h }}
          initial={{ opacity: 0, x: 0, rotate: 0 }}
          animate={{ opacity: [0, 1, 1, 1, 0], x: [0, (k - 1) * cardW * 0.55, (1 - k) * cardW * 0.45, 0, 0], rotate: [0, (k - 1) * 10, (1 - k) * 8, 0, 0] }}
          transition={{ delay: delay + D * 0.37, duration: D * 0.24, ease: 'easeInOut' }}
        >
          <CardBack w={cardW} />
        </motion.div>
      ))}
      {/* 新牌:從牌堆飛到手牌新位置 → 翻開 */}
      <motion.div
        className="card-fx__card"
        style={{ left: it.to.x, top: it.to.y, width: cardW, height: h }}
        initial={{ x: fromDeck.x, y: fromDeck.y, opacity: 0, scale: 0.85 }}
        animate={{ x: [fromDeck.x, fromDeck.x, 0, 0], y: [fromDeck.y, fromDeck.y, -h * 0.3, 0], opacity: [0, 1, 1, 1], scale: [0.85, 0.85, 1.1, 1] }}
        transition={{ delay: delay + D * 0.6, duration: D * 0.22, times: [0, 0.05, 0.8, 1], ease: 'easeOut' }}
      >
        <motion.div initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0] }} transition={{ delay: delay + D * 0.82, duration: D * 0.18, times: [0, 0.75, 1] }}>
          {it.after ? (
            <Flip before={<CardBack w={cardW} />} after={<Card card={it.after} w={cardW} />} at={[0.05, 0.3, 0.55]} dur={D * 0.18} delay={delay + D * 0.82} />
          ) : (
            <CardBack w={cardW} />
          )}
        </motion.div>
      </motion.div>
    </>
  )
}

// ---- 偷窺 -----------------------------------------------------------------

const PEEK_DUR = cardFxMs('peek') / 1000

/** 放大鏡在牌堆上繞一圈,要補的那幾張從牌堆掀起來(只看得到牌背,真牌面在播完後的彈窗裡) */
function PeekRun({ deck, count, cardW }: { deck: Pt; count: number; cardW: number }) {
  const h = cardW * 1.4
  const n = Math.max(1, Math.min(3, count))
  const M = cardW * 0.85
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        // 牌堆在畫面左上角 → 掀起的牌往右邊(牌桌中間)排開,不要往上飛出畫面
        const off = cardW * (1.25 + i * 0.85)
        const tilt = (i - (n - 1) / 2) * 6
        return (
          <motion.div
            key={`pk-${i}`}
            className="card-fx__card"
            style={{ left: deck.x - cardW / 2, top: deck.y - h / 2, width: cardW, height: h }}
            initial={{ opacity: 0, x: 0, y: 0, rotate: 0, scale: 0.9 }}
            animate={{ opacity: [0, 1, 1, 1, 0], x: [0, off * 0.4, off, off, off], y: [0, -h * 0.12, h * 0.05, h * 0.05, h * 0.05], rotate: [0, 0, tilt, tilt - 6, 0], scale: [0.9, 1, 1.05, 1.05, 1] }}
            transition={{ delay: 0.5 + i * 0.18, duration: PEEK_DUR - 0.5 - i * 0.18, times: [0, 0.2, 0.45, 0.8, 1], ease: 'easeOut' }}
          >
            <span className="card-fx__peek-corner" style={{ width: cardW * 0.45, height: cardW * 0.45 }} />
            <CardBack w={cardW} />
          </motion.div>
        )
      })}
      <motion.span
        className="card-fx__emoji card-fx__magnifier"
        style={{ left: deck.x - M / 2, top: deck.y - M / 2, fontSize: M }}
        initial={{ opacity: 0, x: 0, y: h * 0.5 }}
        animate={{
          opacity: [0, 1, 1, 1, 1, 0],
          // 先在牌堆上繞一下,再沿著掀起的牌由左往右掃過去
          x: [0, cardW * 0.4, cardW * 1.25, cardW * (1.25 + (n - 1) * 0.85), cardW * (1.25 + (n - 1) * 0.85), cardW * (1.25 + (n - 1) * 0.85)],
          y: [h * 0.5, -h * 0.1, h * 0.1, h * 0.1, h * 0.1, h * 0.1],
        }}
        transition={{ duration: PEEK_DUR, times: [0, 0.15, 0.4, 0.6, 0.85, 1], ease: 'easeInOut' }}
      >
        🔍
      </motion.span>
    </>
  )
}

// ---- 讓我看看 -------------------------------------------------------------

const SPY_DUR = cardFxMs('spy') / 1000

/** 自己用:一道探照燈從左掃到右,掃過的對手牌一張張翹起來發亮 */
function SpyRun({ slots, cardW }: { slots: Box[]; cardW: number }) {
  if (!slots.length) return null
  const h = cardW * 1.4
  const x0 = slots[0].x - cardW
  const x1 = slots[slots.length - 1].x + slots[slots.length - 1].w + cardW * 0.2
  const y = slots[0].y + slots[0].h / 2
  const sweep = SPY_DUR * 0.72
  return (
    <>
      {slots.map((s, i) => {
        const at = 0.2 + (sweep * (s.x + s.w / 2 - x0)) / Math.max(1, x1 - x0)
        return (
          <motion.div
            key={`glow-${i}`}
            className="card-fx__slot-glow"
            style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
            // 掃過之後一直亮著,到演出結束才熄(掃完整排都是亮的,看得出「全被看光了」)
            initial={{ opacity: 0, y: 0, rotate: 0 }}
            animate={{ opacity: [0, 1, 1, 0], y: [0, h * 0.12, 0, 0], rotate: [0, -6, 0, 0] }}
            transition={{ delay: at, duration: Math.max(0.6, SPY_DUR - at), times: [0, 0.15, 0.85, 1], ease: 'easeOut' }}
          />
        )
      })}
      <motion.div
        className="card-fx__spot"
        style={{ left: 0, top: y - h * 0.9, width: cardW * 2.2, height: h * 1.8 }}
        initial={{ opacity: 0, x: x0 - cardW * 1.1 }}
        animate={{ opacity: [0, 1, 1, 0], x: [x0 - cardW * 1.1, x0 - cardW * 1.1, x1 - cardW * 1.1, x1 - cardW * 1.1] }}
        transition={{ duration: SPY_DUR * 0.95, times: [0, 0.07, 0.07 + sweep / SPY_DUR, 1], ease: 'easeInOut' }}
      />
    </>
  )
}

/** 被看的那一方:自己手牌上一雙眼睛左看右看,牌一張張被照亮 */
function SpiedRun({ slots, cardW }: { slots: Box[]; cardW: number }) {
  if (!slots.length) return null
  const h = cardW * 1.4
  const left = slots[0].x
  const right = slots[slots.length - 1].x + slots[slots.length - 1].w
  const mid = (left + right) / 2
  const E = cardW * 0.9
  const span = Math.max(cardW, (right - left) / 2 - cardW * 0.4)
  return (
    <>
      {slots.map((s, i) => (
        <motion.div
          key={`sg-${i}`}
          className="card-fx__slot-glow is-victim"
          style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.9, 0] }}
          transition={{ delay: 0.35 + (i / Math.max(1, slots.length - 1)) * SPY_DUR * 0.55, duration: 0.8 }}
        />
      ))}
      <motion.span
        className="card-fx__emoji card-fx__eyes"
        style={{ left: mid - E / 2, top: slots[0].y - h * 0.62 - E / 2, fontSize: E }}
        initial={{ opacity: 0, scale: 0.4, x: 0 }}
        animate={{ opacity: [0, 1, 1, 1, 1, 0], scale: [0.4, 1.1, 1, 1, 1, 0.8], x: [0, 0, -span, span, 0, 0] }}
        transition={{ duration: SPY_DUR, times: [0, 0.1, 0.35, 0.65, 0.85, 1], ease: 'easeInOut' }}
      >
        👀
      </motion.span>
    </>
  )
}
