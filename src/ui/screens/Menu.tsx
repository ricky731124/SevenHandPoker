import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../state/appStore'
import { useNetStore } from '../../state/netStore'
import { usePlatformStore } from '../../state/platformStore'
import JoinConfirm from '../components/JoinConfirm'
import Button, { Paw, IconRobot, IconDice, IconKey, IconGlobe } from '../components/Button'
import Modal from '../components/Modal'
import AccountButton from '../components/AccountButton'
import { sfx } from '../../audio/sfx'
import './Menu.css'

type Opponent = 'ai' | 'friend'
type TimeLimit = 50 | 99

export default function Menu() {
  const go = useAppStore((s) => s.go)
  const launchGame = useAppStore((s) => s.launchGame)
  const openMatchmaking = useAppStore((s) => s.openMatchmaking)
  const net = useNetStore()
  const [dialog, setDialog] = useState<null | 'start' | 'create' | 'join' | 'free'>(null)

  // Create-match config (#9): opponent · room type · per-turn time. Single-select
  // per group; pre-checked with sensible defaults (好友 · 特殊 · 99 秒).
  const [opponent, setOpponent] = useState<Opponent | null>('friend')
  const [special, setSpecial] = useState<boolean | null>(true)
  const [time, setTime] = useState<TimeLimit | null>(99)
  const createReady = opponent !== null && special !== null && time !== null

  const ensureAccount = () => void usePlatformStore.getState().ensureAccount()

  // Confirm the create-match config → launch vs computer, or open a room for a friend.
  const confirmCreate = () => {
    if (!createReady) return
    ensureAccount()
    if (opponent === 'ai') {
      launchGame({ mode: 'ai', special: special!, timeLimit: time! })
    } else {
      void net.create(special ? 'special' : 'normal', time!)
      launchGame({ mode: 'host', special: special!, timeLimit: time! })
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

  return (
    <div className="menu">
      <AccountButton />

      {/* Full-bleed hero art (title baked in) */}
      {heroOk ? (
        <img
          className="menu__hero"
          src={`${import.meta.env.BASE_URL}title.png`}
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
      <Modal open={dialog === 'start'} onClose={() => setDialog(null)} title="開始遊戲" largeTitle>
        <Button full icon={<Paw />} onClick={() => { setDialog(null); go('campaignStages') }}>
          主線任務
        </Button>
        <Button full icon={<IconDice />} onClick={() => setDialog('create')}>
          建立對戰
        </Button>
        <Button full icon={<IconKey />} onClick={() => setDialog('join')}>
          加入對戰
        </Button>
        <Button full icon={<IconGlobe />} onClick={() => setDialog('free')}>
          自由匹配
        </Button>
      </Modal>

      {/* Free match: pick room type, then search (30s for a human, else a bot). */}
      <Modal open={dialog === 'free'} onClose={() => setDialog('start')} title="自由匹配">
        <p className="menu__hint">選擇房型,系統會為你配對對手：</p>
        <Button
          full
          icon={<IconGlobe />}
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
          icon={<IconGlobe />}
          onClick={() => {
            sfx.click()
            ensureAccount()
            setDialog('start') // 保留「開始遊戲」面板在底下,取消配對即回到圖一
            openMatchmaking('special')
          }}
        >
          特殊房配對
        </Button>
      </Modal>

      {/* Create-match config: opponent · room type · time (each required), confirm */}
      <Modal open={dialog === 'create'} onClose={() => setDialog('start')} title="建立對戰">
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
          value={special === null ? null : special ? 'special' : 'normal'}
          onChange={(v) => setSpecial(v === 'special')}
          options={[
            { value: 'normal', label: '一般房間' },
            { value: 'special', label: '特殊房間' },
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
      <Modal open={dialog === 'join'} onClose={() => setDialog('start')} title="加入對戰">
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
  options: { value: T; label: string }[]
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
          </button>
        ))}
      </div>
    </div>
  )
}
