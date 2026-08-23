import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../state/appStore'
import { useGameStore } from '../../state/gameStore'
import { useNetStore } from '../../state/netStore'
import { usePlatformStore } from '../../state/platformStore'
import { attachOnline } from '../../net/netgame'
import { setPlayerMeta } from '../../net/room'
import { aiPick, aiPlace } from '../../game/ai'
import { otherPlayer, suitTargets, swapTargets } from '../../game/state'
import { getSpecialCard, ALL_SPECIAL_CARD_IDS, type SpecialCardId } from '../../game/specialCards'
import { SUIT_SYMBOL } from '../../game/cards'
import Button from '../components/Button'
import PlayerAvatar from '../components/PlayerAvatar'
import PlayerInfoCard from '../components/PlayerInfoCard'
import Deck from '../components/game/Deck'
import SortButtons from '../components/game/SortButtons'
import Hand from '../components/game/Hand'
import OpponentHand from '../components/game/OpponentHand'
import SlotView from '../components/game/SlotView'
import TopBar from '../components/game/TopBar'
import CoinToss from '../components/game/CoinToss'
import VsIntro from '../components/game/VsIntro'
import PreMatchSpecial from '../components/game/PreMatchSpecial'
import { SpecialTray, SpecialInfoModal } from '../components/game/SpecialControls'
import StickerProto from '../components/game/StickerProto'
import HandRankModal from '../components/game/HandRankModal'
import ConfirmSubmit from '../components/game/ConfirmSubmit'
import ShowdownModal from '../components/game/ShowdownModal'
import MagnifierModal from '../components/game/MagnifierModal'
import EndModal from '../components/game/EndModal'
import CampaignEndModal from '../components/game/CampaignEndModal'
import { useCampaignStore } from '../../state/campaignStore'
import useBoardSizes from '../hooks/useBoardSizes'
import useSeats from '../hooks/useSeats'
import { sfx } from '../../audio/sfx'
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
    // Campaign matches (campaignStore) and free-match bot games (Matchmaking
    // screen, startCasualBotMatch) are already set up before launch — don't start
    // a plain single-player game over the top of them.
    if (pending?.mode === 'ai' && !pending.campaignSubId && !pending.casualBot) {
      const saved = (usePlatformStore.getState().profile?.equipped.specialCards ?? []) as SpecialCardId[]
      startSinglePlayer(!!pending.special, saved, false, pending.timeLimit ?? 50)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  if (pending && pending.mode !== 'ai') {
    return <OnlineGame mode={pending.mode} roomId={pending.roomId} />
  }
  return <PlayGame />
}

/** Renders the VS intro → coin toss → board from whatever is in the gameStore
 *  (shared by single-player and online). */
