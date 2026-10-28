import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../state/appStore'
import { useCampaignStore } from '../../state/campaignStore'
import { useNetStore } from '../../state/netStore'
import { usePlatformStore } from '../../state/platformStore'
import JoinConfirm from '../components/JoinConfirm'
import Button, { Paw, IconRobot, IconDice, IconKey, IconGlobe, IconSpade, IconCards, IconHourglass } from '../components/Button'
import Modal from '../components/Modal'
import AccountButton from '../components/AccountButton'
import LiveBoard from '../components/LiveBoard'
import LobbyChat from '../components/LobbyChat'
import { sfx } from '../../audio/sfx'
import { LIMITED_INFO, LIMITED_TEST_MODE } from '../../game/limited'
import { limitedDayNow, limitedModeNow } from '../../net/limitedClock'
import { LimitedRotaModal } from '../components/game/LimitedRule'
import './Menu.css'

type Opponent = 'ai' | 'friend'
type TimeLimit = 50 | 99
type RoomKind = 'normal' | 'special' | 'limited'

export default function Menu() {
  const go = useAppStore((s) => s.go)
  const launchGame = useAppStore((s) => s.launchGame)
  const openMatchmaking = useAppStore((s) => s.openMatchmaking)
  const net = useNetStore()
  const [dialog, setDialog] = useState<null | 'start' | 'create' | 'join' | 'free'>(null)
  const [weekOpen, setWeekOpen] = useState(false) // 快速配對 / 建立房間「?」→ 限定房輪值表

  // Create-match config (#9): opponent · room type · per-turn time. Single-select
  // per group; pre-checked with sensible defaults (好友 · 特殊 · 99 秒).
  const [opponent, setOpponent] = useState<Opponent | null>('friend')
  const [kind, setKind] = useState<RoomKind | null>('special')
  const [time, setTime] = useState<TimeLimit | null>(99)
  const createReady = opponent !== null && kind !== null && time !== null
  // 今天的限定房玩法(伺服器時間換算台灣星期;測試期固定一種)。開房那一刻再算一次寫進房間。
  const todayName = LIMITED_INFO[limitedModeNow()].name

  const ensureAccount = () => void usePlatformStore.getState().ensureAccount()

  // Confirm the create-match config → launch vs computer, or open a room for a friend.
  const confirmCreate = () => {
    if (!createReady) return
    ensureAccount()
    const special = kind === 'special'
    // 限定房:玩法在開房這一刻決定(LIMITED-ROOM-SPEC §9),朋友房也照當天玩法
    const limited = kind === 'limited' ? limitedModeNow() : undefined
    if (opponent === 'ai') {
      launchGame({ mode: 'ai', special, timeLimit: time!, limited })
    } else {
      void net.create(kind!, time!, 'friend', limited ?? null)
      launchGame({ mode: 'host', special, timeLimit: time! })
    }
  }

  const joinRoom = (code: string) => {
    ensureAccount()
    void net.join(code)
    launchGame({ mode: 'guest', roomId: code })
  }
  const [joinCode, setJoinCode] = useState('')
  const [heroOk, setHeroOk] = useState(true)
  // A code awaiting the join-confirm popup (peeks type/time/host before joining).
  const [joinConfirmCode, setJoinConfirmCode] = useState<string | null>(null)

  const openStart = () => {
    sfx.unlock()
    setDialog('start')
  }

  // 快速配對 / 建立房間 標題列右上角「?」→ 限定房輪值表(spec §8.1 / §8.2)
  const rotaBtn = (
    <button
      type="button"
      className="backbtn menu__qbtn"
      onClick={() => { sfx.click(); setWeekOpen(true) }}
      aria-label="限定房輪值表"
      title="限定房輪值表"
    >
      ?
    </button>
  )

  return (
    <div className="menu">
      <AccountButton />
      <LiveBoard />
      <LobbyChat />

      {/* Full-bleed hero art (title baked in) */}
      {heroOk ? (
        <img
          className="menu__hero"
          src={`${import.meta.env.BASE_URL}title.webp`}
          alt="Seven Hand Poker"
          onError={() => setHeroOk(false)}
        />
      ) : (
        <div className="menu__hero-fallback">
          <h1 className="menu__fallback-title">Seven Hand Poker</h1>
        </div>
      )}

      {/* Buttons: vertical stack, lower-center over the felt */}
      {/* x:'-50%' is animated by framer so it isn't clobbered like a CSS transform would be */}
      <motion.div
        className="menu__buttons"
        initial={{ x: '-50%', y: 24, opacity: 0 }}
        animate={{ x: '-50%', y: 0, opacity: 1 }}
        transition={{ delay: 0.1, type: 'spring', stiffness: 220, damping: 22 }}
      >
        <Button full icon={<Paw />} onClick={openStart}>
          開始遊戲
        </Button>
        <Button full icon={<Paw />} variant="secondary" onClick={() => go('personalize')}>
          個人化設定
        </Button>
        <Button full icon={<Paw />} variant="secondary" onClick={() => go('leaderboard')}>
          排行榜
        </Button>
      </motion.div>

      {/* Start dialog: 4 modes */}
      <Modal open={dialog === 'start'} onClose={() => setDialog(null)} onBack={() => setDialog(null)} title="開始遊戲" largeTitle panelClass="menu-start menu-dialog">
        <Button full icon={<Paw />} onClick={() => { setDialog(null); useCampaignStore.getState().openChapters() }}>
          主線任務
        </Button>
        <Button full icon={<IconGlobe />} onClick={() => setDialog('free')}>
          快速配對
        </Button>
        <Button full icon={<IconDice />} onClick={() => setDialog('create')}>
          建立房間
        </Button>
        <Button full icon={<IconKey />} onClick={() => setDialog('join')}>
          加入房間
        </Button>
      </Modal>

      {/* Free match: pick room type, then search (30s for a human, else a bot). */}
      <Modal
        open={dialog === 'free'}
        onClose={() => setDialog('start')}
        onBack={() => setDialog('start')}
        title="快速配對"
        panelClass="menu-free menu-dialog"
        titleAction={rotaBtn}
      >
        <p className="menu__hint">選擇房型,系統會線上為你配對對手,請耐心等待一下。</p>
        <Button
          full
          icon={<IconSpade />}
          onClick={() => {
            sfx.click()
            ensureAccount()
            setDialog('start') // 保留「開始遊戲」面板在底下,取消配對即回到圖一
            openMatchmaking('normal')
          }}
        >
          一般房配對
        </Button>
        <Button
          full
          icon={<IconCards />}
          onClick={() => {
            sfx.click()
            ensureAccount()
            setDialog('start') // 保留「開始遊戲」面板在底下,取消配對即回到圖一
            openMatchmaking('special')
          }}
        >
          特殊房配對
        </Button>
        <Button
          full
          icon={<IconHourglass />}
          onClick={() => {
            sfx.click()
            ensureAccount()
            setDialog('start') // 保留「開始遊戲」面板在底下,取消配對即回到圖一
            openMatchmaking('limited')
          }}
        >
          <span className="menu__btn-label">
            限定房配對<span className="menu__btn-sub">・{todayName}</span>
          </span>
        </Button>
      </Modal>
      <LimitedRotaModal open={weekOpen} onClose={() => setWeekOpen(false)} today={limitedDayNow()} testMode={LIMITED_TEST_MODE} />

      {/* Create-match config: opponent · room type · time (each required), confirm */}
      <Modal open={dialog === 'create'} onClose={() => setDialog('start')} onBack={() => setDialog('start')} title="建立房間" panelClass="menu-dialog" titleAction={rotaBtn}>
        <CheckGroup
          label="對手"
          value={opponent}
          onChange={setOpponent}
          options={[
            { value: 'ai', label: '對戰電腦' },
            { value: 'friend', label: '對戰好友' },
          ]}
        />
        <CheckGroup
          label="房型"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'normal', label: '一般房' },
            { value: 'special', label: '特殊房' },
            { value: 'limited', label: '限定房', sub: `今日：${todayName}` },
          ]}
        />
        <CheckGroup
          label="限時"
          value={time === null ? null : String(time)}
          onChange={(v) => setTime(Number(v) as TimeLimit)}
          options={[
            { value: '50', label: '50 秒' },
            { value: '99', label: '99 秒' },
          ]}
        />
        <Button
          full
          icon={opponent === 'friend' ? <IconDice /> : <IconRobot />}
          disabled={!createReady}
          onClick={confirmCreate}
        >
          {opponent === 'friend' ? '建立房間' : '開始對戰'}
        </Button>
      </Modal>

      {/* Join room */}
      <Modal open={dialog === 'join'} onClose={() => setDialog('start')} onBack={() => setDialog('start')} title="加入房間" panelClass="menu-dialog">
        <p className="menu__hint">輸入朋友給你的 3 碼房號：</p>
        <input
          className="menu__input"
          inputMode="numeric"
          maxLength={3}
          placeholder="000"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
        />
        <Button
          full
          disabled={joinCode.length !== 3}
          onClick={() => {
            setDialog(null)
            setJoinConfirmCode(joinCode)
          }}
        >
          加入房間
        </Button>
      </Modal>

      {/* Join-confirm popup (code-entry path) — same popup the deep-link uses. */}
      <JoinConfirm
        code={joinConfirmCode}
        onConfirm={() => {
          const c = joinConfirmCode!
          setJoinConfirmCode(null)
          joinRoom(c)
        }}
        onCancel={() => setJoinConfirmCode(null)}
      />
    </div>
  )
}

/** A labelled, required single-select group shown as compact checkbox chips.
 *  `value` is null until the user picks one (can't multi-select, can't skip). */
function CheckGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T | null
  onChange: (v: T) => void
  options: { value: T; label: string; sub?: string }[]
}) {
  return (
    <div className="cfg-group">
      <div className="cfg-group__label">{label}</div>
      <div className="cfg-checks" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`cfg-check${value === o.value ? ' cfg-check--on' : ''}`}
            onClick={() => {
              sfx.click()
              onChange(o.value)
            }}
          >
            <span className="cfg-box" aria-hidden="true" />
            {o.label}
            {/* 選項下面的小字(例:限定房「今日：百鬼夜行」)。浮在按鈕下方、不佔高度 → 各列間距跟原本一樣 */}
            {o.sub && (
              <span className="cfg-sub" aria-hidden="true">
                {o.sub}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
