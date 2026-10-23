import { useId, useRef } from 'react'
import type { Suit } from '../../game/cards'
import { SPECIAL_CARDS, type SpecialCardDef } from '../../game/specialCards'
import { sfx } from '../../audio/sfx'
import './SpecialCard.css'

/**
 * A special (ability) card rendered as an actual illustrated card: a themed
 * scene + a name banner, in a frame accented by the card's colour. Reused by the
 * personalization loadout, the pre-match pick screen, and the in-game tray.
 */

/** Full illustrated face for a card id, drawn on a 0..100 canvas. */
export function SpecialCardArt({ id, color, uid: uidBase }: { id: string; color: string; uid: string }) {
  // 漸層 id 一定要每個實例唯一:同一張卡常同時出現兩份(出戰牌組 + 牌池),id 重複時 url(#…) 指到別份;
  // 取消選牌、那份被移除後 Chrome 不會改指另一份 → 卡面變黑(2026-10-23 使用者回報)。
  const uid = `${uidBase}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const g = (s: string) => `${s}-${uid}`
  return (
    <svg viewBox="0 0 100 118" width="100%" height="100%" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id={g('bg')} cx="50%" cy="38%" r="72%">
          <stop offset="0%" stopColor="#fffef9" />
          <stop offset="60%" stopColor="#fff8ea" />
          <stop offset="100%" stopColor={color} stopOpacity="0.22" />
        </radialGradient>
        <linearGradient id={g('accent')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} />
        </linearGradient>
      </defs>

      {/* scene background */}
      <rect x="0" y="0" width="100" height="118" fill={`url(#${g('bg')})`} />
      {/* faint corner rays for a bit of flair */}
      <g stroke={color} strokeOpacity="0.12" strokeWidth="3">
        <path d="M50 58 L8 20" />
        <path d="M50 58 L92 20" />
        <path d="M50 58 L14 96" />
        <path d="M50 58 L86 96" />
      </g>

      {id === 'swap' && <SwapArt color={color} />}
      {id === 'peek' && <PeekArt color={color} />}
      {id === 'spy' && <SpyArt color={color} />}
      {id === 'refresh' && <RefreshArt color={color} />}
      {id === 'explode' && <ExplodeArt color={color} />}
      {id === 'deathEye' && <DeathEyeArt color={color} uid={uid} />}
      {SPECIAL_CARDS[id as keyof typeof SPECIAL_CARDS]?.suit && (
        <SuitBloomArt suit={SPECIAL_CARDS[id as keyof typeof SPECIAL_CARDS].suit!} color={color} />
      )}
    </svg>
  )
}

/** 偷天換日 — two cards swapping, wrapped by exchange arrows. */
function SwapArt({ color }: { color: string }) {
  return (
    <g>
      {/* exchange arrows (cycle) */}
      <g fill="none" stroke={color} strokeWidth="4.5" strokeLinecap="round">
        <path d="M24 40 A 30 30 0 0 1 74 34" />
        <path d="M74 34 l-2 -9 9 3" strokeLinejoin="round" />
        <path d="M76 74 A 30 30 0 0 1 26 80" />
        <path d="M26 80 l2 9 -9 -3" strokeLinejoin="round" />
      </g>
      {/* back card (tilts right) */}
      <g transform="rotate(11 50 58)">
        <rect x="35" y="34" width="30" height="42" rx="5" fill="#fffdf5" stroke={color} strokeWidth="2.5" />
        <text x="50" y="60" textAnchor="middle" fontSize="20" fontWeight="900" fill={color}>◆</text>
      </g>
      {/* front card (tilts left) */}
      <g transform="rotate(-12 50 58)">
        <rect x="35" y="40" width="30" height="42" rx="5" fill="#ffffff" stroke={color} strokeWidth="2.5" />
        <text x="50" y="67" textAnchor="middle" fontSize="20" fontWeight="900" fill={color}>★</text>
      </g>
    </g>
  )
}