function PlayGame() {
  const g = useGameStore()
  const seats = useSeats()
  const [introDone, setIntroDone] = useState(false)
  // Show the VS splash again whenever a new coin toss begins (new game / rematch).
  useEffect(() => {
    if (g.status === 'coinToss') setIntroDone(false)
  }, [g.status])

  if (g.status === 'coinToss') {
    if (!introDone) {
      return <VsIntro p1={seats.p1} p2={seats.p2} onDone={() => setIntroDone(true)} />
    }
    // Special-card room: pre-match pick (B) before the coin toss (online: both
    // must confirm — PreMatchSpecial shows a waiting state after you confirm).
    if (g.special && !g.loadoutReady) {
      return <PreMatchSpecial />
    }
    if (g.coinFirstPicker) {
      return (
        <CoinToss
          firstPicker={g.coinFirstPicker}
          me={g.me}
          p1={seats.p1}
          p2={seats.p2}
          onDone={g.online ? g.finishCoinTossOnline : g.finishCoinToss}
        />
      )
    }
    return null // waiting for the (online) coin result
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
  const username = usePlatformStore((s) => s.username)
  const displayName = usePlatformStore((s) => s.displayName)
  const myAvatar = usePlatformStore((s) => s.profile?.equipped?.avatar)
  const myUnlockedSpecials = usePlatformStore((s) => s.profile?.unlocked?.specialCards)
  const myUid = usePlatformStore((s) => s.uid)
  useEffect(() => {
    if (netPhase === 'connected' && code) attachOnline(code, mode)
  }, [netPhase, code, mode])
  // Publish my display identity + unlocked special-card set (for the PvP
  // intersection pool) + my uid (so the opponent can open my public name-card, #5).
  useEffect(() => {
    if (netPhase !== 'connected' || !code) return
    const specials = username === 'ricky' ? ALL_SPECIAL_CARD_IDS : Object.keys(myUnlockedSpecials ?? { swap: true })
    const base = { specials, uid: myUid }
    const meta = displayName
      ? { name: displayName, avatarId: myAvatar || 'cat', ...base }
      : { name: 'guest', avatarId: mode === 'host' ? 'cat' : 'bird', ...base }
    void setPlayerMeta(code, mode, meta)
  }, [netPhase, code, mode, username, displayName, myAvatar, myUnlockedSpecials, myUid])
  // #8:不再於 pagehide 立即記敗(重整/切分頁/短暫斷線都會觸發 pagehide → 會誤記)。
  // 改由「開打即寫 openMatch 標記,下次開 app 若回不到同一房才補記一敗」處理(見 net/room
  // + tryReconnect / reconcileAbandonedMatch),對手那邊仍靠斷線 90 秒判定照常記勝。
  // 這局有沒有「真的開打」(有出牌被判勝場/場次)。全部判勝/發鑽/流程都以此為前提。
  const engine = useGameStore((s) => s.engine)
  const matchStarted =
    !!engine &&
    (engine.slots.some((s) => s.p1.length > 0 || s.p2.length > 0) ||
      engine.placementsDone.p1 + engine.placementsDone.p2 > 0 ||
      !!engine.pendingPick)
  const foeAbandoned = room?.abandoned === (mode === 'host' ? 'guest' : 'host')
  const forfeitedRef = useRef(false)
  const [dcWin, setDcWin] = useState(false) // 斷線等滿 90 秒、判我勝的彈窗
  // silent=true → 我自己提早離開才知道贏(斷線)→ 不放勝利音,獎勵在主畫面跑。
  const claimWin = (silent: boolean) => {
    if (forfeitedRef.current) return false
    forfeitedRef.current = useGameStore.getState().forfeitOnline(true, { silent })
    return forfeitedRef.current
  }
  // 對手「主動離開房間(中離)」一確認就當下判勝(你在遊戲中 → 有勝利音)。
  useEffect(() => {
    if (foeAbandoned && matchStarted) claimWin(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foeAbandoned, matchStarted])

  if (netPhase !== 'connected') return <Lobby mode={mode} roomId={roomId} />

  const foeKey = mode === 'host' ? 'guest' : 'host'
  // presence exists once the foe has joined; connected===false means they dropped
  const foeConnected = room?.players?.[foeKey]?.connected !== false
  const exit = () => {
    useGameStore.getState().leaveOnline()
    go('menu')
  }
  // 斷線:提早離開 = silent 判勝(獎勵回主畫面跑、無勝利音);等滿 90 秒沒回 = 在遊戲中判勝
  // (有勝利音 + 「你獲勝」彈窗)。都以 matchStarted(有出牌)為前提,否則只是離開不判勝。
  const disconnectLeave = () => {
    if (matchStarted) claimWin(true)
    exit()
  }
  const disconnectTimeout = () => {
    if (matchStarted && claimWin(false)) setDcWin(true)
    else exit()
  }
  return (
    <>
      <PlayGame />
      {dcWin ? (
        <WinOverlay title="對手已斷線,你獲得勝利！" onExit={exit} />
      ) : foeAbandoned ? (
        // 只有「對局進行中」對手中離才算判勝;若這一局已正常結束(對方只是在結算後
        // 不想再玩而離開),不再宣告勝利、也不重判——只顯示「對手已離開遊戲」(#8)。
        <LeftOverlay won={matchStarted && engine?.phase !== 'ended'} onExit={exit} />
      ) : !foeConnected ? (
        <DisconnectOverlay hostGone={mode === 'guest'} onTimeout={disconnectTimeout} onLeave={disconnectLeave} />
      ) : null}
    </>
  )
}

/** Opponent chose to leave — no countdown, just an exit. `won` = the match had
 *  started, so the leave counts as my win (勝利音/發鑽已在偵測到當下觸發)。 */
function LeftOverlay({ won, onExit }: { won: boolean; onExit: () => void }) {
  return (
    <div className="net-overlay">
      <div className="net-overlay__card">
        <div className="net-overlay__title">{won ? '對手已離開遊戲,你獲得勝利！' : '對手已離開遊戲'}</div>
        <div className="net-overlay__msg">這一局結束了。</div>
        <div style={{ marginTop: 14 }}>
          <Button onClick={onExit}>返回主畫面</Button>
        </div>
      </div>
    </div>
  )
}

/** Won because a disconnected opponent never came back within 90s. */
function WinOverlay({ title, onExit }: { title: string; onExit: () => void }) {
  return (
    <div className="net-overlay">
      <div className="net-overlay__card">
        <div className="net-overlay__title">{title}</div>
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
  const inCampaign = useCampaignStore((s) => s.series !== null)
  const sz = useBoardSizes()
  const seats = useSeats()
  const lastPvpReward = usePlatformStore((s) => s.lastPvpReward)
  // Tap the opponent's avatar → their public info card (#5). Online foes only
  // (AI/campaign have no card); uid comes from the synced room meta.
  const room = useNetStore((s) => s.room)
  const [foeCardOpen, setFoeCardOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false) // 牌型大小速查 (#5)
  const foeRole = g.online ? (g.online.role === 'host' ? 'guest' : 'host') : null
  const foeUid = foeRole ? ((room?.players?.[foeRole] as { uid?: string | null } | undefined)?.uid ?? null) : null

  // Pause is unlimited: online is a shared synced flag (either side toggles),
  // single-player is a local toggle. While paused, no move may be made — only
  // resuming (and, later, emoji) is allowed. Declared up here so the action
  // gates below (submit / place / hand / special) can all respect it.
  const [paused, setPaused] = useState(false) // single-player local pause
  const isPaused = g.online ? g.onlinePause.active : paused
  // Special-card one-shot: after it's spent the button stays (greyed); tapping
  // or hovering it flashes a small bubble explaining it's used up (like 鳥鳥's
  // "N 張" bubble) instead of silently doing nothing.
  const [spentTip, setSpentTip] = useState(false)
  const spentTipT = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tap (touch, no hover) → show the "used up" bubble and keep it visible for a
  // beat so it doesn't just flash. Desktop uses hover (pointer handlers below).
  const flashSpentTip = () => {
    if (spentTipT.current) clearTimeout(spentTipT.current)
    setSpentTip(true)
    spentTipT.current = setTimeout(() => setSpentTip(false), 2000)
  }

  // Name label under/over the avatar. FIXED width (sized for the 15-byte max =
  // 7中文/15英文) so it never resizes with the name; the outer edge is pinned
  // (Game.css: my field's left edge to the far left, the foe's right edge to the
  // far right). Text is CENTERED in the field and the avatar is centered over the
  // same field (align-items:center), so a 3/5/7-char name always sits centred and
  // nothing drifts by length. Reserve (useBoardSizes) is widened so the centred
  // avatar still clears the hand.
  const nameStyle: CSSProperties = {
    width: 110,
    textAlign: 'center',
    marginTop: 2,
    fontSize: 13,
    fontWeight: 800,
    color: '#fff',
    textShadow: '0 1px 2px rgba(0,0,0,0.75)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-display)',
  }

  // ----- AI driver (single-player only) -----
  useEffect(() => {
    if (!engine) return
    if (g.online) return // online: the opponent is a human, no AI
    if (g.showdownOpen || g.endOpen) return
    let timer: ReturnType<typeof setTimeout> | undefined
    if (engine.phase === 'pick' && engine.turn !== me) {
      timer = setTimeout(() => {
        // The AI may spend its one-shot special before picking (#13). If it
        // does, the engine changes → this effect re-runs (now specialUsed) and
        // the pick fires on the next pass, giving a natural beat between them.
        if (g.aiMaybeSpecial()) return
        g.submitPick(aiPick(engine, engine.turn, g.aiBoss ?? undefined))
      }, 850)
    } else if (engine.phase === 'place') {
      const placer = otherPlayer(engine.pendingPick!.by)
      if (placer !== me) timer = setTimeout(() => g.placeAt(aiPlace(engine, placer, g.aiBoss ?? undefined)), 850)
    }
    return () => timer && clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, g.showdownOpen, g.endOpen])

  const iPick = engine.phase === 'pick' && engine.turn === me
  const iPlace = engine.phase === 'place' && engine.pendingPick && otherPlayer(engine.pendingPick.by) === me
  const myActive = !!iPick || !!iPlace
  const foeActive = engine.phase !== 'ended' && !g.showdownOpen && !myActive

  // ----- special cards (Phase C, single-player) -----
  const targeting = g.specialTargeting
  const targetingDef = targeting ? getSpecialCard(targeting) : undefined
  const targetableIds = targeting
    ? new Set(
        (targetingDef?.suit
          ? suitTargets(engine, me, targetingDef.suit)
          : swapTargets(engine, me)
        ).map((c) => c.id),
      )
    : null
  // Show the trigger throughout my pick turn; grey it out (disabled) once spent
  // rather than removing it, so the player still sees the one-shot is used.
  const showSpecialBtn = g.special && iPick && !targeting && g.loadout.length > 0
  const specialSpent = engine.specialUsed[me]
  const targetHint = targetingDef?.suit
    ? `選一張手牌，變成 ${SUIT_SYMBOL[targetingDef.suit]}`
    : '選一張手牌換掉'

  // ----- per-turn timer -----
  // Whose turn it is to act: on pick, the picker; on place, the placer (the
  // opponent of the picker). Pick uses the room's limit; placement is 30s.
  const activePicker =
    engine.phase === 'pick'
      ? engine.turn
      : engine.phase === 'place' && engine.pendingPick
        ? otherPlayer(engine.pendingPick.by)
        : null
  const isMyActionTurn = activePicker === me
  const inPlay = !g.showdownOpen && !g.endOpen && engine.phase !== 'ended'
  // Show the countdown on my turn always; on the opponent's turn only online
  // (single-player AI acts instantly — a flashing counter would be pointless).
  const timed = !!activePicker && inPlay && (isMyActionTurn || !!g.online)
  const turnDuration = engine.phase === 'place' ? 30 : g.timeLimit
  const turnKey = `${engine.phase}:${engine.turn}:${engine.placementsDone.p1}:${engine.placementsDone.p2}`
  const [secsLeft, setSecsLeft] = useState(turnDuration)
  const showPause = g.online ? inPlay : isMyActionTurn && inPlay
  const onPauseClick = g.online ? g.togglePauseOnline : () => setPaused((p) => !p)
  const pausedRef = useRef(false)
  pausedRef.current = isPaused
  useEffect(() => setPaused(false), [turnKey]) // single-player: fresh turn → resume
  // 暫停/繼續都用「成功音」,雙方都聽到:online 兩端都由 onlinePause.active 推導 isPaused,
  // 各自的 effect 會觸發;單機則是本地 toggle。用「變化」驅動,不論誰按下都只響一次。
  const prevPausedRef = useRef(isPaused)
  useEffect(() => {
    if (isPaused !== prevPausedRef.current) {
      prevPausedRef.current = isPaused
      sfx.success()
    }
  }, [isPaused])
  useEffect(() => {
    if (!timed) {
      setSecsLeft(turnDuration)
      return
    }
    setSecsLeft(turnDuration)
    const id = setInterval(() => {
      if (pausedRef.current) return // frozen while paused (value preserved)
      setSecsLeft((s) => (s <= 0 ? 0 : s - 1))
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, turnKey, turnDuration])
  // Auto-play only MY own turn when it hits zero (opponent's client does theirs).
  useEffect(() => {
    if (timed && isMyActionTurn && secsLeft === 0) g.timeoutAutoPlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secsLeft, timed, isMyActionTurn])
  // Countdown: one tick every second through the final 15s of MY turn. The 1s
  // interval above freezes secsLeft while paused, so this naturally stops on pause
  // and resumes from the remaining seconds; a played card / new turn resets turnKey
  // (secsLeft jumps back above 15) so the ticking stops immediately.
  useEffect(() => {
    // pick 從剩 15s、place(放置別人的牌)從剩 8s 起,每秒一聲;只有「有決定權的人」(isMyActionTurn)聽到。
    const cdFrom = engine.phase === 'place' ? 8 : 15
    if (timed && isMyActionTurn && secsLeft <= cdFrom && secsLeft >= 1 && turnDuration > cdFrom) sfx.countdown()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secsLeft, timed, isMyActionTurn])
  const timerLabel = `${isMyActionTurn ? '你的' : '對方的'}${engine.phase === 'place' ? '放置時間' : '出手時間'}`

  const statusText =
    engine.phase === 'pick'
      ? engine.turn === me
        ? '你的回合：點選 1~5 張牌，按「送出」'
        : '對手思考中…'
      : engine.phase === 'place'
        ? iPlace
          ? '把對手的牌指定到對手任意發亮的空格上'
          : '對手正在放置你的牌…'
        : ''

  // Paused → no placing (the drop targets go inert until resume).
  const placeableSlot = (i: number) => !!iPlace && !isPaused && engine.slots[i][engine.pendingPick!.by].length === 0

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

      {timed && (
        <div className={`game__timer${secsLeft <= 10 && !isPaused ? ' game__timer--low' : ''}`}>
          {timerLabel}：{secsLeft}
        </div>
      )}
      {/* 暫停中:大字蓋在對手牌區(指示框與計時器之間),半透明 → 仍看得到對手的牌;
          pointer-events:none → 點對手格子的牌能穿透開放大鏡;z 高於牌桌、低於彈窗 (#6)。 */}
      {isPaused && inPlay && <div className="game__paused">暫停中</div>}
      {showPause && (
        <button
          type="button"
          className="game__pausebtn"
          onClick={onPauseClick}
          title={isPaused ? '繼續' : '暫停'}
          aria-label={isPaused ? '繼續' : '暫停'}
        >
          <svg viewBox="0 0 24 24" width="56%" height="56%">
            {isPaused ? (
              <path d="M7 4 L19 12 L7 20 Z" fill="currentColor" />
            ) : (
              <g fill="currentColor">
                <rect x="6" y="4" width="4.4" height="16" rx="1.2" />
                <rect x="13.6" y="4" width="4.4" height="16" rx="1.2" />
              </g>
            )}
          </svg>
        </button>
      )}

      {/* 牌型大小速查 (#5) — 木紋圓鈕,右側控制群「內欄・上」(與金幣列齊)。 */}
      <button
        type="button"
        className="game__helpbtn"
        onClick={() => { sfx.click(); setHelpOpen(true) }}
        title="牌型大小"
        aria-label="牌型大小"
      >
        ?
      </button>

      {/* 排序鈕(花色/大小 + 升降冪)— 移出 flex,絕對定位於 .game,與 pause/? 同座標系,
          手機/桌機對齊一致。 */}
      <SortButtons mode={g.sortMode} dir={g.sortDir} onToggleMode={g.toggleSortMode} onToggleDir={g.toggleSortDir} />

      <div
        className="game__foe-avatar"
        onClick={g.online ? () => { sfx.click(); setFoeCardOpen(true) } : undefined}
        style={g.online ? { cursor: 'pointer' } : undefined}
      >
        <div className={`avatar-wrap${foeActive ? ' avatar-wrap--active' : ''}`}>
          <PlayerAvatar avatarId={seats[foe].avatarId} size={sz.avatar} />
        </div>
        <div style={nameStyle}>{seats[foe].name}</div>
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
          <PlayerAvatar avatarId={seats[me].avatarId} size={sz.avatar} />
        </div>
        <div style={nameStyle}>{seats[me].name}</div>
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

        {/* empty right reserve — keeps the band centred; the sort buttons are now
            positioned absolutely in the .game coord system (below) so they line up
            with pause/? identically on phone & desktop. */}
        <div className="game__sort" />
      </div>

      {(g.statusOverride ?? statusText) && (
        // 只在「輪到我動作」(選牌 / 放對手的牌)時讓提示框微微呼吸,提醒玩家該他了;
        // 對手思考/確認中不呼吸(我沒決定權)。#5
        <div className={`game__status${myActive && !isPaused ? ' game__status--mine' : ''}`}>
          {g.statusOverride ?? statusText}
        </div>
      )}
      {/* online: I confirmed the showdown, waiting for the opponent to confirm too */}
      {!!g.online && engine.phase === 'showdown' && !g.showdownOpen && (
        <div className="game__status">等待對手確認…</div>
      )}

      {/* special-card targeting banner (choose a hand card as the effect target) */}
      {targeting && (
        <div className="game__special-banner">
          <span>{targetHint}</span>
          <Button size="sm" onClick={g.cancelSpecialTarget}>取消</Button>
        </div>
      )}

      <div className="game__hand">
        <Hand
          cards={engine.hands[me]}
          selected={targeting ? [] : g.selected}
          sortMode={g.sortMode}
          sortDir={g.sortDir}
          // 特殊牌指定(偷天換日/花色)一旦進入 targeting 就不受暫停凍結——否則玩家
          // 在指定過程中按到暫停/切分頁,手牌會變成不可點,只剩「取消」→ 看起來卡死(使用者回報#8)。
          // 一般選牌(iPick)仍受暫停凍結。
          interactive={!!targeting || (iPick && !isPaused)}
          onToggle={targeting ? g.activateSpecialTarget : g.toggleCard}
          targetableIds={targetableIds}
          cardW={sz.card}
          maxWidth={sz.handMax}
        />
      </div>

      {/* in-game special-card trigger (my pick phase, one-shot; greys when spent).
          When spent we keep it visible but inert, and surface a small bubble on
          hover/tap explaining it's used up (rather than a silent no-op). */}
      {showSpecialBtn && (
        <>
          {spentTip && <div className="game__special-tip">本場特殊牌已使用完畢</div>}
          <button
            type="button"
            className={`game__special-trigger${specialSpent || isPaused ? ' game__special-trigger--used' : ''}`}
            onClick={() => {
              if (specialSpent) return flashSpentTip()
              if (isPaused) return
              sfx.click()
              g.openSpecialTray()
            }}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse' && specialSpent) setSpentTip(true)
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse') setSpentTip(false)
            }}
            title={specialSpent ? '' : '發動特殊牌'}
          >
            <span className="game__special-trigger__star">✦</span>
            特殊牌
          </button>
        </>
      )}

      {iPick && !targeting && (
        <div className="game__action">
          <Button size="sm" disabled={g.selected.length === 0 || isPaused} onClick={g.openConfirm}>
            送出 {g.selected.length}
          </Button>
        </div>
      )}

      {g.special && (
        <>
          <SpecialTray />
          <SpecialInfoModal />
        </>
      )}

      <StickerProto />

      <HandRankModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {foeCardOpen && (
        <PlayerInfoCard
          uid={foeUid}
          fallback={{ name: seats[foe].name, avatarId: seats[foe].avatarId }}
          onClose={() => setFoeCardOpen(false)}
        />
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
      {inCampaign ? (
        <CampaignEndModal open={g.endOpen} winner={engine.winner} me={me} />
      ) : (
        <EndModal
          open={g.endOpen}
          winner={engine.winner}
          reason={engine.winReason}
          me={me}
          reward={lastPvpReward}
          waiting={!!g.online && g.rematchPending}
          // Free-match bot always "agrees" to a rematch → the player just clicks 再玩一場.
          foeWantsRematch={(!!g.online && g.foeWantsRematch) || !!g.casualFoe}
          onRematch={g.online ? g.agreeRematch : g.nextGame}
          onLeave={() => {
            if (g.online) g.leaveOnline()
            go('menu')
          }}
        />
      )}
    </div>
  )
}
