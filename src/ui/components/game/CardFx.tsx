import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { cardFxMs, useGameStore, type CardFxRun } from '../../../state/gameStore'
import type { PlayerId } from '../../../game/state'
import type { Card as TCard, Suit } from '../../../game/cards'
import { getSpecialCard, type SpecialCardId } from '../../../game/specialCards'
import Card from '../Card'
import CardBack from '../CardBack'
import { sfx } from '../../../audio/sfx'
import './CardFx.css'
import { canvasRect } from '../../../platform/canvas' // 畫布座標(假橫向轉過、網頁版縮過也對得上)

/**
 * 舊特殊卡的演出(2026-10-27 使用者定):
 *  - 四張花色卡:牌浮起 → 各自的特效(梅花=飄雪+梅花瓣、方塊=天上一道光降下來、紅心=一把弓射箭、黑桃=小鴨「快逃呀～」跑過)
 *    → 牌翻一圈換成新花色 → 落回手牌位置。2026-11-02 一次改 1~2 張:兩張同時播(兩道光、兩隻鴨、兩陣雪);
 *    紅心是同一把弓依序射兩箭,射中的牌同時爆愛心。
 *  - 偷天換日:牌飛進牌堆 → 牌堆洗一下 → 抽一張飛回來翻開。targets 可以多張(之後「選 1~3 張」)。
 *  - 偷窺:放大鏡在牌堆上掃,要補的那幾張從牌堆攤開、右上角掀起來(角真的缺一塊,看得到桌布)→ 播完才跳結果彈窗。
 *  - 讓我看看:探照燈掃過對手手牌 → 播完才跳結果彈窗;被看的那一方:自己手牌上一雙眼睛左看右看。
 * 誰看得到:自己用的自己看;讓我看看被看的人也看。對手用花色卡/偷天換日/偷窺(沒動到你)→ 你看不到(只有原本的提示)。
 * 回放(fx.replay,2026-11-02):雙方牌都看得到 → 上方玩家用的也播在上方手牌上;偷窺直接翻出看到的牌。
 * 只是疊一層演出:真牌在播放時先藏起來(新牌面已經算好了),播完就露出來。
 */

type Box = { x: number; y: number; w: number; h: number }
type Pt = { x: number; y: number }
type Side = 'hand' | 'ohand'
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
  /** victim = 被對手「讓我看看」(只有對局中;回放一律照用卡的人播) */
  view: 'self' | 'victim'
  /** 演出播在哪一排手牌(下方 = 我、上方 = 對手,只有回放會是上方) */
  side: Side
  /** 牌浮起的方向:往牌桌中間(下方那排往上 = -1、上方那排往下 = 1) */
  dir: 1 | -1
  items: Item[]
  deck: Pt | null
  foeSlots: Box[]
  mySlots: Box[]
}

/** 卡名標籤的顏色:跟卡片本身的主色相近(使用者 2026-11-02:不要木紋,像按鈕;強迫更新紫、爆破橘那樣) */
const LABEL_BG: Partial<Record<SpecialCardId, string>> = {
  swap: '#b07d1c',
  peek: '#3f7f3a',
  spy: '#a1233a',
  clubs: '#2f6d4f',
  diamonds: '#2b6cb0',
  hearts: '#d0355a',
  spades: '#33384a',
}

