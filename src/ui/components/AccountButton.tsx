import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../state/appStore'
import { useNetStore } from '../../state/netStore'
import { usePlatformStore } from '../../state/platformStore'
import { isUsernameTaken } from '../../platform/profile'
import { validateUsername, validatePassword, validateDisplayName, clampDisplayName, DISPLAY_NAME_HINT } from '../../platform/auth'
import { useToastStore } from '../../state/toastStore'
import Button, { IconShop } from './Button'
import Modal from './Modal'
import JoinConfirm from './JoinConfirm'
import Shop from './Shop'
import { avatarSrc } from './PlayerAvatar'
import Diamond from './game/Diamond'
import './AccountButton.css'

/**
 * Account UX (platform layer). See docs/PLATFORM-SPEC.md §2 / §4.
 * - First-launch gate: 註冊 / 登入 / 訪客 before reaching the menu (localStorage
 *   `shp.onboarded` remembers the choice per browser).
 * - Deep-link join (?room=): gate the identity FIRST, then join; registered
 *   users join straight through.
 * - Menu top-left: guest → 註冊 + 登入; registered → avatar + name. 登出 top-right.
 * Styled with the design system (wood Button, parchment Modal, Huninn font).
 * (公告 uses the 📢 emoji as its button icon.)
 */

const ONBOARDED_KEY = 'shp.onboarded'
const LAST_USER_KEY = 'shp.lastUser'

// Remember only the USERNAME (prefilled next time); never the password.
const rememberedUser = () => localStorage.getItem(LAST_USER_KEY) ?? ''
function remember(name: string) {
  try {
    localStorage.setItem(LAST_USER_KEY, name)
  } catch {
    /* ignore */
  }
}

type Dialog = null | 'gate' | 'register' | 'login' | 'chooseName'

function doJoin(code: string) {
  void usePlatformStore.getState().ensureAccount()
  void useNetStore.getState().join(code)
  useAppStore.getState().launchGame({ mode: 'guest', roomId: code })
  useAppStore.getState().setPendingRoom(null)
}

