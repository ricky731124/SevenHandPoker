import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../state/appStore'
import { useGameStore } from '../../state/gameStore'
import { useNetStore } from '../../state/netStore'
import { attachOnline } from '../../net/netgame'
import { aiPick, aiPlace } from '../../game/ai'
import { otherPlayer } from '../../game/state'
import Button from '../components/Button'
import PlayerAvatar from '../components/PlayerAvatar'
import Deck from '../components/game/Deck'
import SortButtons from '../components/game/SortButtons'
import Hand from '../components/game/Hand'
import OpponentHand from '../components/game/OpponentHand'
import SlotView from '../components/game/SlotView'
import TopBar from '../components/game/TopBar'
import CoinToss from '../components/game/CoinToss'
import ConfirmSubmit from '../components/game/ConfirmSubmit'
import ShowdownModal from '../components/game/ShowdownModal'
import MagnifierModal from '../components/game/MagnifierModal'
import EndModal from '../components/game/EndModal'
import useBoardSizes from '../hooks/useBoardSizes'
import Lobby from './Lobby'
import './Game.css'

export default function Game() {
  const pending = useAppStore((s) => s.pendingGame)
  const startSinglePlayer = useGameStore((s) => s.startSinglePlayer)
  const startedFor = useRef<string>('')

  useEffect(() => {
    const key = `${pending?.mode}:${pending?.roomId ?? ''}`
    if (startedFor.current === key) return
    startedFor.current = key
    if (pending?.mode === 'ai') startSinglePlayer()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  if (pending && pending.mode !== 'ai') {
    return <OnlineGame mode={pending.mode} roomId={pending.roomId} />
  }
  return <PlayGame />
}

/** Renders the coin toss then the board from whatever is in the gameStore
 *  (shared by single-player and online). */
function PlayGame() {
  const g = useGameStore()
  if (g.status === 'coinToss' && g.coinFirstPicker) {
    return (
      <CoinToss
        firstPicker={g.coinFirstPicker}
        me={g.me}
        onDone={g.online ? g.finishCoinTossOnline : g.finishCoinToss}
      />
    )
  }
  if (!g.engine) return null
  return <GameBoard />
}

/** Online: show the lobby until both are connected, then attach the sync bridge
 *  and render the shared board. */
function OnlineGame({ mode, roomId }: { mode: 'host' | 'guest'; roomId?: string }) {
  const netPhase = useNetStore((s) => s.phase)
  const code = useNetStore((s) => s.code)
  const room = useNetStore((s) => s.room)
  const go = useAppStore((s) => s.go)
  useEffect(() => {
    if (netPhase === 'connected' && code) attachOnline(code, mode)
  }, [netPhase, code, mode])

  if (netPhase !== 'connected') return <Lobby mode={mode} roomId={roomId} />

  const foeKey = mode === 'host' ? 'guest' : 'host'
  const abandonedByFoe = room?.abandoned === foeKey
  // presence exists once the foe has joined; connected===false means they dropped
  const foeConnected = room?.players?.[foeKey]?.connected !== false
  const exit = () => {
    useGameStore.getState().leaveOnline()
    go('menu')
  }
  return (
    <>
      <PlayGame />
      {abandonedByFoe ? (
        <LeftOverlay onExit={exit} />
      ) : !foeConnected ? (
        <DisconnectOverlay hostGone={mode === 'guest'} onTimeout={exit} onLeave={exit} />
      ) : null}
    </>
  )
}

/** Opponent chose to leave — no countdown, just an exit. */
function LeftOverlay({ onExit }: { onExit: () => void }) {
  return (
    <div className="net-overlay">
      <div className="net-overlay__card">
        <div className="net-overlay__title">對手已離開遊戲</div>
        <div className="net-overlay__msg">這一局結束了。</div>
        <div style={{ marginTop: 14 }}>
          <Button onClick={onExit}>返回主畫面</Button>
        </div>
      </div>
    </div>
  )
}

/** Opponent dropped (network/crash) — wait up to 90s for a reconnect, or leave. */
const RECONNECT_SECS = 90
function DisconnectOverlay({
  hostGone,
  onTimeout,
  onLeave,
}: {
  hostGone: boolean
  onTimeout: () => void
  onLeave: () => void
}) {
  const [left, setLeft] = useState(RECONNECT_SECS)
  useEffect(() => {
    setLeft(RECONNECT_SECS)
    const t = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(t)
          onTimeout()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const m = Math.floor(left / 60)
  const s = String(left % 60).padStart(2, '0')
  return (
    <div className="net-overlay">
      <div className="net-overlay__card">
        <div className="net-overlay__title">對手斷線</div>
        <div className="net-overlay__msg">{hostGone ? '等待房主重連…' : '等待對手重連…'}</div>
        <div className="net-overlay__time">
          {m}:{s}
        </div>
        <div style={{ marginTop: 14 }}>
          <Button variant="secondary" onClick={onLeave}>
            離開遊戲
          </Button>
        </div>
      </div>
    </div>
  )
}

function GameBoard() {
  const g = useGameStore()
  const engine = g.engine!
  const me = g.me
  const foe = otherPlayer(me)
  const go = useAppStore((s) => s.go)
  const sz = useBoardSizes()

  // ----- AI driver (single-player only) -----
  useEffect(() => {
    if (!engine) return
    if (g.online) return // online: the opponent is a human, no AI
    if (g.showdownOpen || g.endOpen) return
    let timer: ReturnType<typeof setTimeout> | undefined
    if (engine.phase === 'pick' && engine.turn !== me) {
      timer = setTimeout(() => g.submitPick(aiPick(engine, engine.turn)), 850)
    } else if (engine.phase === 'place') {
      const placer = otherPlayer(engine.pendingPick!.by)
      if (placer !== me) timer = setTimeout(() => g.placeAt(aiPlace(engine, placer)), 850)
    }
    return () => timer && clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, g.showdownOpen, g.endOpen])

  const iPick = engine.phase === 'pick' && engine.turn === me
  const iPlace = engine.phase === 'place' && engine.pendingPick && otherPlayer(engine.pendingPick.by) === me
  const myActive = !!iPick || !!iPlace
  const foeActive = engine.phase !== 'ended' && !g.showdownOpen && !myActive

  const statusText =
    engine.phase === 'pick'
      ? engine.turn === me
        ? '你的回合：點選 1~5 張牌，按「送出」'
        : '對手思考中…'
      : engine.phase === 'place'
        ? iPlace
          ? '把對手的牌放到對手的一個空格'
          : '對手正在放置你的牌…'
        : ''

  const placeableSlot = (i: number) => !!iPlace && engine.slots[i][engine.pendingPick!.by].length === 0

  // Opponent's selection shown pushed out: the LIVE preview (情報戰) during their
  // pick, else the submitted selection while I place it.
  const foeSel = g.foeLive ?? g.foeSelection
  const oCount = foeSel ? foeSel.total : engine.hands[foe].length
  const oSelected = foeSel ? foeSel.idx : []

  return (
    <div
      className="game"
      style={{
        width: sz.stageW,
        height: sz.stageH,
        ['--reserve' as string]: `${sz.reserve}px`,
        ['--reserve-r' as string]: `${sz.rightReserve}px`,
        // stage box size, so vertical vh-based spacing can respect the capped
        // box on desktop (on phones these equal the viewport → no change).
        ['--stage-w' as string]: `${sz.stageW}px`,
        ['--stage-h' as string]: `${sz.stageH}px`,
      }}
    >
      <TopBar />

      <div className="game__foe-avatar">
        <div className={`avatar-wrap${foeActive ? ' avatar-wrap--active' : ''}`}>
          <PlayerAvatar player={foe} size={sz.avatar} />
        </div>
      </div>
      {foeSel && (foeSel.idx?.length ?? 0) > 0 && (
        <motion.div
          className="foe-bubble"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
        >
          {foeSel.idx.length} 張
        </motion.div>
      )}
      <div className="game__me-avatar">
        <div className={`avatar-wrap${myActive ? ' avatar-wrap--active' : ''}`}>
          <PlayerAvatar player={me} size={sz.avatar} />
        </div>
      </div>

      <div className="game__ohand">
        <OpponentHand count={oCount} selectedIdx={oSelected} cardW={sz.card} maxWidth={sz.handMax} />
      </div>

      <div className="game__mid">
        <div className="game__deck">
          <Deck count={engine.deck.length} cardW={sz.card} />
        </div>

        <div className="game__band" style={{ gridTemplateColumns: `repeat(7, ${sz.card}px)`, width: sz.bandWidth }}>
          {engine.slots.map((slot, i) => (
            <SlotView
              key={i}
              slot={slot}
              index={i}
              me={me}
              placeable={placeableSlot(i)}
              onPlace={g.placeAt}
              onMagnify={g.openMagnifier}
              cardW={sz.card}
              coinSize={sz.coin}
            />
          ))}
        </div>

        <div className="game__sort">
          <SortButtons mode={g.sortMode} dir={g.sortDir} onToggleMode={g.toggleSortMode} onToggleDir={g.toggleSortDir} />
        </div>
      </div>

      {statusText && <div className="game__status">{statusText}</div>}
      {/* online: I confirmed the showdown, waiting for the opponent to confirm too */}
      {!!g.online && engine.phase === 'showdown' && !g.showdownOpen && (
        <div className="game__status">等待對手確認…</div>
      )}

      <div className="game__hand">
        <Hand
          cards={engine.hands[me]}
          selected={g.selected}
          sortMode={g.sortMode}
          sortDir={g.sortDir}
          interactive={iPick}
          onToggle={g.toggleCard}
          cardW={sz.card}
          maxWidth={sz.handMax}
        />
      </div>

      {iPick && (
        <div className="game__action">
          <Button size="sm" disabled={g.selected.length === 0} onClick={g.openConfirm}>
            送出 {g.selected.length}
          </Button>
        </div>
      )}

      <ConfirmSubmit data={g.confirm} onConfirm={g.confirmPick} onCancel={g.cancelConfirm} />
      <ShowdownModal
        open={g.showdownOpen}
        showdown={engine.lastShowdown}
        slot={engine.lastShowdown ? engine.slots[engine.lastShowdown.slot] : null}
        me={me}
        onClose={g.dismissShowdown}
      />
      <MagnifierModal target={g.magnifier} engine={engine} me={me} onClose={g.closeMagnifier} />
      <EndModal
        open={g.endOpen}
        winner={engine.winner}
        reason={engine.winReason}
        me={me}
        waiting={!!g.online && g.rematchPending}
        foeWantsRematch={!!g.online && g.foeWantsRematch}
        onRematch={g.online ? g.agreeRematch : g.nextGame}
        onLeave={() => {
          if (g.online) g.leaveOnline()
          go('menu')
        }}
      />
    </div>
  )
}
