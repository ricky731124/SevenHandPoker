import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../state/appStore'
import { useCampaignStore } from '../../state/campaignStore'
import { usePlatformStore } from '../../state/platformStore'
import { getSpecialCard } from '../../game/specialCards'
import type { CampaignStage } from '../../game/campaign'
import {
  CHAPTERS,
  CHAPTER_MAP_ASPECT,
  CHAPTER_NUMERALS,
  chapterClearedCount,
  chapterMapUrl,
  chapterStages,
  focusForChapter,
  frontierFocus,
  getChapter,
  initialFocus,
  isChapterUnlocked,
  type Chapter,
} from '../../game/chapters'
import { isStageUnlocked } from '../../game/campaign'
import PlayerAvatar from '../components/PlayerAvatar'
import BackButton from '../components/BackButton'
import { SpecialCardArt } from '../components/SpecialCard'
import ChapterStageCard from '../components/game/ChapterStageCard'
import { CHAPTER_THUMBS } from './chapterThumbs'
import { sfx } from '../../audio/sfx'
import './ChapterMap.css'

/**
 * 主線章節大地圖(2026-10-16):一章 7 關一張橫向長圖,左右捲。進場捲到玩家現在該打的那關
 * (從小關地圖返回 → 捲到剛剛那關)。左側三顆懸浮按鈕切章;點節點彈關卡資訊卡,按「進入」才到
 * 原本的三小關地圖(CampaignMap,完全沒動)。滑鼠可拖曳、滾輪可橫移,底下是木色捲軸。
 */