export default function AccountButton() {
  const ready = usePlatformStore((s) => s.ready)
  const displayName = usePlatformStore((s) => s.displayName)
  const uid = usePlatformStore((s) => s.uid)
  const isAnonymous = usePlatformStore((s) => s.isAnonymous)
  const avatarId = usePlatformStore((s) => s.profile?.equipped.avatar)
  const diamonds = usePlatformStore((s) => s.profile?.diamonds) ?? 0
  const logout = usePlatformStore((s) => s.logout)
  const pendingRoom = useAppStore((s) => s.pendingRoom)
  const wantRegister = useAppStore((s) => s.wantRegister)
  const wantGoogle = useAppStore((s) => s.wantGoogle)
  // A registered (non-anonymous) account. uid+isAnonymous are set together with
  // `ready`, so this is stable — unlike `username`, which loads a beat later via
  // the profile subscription (using username here caused the gate to flash for
  // already-logged-in users on a deep-link).
  const registered = !!uid && !isAnonymous

  const [dialog, setDialog] = useState<Dialog>(null)
  const [shopOpen, setShopOpen] = useState(false)
  const [announceOpen, setAnnounceOpen] = useState(false)
  const [fromGate, setFromGate] = useState(false)
  const [joinFlow, setJoinFlow] = useState(false)
  // Whether the chooser shows 訪客 (deep-link / first-launch) or not (the menu
  // 登入 / 註冊 button, where you're already browsing as a guest).
  const [gateAllowGuest, setGateAllowGuest] = useState(true)
  // A room code awaiting the join-confirm popup (peeks type/time/host).
  const [confirmCode, setConfirmCode] = useState<string | null>(null)

  // Decide when to show the gate: (a) a deep-link join needs an identity, or
  // (b) first launch with no account and not previously onboarded.
  useEffect(() => {
    if (!ready) return
    if (pendingRoom) {
      if (registered) {
        setConfirmCode(pendingRoom) // logged-in → straight to the confirm popup (no gate)
      } else {
        setJoinFlow(true)
        setFromGate(true)
        setGateAllowGuest(true)
        setDialog('gate')
      }
      return
    }
    if (!registered && !localStorage.getItem(ONBOARDED_KEY)) {
      setJoinFlow(false)
      setFromGate(true)
      setGateAllowGuest(true)
      setDialog('gate')
    }
  }, [ready, registered, pendingRoom])

  // From the upgrade prompt's 前往註冊 (#9): open the register form on the menu.
  useEffect(() => {
    if (wantRegister) {
      setFromGate(false)
      setJoinFlow(false)
      setDialog('register')
      useAppStore.getState().clearRegister()
    }
  }, [wantRegister])

  const onboard = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1')
    } catch {
      /* ignore */
    }
  }
  // Called after choosing 訪客 / finishing register / finishing login.
  const finish = () => {
    onboard()
    setFromGate(false)
    setDialog(null)
    const pr = useAppStore.getState().pendingRoom
    if (pr) setConfirmCode(pr) // identity resolved → now confirm the join
    setJoinFlow(false)
  }
  const closeForm = () => (fromGate ? setDialog('gate') : setDialog(null))

  // Google sign-in: no password to remember. First-timers then pick a display
  // name (chooseName); returning users go straight in.
  const [gBusy, setGBusy] = useState(false)
  const handleGoogle = async () => {
    if (gBusy) return
    setGBusy(true)
    const res = await usePlatformStore.getState().loginWithGoogle()
    setGBusy(false)
    if (!res.ok) {
      if (res.error) useToastStore.getState().show(res.error)
      return
    }
    if (res.needsName) {
      setFromGate(false)
      setDialog('chooseName') // first time → pick a display name
    } else {
      useToastStore.getState().show('登入成功！')
      finish()
    }
  }

  // From the upgrade prompt's 使用 Google 登入 (routed via the menu): fire Google.
  useEffect(() => {
    if (wantGoogle) {
      useAppStore.getState().clearGoogle()
      void handleGoogle()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantGoogle])

  if (!ready) return null

  return (
    <>
      <div className="acctbar">
        {registered ? (
          <button
            type="button"
            className="acctbar__me"
            onClick={() => useAppStore.getState().go('personalize')}
            title="個人化設定"
          >
            <img
              className="acctbar__avatar"
              src={avatarSrc(avatarId ?? 'cat')}
              alt=""
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
            <span className="acctbar__meta">
              <span className="acctbar__name">{displayName}</span>
              <span className="acctbar__gems">
                <Diamond size={19} />
                {diamonds}
              </span>
            </span>
          </button>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              setJoinFlow(false)
              setGateAllowGuest(false)
              setFromGate(true)
              setDialog('gate')
            }}
          >
            登入 / 註冊
          </Button>
        )}

        {/* 公告:置於頭像/名稱下方,靠左對齊,大小同商城鈕;icon 直接用 📢 */}
        <Button size="sm" variant="secondary" icon={<span className="acct-announce-ico">📢</span>} onClick={() => setAnnounceOpen(true)}>
          公告
        </Button>
      </div>

      {/* Top-right: 商城 → 登出 (設定 已併入個人化設置的頁籤). */}
      <div className="acctbar-right">
        <button
          type="button"
          className="acctbar-qbtn"
          onClick={() => useAppStore.getState().go('howto')}
          aria-label="遊戲介紹"
          title="遊戲介紹"
        >
          ?
        </button>
        <Button size="sm" variant="secondary" icon={<IconShop />} onClick={() => setShopOpen(true)}>
          商城
        </Button>
        {registered && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void logout()
              useToastStore.getState().show('已成功登出！')
            }}
          >
            登出
          </Button>
        )}
      </div>

      {/* Auth chooser — used from the menu 登入 / 註冊 button (no 訪客), and as the
          first-launch / deep-link gate (with 訪客). */}
      <Modal
        open={dialog === 'gate'}
        locked={gateAllowGuest}
        onClose={gateAllowGuest ? undefined : () => setDialog(null)}
        title={gateAllowGuest ? (joinFlow ? '加入朋友的房間' : '歡迎來到 Seven Hand Poker') : '登入 / 註冊'}
        width={360}
      >
        <p className="acct-note">
          {gateAllowGuest
            ? '建議使用 Google 登入免記帳密，並可保存玩家資訊；也可以先用訪客試玩。'
            : '建議使用 Google 登入免記帳密，並可保存玩家資訊。'}
        </p>
        <Button full onClick={() => void handleGoogle()} disabled={gBusy}>
          {gBusy ? '請稍候…' : 'Google 登入（推薦）'}
        </Button>
        <Button full variant="secondary" onClick={() => setDialog('login')}>遊戲帳號登入</Button>
        <Button full variant="secondary" onClick={() => setDialog('register')}>遊戲帳號註冊</Button>
        {gateAllowGuest ? (
          <Button full variant="ghost" onClick={finish}>{joinFlow ? '訪客加入' : '訪客進入'}</Button>
        ) : (
          <Button full variant="ghost" onClick={() => setDialog(null)}>返回</Button>
        )}
      </Modal>

      <Shop open={shopOpen} onClose={() => setShopOpen(false)} />

      {/* 公告彈窗 — 維護更新預告 + 特別感謝。未來新的更新日期往上加(保留約一個月),
          內容變長時 .announce 會自動出現捲軸。 */}
      <Modal open={announceOpen} onClose={() => setAnnounceOpen(false)} title="📢 公告" width={420}>
        <div className="announce">
          <section className="announce__sec">
            <h3 className="announce__head">維護更新預告</h3>
            <div className="announce__entry">
              <p className="announce__date">8 / 22</p>
              <ol className="announce__list">
                <li>新增關卡第七關</li>
                <li>新增貼圖</li>
                <li>新增 battle 畫面成就展示</li>
              </ol>
            </div>
          </section>
          <section className="announce__sec">
            <h3 className="announce__head">特別感謝</h3>
            <p className="announce__thanks">
              水哥、vic、ally、yuying、ttt12345、蛇哥 等人的遊玩與建議，讓遊戲功能得以更加完善。
            </p>
          </section>
        </div>
      </Modal>

      <RegisterForm open={dialog === 'register'} onClose={closeForm} onDone={() => setDialog('chooseName')} />
      <LoginForm open={dialog === 'login'} onClose={closeForm} onDone={finish} />
      <ChooseNameForm open={dialog === 'chooseName'} onDone={finish} />

      {/* Confirm the join (peeks type/time/host) — deep-link path. */}
      <JoinConfirm
        code={confirmCode}
        onConfirm={() => {
          const c = confirmCode!
          setConfirmCode(null)
          doJoin(c)
        }}
        onCancel={() => {
          setConfirmCode(null)
          useAppStore.getState().setPendingRoom(null)
        }}
      />
    </>
  )
}

