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
import { Paw } from '../components/Button'
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
  const fromTutorial = useCampaignStore((s) => s.mapFocus === 'tutorial')
  const [focus, setFocus] = useState(() => initialFocus(viewStageId, cleared, tutorialSeen, fromTutorial) as { chapter: number; target: string })
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
  // 基準單位 u(CSS 的 --node)跟著圖高等比:手機約 84px、電腦 900 高約 200px。
  // 地圖上每樣東西各自用 u 乘自己的倍率(頭像 0.8u、棋子 0.5u、木牌…),改一樣不會牽動別樣。
  const nodePx = Math.round(Math.min(240, Math.max(80, worldH * 0.225)))

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

  // 棋子:站在現在那關上方;還沒看教學 → 貼在教學木牌正左邊(畫在木牌裡,見下)
  const pawnTutorial = frontier.chapter === chapter.index && frontier.target === 'tutorial'
  const pawnAt =
    frontier.chapter !== chapter.index || pawnTutorial
      ? null
      : chapter.nodes[stages.findIndex((s) => s?.id === frontier.target)] ?? null
  // 棋子用遊戲裡頭像本來的金框(全站頭像都是這個框,放地圖上最搭)
  const pawn = (
    <div className="chmap__pawn-bob">
      <div className="chmap__pawn-pin">
        <PlayerAvatar avatarId={myAvatar} size={Math.round(nodePx * 0.5)} />
      </div>
    </div>
  )

  return (
    <div className="chmap">
      <div className="chmap__scroller" ref={scrollerRef}>
        <div
          key={chapter.index}
          className="chmap__world"
          data-ch={chapter.index}
          style={{ width: worldW, height: worldH, top: Math.min(0, (box.h - worldH) / 2), ['--node' as string]: `${nodePx}px` }}
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
          {/* 底圖淡化(圖太花,節點會看不清楚):蓋一層半透明,第三章夜景蓋暗色 */}
          <div className="chmap__fade" aria-hidden />

          {chapter.tutorial && (
            <div className="chmap__tutorial" style={{ left: `${chapter.tutorial.x}%`, top: `${chapter.tutorial.y}%` }}>
              {/* 木牌(木紋+釘子+貓爪)斜 10 度,蓋在圖上那塊空白板子上,站在圖上原本那兩根腳上(不另畫桿子) */}
              <div className="chmap__tut-tilt">
                <button
                  type="button"
                  className={`chboard chboard--btn${!tutorialSeen ? ' is-current' : ''}`}
                  onPointerEnter={(e) => { if (e.pointerType === 'mouse') sfx.hover() }}
                  onClick={() => { sfx.click(); go('tutorial') }}
                >
                  <span className="chboard__row">
                    <span className="chboard__icon">
                      <Paw />
                    </span>
                    <b>新手教學</b>
                  </span>
                </button>
              </div>
              {pawnTutorial && (
                <div className="chmap__pawn is-side" aria-hidden>
                  {pawn}
                </div>
              )}
            </div>
          )}

          {chapter.nodes.map((pos, i) => {
            const stage = stages[i]
            const style = { left: `${pos.x}%`, top: `${pos.y}%` }
            if (!stage) return <ComingSoon key={i} style={style} tilt={SOON_TILT[i % SOON_TILT.length]} />
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
            <div className="chmap__pawn" style={{ left: `${pawnAt.x}%`, top: `${pawnAt.y}%` }} aria-hidden>
              {pawn}
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
          {/* 頭像圈 = 0.8u(2026-10-21 -20%);特殊卡/小點/通關照 u 算,大小不變 */}
          <PlayerAvatar avatarId={stage.bossAvatar} size={Math.round(size * 0.8 * 0.86)} />
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

/** 「敬請期待」木牌的傾斜角度:依位置左右交錯,看起來比較自然。 */
const SOON_TILT = [-6, 5, -4, 6, -5, 4, -6]

/** 還沒做的關卡:插在平台上的木牌(木紋+釘子+小鐵鎚,施工中的感覺;點了沒反應所以不放貓爪)。 */
function ComingSoon({ style, tilt }: { style: React.CSSProperties; tilt: number }) {
  return (
    <div className="chsoon" style={style}>
      <div className="chsoon__tilt" style={{ transform: `rotate(${tilt}deg)` }}>
        <div className="chboard">
          <span className="chboard__row">
            <span className="chboard__icon">
              <Hammer />
            </span>
            <b>敬請期待</b>
          </span>
          {/* 分兩行:木牌才不會比平台間距寬、跟隔壁疊在一起 */}
          <small>
            抖內加速
            <br />
            開發（誤）
          </small>
        </div>
        <i className="chsoon__post" />
      </div>
    </div>
  )
}

function Hammer() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <rect x="10.4" y="8.5" width="3.2" height="13.5" rx="1.4" fill="#8a5424" stroke="#4d2e13" strokeWidth="1.1" transform="rotate(-35 12 12)" />
      <path d="M4.5 6.2 L12.3 1.8 L15.4 7.3 L7.6 11.7 Z" fill="#7d8790" stroke="#3a4148" strokeWidth="1.2" strokeLinejoin="round" transform="rotate(-35 12 12) translate(2 1)" />
    </svg>
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
