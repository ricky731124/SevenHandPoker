import { useGameStore } from '../../../state/gameStore'
import { sfx } from '../../../audio/sfx'
import './ReplayControls.css'

/**
 * 賽事回放控制(§6.4)——Reels 風。播放時畫面全乾淨,只留右側倍速(常駐)+ 右側流程字幕(當字幕)。
 * 點畫面(rp-tap)→ 暫停 + 浮出「中央上下步/播放」+「底部超細進度軸」;倍速常駐、點了只改速度不暫停。
 * 全部用 stage 相對定位(和 spec-hud/spec-leave 同做法,各平台一致)。
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

  const total = frames.length
  const frame = frames[step]
  const atStart = step === 0
  const atEnd = step >= total - 1

  return (
    <>
      {/* 點空白牌桌 → 播放/暫停切換(按鈕在更上層,不會誤觸)。 */}
      <div className="rp-tap" onClick={() => { sfx.click(); toggle() }} />

      {/* 流程字幕(常駐、右側):第 N 步 / 誰 / 做什麼。 */}
      <div className="rp-flow" aria-live="polite">
        <div className="rp-flow__step">第 {Math.min(step + 1, total)} 步</div>
        {frame?.actor && <div className="rp-flow__who">{frame.actor}</div>}
        <div className="rp-flow__act">{frame?.action ?? ''}</div>
      </div>

      {/* 倍速(常駐、右側對手頭像下):1x=1.7s、2x=1s。點了只改速度、不暫停;選中有壓下感。 */}
      <div className="rp-speed">
        <button type="button" className={`rp-speed__btn${speed === 1 ? ' rp-speed__btn--on' : ''}`} onClick={() => { sfx.click(); setSpeed(1) }}>1x</button>
        <button type="button" className={`rp-speed__btn${speed === 2 ? ' rp-speed__btn--on' : ''}`} onClick={() => { sfx.click(); setSpeed(2) }}>2x</button>
      </div>

      {/* 暫停時:中央(壓在下方玩家格子上,避開正中的狀態提示)上一步/播放/下一步。 */}
      {!playing && (
        <div className="rp-center">
          <button type="button" className="rp-cbtn" onClick={() => { sfx.click(); stepBy(-1) }} disabled={atStart} aria-label="上一步">⏮</button>
          <button type="button" className="rp-cbtn rp-cbtn--play" onClick={() => { sfx.click(); toggle() }} aria-label="播放">{atEnd ? '↻' : '▶'}</button>
          <button type="button" className="rp-cbtn" onClick={() => { sfx.click(); stepBy(1) }} disabled={atEnd} aria-label="下一步">⏭</button>
        </div>
      )}

      {/* 暫停時:底部超細超透進度軸(可拖)。 */}
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
}