export default function CardFx({ me, cardW }: { me: PlayerId; cardW: number }) {
  const fx = useGameStore((s) => s.cardFx)
  const anchor = useRef<HTMLDivElement>(null)
  const seenN = useRef(fx?.n ?? 0)
  const snap = useRef<Record<Side, Map<string, Box>>>({ hand: new Map(), ohand: new Map() })
  const [run, setRun] = useState<Run | null>(null)

  const root = () => anchor.current?.parentElement ?? null
  /** 元素在 .game 內「未縮放」座標的停放位置(跟 ExplodeFx 同一套:用排版位置,不吃進行中的 transform) */
  const boxOf = (r: HTMLElement, el: Element): Box => {
    const rr = canvasRect(r.getBoundingClientRect())
    const k = r.offsetWidth ? rr.width / r.offsetWidth : 1
    const h = el as HTMLElement
    const p = h.offsetParent as HTMLElement | null
    if (!p) {
      const b = canvasRect(el.getBoundingClientRect())
      return { x: (b.left - rr.left) / k, y: (b.top - rr.top) / k, w: b.width / k, h: b.height / k }
    }
    const pr = canvasRect(p.getBoundingClientRect())
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
    for (const side of ['hand', 'ohand'] as const) {
      // 上方手牌只有回放 / 觀戰是翻開的(有 data-card-id);對局中是牌背,量不到也用不到
      r.querySelectorAll(`.game__${side} [data-card-id]`).forEach((el) => {
        const id = el.getAttribute('data-card-id')
        if (id) snap.current[side].set(id, boxOf(r, el))
      })
    }
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
    const mine = fx.by === me
    // 對局中:對手對自己手牌做的事 → 看不到;讓我看看被看的人看「被偷看」。回放:誰用的都照播。
    const view: Run['view'] | null = mine || fx.replay ? 'self' : fx.kind === 'spy' ? 'victim' : null
    if (!view) return
    const side: Side = mine ? 'hand' : 'ohand'
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
    const handC = center(`.game__${side}`) ?? { x: r.offsetWidth / 2, y: r.offsetHeight * (side === 'hand' ? 0.8 : 0.2) }
    const fallback: Box = { x: handC.x - cardW / 2, y: handC.y - cardH / 2, w: cardW, h: cardH }
    const items = (fx.targets ?? []).map((t) => {
      const from = snap.current[side].get(t.before.id) ?? fallback
      const el = t.after ? r.querySelector(`.game__${side} [data-card-id="${CSS.escape(t.after.id)}"]`) : null
      const to = el ? boxOf(r, el) : from
      return { ...t, from: { ...from, w: cardW, h: cardH }, to: { ...to, w: cardW, h: cardH } }
    })
    const slots = (sel: string) => [...r.querySelectorAll(sel)].map((el) => boxOf(r, el))
    setRun({
      fx,
      view,
      side,
      dir: side === 'hand' ? -1 : 1,
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
  // 讓我看看:被照的那一排(我用 → 上方對手;回放裡上方玩家用 → 下方)
  const spySlots = run ? (run.side === 'hand' ? run.foeSlots : run.mySlots) : []
  const spyDir = run?.side === 'hand' ? 1 : -1

  return (
    <div ref={anchor} className="card-fx" aria-hidden="true">
      {run && hideIds.length > 0 && (
        <style>{hideIds.map((id) => `.game__${run.side} [data-card-id="${CSS.escape(id!)}"]{visibility:hidden!important}`).join('')}</style>
      )}
      {run?.fx.kind === 'suit' && (
        <>
          {/* 1~2 張同時播(使用者 2026-11-02) */}
          {run.items.map((it, i) => <SuitRun key={`${run.fx.n}-${i}`} it={it} cardW={cardW} dir={run.dir} />)}
          <SuitTheme key={`th-${run.fx.n}`} suit={def?.suit ?? 'C'} centers={run.items.map((it) => suitCenter(it, cardW, run.dir))} cardW={cardW} dir={run.dir} />
        </>
      )}
      {run?.fx.kind === 'swap' &&
        run.items.map((it, i) => <SwapRun key={`${run.fx.n}-${i}`} it={it} deck={run.deck} cardW={cardW} delay={i * 0.18} dir={run.dir} />)}
      {run?.fx.kind === 'peek' && run.deck && <PeekRun key={run.fx.n} deck={run.deck} count={run.fx.count ?? 2} cards={run.fx.cards} cardW={cardW} />}
      {run?.fx.kind === 'spy' && run.view === 'self' && <SpyRun key={run.fx.n} slots={spySlots} cardW={cardW} dir={spyDir} />}
      {run?.fx.kind === 'spy' && run.view === 'victim' && <SpiedRun key={run.fx.n} slots={run.mySlots} cardW={cardW} />}
      {run && def && (
        <motion.div
          key={`label-${run.fx.n}`}
          className={`card-fx__label${run.view === 'victim' ? ' is-victim' : ''}${run.fx.card === 'hearts' || run.fx.card === 'spy' ? ' is-red' : ''}`}
          style={{ ...labelPos(run, cardW), ...(run.view === 'victim' ? {} : { background: LABEL_BG[run.fx.card] ?? '#555' }) }}
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

/** 卡名標籤放哪:花色/偷天換日 = 那幾張牌往牌桌中間那一側;偷窺 = 攤開那排牌下面;讓我看看 = 被看的那排旁邊 */
function labelPos(run: Run, cardW: number): { left: number; top: number } {
  const h = cardW * 1.4
  if ((run.fx.kind === 'suit' || run.fx.kind === 'swap') && run.items[0]) {
    const xs = run.items.map((it) => it.from.x + it.from.w / 2)
    const b = run.items[0].from
    const left = (Math.min(...xs) + Math.max(...xs)) / 2
    // 下方手牌:浮起的牌上方;上方手牌(回放):往下浮起的牌下方
    return { left, top: run.dir < 0 ? b.y - h * 0.95 : b.y + h * 1.95 }
  }
  // 牌堆在左上角:標籤放在掀起那排牌的下面(放上面會出畫面)
  if (run.fx.kind === 'peek' && run.deck) {
    const n = Math.max(1, Math.min(3, run.fx.count ?? 2))
    return { left: run.deck.x + cardW * (PEEK_X0 + ((n - 1) * PEEK_GAP) / 2), top: run.deck.y + h * 0.95 }
  }
  const lookAtMe = run.view === 'victim' || run.side === 'ohand'
  const s = lookAtMe ? run.mySlots : run.foeSlots
  if (s.length) {
    const mid = (s[0].x + s[s.length - 1].x + s[s.length - 1].w) / 2
    return lookAtMe ? { left: mid, top: s[0].y - h * 0.8 } : { left: mid, top: s[0].y + s[0].h + h * 0.45 }
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

/** 浮起多高(牌高的一半) */
const SUIT_LIFT = 0.5
/** 浮起後的牌心(特效圍著它播) */
const suitCenter = (it: Item, cardW: number, dir: number): Pt => {
  const h = cardW * 1.4
  return { x: it.from.x + cardW / 2, y: it.from.y + h / 2 + dir * h * SUIT_LIFT }
}

/** 一張牌:浮起(往牌桌中間)→ 特效 → 翻一圈換新花色 → 落回(可能排序後換了位置)→ 淡出露出真牌 */
function SuitRun({ it, cardW, dir }: { it: Item; cardW: number; dir: number }) {
  const h = cardW * 1.4
  const L = dir * h * SUIT_LIFT
  const dx = it.to.x - it.from.x
  const dy = it.to.y - it.from.y
  const after = it.after ?? it.before
  return (
    <motion.div
      className="card-fx__card"
      style={{ left: it.from.x, top: it.from.y, width: cardW, height: h }}
      initial={{ x: 0, y: 0, scale: 1 }}
      animate={{
        x: [0, 0, 0, 0, dx, dx],
        y: [0, L, L, L, dy, dy],
        scale: [1, 1.14, 1.14, 1.14, 1, 1],
      }}
      // 落回手牌位置後就停在那裡(不淡出),演出結束時跟真牌同一刻換掉 → 不會「消失一下再出現」(使用者 2026-11-02)
      transition={{ duration: SUIT_DUR, times: [0, 0.12, 0.5, 0.74, 0.9, 1], ease: 'easeInOut' }}
    >
      <Flip before={<Card card={it.before} w={cardW} />} after={<Card card={after} w={cardW} />} at={[0.5, 0.6, 0.7]} dur={SUIT_DUR} delay={0} />
    </motion.div>
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

/** 各花色的特效。centers = 每張被改的牌浮起後的牌心(1~2 張,同時播) */
function SuitTheme({ suit, centers, cardW, dir }: { suit: Suit; centers: Pt[]; cardW: number; dir: number }) {
  useEffect(() => {
    const t = setTimeout(() => sfx.place(), SUIT_DUR * 0.6 * 1000)
    return () => clearTimeout(t)
  }, [])
  if (!centers.length) return null
  if (suit === 'H') return <HeartsTheme centers={centers} cardW={cardW} dir={dir} />
  return (
    <>
      {centers.map((c, k) =>
        suit === 'C' ? (
          <SnowTheme key={k} cx={c.x} cy={c.y} cardW={cardW} seed={k * 37} />
        ) : suit === 'D' ? (
          <BeamTheme key={k} cx={c.x} cy={c.y} cardW={cardW} dir={dir} seed={k * 37} />
        ) : (
          <DuckTheme key={k} cx={c.x} cy={c.y} cardW={cardW} k={k} />
        ),
      )}
    </>
  )
}

/** 踏雪尋梅:雪花從上面飄下來 + 梅花瓣繞著牌轉 */
function SnowTheme({ cx, cy, cardW, seed }: { cx: number; cy: number; cardW: number; seed: number }) {
  const h = cardW * 1.4
  return (
    <>
      {Array.from({ length: 14 }, (_, i) => {
        const x0 = cx + (rnd(i + seed, 1) - 0.5) * cardW * 2.6
        const drift = (rnd(i + seed, 2) - 0.5) * cardW * 0.8
        const s = 0.55 + rnd(i + seed, 3) * 0.6
        return (
          <motion.span
            key={`snow-${i}`}
            className="card-fx__emoji"
            style={{ left: x0, top: cy - h * 1.6, fontSize: cardW * 0.45 * s }}
            initial={{ opacity: 0, x: 0, y: 0, rotate: 0 }}
            animate={{ opacity: [0, 1, 1, 0], x: [0, drift * 0.5, drift], y: [0, h * 1.2, h * 2.2], rotate: [0, 180, 360] }}
            transition={{ delay: 0.1 + rnd(i + seed, 4) * 0.7, duration: 1.3, ease: 'linear' }}
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
            transition={{ delay: 0.35, duration: 1.4, ease: 'easeInOut' }}
          >
            🌸
          </motion.span>
        )
      })}
    </>
  )
}

/** 永恆鑽石:天上一道光降下來打在牌上 → 牌閃一下 + 四周亮晶晶(上方手牌 = 光從畫面下緣往上打) */
function BeamTheme({ cx, cy, cardW, dir, seed }: { cx: number; cy: number; cardW: number; dir: number; seed: number }) {
  const h = cardW * 1.4
  const up = dir < 0
  return (
    <>
      <motion.div
        className="card-fx__beam"
        style={
          up
            ? { left: cx - cardW * 0.55, top: 0, width: cardW * 1.1, height: Math.max(0, cy + h * 0.55) }
            : { left: cx - cardW * 0.55, top: cy - h * 0.55, width: cardW * 1.1, height: h * 4, transformOrigin: '50% 100%', rotate: 180 }
        }
        initial={{ opacity: 0, scaleY: 0 }}
        animate={{ opacity: [0, 1, 1, 0], scaleY: [0, 1, 1, 1] }}
        transition={{ delay: 0.25, duration: 1.6, times: [0, 0.3, 0.75, 1], ease: 'easeOut' }}
      />
      <motion.div
        className="card-fx__flash"
        style={{ left: cx - cardW, top: cy - cardW, width: cardW * 2, height: cardW * 2 }}
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: [0, 0.9, 0], scale: [0.4, 1.3, 1.6] }}
        transition={{ delay: 0.75, duration: 0.7, ease: 'easeOut' }}
      />
      {Array.from({ length: 9 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2 + rnd(i + seed, 5)
        const R = cardW * (0.8 + rnd(i + seed, 6) * 0.5)
        return (
          <motion.span
            key={`spk-${i}`}
            className="card-fx__emoji"
            style={{ left: cx + Math.cos(a) * R - cardW * 0.14, top: cy + Math.sin(a) * R * 1.2 - cardW * 0.14, fontSize: cardW * 0.28 }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0, 1, 0], scale: [0, 1.2, 0.6] }}
            transition={{ delay: 0.9 + rnd(i + seed, 7) * 0.9, duration: 0.6 }}
          >
            ✨
          </motion.span>
        )
      })}
    </>
  )
}

/** 正中紅心的時間軸(秒):弓出現 → 每支箭 0.45 秒射到 → 第二支晚 0.4 秒 → 最後一支射中後所有牌同時爆愛心 */
const HEART_T = { bowIn: 0.1, first: 0.3, gap: 0.45, fly: 0.4 }

/**
 * 正中紅心:同一把弓依序射出箭(1~2 支),射中的牌最後同時爆愛心(使用者 2026-11-02)。
 * 弓一律在被射的牌中間、往牌桌中間那一側(1 張 = 正對那張往下射;2 張 = 兩張中間分別斜射,箭不會交叉疊到)。
 * 2026-11-02 使用者:1 張 / 2 張做法要一致(原本 1 張是從左邊平射)。
 */
function HeartsTheme({ centers, cardW, dir }: { centers: Pt[]; cardW: number; dir: number }) {
  const h = cardW * 1.4
  const A = cardW * 1.2 // 箭長
  const B = cardW * 0.75 // 弓大小
  const midX = centers.reduce((s, c) => s + c.x, 0) / centers.length
  // 弓在卡名標籤再過去一點(標籤在浮起的牌上方約 0.95 張牌高),不疊到標籤
  const bow: Pt = { x: midX, y: centers[0].y + dir * h * 1.75 }
  const shots = centers.map((c, i) => {
    const ang = Math.atan2(c.y - bow.y, c.x - bow.x)
    const ux = Math.cos(ang)
    const uy = Math.sin(ang)
    return {
      ang: (ang * 180) / Math.PI,
      // 箭尖從弓前面出發,停在牌面上(牌心往弓那邊退一點)
      from: { x: bow.x + ux * B * 0.5, y: bow.y + uy * B * 0.5 },
      to: { x: c.x - ux * cardW * 0.2, y: c.y - uy * cardW * 0.2 },
      at: HEART_T.first + i * HEART_T.gap,
    }
  })
  const burst = shots[shots.length - 1].at + HEART_T.fly
  // 🏹 圖本身朝右上(-45°)→ 轉到瞄準的角度
  const aim = shots.map((s) => s.ang + 45)
  const bowEnd = burst + 0.5
  return (
    <>
      <motion.span
        className="card-fx__emoji card-fx__bow"
        style={{ left: bow.x - B / 2, top: bow.y - B / 2, fontSize: B }}
        initial={{ opacity: 0, scale: 0.5, rotate: aim[0] }}
        animate={{
          opacity: [0, 1, 1, 1, 0],
          scale: [0.5, 1, 1, 1, 0.8],
          rotate: [aim[0], aim[0], aim[aim.length - 1], aim[aim.length - 1], aim[aim.length - 1]],
        }}
        transition={{
          duration: bowEnd,
          times: [0, HEART_T.bowIn / bowEnd, Math.max(HEART_T.bowIn, shots[shots.length - 1].at - 0.05) / bowEnd, burst / bowEnd, 1],
          ease: 'easeInOut',
        }}
      >
        🏹
      </motion.span>
      {shots.map((s, i) => (
        <motion.div
          key={`arrow-${i}`}
          className="card-fx__arrow"
          style={{ left: 0, top: 0, width: A, transformOrigin: '100% 50%', rotate: s.ang }}
          initial={{ opacity: 0, x: s.from.x - A, y: s.from.y }}
          animate={{ opacity: [0, 1, 1, 1, 0], x: [s.from.x - A, s.to.x - A, s.to.x - A, s.to.x - A, s.to.x - A], y: [s.from.y, s.to.y, s.to.y, s.to.y, s.to.y] }}
          transition={{ delay: s.at, duration: SUIT_DUR * 0.55 - s.at, times: [0, HEART_T.fly / (SUIT_DUR * 0.55 - s.at), 0.6, 0.9, 1], ease: 'easeIn' }}
        >
          <span className="card-fx__arrow-shaft" />
          <span className="card-fx__arrow-tip" style={{ fontSize: cardW * 0.42 }}>
            💗
          </span>
        </motion.div>
      ))}
      {centers.map((c, k) =>
        Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2
          const R = cardW * (1.05 + (i % 3) * 0.3)
          return (
            <motion.span
              key={`heart-${k}-${i}`}
              className="card-fx__emoji"
              style={{ left: c.x - cardW * 0.2, top: c.y - cardW * 0.2, fontSize: cardW * 0.42 }}
              initial={{ opacity: 0, x: 0, y: 0, scale: 0.4 }}
              animate={{ opacity: [0, 1, 0], x: [0, Math.cos(a) * R], y: [0, Math.sin(a) * R * 1.2], scale: [0.4, 1.1, 0.8] }}
              transition={{ delay: burst + rnd(i + k * 11, 8) * 0.15, duration: 0.9, ease: 'easeOut' }}
            >
              {/* 牌桌是紅的,紅心會看不見 → 用粉紅亮色 + 白光暈(CSS .is-glow) */}
              <span className="is-glow">💖</span>
            </motion.span>
          )
        }),
      )}
    </>
  )
}

/** 塊桃鴨:一隻小鴨從牌前面跑過去,喊「快逃呀～」(塊桃鴨 = 快逃呀的諧音) */
function DuckTheme({ cx, cy, cardW, k }: { cx: number; cy: number; cardW: number; k: number }) {
  const h = cardW * 1.4
  // 兩隻鴨(改 2 張)時第二隻跑低一點,對話泡泡才不會疊在一起
  // 整體往上提一點(使用者 2026-11-02:下方玩家第二隻太貼底)
  const y = cy + h * 0.42 - cardW * 0.22 + k * cardW * 0.45
  const x0 = cx - cardW * 2.4
  const x1 = cx + cardW * 2.4
  const hops = 8
  const D = Math.min(1.7, SUIT_DUR - 0.4)
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
      transition={{ delay: 0.3, duration: D, ease: 'linear', opacity: { delay: 0.3, duration: D, times: [0, 0.08, 0.5, 0.92, 1] } }}
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
function SwapRun({ it, deck, cardW, delay, dir }: { it: Item; deck: Pt | null; cardW: number; delay: number; dir: number }) {
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
        animate={{ x: [0, 0, toDeck.x], y: [0, dir * h * 0.35, toDeck.y], scale: [1, 1.1, 0.85], rotate: [0, 0, -12], opacity: [1, 1, 1, 0] }}
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
        animate={{ x: [fromDeck.x, fromDeck.x, 0, 0], y: [fromDeck.y, fromDeck.y, dir * h * 0.3, 0], opacity: [0, 1, 1, 1], scale: [0.85, 0.85, 1.1, 1] }}
        transition={{ delay: delay + D * 0.6, duration: D * 0.22, times: [0, 0.05, 0.8, 1], ease: 'easeOut' }}
      >
        {/* 落定後停在手牌位置不淡出,演出結束時跟真牌同一刻換掉(不會消失一下再出現) */}
        <div>
          {it.after ? (
            <Flip before={<CardBack w={cardW} />} after={<Card card={it.after} w={cardW} />} at={[0.05, 0.3, 0.55]} dur={D * 0.18} delay={delay + D * 0.82} />
          ) : (
            <CardBack w={cardW} />
          )}
        </div>
      </motion.div>
    </>
  )
}

// ---- 偷窺 -----------------------------------------------------------------

const PEEK_DUR = cardFxMs('peek') / 1000

/** 偷窺攤開的牌:第一張離牌堆多遠、每張間隔(牌寬倍數)。間隔 > 1 → 不重疊,每張右上角缺口都看得到 */
const PEEK_X0 = 1.25
const PEEK_GAP = 1.12

/**
 * 放大鏡在牌堆上繞一圈,要補的那幾張從牌堆攤開(彼此不重疊)→ 每張右上角掀起來:
 * 角真的缺一塊(看得到底下的桌布)+ 一小片往內折的白色牌角(使用者 2026-11-02:不畫點數)。
 * 對局中只看得到牌背,真牌面在播完後的彈窗裡;回放(cards 有給)最後直接翻開給觀眾看。
 */
function PeekRun({ deck, count, cards, cardW }: { deck: Pt; count: number; cards?: TCard[]; cardW: number }) {
  const h = cardW * 1.4
  const n = Math.max(1, Math.min(3, count))
  const M = cardW * 0.85
  const C = cardW * 0.36 // 掀起的角多大
  const cut = `polygon(0 0, ${cardW - C}px 0, ${cardW}px ${C}px, ${cardW}px ${h}px, 0 ${h}px)`
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        // 牌堆在畫面左上角 → 掀起的牌往右邊(牌桌中間)排開,不要往上飛出畫面
        const off = cardW * (PEEK_X0 + i * PEEK_GAP)
        const tilt = (i - (n - 1) / 2) * 4
        const delay = 0.5 + i * 0.18
        const dur = PEEK_DUR - delay
        const face = cards?.[i]
        // 牌背:先整張 → 掀起來時右上角缺一塊 + 往內折的白色牌角
        const back = (
          <>
            <motion.div className="card-fx__face" initial={{ opacity: 1 }} animate={{ opacity: [1, 1, 0, 0] }} transition={{ delay, duration: dur, times: [0, 0.4, 0.401, 1] }}>
              <CardBack w={cardW} />
            </motion.div>
            <motion.div className="card-fx__face" initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 1, 1] }} transition={{ delay, duration: dur, times: [0, 0.4, 0.401, 1] }}>
              <div style={{ clipPath: cut, width: cardW, height: h }}>
                <CardBack w={cardW} />
              </div>
              <motion.span
                className="card-fx__peek-flap"
                style={{ left: cardW - C, top: 0, width: C, height: C }}
                initial={{ scale: 0 }}
                animate={{ scale: [0, 0, 1, 1] }}
                transition={{ delay, duration: dur, times: [0, 0.4, 0.5, 1], ease: 'easeOut' }}
              />
            </motion.div>
          </>
        )
        return (
          <motion.div
            key={`pk-${i}`}
            className="card-fx__card"
            style={{ left: deck.x - cardW / 2, top: deck.y - h / 2, width: cardW, height: h }}
            initial={{ opacity: 0, x: 0, y: 0, rotate: 0, scale: 0.9 }}
            animate={{ opacity: [0, 1, 1, 1, 0], x: [0, off * 0.4, off, off, off], y: [0, -h * 0.12, h * 0.05, h * 0.05, h * 0.05], rotate: [0, 0, tilt, tilt, 0], scale: [0.9, 1, 1.05, 1.05, 1] }}
            transition={{ delay, duration: dur, times: [0, 0.2, 0.45, 0.8, 1], ease: 'easeOut' }}
          >
            {/* 回放(有 face):掀角之後整張翻過來給觀眾看(2026-11-02:原本淡入疊在切角牌上,看起來怪) */}
            {face ? <Flip before={back} after={<Card card={face} w={cardW} />} at={[0.5, 0.56, 0.62]} dur={dur} delay={delay} /> : back}
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
          x: [0, cardW * 0.4, cardW * PEEK_X0, cardW * (PEEK_X0 + (n - 1) * PEEK_GAP), cardW * (PEEK_X0 + (n - 1) * PEEK_GAP), cardW * (PEEK_X0 + (n - 1) * PEEK_GAP)],
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
function SpyRun({ slots, cardW, dir }: { slots: Box[]; cardW: number; dir: number }) {
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
            animate={{ opacity: [0, 1, 1, 0], y: [0, dir * h * 0.12, 0, 0], rotate: [0, -6, 0, 0] }}
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