/** 偷窺 — a big eye peeking DOWN at your own fanned deck. */
function PeekArt({ color }: { color: string }) {
  return (
    <g>
      {/* fanned deck (card backs) at the bottom */}
      <g stroke={color} strokeWidth="2">
        <rect x="30" y="72" width="22" height="30" rx="4" fill={color} fillOpacity="0.85" transform="rotate(-14 41 87)" />
        <rect x="39" y="70" width="22" height="30" rx="4" fill={color} transform="rotate(0 50 85)" />
        <rect x="48" y="72" width="22" height="30" rx="4" fill={color} fillOpacity="0.85" transform="rotate(14 59 87)" />
      </g>
      {/* sight line */}
      <path d="M50 44 L50 64" stroke={color} strokeWidth="2.5" strokeDasharray="3 4" strokeLinecap="round" />
      {/* eye */}
      <path d="M22 36 Q50 14 78 36 Q50 58 22 36 Z" fill="#fffef9" stroke={color} strokeWidth="3" />
      <circle cx="50" cy="37" r="10" fill={color} />
      <circle cx="50" cy="42" r="4.5" fill="#1c1c1c" />
      <circle cx="46" cy="33" r="3" fill="#fff" />
    </g>
  )
}

/** 讓我看看 — a magnifier over the opponent's face-down hand, revealing a card. */
function SpyArt({ color }: { color: string }) {
  return (
    <g>
      {/* opponent fanned hand (backs) */}
      <g stroke={color} strokeWidth="2">
        <rect x="18" y="44" width="22" height="32" rx="4" fill={color} fillOpacity="0.85" transform="rotate(-18 29 60)" />
        <rect x="34" y="40" width="22" height="32" rx="4" fill={color} transform="rotate(-3 45 56)" />
        <rect x="50" y="44" width="22" height="32" rx="4" fill={color} fillOpacity="0.85" transform="rotate(12 61 60)" />
      </g>
      {/* magnifier — the lens reveals a card (a red pip), no letter */}
      <circle cx="60" cy="60" r="19" fill="#fffef9" fillOpacity="0.97" stroke={color} strokeWidth="4.5" />
      <path
        transform="translate(52 51) scale(0.66)"
        fill="#d21a3b"
        d="M12 21C12 21 2.8 14.4 2.8 8.4 2.8 5.2 5.2 3.2 8 3.2 10.1 3.2 11.5 4.7 12 5.9 12.5 4.7 13.9 3.2 16 3.2 18.8 3.2 21.2 5.2 21.2 8.4 21.2 14.4 12 21 12 21Z"
      />
      <ellipse cx="54" cy="54" rx="5" ry="3" fill="#fff" opacity="0.7" transform="rotate(-30 54 54)" />
      <path d="M74 74 L90 92" stroke={color} strokeWidth="8" strokeLinecap="round" />
    </g>
  )
}

/** 強迫更新 — the opponent's fanned hand (backs) caught in a big refresh loop,
 *  with an "updating…" progress bar underneath: their cards are being reloaded. */
function RefreshArt({ color }: { color: string }) {
  return (
    <g>
      {/* refresh loop: two arcs chasing each other, arrowheads at the ends */}
      <g fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 50 A 29 29 0 0 1 72 30" />
        <path d="M64 25 L73 30 L70 40" />
        <path d="M78 66 A 29 29 0 0 1 28 86" />
        <path d="M36 91 L27 86 L30 76" />
      </g>
      {/* opponent hand (backs), tumbling inside the loop */}
      <g stroke="#fffdf5" strokeWidth="1.6">
        <rect x="31" y="44" width="18" height="26" rx="3" fill={color} fillOpacity="0.8" transform="rotate(-22 40 57)" />
        <rect x="41" y="40" width="18" height="26" rx="3" fill={color} transform="rotate(4 50 53)" />
        <rect x="51" y="46" width="18" height="26" rx="3" fill={color} fillOpacity="0.8" transform="rotate(26 60 59)" />
      </g>
      {/* "updating" bar */}
      <rect x="26" y="100" width="48" height="8" rx="4" fill="#fffdf5" stroke={color} strokeWidth="1.8" />
      <rect x="28" y="102" width="30" height="4" rx="2" fill={color} />
    </g>
  )
}

