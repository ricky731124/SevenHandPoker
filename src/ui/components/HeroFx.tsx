import { useEffect, useId, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { getCanvas, subscribeCanvas } from '../../platform/canvas'
import { artRect, currentTheme, type ArtPoint } from '../theme/themes'
import { makeBlank, makeJoker, type Card as TCard, type Rank, type Suit } from '../../game/cards'
import { sfx } from '../../audio/sfx'
import Card from './Card'
import './HeroFx.css'

/**
 * 主圖特效層(主題 fx = 'cafe'),開場頁和大廳共用,疊在 HeroArt 上面:
 *   1. 貓鳥互動(只有開場頁):貓冒 😊 → 麻雀冒 💢 / 貓冒 💡 → 麻雀冒 ❗ / 貓冒 🎉 → 麻雀冒 😭;每 2 秒冒一個
 *   2. 蓋著的牌堆:光粒子往上飄;點一下彈出一張牌(正面,含空白 / 鬼牌),彈 1 秒、停 1 秒、淡 1 秒;
 *      點過光粒子消失,10 秒後回來才能再點
 *   3. Logo:火焰忽明忽暗 + 火星;每 12 秒一道白光掃過字和籌碼
 *   4. 吊燈的光暈慢慢、輕輕地晃
 *   5. 空中細小光點慢慢飄
 * 位置一律以「圖」為準(themes.ts 的原圖座標 → artRect 換算;網頁版寬畫面換寬版圖時用寬版圖那一套座標)。
 * 只用 transform / opacity 的 CSS 動畫;系統設定「減少動態效果」時整層不顯示(HeroFx.css)。
 */
type Sym = 'smile' | 'anger' | 'idea' | 'shock' | 'party' | 'cry'
const PAIRS: [cat: Sym, bird: Sym][] = [
  ['smile', 'anger'],
  ['idea', 'shock'],
  ['party', 'cry'],
]
/** 每隔多久冒一個符號(貓、麻雀輪流) */
const BUBBLE_GAP = 2000
/** 點牌堆抽過一張後,要等多久才能再點(光粒子回來) */
const DRAW_COOLDOWN = 10000

/** 抽到哪張:52 張一般牌 + 空白牌 + 鬼牌,機率一樣 */
function randomCard(): TCard {
  const i = Math.floor(Math.random() * 54)
  if (i === 52) return makeBlank('fx')
  if (i === 53) return makeJoker('fx')
  const suits: Suit[] = ['S', 'H', 'D', 'C']
  return { id: 'fx', suit: suits[i % 4], rank: ((i >> 2) + 2) as Rank }
}

/** bubbles = 貓鳥頭上冒符號(大廳不要,開場頁才有) */
export default function HeroFx({ bubbles = true }: { bubbles?: boolean }) {
  const theme = currentTheme()
  const fx = theme.fx === 'cafe'
  const c = useSyncExternalStore(subscribeCanvas, getCanvas)
  const [cat, setCat] = useState<{ sym: Sym; n: number } | null>(null)
  const [bird, setBird] = useState<{ sym: Sym; n: number } | null>(null)
  const [ready, setReady] = useState(true)
  const [drawn, setDrawn] = useState<{ n: number; card: TCard } | null>(null)

  // 貓先、麻雀接著,一對演完換下一對(不跟上一對重複);n 遞增讓同一個符號再冒一次時動畫重播
  useEffect(() => {
    if (!fx || !bubbles) return
    let n = 0
    let t = 0
    let last = -1
    const next = () => {
      let p = Math.floor(Math.random() * (PAIRS.length - 1))
      if (p >= last) p++
      if (last < 0) p = Math.floor(Math.random() * PAIRS.length)
      last = p
      const [a, b] = PAIRS[p]
      t = window.setTimeout(() => {
        setCat({ sym: a, n: ++n })
        t = window.setTimeout(() => {
          setBird({ sym: b, n: ++n })
          next()
        }, BUBBLE_GAP)
      }, BUBBLE_GAP)
    }
    next()
    return () => window.clearTimeout(t)
  }, [fx, bubbles])

  // 點牌堆抽一張:牌彈起來(正面)→ 停一下 → 淡掉;光粒子消失,DRAW_COOLDOWN 後才能再點
  useEffect(() => {
    if (ready) return
    const t = window.setTimeout(() => setReady(true), DRAW_COOLDOWN)
    return () => window.clearTimeout(t)
  }, [ready])
  const drawCard = () => {
    if (!ready) return
    sfx.unlock()
    sfx.select() // 選牌的音效(不用發牌 / 補牌那種)
    setReady(false)
    setDrawn((d) => ({ n: (d?.n ?? 0) + 1, card: randomCard() }))
  }

  if (!fx) return null
  const r = artRect(c.w, c.h, theme) // 用哪張圖(一般 / 寬版)、畫在哪裡
  const art = r.art
  const a = art.anchors
  const at = (p: ArtPoint): CSSProperties => ({ left: `${(p[0] / art.w) * 100}%`, top: `${(p[1] / art.h) * 100}%` })
  const box = ([x, y, w, h]: readonly number[]): CSSProperties => ({
    left: `${(x / art.w) * 100}%`,
    top: `${(y / art.h) * 100}%`,
    width: `${(w / art.w) * 100}%`,
    height: `${(h / art.h) * 100}%`,
  })
  const mask = `url(${import.meta.env.BASE_URL}${a.logo.mask})`

  return (
    <div className="sfx" style={{ left: r.x, top: r.y, width: r.w, height: r.h, ['--ah' as string]: `${r.h}px` }} aria-hidden>
      {a.lamps.map((p, i) => (
        <span key={i} className="sfx-lamp" style={{ ...at(p), animationDelay: `${-i * 2.3}s` }} />
      ))}
      {SPECKS.map((s, i) => (
        <span key={i} className="sfx-speck" style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s`, animationDuration: `${s.t}s` }} />
      ))}
      <div className="sfx-fire" style={at(a.fire)}>
        <span className="sfx-fire__glow" />
        {EMBERS.map((e, i) => (
          <span key={i} className="sfx-ember" style={{ ['--dx' as string]: e.dx, animationDelay: `${e.d}s`, animationDuration: `${e.t}s`, left: e.x }} />
        ))}
      </div>
      <div
        className="sfx-logo"
        style={{ ...box(a.logo.box), WebkitMaskImage: mask, maskImage: mask }}
      >
        <span className="sfx-logo__band" />
      </div>
      {/* 牌堆:點擊範圍;抽到的牌從牌堆中間彈起來 */}
      <div className={`sfx-deckbox${ready ? ' is-ready' : ''}`} style={box(a.deckBox)} onClick={drawCard}>
        {drawn && (
          <span key={drawn.n} className="sfx-draw">
            <Card card={drawn.card} w={Math.round(r.h * 0.1)} />
          </span>
        )}
      </div>
      {ready && (
        <div className="sfx-deck" style={at(a.deck)}>
          {MOTES.map((m, i) => (
            <span key={i} className="sfx-mote" style={{ ['--dx' as string]: m.dx, animationDelay: `${m.d}s`, animationDuration: `${m.t}s`, left: m.x }} />
          ))}
        </div>
      )}
      {bubbles && cat && (
        <span key={cat.n} className="sfx-bub" style={at(a.cat)}>
          <Symbol sym={cat.sym} />
        </span>
      )}
      {bubbles && bird && (
        <span key={bird.n} className="sfx-bub" style={at(a.bird)}>
          <Symbol sym={bird.sym} />
        </span>
      )}
    </div>
  )
}

// 固定的亂數表(每次長得一樣,截圖比對才穩)
function table<T>(n: number, seed: number, make: (r: () => number) => T): T[] {
  let s = seed
  const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  return Array.from({ length: n }, () => make(r))
}
const SPECKS = table(16, 7, (r) => ({ x: 4 + r() * 92, y: 6 + r() * 70, d: -r() * 9, t: 7 + r() * 5 }))
// x = 在火焰 / 牌堆那一塊裡的橫向位置;dx = 往上飄時左右偏多少(粒子自己寬度的百分比)
const EMBERS = table(8, 11, (r) => ({ x: `${15 + r() * 70}%`, dx: `${(r() - 0.5) * 600}%`, d: -r() * 3, t: 2 + r() * 1.6 }))
const MOTES = table(10, 23, (r) => ({ x: `${5 + r() * 90}%`, dx: `${(r() - 0.5) * 500}%`, d: -r() * 4, t: 2.6 + r() * 1.8 }))

/** 大哭臉(照 😭 畫):眼睛瞇成 ∩、嘴巴張大、兩道眼淚從眼睛一路流到下巴 */
function Cry() {
  const clip = `sfx-cry-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 40 40">
      <defs>
        <clipPath id={clip}>
          <circle cx="20" cy="20" r="16" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="16" fill="#ffcc3d" stroke="#fff" strokeWidth="4" />
      <g clipPath={`url(#${clip})`}>
        {/* 眼淚:眼睛下緣往下變寬,流出臉的下緣 */}
        <path d="M8.6 17.6h7l1.6 20H6.4z" fill="#3ea6ee" />
        <path d="M24.4 17.6h7l2.2 20H22.8z" fill="#3ea6ee" />
        <path d="M10.4 19.5l-.9 16M26.2 19.5l-.6 16" stroke="#9ad6ff" strokeWidth="1.3" strokeLinecap="round" />
      </g>
      <circle cx="20" cy="20" r="16" fill="none" stroke="#c98a12" strokeWidth="1.8" />
      {/* 八字眉 */}
      <path d="M9.5 12.6l5-2M30.5 12.6l-5-2" stroke="#6b3a0c" strokeWidth="1.8" strokeLinecap="round" />
      {/* 閉著的眼睛 ∩ */}
      <path d="M8.8 18q3.3-4.2 6.6 0M24.6 18q3.3-4.2 6.6 0" fill="none" stroke="#6b3a0c" strokeWidth="2.3" strokeLinecap="round" />
      {/* 哇哇大哭的嘴:上緣拱起、嘴角往下(∩ 形),舌頭在下緣 */}
      <path d="M13 31.6Q12.8 23 20 22.6Q27.2 23 27 31.6Q20 29.4 13 31.6Z" fill="#6b2a0c" />
      <path d="M15.6 30.9Q20 26.8 24.4 30.9Q20 29.6 15.6 30.9Z" fill="#f2667a" />
    </svg>
  )
}

/** 漫畫風符號(自己畫,各平台長得一樣;emoji 在 iPhone / 安卓 / 電腦都不同)。外圈白邊讓它在圖上看得清楚。 */
function Symbol({ sym }: { sym: Sym }) {
  if (sym === 'anger') {
    const d = 'M15 5 Q15 15 5 15 M25 5 Q25 15 35 15 M15 35 Q15 25 5 25 M25 35 Q25 25 35 25'
    return (
      <svg viewBox="0 0 40 40">
        <path d={d} fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" />
        <path d={d} fill="none" stroke="#e0322b" strokeWidth="5" strokeLinecap="round" />
      </svg>
    )
  }
  if (sym === 'shock') {
    return (
      <svg viewBox="0 0 40 40">
        <path d="M20 5 L20 25" stroke="#fff" strokeWidth="12" strokeLinecap="round" />
        <circle cx="20" cy="34" r="5.5" fill="#fff" />
        <path d="M20 5 L20 25" stroke="#e0322b" strokeWidth="7" strokeLinecap="round" />
        <circle cx="20" cy="34" r="3.6" fill="#e0322b" />
      </svg>
    )
  }
  if (sym === 'idea') {
    return (
      <svg viewBox="0 0 40 40">
        <g stroke="#fff" strokeWidth="6" strokeLinecap="round">
          <path d="M20 2v3M6 8l2.5 2.5M34 8l-2.5 2.5M2 20h3M35 20h3" />
        </g>
        <g stroke="#f6b81f" strokeWidth="2.6" strokeLinecap="round">
          <path d="M20 2v3M6 8l2.5 2.5M34 8l-2.5 2.5M2 20h3M35 20h3" />
        </g>
        <path d="M20 9a10 10 0 0 0-6 18v4h12v-4a10 10 0 0 0-6-18z" fill="#ffe066" stroke="#fff" strokeWidth="4" strokeLinejoin="round" paintOrder="stroke" />
        <path d="M20 9a10 10 0 0 0-6 18v4h12v-4a10 10 0 0 0-6-18z" fill="#ffe066" stroke="#c98a12" strokeWidth="1.8" strokeLinejoin="round" />
        <rect x="15" y="31" width="10" height="5" rx="1.5" fill="#9a8f80" stroke="#fff" strokeWidth="1.5" />
      </svg>
    )
  }
  if (sym === 'party') {
    // 拉炮:左下往右上噴,彩帶 + 紙花
    const cone = 'M4 36 L13 15 L25 27 Z'
    return (
      <svg viewBox="0 0 40 40">
        <path d={cone} fill="#fff" stroke="#fff" strokeWidth="5" strokeLinejoin="round" />
        <path d={cone} fill="#ffb43a" stroke="#c46a10" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8.4 25.6 L16.6 18.4 M6.2 30.8 L21 24" stroke="#e8432e" strokeWidth="2.6" strokeLinecap="round" />
        <g fill="none" strokeWidth="2.6" strokeLinecap="round">
          <path d="M18 14 Q20 8 16 4" stroke="#fff" strokeWidth="5" />
          <path d="M18 14 Q20 8 16 4" stroke="#3aa0f0" />
          <path d="M26 22 Q32 21 35 15" stroke="#fff" strokeWidth="5" />
          <path d="M26 22 Q32 21 35 15" stroke="#ec4f9a" />
        </g>
        <g stroke="#fff" strokeWidth="1.4" paintOrder="stroke">
          <rect x="24" y="5" width="4.5" height="4.5" rx="1" fill="#f6c21c" transform="rotate(25 26 7)" />
          <circle cx="33" cy="8" r="2.4" fill="#e8432e" />
          <rect x="29" y="27" width="4.5" height="4.5" rx="1" fill="#4fbf5a" transform="rotate(-20 31 29)" />
          <circle cx="23" cy="13" r="2" fill="#3aa0f0" />
          <circle cx="36" cy="22" r="1.8" fill="#f6c21c" />
        </g>
      </svg>
    )
  }
  if (sym === 'cry') return <Cry />

  // smile
  return (
    <svg viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="16" fill="#ffd54a" stroke="#fff" strokeWidth="4" />
      <circle cx="20" cy="20" r="16" fill="none" stroke="#c98a12" strokeWidth="1.8" />
      <path d="M12.5 17.5q2.5-3 5 0M22.5 17.5q2.5-3 5 0" fill="none" stroke="#6b3a0c" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M13 23q7 7 14 0" fill="none" stroke="#6b3a0c" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="11" cy="23.5" r="2.3" fill="#ff8a7a" opacity="0.7" />
      <circle cx="29" cy="23.5" r="2.3" fill="#ff8a7a" opacity="0.7" />
    </svg>
  )
}
