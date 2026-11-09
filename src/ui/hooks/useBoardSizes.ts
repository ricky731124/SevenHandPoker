import { useSyncExternalStore } from 'react'
import { getCanvas, subscribeCanvas } from '../../platform/canvas'

export interface BoardSizes {
  /** uniform playing-card width used everywhere on the table */
  card: number
  coin: number
  avatar: number
  /** left reserve zone width (menu / my avatar / deck) */
  reserve: number
  /** right reserve for the hands — wide enough to clear the submit button */
  rightReserve: number
  /** max width available to a hand row */
  handMax: number
  /** narrowed width of the 7-slot band (frames closer together) */
  bandWidth: number
  /** width of the board box; == canvas on phones, capped on desktop (centred) */
  stageW: number
  /** height of the board box; == canvas on phones, capped on desktop (centred) */
  stageH: number
}

const clamp = (a: number, x: number, b: number) => Math.max(a, Math.min(x, b))

/**
 * Bounded-fluid layout. Phones lay out against the canvas (= the phone's full-screen
 * landscape size, see platform/canvas.ts — fake-landscape / browser-tab shrink are
 * handled by the canvas as a whole, so this never sees them). Above WCAP the board's
 * *width* is frozen so the 7 slots stop spreading across a wide desktop (the "ocean
 * gaps"); the board is then centred with felt showing on both sides (see Game.css).
 * WCAP sits above every phone-landscape width, so for phones `ew === vw`.
 */
const WCAP = 1000
// Height cap: above this the board box stops growing and is centred vertically,
// so a tall desktop doesn't leave the hands stranded far from the centre band.
// Sits above every phone-landscape height, so phones lay out at full height.
const HCAP = 580

function calc(vw: number, vh: number): BoardSizes {
  // Effective width the board is laid out against (bounded on desktop only).
  const ew = Math.min(vw, WCAP)
  // 手機網頁版的畫布寬度會補滿(可能 > 1000),但高度只有手機那麼高 → 高度也要夠才算電腦,
  // 不然牌放大到 66 會跟對決區、上方的牌擠在一起。
  const desktop = vw > WCAP && vh > 480

  const avatar = Math.round(clamp(50, vh * 0.17, 108))
  // left clears the avatar (incl. its margin) + a little; right must also clear
  // the wider submit button.
  // The avatar is centred inside the fixed ~110px name field, so it sits a little
  // inward of the field's pinned edge; +36 clears that (plus the active-turn halo)
  // so the avatar never overlaps the hand.
  const reserve = Math.round(clamp(88, avatar + 40, 158))
  const rightReserve = Math.round(Math.max(reserve, clamp(110, ew * 0.145, 156)))
  const handMax = Math.round(ew - reserve - rightReserve - 6)

  // Card size: capped at 54 on phones (avoids over-tall stacks); desktop may go
  // a touch larger (66) so the centred table doesn't look tiny. The cap only
  // rises above WCAP, so phones are unaffected. Also limited by height and by
  // "10 cards fit the hand without overlap".
  // 窄畫布(< 1.9:1,只有手機網頁直拿、iPhone SE 這類 16:9)牌之間只留 2px(原 6px),牌從 42 回到約 46,
  // 上下才不會空太多;一般手機全螢幕(≥ 2:1)、電腦照舊。
  const cardGap = !desktop && vw / vh < 1.9 ? 2 : 6
  const hCard = (handMax - cardGap * 9) / 10
  const cardCap = desktop ? 66 : 54
  const card = Math.round(clamp(36, Math.min(vh * 0.15, ew * 0.078, hCard), cardCap))

  return {
    card,
    coin: Math.round(clamp(28, Math.min(vh * 0.1, card * 0.86), 58)),
    avatar,
    reserve,
    rightReserve,
    handMax,
    // narrow the 7-slot band (piles stack now, so frames can be closer)
    bandWidth: Math.round(0.85 * (ew - 2 * reserve)),
    stageW: ew,
    stageH: Math.min(vh, HCAP),
  }
}

// 畫布沒變就回同一個物件(useSyncExternalStore 要求快照穩定)
let memo: { w: number; h: number; v: BoardSizes } | null = null
function snapshot(): BoardSizes {
  const { w, h } = getCanvas()
  if (!memo || memo.w !== w || memo.h !== h) memo = { w, h, v: calc(w, h) }
  return memo.v
}

/** Fluid, full-bleed board element sizes derived from the canvas. */
export default function useBoardSizes(): BoardSizes {
  return useSyncExternalStore(subscribeCanvas, snapshot)
}
