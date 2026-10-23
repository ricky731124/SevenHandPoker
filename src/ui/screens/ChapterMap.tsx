import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
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
  chapterIndexOfStage,
  chapterMapUrl,
  chapterStages,
  focusForChapter,
  frontierFocus,
  getChapter,
  initialFocus,
  isChapterUnlocked,
  lastClearedStageIndex,
  pendingUnlock,
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

  // ---- 解鎖動畫(打完整隻 boss 的 x-3 才播;這台裝置看過到第幾關記在 localStorage,沒看過的進來就補播) ----
  const uid = usePlatformStore((s) => s.uid)
  const profileReady = usePlatformStore((s) => !!s.profile)
  // 進場記號只看「進來那一刻」,用完馬上清掉(不然之後從小關地圖返回又會被當成剛從教學/前往下一關來)
  const [mapFocus] = useState(() => useCampaignStore.getState().mapFocus)
  useEffect(() => {
    if (useCampaignStore.getState().mapFocus) useCampaignStore.setState({ mapFocus: null })
  }, [])
  const seenKey = uid ? `shp.unlockSeen.${uid}` : null
  const [anim, setAnim] = useState<UnlockAnim | null>(() => {
    if (!profileReady || !seenKey) return null
    const seen = readSeen(seenKey)
    if (seen == null) {
      writeSeen(seenKey, lastClearedStageIndex(cleared)) // 第一次進來(或新裝置):不補播以前的
      return null
    }
    const p = pendingUnlock(cleared, seen)
    if (!p) return null
    const cross = !!p.to && chapterIndexOfStage(p.to.index) !== chapterIndexOfStage(p.from.index)
    return { ...p, cross, phase: 'pre' }
  })
  const animStart = useRef(anim)

  // 進場要看哪章、捲到哪(只算一次;之後切章另外算)。有動畫 → 從剛打完的那關開始
  const fromTutorial = mapFocus === 'tutorial'
  const [focus, setFocus] = useState(() =>
    anim
      ? { chapter: chapterIndexOfStage(anim.from.index), target: anim.from.id }
      : (initialFocus(viewStageId, cleared, tutorialSeen, fromTutorial) as { chapter: number; target: string }),
  )
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
  // 基準單位 u(CSS 的 --node)跟著圖高等比:手機約 88px、電腦 900 高約 200px。
  // 地圖上每樣東西各自用 u 乘自己的倍率(頭像圈 0.955u、棋子 0.613u、木牌…),改一樣不會牽動別樣。
  const nodePx = Math.round(Math.min(240, Math.max(80, worldH * 0.225)))
  // 頭像圈 0.955u 往上取「偶數整數 px」:第一章第 4 關平台最寬,要 0.952u 才蓋得住左邊投影(所有頭像同一大小);
  // 偶數 → 圓心位移剛好半徑(整數),節點才不會落在半個像素上(半像素的東西重畫時會 1px 跳)
  const ringPx = 2 * Math.ceil((nodePx * 0.955) / 2)
  // 節點/棋子/木牌的座標也一律取整數 px
  const at = (p: { x: number; y: number }) => ({ left: Math.round((p.x / 100) * worldW), top: Math.round((p.y / 100) * worldH) })

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
    // 取整數:捲在半個像素上,切章/返回的淡入結束那刻會重新對齊像素 → 節點左右跳 1px
    el.scrollLeft = x ? Math.round((x / 100) * worldW - el.clientWidth / 2) : 0
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

  // ---- 解鎖動畫時間軸(約 3 秒,不能跳過;跨章約 4.4 秒)----
  //   pre → stamp(剛打完那關蓋「✓ 通關」、框變金)→ walk(貓爪印一路印到下一關、棋子跳三下過去)
  //   → unlock(下一關鎖頭晃一下碎掉、銅框變銀、開始閃金光)→ 結束(從「前往下一關」來的就打開下一關資訊卡)
  //   跨章:walk 走出右邊 → tab(左側下一章按鈕鎖頭飛走、亮起來)→ 切到下一章 → land(棋子降落)→ unlock
  useEffect(() => {
    const a = animStart.current
    if (!a || !seenKey) return
    writeSeen(seenKey, lastClearedStageIndex(cleared)) // 一開播就記看過(中途離開也不會每次重播)
    const openNext = mapFocus === 'unlockNext'
    const timers: number[] = []
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    const phase = (p: UnlockPhase) => setAnim((x) => (x ? { ...x, phase: p } : x))
    const finish = () => {
      setAnim(null)
      if (openNext && a.to) setCardStage(a.to)
    }
    later(350, () => { phase('stamp'); sfx.place() })
    if (!a.to) {
      later(1500, finish) // 下一關還沒做:只蓋章
    } else {
      later(950, () => phase('walk'))
      ;[950, 1350, 1750].forEach((ms) => later(ms, () => sfx.select()))
      if (!a.cross) {
        later(2150, () => { phase('unlock'); sfx.reward() })
        later(3000, finish)
      } else {
        later(2150, () => { phase('tab'); sfx.success() })
        later(2950, () => {
          setFocus({ chapter: chapterIndexOfStage(a.to!.index), target: a.to!.id })
          phase('land')
        })
        later(3550, () => { phase('unlock'); sfx.reward() })
        later(4400, finish)
      }
    }
    return () => timers.forEach((t) => clearTimeout(t))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 從「前往下一關」來、但沒有動畫要播(例如已經在別處看過)→ 直接打開下一關資訊卡
  useEffect(() => {
    if (animStart.current || mapFocus !== 'unlockNext') return
    const st = stages.find((s) => s?.id === frontier.target)
    if (st) setCardStage(st)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 動畫中:這章的起點(剛打完那關)與終點(下一關;跨章時 = 右邊出口)
  const animFrom = anim && chapterIndexOfStage(anim.from.index) === chapter.index ? chapter.nodes[anim.from.index - (chapter.index - 1) * 7 - 1] : null
  const animToHere = anim?.to && chapterIndexOfStage(anim.to.index) === chapter.index ? chapter.nodes[anim.to.index - (chapter.index - 1) * 7 - 1] : null
  const animEnd = animFrom ? animToHere ?? (anim?.cross ? { x: Math.min(98, animFrom.x + 9), y: animFrom.y - 2 } : null) : null

  // walk 開始時把畫面捲到兩點中間
  useEffect(() => {
    if (anim?.phase !== 'walk' || !animFrom || !animEnd) return
    const el = scrollerRef.current
    if (!el) return
    const mid = (((animFrom.x + animEnd.x) / 2) / 100) * worldW
    el.scrollTo({ left: Math.round(mid - el.clientWidth / 2), behavior: 'smooth' })
  }, [anim?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // 棋子:站在現在那關上方;還沒看教學 → 貼在教學木牌正左邊(畫在木牌裡,見下)。
  // 動畫中改由動畫決定(起點站著 → 跳過去 → 終點站著)
  const pawnTutorial = !anim && frontier.chapter === chapter.index && frontier.target === 'tutorial'
  const pawnAt = anim
    ? anim.phase === 'pre' || anim.phase === 'stamp'
      ? animFrom
      : anim.phase === 'unlock'
        ? animToHere
        : null
    : frontier.chapter !== chapter.index || pawnTutorial
      ? null
      : chapter.nodes[stages.findIndex((s) => s?.id === frontier.target)] ?? null

  /** 動畫中節點要顯示成什麼(資料上已經通關/解鎖,但要照時間軸一步一步變) */
  const override = (s: CampaignStage): NodeOverride | undefined => {
    if (!anim) return undefined
    if (s.id === anim.from.id) return anim.phase === 'pre' ? { state: 'current' } : { state: 'done', fx: anim.phase === 'stamp' ? 'stamp' : undefined }
    if (anim.to && s.id === anim.to.id) return anim.phase === 'unlock' ? { state: 'current', fx: 'unlock' } : { state: 'locked' }
    return undefined
  }
  // 跨章:下一章的按鈕在 tab 之前看起來還是鎖著
  const tabLockedByAnim = (ch: Chapter) =>
    !!anim?.cross && !!anim.to && chapterIndexOfStage(anim.to.index) === ch.index && ['pre', 'stamp', 'walk'].includes(anim.phase)
  const tabUnlocking = (ch: Chapter) => !!anim?.cross && !!anim.to && chapterIndexOfStage(anim.to.index) === ch.index && anim.phase === 'tab'
  // 棋子:手機約 54px,奶白框配咖啡邊(酒紅融不進背景、金色會跟通關金框撞)
  const pawn = (
    <div className="chmap__pawn-bob">
      <div className="chmap__pawn-pin">
        <PlayerAvatar avatarId={myAvatar} size={Math.round(nodePx * 0.613)} />
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
          style={{
            width: worldW,
            height: worldH,
            top: Math.round(Math.min(0, (box.h - worldH) / 2)),
            ['--node' as string]: `${nodePx}px`,
            ['--ring' as string]: `${ringPx}px`,
          }}
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
            <div className="chmap__tutorial" style={at(chapter.tutorial)}>
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
            const style = at(pos)
            if (!stage) return <ComingSoon key={i} style={style} tilt={SOON_TILT[i % SOON_TILT.length]} />
            return (
              <StageNode
                key={stage.id}
                stage={stage}
                style={style}
                size={nodePx}
                ring={ringPx}
                cleared={cleared}
                unlocked={isStageUnlocked(stage, cleared, tutorialSeen)}
                current={frontier.target === stage.id}
                override={override(stage)}
                onOpen={() => { sfx.click(); setCardStage(stage) }}
              />
            )
          })}

          {/* 解鎖動畫:貓爪印一路印過去 + 棋子跳過去 / 跨章降落 */}
          {anim && animFrom && animEnd && ['walk', 'tab', 'unlock'].includes(anim.phase) && (
            <PawTrail a={at(animFrom)} b={at(animEnd)} u={nodePx} />
          )}
          {anim?.phase === 'walk' && animFrom && animEnd && (
            <FlyingPawn a={at(animFrom)} b={at(animEnd)} u={nodePx} fadeOut={!animToHere}>
              {pawn}
            </FlyingPawn>
          )}
          {anim?.phase === 'land' && animToHere && <LandingPawn at={at(animToHere)} u={nodePx}>{pawn}</LandingPawn>}

          {pawnAt && (
            <div className="chmap__pawn" style={at(pawnAt)} aria-hidden>
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
          const open = has && isChapterUnlocked(ch, cleared, tutorialSeen) && !tabLockedByAnim(ch)
          const done = chapterClearedCount(ch, cleared)
          const total = chapterStages(ch).filter(Boolean).length
          const unlocking = tabUnlocking(ch)
          return (
            <button
              key={ch.index}
              type="button"
              className={`chmap__tab${ch.index === chapter.index ? ' is-active' : ''}${open ? '' : ' is-locked'}${unlocking ? ' is-unlocking' : ''}`}
              disabled={!open}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse' && open) sfx.hover() }}
              onClick={() => { sfx.click(); switchChapter(ch) }}
            >
              {unlocking && <span className="chmap__tab-lockfly" aria-hidden>🔒</span>}
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

      {/* 解鎖動畫播放中:整個畫面不能點(使用者:3 秒就硬看完,不做跳過) */}
      {anim && <div className="chmap__block" aria-hidden />}
    </div>
  )
}

// ---- 解鎖動畫 -------------------------------------------------------------

type UnlockPhase = 'pre' | 'stamp' | 'walk' | 'tab' | 'land' | 'unlock'
interface UnlockAnim {
  from: CampaignStage
  to?: CampaignStage
  /** 下一關在下一章 */
  cross: boolean
  phase: UnlockPhase
}
interface NodeOverride {
  state: 'current' | 'done' | 'locked'
  fx?: 'stamp' | 'unlock'
}
type Pt = { left: number; top: number }

function readSeen(key: string): number | null {
  try {
    const v = localStorage.getItem(key)
    return v == null ? null : Number(v)
  } catch {
    return null
  }
}
function writeSeen(key: string, n: number) {
  try {
    localStorage.setItem(key, String(n))
  } catch {
    /* 私密模式等:不記就是了 */
  }
}

/** 兩點之間往上拱的弧線(地圖上沒有路的座標,走弧線;貓爪印不用貼著路也自然) */
function arcPoint(a: Pt, b: Pt, t: number, lift: number): Pt {
  const cx = (a.left + b.left) / 2
  const cy = (a.top + b.top) / 2 - lift
  const m = 1 - t
  return { left: m * m * a.left + 2 * m * t * cx + t * t * b.left, top: m * m * a.top + 2 * m * t * cy + t * t * b.top }
}
/**
 * 弧線拱多高:每段路走起來要「一樣長」(步數、時間都一樣,步伐才一致)——
 * 距離短的就拱高一點把路拉長,距離長的幾乎直走。二次貝茲弧長 ≈ √(d² + 4/3·c²),
 * 取目標路長 1.6u 反推控制點高度 c;最少拱 0.3u。
 */
const PATH_LEN = 1.6
function arcLift(a: Pt, b: Pt, u: number) {
  const d = Math.hypot(b.left - a.left, b.top - a.top)
  const L = u * PATH_LEN
  return Math.max(u * 0.3, d < L ? Math.sqrt((L * L - d * d) * 0.75) : 0)
}

/** 貓爪印:頭像連頭像,沿弧線一個一個印出來(固定 6 步、每步間隔一樣),左右腳交錯、腳尖朝前進方向;
 *  頭尾會蓋到頭像邊緣(使用者:蓋到沒關係) */
function PawTrail({ a, b, u }: { a: Pt; b: Pt; u: number }) {
  const lift = arcLift(a, b, u)
  const N = 6
  return (
    <>
      {Array.from({ length: N }, (_, i) => {
        const t = 0.14 + (0.72 * i) / (N - 1)
        const p = arcPoint(a, b, t, lift)
        const q = arcPoint(a, b, t + 0.01, lift)
        const ang = Math.atan2(q.top - p.top, q.left - p.left)
        const side = i % 2 === 0 ? 1 : -1
        const off = u * 0.06 * side
        return (
          <span
            key={i}
            className="chmap__paw"
            style={{
              left: Math.round(p.left - Math.sin(ang) * off),
              top: Math.round(p.top + Math.cos(ang) * off),
              animationDelay: `${i * 0.17}s`,
              ['--rot' as string]: `${(ang * 180) / Math.PI + 90}deg`,
            }}
          >
            <Paw />
          </span>
        )
      })}
    </>
  )
}

/** 棋子沿弧線跳三下過去(跨章時跳出右邊、最後淡出) */
function FlyingPawn({ a, b, u, fadeOut, children }: { a: Pt; b: Pt; u: number; fadeOut: boolean; children: React.ReactNode }) {
  const lift = arcLift(a, b, u)
  const xs: number[] = []
  const ys: number[] = []
  for (let k = 0; k <= 6; k++) {
    const p = arcPoint(a, b, k / 6, lift)
    xs.push(p.left - a.left)
    ys.push(p.top - a.top - (k % 2 === 1 ? u * 0.32 : 0)) // 奇數格 = 每一跳的最高點
  }
  return (
    <motion.div
      className="chmap__flyer"
      style={{ left: a.left, top: a.top }}
      initial={{ x: 0, y: 0, opacity: 1 }}
      animate={{ x: xs, y: ys, opacity: fadeOut ? [1, 1, 1, 1, 1, 0.6, 0] : 1 }}
      transition={{ duration: 1.2, ease: 'easeInOut' }}
    >
      <div className="chmap__pawn">{children}</div>
    </motion.div>
  )
}

/** 跨章:棋子從上面掉下來、彈一下站好 */
function LandingPawn({ at, u, children }: { at: Pt; u: number; children: React.ReactNode }) {
  return (
    <motion.div
      className="chmap__flyer"
      style={{ left: at.left, top: at.top }}
      initial={{ y: -u * 1.6, opacity: 0 }}
      animate={{ y: [-u * 1.6, 0, -u * 0.22, 0], opacity: [0, 1, 1, 1] }}
      transition={{ duration: 0.6, times: [0, 0.55, 0.78, 1], ease: 'easeOut' }}
    >
      <div className="chmap__pawn">{children}</div>
    </motion.div>
  )
}

function StageNode({
  stage,
  style,
  size,
  ring,
  cleared,
  unlocked: realUnlocked,
  current: realCurrent,
  override,
  onOpen,
}: {
  stage: CampaignStage
  style: React.CSSProperties
  size: number
  /** 頭像圈直徑(偶數整數 px) */
  ring: number
  cleared: string[]
  unlocked: boolean
  current: boolean
  /** 解鎖動畫中照時間軸顯示(資料上已經變了,畫面一步一步變) */
  override?: NodeOverride
  onOpen: () => void
}) {
  const subsDone = stage.subStages.map((ss) => cleared.includes(ss.id))
  const ov = override?.state
  const done = ov ? ov === 'done' : subsDone.every(Boolean)
  const unlocked = ov ? ov !== 'locked' : realUnlocked
  const current = ov ? ov === 'current' : realCurrent
  const card = getSpecialCard(stage.signatureCard)
  const state = done ? 'is-done' : !unlocked ? 'is-locked' : current ? 'is-current' : 'is-open'
  const fx = override?.fx ? ` fx-${override.fx}` : ''
  return (
    <div className={`chnode ${state}${fx}`} style={{ ...style, ['--node' as string]: `${size}px` }}>
      <button
        type="button"
        className="chnode__btn"
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') sfx.hover() }}
        onClick={onOpen}
        aria-label={`第 ${stage.index} 關 ${stage.name}`}
      >
        {/* 目前這關的金光:獨立一層只動 transform/opacity(不重畫頭像,也就不會抖) */}
        {current && <span className="chnode__glow" aria-hidden />}
        <span className="chnode__ring">
          {/* 頭像圈 = ring(約 0.955u):要連平台左邊的投影、右邊石框一起蓋住(大家同一大小) */}
          <PlayerAvatar avatarId={stage.bossAvatar} size={Math.round(ring * 0.86)} />
        </span>
        <span className="chnode__no">{stage.index}</span>
        {card && (
          <span className="chnode__card" style={{ borderColor: card.accent }}>
            <SpecialCardArt id={card.id} color={card.accent} uid={`ch-${stage.id}`} />
          </span>
        )}
        {!unlocked && <span className="chnode__lock">🔒</span>}
        {/* 解鎖動畫:鎖頭晃一下、裂成兩半飛走 */}
        {override?.fx === 'unlock' && (
          <span className="chnode__lockbreak" aria-hidden>
            <i>🔒</i>
            <i>🔒</i>
          </span>
        )}
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
          {/* 分兩行(木牌才不會比平台間距寬、跟隔壁疊),兩行靠左對齊、半形括號才不會空太開 */}
          <small>
            抖內加速
            <br />
            開發(誤)
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
      if (dragging) el.scrollLeft = Math.round(startLeft + (e.clientX - startX) * ratio())
    }
    const onThumbUp = () => {
      dragging = false
      thumb.classList.remove('is-active')
    }
    const onTrackDown = (e: PointerEvent) => {
      if (e.target !== track) return
      const r = track.getBoundingClientRect()
      const x = e.clientX - r.left - thumb.clientWidth / 2
      el.scrollTo({ left: Math.round(x * ratio()), behavior: 'smooth' })
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