/** 爆破 — a lit bomb in front of a starburst, with a playing card blown to pieces. */
function ExplodeArt({ color }: { color: string }) {
  return (
    <g>
      {/* starburst */}
      <path
        d="M50 22 L57 42 L77 34 L66 52 L86 60 L65 66 L72 88 L53 74 L44 94 L40 72 L18 80 L30 62 L12 52 L33 46 L26 26 L44 40 Z"
        fill="#ffd166"
        stroke={color}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* card fragments flying off */}
      <g stroke={color} strokeWidth="1.6" fill="#fffdf5">
        <path d="M14 30 l10 -4 3 9 -10 4 z" transform="rotate(-18 19 32)" />
        <path d="M80 24 l9 2 -2 10 -9 -2 z" transform="rotate(22 84 30)" />
        <path d="M78 88 l10 1 -1 8 -10 -1 z" />
      </g>
      {/* bomb */}
      <circle cx="47" cy="62" r="16" fill="#2b2b33" stroke="#fffdf5" strokeWidth="1.5" />
      <ellipse cx="41" cy="56" rx="4.5" ry="3" fill="#fff" opacity="0.45" transform="rotate(-30 41 56)" />
      <rect x="54" y="42" width="8" height="7" rx="1.5" fill="#55555f" transform="rotate(35 58 45)" />
      {/* fuse + spark */}
      <path d="M61 42 Q66 34 72 36" fill="none" stroke="#7a5230" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M72 36 l2 -5 1.5 5 5 1.5 -5 1.5 -1.5 5 -2 -5 -5 -1.5 z" fill="#ff7b00" stroke="#fff3c4" strokeWidth="0.8" />
    </g>
  )
}

/** 死神之眼 — 黑色兜帽裡一隻金色豎瞳的眼睛,金光往下掃,底下決鬥區的牌一張張被翻開。 */
function DeathEyeArt({ color, uid }: { color: string; uid: string }) {
  const iris = `deye-iris-${uid}`
  return (
    <g>
      <defs>
        <radialGradient id={iris} cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="50%" stopColor="#f5c542" />
          <stop offset="100%" stopColor="#b5560b" />
        </radialGradient>
      </defs>
      {/* 金光往下掃到牌上 */}
      <path d="M40 46 L16 84 L84 84 L60 46 Z" fill="#f5c542" fillOpacity="0.28" />
      {/* 兜帽 */}
      <path d="M50 10 Q78 14 80 46 Q70 54 50 54 Q30 54 20 46 Q22 14 50 10 Z" fill="#241a12" stroke={color} strokeWidth="2.5" />
      {/* 眼睛:杏仁眼 + 金色虹膜 + 豎瞳 */}
      <path d="M28 36 Q50 20 72 36 Q50 52 28 36 Z" fill="#120a04" stroke="#f5c542" strokeWidth="2" />
      <circle cx="50" cy="36" r="10" fill={`url(#${iris})`} />
      <ellipse cx="50" cy="36" rx="2.4" ry="8.5" fill="#120600" />
      <circle cx="46.5" cy="32" r="2" fill="#fff" opacity="0.9" />
      {/* 決鬥區的三張牌:兩張已翻開、一張正在翻 */}
      <g stroke={color} strokeWidth="1.8">
        <rect x="16" y="74" width="20" height="28" rx="3" fill="#fffdf5" />
        <rect x="40" y="74" width="20" height="28" rx="3" fill="#fffdf5" />
        <rect x="68" y="74" width="12" height="28" rx="3" fill={color} />
      </g>
      <text x="26" y="94" textAnchor="middle" fontSize="13" fontWeight="900" fill="#1c1c1c">♠</text>
      <text x="50" y="94" textAnchor="middle" fontSize="13" fontWeight="900" fill="#c0392b">♥</text>
    </g>
  )
}

/** Suit-bloom cards (梅花/方塊/紅心/黑桃) — the deck's own suit symbol, blooming
 *  with leaves + sparkles. The pip shape switches by suit; all share the frame. */
function SuitBloomArt({ suit, color }: { suit: Suit; color: string }) {
  return (
    <g>
      {/* leaves at the stem base */}
      <g fill={color} fillOpacity="0.5">
        <path d="M50 82 Q33 80 29 65 Q46 69 50 82 Z" />
        <path d="M50 82 Q67 80 71 65 Q54 69 50 82 Z" />
      </g>
      {/* the playing-card pip (drawn on a 0..24 box, then placed + scaled) */}
      <g transform="translate(6.8 8) scale(3.6)" fill={color}>
        <SuitPip suit={suit} />
      </g>
      {/* sparkles */}
      <g fill="#fffbe6" stroke={color} strokeWidth="1">
        <path d="M80 27 l2 4.6 4.6 2 -4.6 2 -2 4.6 -2 -4.6 -4.6 -2 4.6 -2 z" />
        <path d="M20 35 l1.5 3.4 3.4 1.5 -3.4 1.5 -1.5 3.4 -1.5 -3.4 -3.4 -1.5 3.4 -1.5 z" />
      </g>
    </g>
  )
}