type Avail = null | 'checking' | 'ok' | 'taken' | 'invalid'

function RegisterForm({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const register = usePlatformStore((s) => s.register)
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [avail, setAvail] = useState<Avail>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setPw('')
      setPw2('')
      setAvail(null)
      setError(null)
      setBusy(false)
    }
  }, [open])

  const checkAvail = async () => {
    if (!name) return
    if (validateUsername(name)) return setAvail('invalid')
    setAvail('checking')
    try {
      setAvail((await isUsernameTaken(name)) ? 'taken' : 'ok')
    } catch {
      setAvail(null)
    }
  }

  const submit = async () => {
    if (busy) return
    setError(null)
    const v = validateUsername(name) ?? validatePassword(pw)
    if (v) return setError(v)
    if (pw !== pw2) return setError('兩次密碼不一致')
    setBusy(true)
    const res = await register(name, pw)
    setBusy(false)
    if (res.ok) {
      remember(name)
      onDone() // → pick a display name
    } else setError(res.error)
  }

  // Wipe what was typed on leave, so a half-typed password never lingers in
  // state/DOM after 返回 (nothing is ever sent unless you press 確定).
  const handleClose = () => {
    setName('')
    setPw('')
    setPw2('')
    setAvail(null)
    setError(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="遊戲帳號註冊" width={360} panelClass="modal__panel--auth">
      <label className="acct-field">
        <span>帳號</span>
        <input
          className="acct-input"
          value={name}
          maxLength={16}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="2–16 字，英文或數字"
          onChange={(e) => { setName(e.target.value); setAvail(null) }}
          onBlur={() => void checkAvail()}
        />
        {avail && (
          <span className={`acct-avail acct-avail--${avail}`}>
            {avail === 'checking' && '檢查中…'}
            {avail === 'ok' && '✓ 可以使用'}
            {avail === 'taken' && '✗ 此帳號已被使用'}
            {avail === 'invalid' && '✗ 需 2–16 字，英文或數字'}
          </span>
        )}
      </label>
      <label className="acct-field">
        <span>密碼</span>
        <input className="acct-input" type="password" autoComplete="new-password" value={pw} maxLength={64} placeholder="至少 6 個字" onChange={(e) => setPw(e.target.value)} />
      </label>
      <label className="acct-field">
        <span>確認密碼</span>
        <input
          className="acct-input"
          type="password"
          autoComplete="new-password"
          value={pw2}
          maxLength={64}
          placeholder="再輸入一次密碼"
          onChange={(e) => setPw2(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </label>
      {error && <p className="acct-error">{error}</p>}
      <p className="acct-note acct-note--tiny">沒有真實信箱，忘記密碼無法找回，請記牢。</p>
      <div className="acct-btnrow">
        <Button variant="ghost" onClick={handleClose}>返回</Button>
        <Button disabled={busy || !name || !pw || !pw2 || avail === 'taken'} onClick={() => void submit()}>
          {busy ? '請稍候…' : '確定'}
        </Button>
      </div>
    </Modal>
  )
}

function LoginForm({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const login = usePlatformStore((s) => s.login)
  const [name, setName] = useState(rememberedUser)
  const [pw, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(rememberedUser())
      setPw('')
      setError(null)
      setBusy(false)
    }
  }, [open])

  const submit = async () => {
    if (busy) return
    setError(null)
    setBusy(true)
    const res = await login(name, pw)
    setBusy(false)
    if (res.ok) {
      remember(name)
      useToastStore.getState().show(`${name}，歡迎回來！`)
      onDone()
    } else setError(res.error)
  }

  const handleClose = () => {
    setPw('')
    setError(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="遊戲帳號登入" width={360} panelClass="modal__panel--auth">
      <label className="acct-field">
        <span>帳號</span>
        <input
          className="acct-input"
          value={name}
          maxLength={16}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="你的帳號"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="acct-field">
        <span>密碼</span>
        <input
          className="acct-input"
          type="password"
          autoComplete="current-password"
          value={pw}
          maxLength={64}
          placeholder="你的密碼"
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </label>
      {error && <p className="acct-error">{error}</p>}
      <div className="acct-btnrow">
        <Button variant="ghost" onClick={handleClose}>返回</Button>
        <Button disabled={busy || !name || !pw} onClick={() => void submit()}>
          {busy ? '請稍候…' : '登入'}
        </Button>
      </div>
    </Modal>
  )
}

/** First-time Google users pick a display name (locked — an account without a
 *  name would show the guest UI). Free-form (can be Chinese), prefilled from the
 *  Google account name. No password: Google is the credential. */
function ChooseNameForm({ open, onDone }: { open: boolean; onDone: () => void }) {
  const choose = usePlatformStore((s) => s.chooseDisplayName)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Don't clamp while an IME is composing (Chinese) — truncating the pinyin
  // buffer mid-compose corrupts it (eats characters). Clamp on composition end.
  const composing = useRef(false)

  useEffect(() => {
    if (open) {
      setName('')
      setError(null)
      setBusy(false)
    }
  }, [open])

  const submit = async () => {
    if (busy) return
    setError(null)
    const v = validateDisplayName(name)
    if (v) return setError(v)
    setBusy(true)
    const res = await choose(name)
    setBusy(false)
    if (res.ok) {
      useToastStore.getState().show(`歡迎，${name.trim()}！`)
      onDone()
    } else setError(res.error)
  }

  return (
    <Modal open={open} locked title="取一個顯示名稱" width={360} panelClass="modal__panel--auth">
      <p className="acct-note">Google 登入成功！取一個遊戲內顯示名稱（{DISPLAY_NAME_HINT}，中英數皆可）。</p>
      <label className="acct-field">
        <span>顯示名稱</span>
        <input
          className="acct-input"
          value={name}
          placeholder="金乘五"
          onChange={(e) => { const v = e.target.value; setName(composing.current ? v : clampDisplayName(v)); setError(null) }}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={(e) => { composing.current = false; setName(clampDisplayName(e.currentTarget.value)) }}
          onKeyDown={(e) => e.key === 'Enter' && !composing.current && void submit()}
        />
      </label>
      {error && <p className="acct-error">{error}</p>}
      <Button full disabled={busy || !name.trim()} onClick={() => void submit()}>
        {busy ? '請稍候…' : '確定'}
      </Button>
    </Modal>
  )
}