export default function ChapterMap() {
  const go = useAppStore((s) => s.go)
  const viewStageId = useCampaignStore((s) => s.viewStageId)
  const clearedAt = usePlatformStore((s) => s.profile?.progress.stageClearedAt)
  const tutorialSeen = usePlatformStore((s) => s.profile?.tutorialSeen ?? false)
  const myAvatar = usePlatformStore((s) => s.profile?.equipped.avatar) ?? 'cat'
  const clearedKey = Object.keys(clearedAt ?? {}).sort().join(',')
  const cleared = useMemo(() => (clearedKey ? clearedKey.split(',') : []), [clearedKey])

  // 進場要看哪章、捲到哪(只算一次;之後切章另外算)
  const [focus, setFocus] = useState(() => initialFocus(viewStageId, cleared, tutorialSeen) as { chapter: number; target: string })
  const chapter = getChapter(focus.chapter) ?? CHAPTERS[0]
  const [cardStage, setCardStage] = useState<CampaignStage | null>(null)

  const frontier = frontierFocus(cleared, tutorialSeen)
  const stages = chapterStages(chapter)

  // ---- 尺寸:圖高 = 畫面高,寬照比例;畫面比圖還寬(超寬螢幕)就改成寬貼滿、上下裁 ----
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const worldW = Math.max(box.w, Math.round(box.h * CHAPTER_MAP_ASPECT))
  const worldH = Math.round(worldW / CHAPTER_MAP_ASPECT)
  const nodePx = Math.round(Math.min(140, Math.max(54, worldH * 0.15)))

  // ---- 捲到焦點(進場 / 切章 / 視窗改大小時) ----
  const scrollToFocus = useCallback(() => {
    const el = scrollerRef.current
    if (!el || !worldW) return
    let x = 0
    if (focus.target === 'tutorial' && chapter.tutorial) x = chapter.tutorial.x
    else if (focus.target !== 'start') {
      const i = stages.findIndex((s) => s?.id === focus.target)
      if (i >= 0) x = chapter.nodes[i].x
    }
    el.scrollLeft = x ? (x / 100) * worldW - el.clientWidth / 2 : 0
  }, [focus, chapter, stages, worldW])
  useLayoutEffect(() => { scrollToFocus() }, [focus, worldW]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 滑鼠拖曳 + 滾輪橫移(觸控用原生捲動,有慣性) ----
  const dragged = useRef(false)
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    let startX = 0
    let startLeft = 0
    let down = false
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      down = true
      dragged.current = false
      startX = e.clientX
      startLeft = el.scrollLeft
    }
    const onMove = (e: PointerEvent) => {
      if (!down) return
      const dx = e.clientX - startX
      if (!dragged.current && Math.abs(dx) > 6) {
        dragged.current = true
        el.classList.add('is-dragging')
      }
      if (dragged.current) el.scrollLeft = startLeft - dx
    }
    const onUp = () => {
      if (!down) return
      down = false
      el.classList.remove('is-dragging')
    }
    // 拖完放開不算點擊(不然拖到節點上放開會打開資訊卡)
    const onClickCapture = (e: MouseEvent) => {
      if (dragged.current) {
        e.stopPropagation()
        e.preventDefault()
        dragged.current = false
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('click', onClickCapture, true)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('click', onClickCapture, true)
    }
  }, [])

  // ---- 地圖圖:先放極小模糊圖,清楚的載完再淡入 ----
  const imgRef = useRef<HTMLImageElement>(null)
  const [loadedSrc, setLoadedSrc] = useState('')
  const src = chapterMapUrl(chapter)
  useLayoutEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth) setLoadedSrc(src)
  }, [src])

  const switchChapter = (ch: Chapter) => {
    if (ch.index === chapter.index) return
    setCardStage(null)
    setFocus(focusForChapter(ch.index, cleared, tutorialSeen))
  }

  // 棋子:站在現在那關上方;還沒看教學 → 站在教學木牌右邊的帳篷前(木牌在圖上方,站頭上會撞到章名;
  // 站左下又太靠近第 1 關,看起來像在第 1 關)
  const pawnAt =
    frontier.chapter !== chapter.index
      ? null
      : frontier.target === 'tutorial'
        ? chapter.tutorial
          ? { x: chapter.tutorial.x + 6.5, y: chapter.tutorial.y + 8 }
          : null
        : chapter.nodes[stages.findIndex((s) => s?.id === frontier.target)] ?? null

  return (
    <div className="chmap">
      <div className="chmap__scroller" ref={scrollerRef}>
        <div
          key={chapter.index}
          className="chmap__world"
          style={{ width: worldW, height: worldH, top: Math.min(0, (box.h - worldH) / 2) }}
        >
          <img className="chmap__thumb" src={CHAPTER_THUMBS[chapter.index]} alt="" draggable={false} />
          <img
            ref={imgRef}
            className={`chmap__img${loadedSrc === src ? ' is-loaded' : ''}`}
            src={src}
            alt=""
            draggable={false}
            onLoad={() => setLoadedSrc(src)}
          />

          {chapter.tutorial && (
            <button
              type="button"
              className={`chmap__tutorial${!tutorialSeen ? ' is-current' : ''}`}
              style={{ left: `${chapter.tutorial.x}%`, top: `${chapter.tutorial.y}%`, fontSize: Math.round(nodePx * 0.27) }}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') sfx.hover() }}
              onClick={() => { sfx.click(); go('tutorial') }}
            >
              新手教學
            </button>
          )}

          {chapter.nodes.map((pos, i) => {
            const stage = stages[i]
            const style = { left: `${pos.x}%`, top: `${pos.y}%` }
            if (!stage) return <ComingSoon key={i} style={style} size={nodePx} />
            return (
              <StageNode
                key={stage.id}
                stage={stage}
                style={style}
                size={nodePx}
                cleared={cleared}
                unlocked={isStageUnlocked(stage, cleared, tutorialSeen)}
                current={frontier.target === stage.id}
                onOpen={() => { sfx.click(); setCardStage(stage) }}
              />
            )
          })}

          {pawnAt && (
            <div
              className={`chmap__pawn${frontier.target === 'tutorial' ? ' is-free' : ''}`}
              style={{ left: `${pawnAt.x}%`, top: `${pawnAt.y}%`, ['--node' as string]: `${nodePx}px` }}
              aria-hidden
            >
              <div className="chmap__pawn-bob">
                <div className="chmap__pawn-pin">
                  <PlayerAvatar avatarId={myAvatar} size={Math.round(nodePx * 0.5)} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <MapScrollbar scrollerRef={scrollerRef} worldW={worldW} chapterKey={chapter.index} />

      <div className="chmap__veil" aria-hidden />
      <BackButton onClick={() => go('menu')} className="chmap__back" />
      <div className="chmap__title">
        第{CHAPTER_NUMERALS[chapter.index - 1]}章 · {chapter.name}
      </div>

      <nav className="chmap__tabs" aria-label="章節">
        {CHAPTERS.map((ch) => {
          const has = !!chapterStages(ch)[0]
          const open = has && isChapterUnlocked(ch, cleared, tutorialSeen)
          const done = chapterClearedCount(ch, cleared)
          const total = chapterStages(ch).filter(Boolean).length
          return (
            <button
              key={ch.index}
              type="button"
              className={`chmap__tab${ch.index === chapter.index ? ' is-active' : ''}${open ? '' : ' is-locked'}`}
              disabled={!open}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse' && open) sfx.hover() }}
              onClick={() => { sfx.click(); switchChapter(ch) }}
            >
              <span className="chmap__tab-no">
                {!open && <span className="chmap__tab-lock">🔒</span>}第{CHAPTER_NUMERALS[ch.index - 1]}章
              </span>
              <span className="chmap__tab-name">{ch.name}</span>
              <span className="chmap__tab-sub">{!has ? '敬請期待' : open ? `${done}/${total} 關` : `打完第 ${(ch.index - 1) * 7} 關解鎖`}</span>
            </button>
          )
        })}
      </nav>

      {cardStage && (
        <ChapterStageCard
          stage={cardStage}
          unlocked={isStageUnlocked(cardStage, cleared, tutorialSeen)}
          tutorialSeen={tutorialSeen}
          onClose={() => setCardStage(null)}
        />
      )}
    </div>
  )
}

function StageNode({
  stage,
  style,
  size,
  cleared,
  unlocked,
  current,
  onOpen,
}: {
  stage: CampaignStage
  style: React.CSSProperties
  size: number
  cleared: string[]
  unlocked: boolean
  current: boolean
  onOpen: () => void
}) {
  const subsDone = stage.subStages.map((ss) => cleared.includes(ss.id))
  const done = subsDone.every(Boolean)
  const card = getSpecialCard(stage.signatureCard)
  const state = done ? 'is-done' : !unlocked ? 'is-locked' : current ? 'is-current' : 'is-open'
  return (
    <div className={`chnode ${state}`} style={{ ...style, ['--node' as string]: `${size}px` }}>
      <button
        type="button"
        className="chnode__btn"
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') sfx.hover() }}
        onClick={onOpen}
        aria-label={`第 ${stage.index} 關 ${stage.name}`}
      >
        <span className="chnode__ring">
          <PlayerAvatar avatarId={stage.bossAvatar} size={Math.round(size * 0.86)} />
        </span>
        <span className="chnode__no">{stage.index}</span>
        {card && (
          <span className="chnode__card" style={{ borderColor: card.accent }}>
            <SpecialCardArt id={card.id} color={card.accent} uid={`ch-${stage.id}`} />
          </span>
        )}
        {!unlocked && <span className="chnode__lock">🔒</span>}
      </button>
      {done ? (
        <span className="chnode__clear">✓ 通關</span>
      ) : (
        <span className="chnode__dots" aria-label={`已過 ${subsDone.filter(Boolean).length}/3`}>
          {subsDone.map((d, i) => (
            <i key={i} className={d ? 'is-on' : ''} />
          ))}
        </span>
      )}
    </div>
  )
}

function ComingSoon({ style, size }: { style: React.CSSProperties; size: number }) {
  return (
    <div className="chsoon" style={{ ...style, ['--node' as string]: `${size}px` }}>
      <div className="chsoon__board">
        <b>敬請期待</b>
        <small>抖內加速開發（誤）</small>
      </div>
    </div>
  )
}

/** 底下的木色捲軸(原生的醜,藏起來自己畫):跟著捲動、可拖拉、點軌道跳過去。 */
function MapScrollbar({
  scrollerRef,
  worldW,
  chapterKey,
}: {
  scrollerRef: React.RefObject<HTMLDivElement>
  worldW: number
  chapterKey: number
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = scrollerRef.current
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!el || !track || !thumb) return
    let raf = 0
    const paint = () => {
      raf = 0
      const max = el.scrollWidth - el.clientWidth
      setShow(max > 4)
      const tw = track.clientWidth
      const w = Math.max(36, (el.clientWidth / el.scrollWidth) * tw)
      const x = max > 0 ? (el.scrollLeft / max) * (tw - w) : 0
      thumb.style.width = `${w}px`
      thumb.style.transform = `translateX(${x}px)`
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(paint) }
    paint()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(el)

    // 拖拉滑塊 / 點軌道
    let dragging = false
    let startX = 0
    let startLeft = 0
    const ratio = () => (el.scrollWidth - el.clientWidth) / Math.max(1, track.clientWidth - thumb.clientWidth)
    const onThumbDown = (e: PointerEvent) => {
      e.stopPropagation()
      dragging = true
      startX = e.clientX
      startLeft = el.scrollLeft
      thumb.setPointerCapture(e.pointerId)
      thumb.classList.add('is-active')
    }
    const onThumbMove = (e: PointerEvent) => {
      if (dragging) el.scrollLeft = startLeft + (e.clientX - startX) * ratio()
    }
    const onThumbUp = () => {
      dragging = false
      thumb.classList.remove('is-active')
    }
    const onTrackDown = (e: PointerEvent) => {
      if (e.target !== track) return
      const r = track.getBoundingClientRect()
      const x = e.clientX - r.left - thumb.clientWidth / 2
      el.scrollTo({ left: x * ratio(), behavior: 'smooth' })
    }
    thumb.addEventListener('pointerdown', onThumbDown)
    thumb.addEventListener('pointermove', onThumbMove)
    thumb.addEventListener('pointerup', onThumbUp)
    thumb.addEventListener('pointercancel', onThumbUp)
    track.addEventListener('pointerdown', onTrackDown)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      thumb.removeEventListener('pointerdown', onThumbDown)
      thumb.removeEventListener('pointermove', onThumbMove)
      thumb.removeEventListener('pointerup', onThumbUp)
      thumb.removeEventListener('pointercancel', onThumbUp)
      track.removeEventListener('pointerdown', onTrackDown)
    }
  }, [scrollerRef, worldW, chapterKey])

  return (
    <div className={`chmap__bar${show ? '' : ' is-hidden'}`} ref={trackRef}>
      <div className="chmap__bar-thumb" ref={thumbRef} />
    </div>
  )
}
