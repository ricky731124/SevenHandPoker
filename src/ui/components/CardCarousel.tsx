import type { ReactNode } from 'react'
import Button from './Button'
import './CardCarousel.css'

export type CarouselSlide = {
  key: string
  /** pre-sized visual (card art / avatar / sticker) */
  art: ReactNode
  name: string
  desc?: string
  /** small status line, e.g. 可用 / 對手未解鎖 / 未解鎖 / 已擁有 (omit to hide) */
  statusText?: string
  statusColor?: string
  /** can this be added via 確定 / double-tap? (usable cards only) */
  selectable?: boolean
  /** already in the loadout? → 確定 becomes 移除 */
  selected?: boolean
}

/**
 * A single-item viewer with < > navigation and an optional 取消/確定 footer.
 * Reused by the loadout / pre-match pick / avatar / sticker screens: single-tap
 * a card opens this; the arrows step through the same (filtered) list. When
 * `onConfirm` is omitted it's a pure viewer (e.g. stickers) — close via the
 * top-left back button or by tapping the backdrop.
 */
export default function CardCarousel({
  slides,
  index,
  onIndex,
  onClose,
  onConfirm,
  full = false,
}: {
  slides: CarouselSlide[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onConfirm?: (slide: CarouselSlide) => void
  /** loadout already full → 確定 disabled for not-yet-selected cards */
  full?: boolean
}) {
  if (index < 0 || index >= slides.length) return null
  const s = slides[index]
  const confirmDisabled = !s.selected && (!s.selectable || full)

  return (
    <div className="ccar" onClick={onClose}>
      <div className="ccar__panel" onClick={(e) => e.stopPropagation()}>
        {index > 0 && (
          <button className="ccar__nav ccar__nav--prev" onClick={() => onIndex(index - 1)} aria-label="上一張">
            ‹
          </button>
        )}
        {index < slides.length - 1 && (
          <button className="ccar__nav ccar__nav--next" onClick={() => onIndex(index + 1)} aria-label="下一張">
            ›
          </button>
        )}

        <div className="ccar__art">{s.art}</div>
        <div className="ccar__name">{s.name}</div>
        {s.statusText && (
          <div className="ccar__status" style={{ color: s.statusColor ?? 'var(--wood-700, #6a4e2c)' }}>
            {s.statusText}
          </div>
        )}
        {s.desc && <div className="ccar__desc">{s.desc}</div>}

        {onConfirm && (
          <div className="ccar__actions">
            <Button size="sm" variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button size="sm" disabled={confirmDisabled} onClick={() => onConfirm(s)}>
              {s.selected ? '移除' : '確定'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