/** A single suit pip drawn on a 0..24 canvas (fill inherited from the parent). */
function SuitPip({ suit }: { suit: Suit }) {
  if (suit === 'C') {
    return (
      <>
        <circle cx="12" cy="8.2" r="4.3" />
        <circle cx="8" cy="13.4" r="4.3" />
        <circle cx="16" cy="13.4" r="4.3" />
        <circle cx="12" cy="12.4" r="3.6" />
        <path d="M11 13.5h2l1 7.7h-4z" />
      </>
    )
  }
  if (suit === 'D') return <path d="M12 2 L20.5 12 L12 22 L3.5 12 Z" />
  if (suit === 'H') {
    return (
      <path d="M12 21 C7 16 3 13 3 8.5 C3 5.5 5.2 3.5 7.8 3.5 C9.6 3.5 11.2 4.6 12 6.2 C12.8 4.6 14.4 3.5 16.2 3.5 C18.8 3.5 21 5.5 21 8.5 C21 13 17 16 12 21 Z" />
    )
  }
  // Spade: an inverted heart with a stem.
  return (
    <path d="M12 3 C17 8 21 11 21 15.5 C21 18 19 19.6 16.8 19 C15.4 18.6 14 17.6 13.2 16.4 L14 21 H10 L10.8 16.4 C10 17.6 8.6 18.6 7.2 19 C5 19.6 3 18 3 15.5 C3 11 7 8 12 3 Z" />
  )
}

export default function SpecialCard({
  card,
  selected = false,
  order,
  locked = false,
  lockLabel = '未解鎖',
  w = 84,
  interactive = true,
  openOnSingle = false,
  onSelect,
  onView,
}: {
  card: SpecialCardDef
  selected?: boolean
  order?: number
  locked?: boolean
  /** text shown on the dim overlay when locked (e.g. 未解鎖 / 對手未解鎖) */
  lockLabel?: string
  w?: number
  /** false → a display-only card (no clicks, no button) — e.g. inside a slot */
  interactive?: boolean
  /** true → single tap opens the detail popup (onView), double tap selects (onSelect).
   *  Used by the loadout/pre-match pools. Default = single selects, double views. */
  openOnSingle?: boolean
  onSelect?: () => void
  onView?: () => void
}) {
  const h = Math.round(w * 1.4)
  const bannerFont = Math.max(9, Math.min(14, Math.round(w * 0.19)))
  // Distinguish single-click from double-click with a small counter — robust on
  // desktop AND touch, no native dblclick needed.
  const clicks = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleClick = () => {
    clicks.current += 1
    if (clicks.current === 1) {
      timer.current = setTimeout(() => {
        clicks.current = 0
        if (openOnSingle) { sfx.click(); onView?.() } // single → popup (even when locked)
        else if (!locked) onSelect?.() // single → select (default; onSelect owns its sound)
      }, 240)
    } else {
      if (timer.current) clearTimeout(timer.current)
      clicks.current = 0
      if (openOnSingle) {
        if (!locked) onSelect?.() // double → select (skip popup)
      } else {
        sfx.click()
        onView?.() // double → description (works even when locked)
      }
    }
  }

  const inner = (
    <>
      {order != null && <span className="spc__order">{order}</span>}
      <span className="spc__art">
        <SpecialCardArt id={card.id} color={card.accent} uid={card.id} />
      </span>
      <span className="spc__banner" style={{ fontSize: bannerFont }}>{card.name}</span>
      {locked && <span className="spc__lock">{lockLabel}</span>}
    </>
  )
  const style = { ['--accent' as string]: card.accent, width: w, height: h }

  if (!interactive) {
    return (
      <div className={`spc spc--static${selected ? ' spc--on' : ''}${locked ? ' spc--locked' : ''}`} style={style}>
        {inner}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={`spc${selected ? ' spc--on' : ''}${locked ? ' spc--locked' : ''}`}
      style={style}
      onClick={handleClick}
    >
      {inner}
    </button>
  )
}
