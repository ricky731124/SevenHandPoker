import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useGameStore } from '../../../state/gameStore'
import { useAppStore } from '../../../state/appStore'
import Button from '../Button'
import { sfx } from '../../../audio/sfx'
import './ReplayControls.css'

/**
 * 賽事回放控制(§6.4)——Reels 風。
 *  - 舞台層 `rp-tap`:點畫面切換 播放/暫停。播放中 z 高(到處點=暫停);暫停中 z=2 夾在 felt 上、
 *    牌堆(game__mid z3)/頭像(z≥40)下(空白點=繼續,點頭像開資訊、點放大鏡開放大鏡都不解暫停)(#6)。
 *  - body 傳送門(z 1100,比對決彈窗高):離開/流程字幕/倍速/(暫停時)中央上下步+進度軸。
 *    ⚠️ 傳送門定位「對齊 .game 舞台的實際 rect」(不是 viewport)→ 電腦版舞台置中留白時控制才不會
 *    飛到視窗邊緣(#4)。子元素用舞台的百分比定位。
 */
export default function ReplayControls() {
  const frames = useGameStore((s) => s.replayFrames)
  const step = useGameStore((s) => s.replayStep)
  const playing = useGameStore((s) => s.replayPlaying)
  const speed = useGameStore((s) => s.replaySpeed)
  const seek = useGameStore((s) => s.replaySeek)
  const stepBy = useGameStore((s) => s.replayStepBy)
  const toggle = useGameStore((s) => s.replayToggle)
  const setSpeed = useGameStore((s) => s.replaySetSpeed)
  const closeReplay = useAppStore((s) => s.closeReplay)

  // 量 .game 舞台的實際位置(含 mobile-web transform 縮放),讓 body 傳送門貼齊舞台(#4)。
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  useEffect(() => {
    const el = document.querySelector('.game')
    const measure = () => {
      const t = document.querySelector('.game')
      if (t) {
        const r = t.getBoundingClientRect()
        setRect({ left: r.left, top: r.top, width: r.width, height: r.height })
      }
    }
    measure()
    const t1 = setTimeout(measure, 150)
    const t2 = setTimeout(measure, 450)
    const ro = el ? new ResizeObserver(measure) : null
    if (el && ro) ro.observe(el)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [])

  const total = frames.length
  const frame = frames[step]
  const atStart = step === 0
  const atEnd = step >= total - 1

  const controls = (
    <>
      <div className="rp-leave">
        <Button size="md" onClick={() => { sfx.click(); closeReplay() }}>離開</Button>
      </div>

      {/* 流程字幕:第N步：/ 誰 / 動作(全圓體 Huninn)。z 最高 → 開牌彈窗也擋不住(#8)。 */}
      <div className="rp-flow" aria-live="polite">
        <div className="rp-flow__step">第 {Math.min(step + 1, total)} 步：</div>
        <div className="rp-flow__who">{frame?.actor ?? ''}</div>
        <div className="rp-flow__act">{frame?.action ?? ''}</div>
      </div>

      {/* 倍速(常駐、右側、對手「N 張」下方一點):1x=1.7s、2x=1s。點了只改速度不暫停;選中壓下感。 */}
      <div className="rp-speed">
        <button type="button" className={`rp-speed__btn${speed === 1 ? ' rp-speed__btn--on' : ''}`} onClick={() => { sfx.click(); setSpeed(1) }}>1x</button>
        <button type="button" className={`rp-speed__btn${speed === 2 ? ' rp-speed__btn--on' : ''}`} onClick={() => { sfx.click(); setSpeed(2) }}>2x</button>
      </div>

      {/* 暫停時:中央(壓下方玩家牌上、很透)上一步/播放/下一步。 */}
      {!playing && (
        <div className="rp-center">
          <button type="button" className="rp-cbtn" onClick={() => { sfx.click(); stepBy(-1) }} disabled={atStart} aria-label="上一步">⏮</button>
          <button type="button" className="rp-cbtn rp-cbtn--play" onClick={() => { sfx.click(); toggle() }} aria-label="播放">{atEnd ? '↻' : '▶'}</button>
          <button type="button" className="rp-cbtn" onClick={() => { sfx.click(); stepBy(1) }} disabled={atEnd} aria-label="下一步">⏭</button>
        </div>
      )}

      {/* 暫停時:底部細進度軸(黃、半透明、可拖),避開右下離開鈕。 */}
      {!playing && (
        <div className="rp-scrub">
          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            value={step}
            onChange={(e) => seek(Number(e.target.value), true)}
            aria-label="回放進度"
          />
        </div>
      )}
    </>
  )

  return (
    <>
      {/* 舞台層感應:播放中到處點=暫停;暫停中 z 夾在 felt 上、牌堆/頭像下(點空白=繼續,點頭像/放大鏡各做各的、不解暫停,#3)。 */}
      <div
        className={`rp-tap${playing ? ' rp-tap--playing' : ' rp-tap--paused'}`}
        onClick={() => { sfx.click(); toggle() }}
      />
      {rect &&
        createPortal(
          <div
            className="rp-ui"
            style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          >
            {controls}
          </div>,
          document.body,
        )}
    </>
  )
}
