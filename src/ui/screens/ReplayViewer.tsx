import { useEffect } from 'react'
import { useAppStore } from '../../state/appStore'
import { useGameStore, type SpectateInfo } from '../../state/gameStore'
import type { ReplayEntry } from '../../net/replays'
import { buildFrames } from '../../game/replay'
import { GameBoard } from './Game'
import './Game.css'
import './SpectatorGame.css'
import './ReplayViewer.css'

/**
 * 賽事回放(§6.4):複用觀戰的 GameBoard(全開唯讀)。本元件只負責①把清單帶進來的 record
 * buildFrames → gameStore.startReplay ②跑播放計時器。所有回放控制(中央上下步/播放、右側倍速、
 * 流程字幕、進度軸、離開)都在 GameBoard 內用 stage 相對定位(§6.4;各平台一致,沿用觀戰版位)。
 */

const DWELL = { 1: 1700, 2: 1000 } as const // 1x=1.7s/步、2x=1s/步

function seatsFrom(rec: ReplayEntry): SpectateInfo {
  return {
    p1: { name: rec.p1?.name || '玩家1', avatarId: rec.p1?.avatar || 'cat', uid: rec.p1?.uid ?? null },
    p2: { name: rec.p2?.name || '玩家2', avatarId: rec.p2?.avatar || 'bird', uid: rec.p2?.uid ?? null },
  }
}

export default function ReplayViewer() {
  const rec = useAppStore((s) => s.replayData)
  const startReplay = useGameStore((s) => s.startReplay)
  const exitSpectate = useGameStore((s) => s.exitSpectate)
  const replayAdvance = useGameStore((s) => s.replayAdvance)
  const playing = useGameStore((s) => s.replayPlaying)
  const step = useGameStore((s) => s.replayStep)
  const speed = useGameStore((s) => s.replaySpeed)
  const boardEngine = useGameStore((s) => s.engine)
  const boardSpectate = useGameStore((s) => s.spectate)

  // 進場:清單已帶完整 record(含 moves)→ 直接 buildFrames、從頭自動播。
  useEffect(() => {
    if (!rec) return
    const info = seatsFrom(rec)
    const frames = buildFrames({
      seed: rec.seed,
      firstPicker: rec.firstPicker,
      moves: rec.moves,
      names: { p1: info.p1.name, p2: info.p2.name },
    })
    startReplay(frames, info)
    return () => exitSpectate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec])

  // 播放計時器:每步排下一步(step 變就重排),暫停時不排。
  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => replayAdvance(), DWELL[speed])
    return () => clearTimeout(t)
  }, [playing, step, speed, replayAdvance])

  if (!rec) return null
  const ready = !!boardEngine && !!boardSpectate

  return (
    <div className="replay">
      {ready ? (
        <GameBoard />
      ) : (
        <div className="spectate__loading">
          <div className="mm__spinner" aria-hidden="true" />
          <p>載入賽事中…</p>
        </div>
      )}
    </div>
  )
}
