import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../state/appStore'
import { usePlatformStore } from '../../state/platformStore'
import { useToastStore } from '../../state/toastStore'
import { clampDisplayName } from '../../platform/auth'
import PlayerAvatar, { AVATARS } from '../components/PlayerAvatar'
import SpecialCard, { SpecialCardArt } from '../components/SpecialCard'
import CardCarousel, { type CarouselSlide } from '../components/CardCarousel'
import Badge from '../components/Badge'
import CardBack from '../components/CardBack'
import useMobileWebScale from '../hooks/useMobileWebScale'
import { SPECIAL_CARD_LIST, LOADOUT_SIZE, type SpecialCardDef } from '../../game/specialCards'
import { ACHIEVEMENTS, TIER_NAME_ZH, tierFor, type AchMetric } from '../../game/achievements'
import { STICKERS, stickerSrc, ownsSticker } from '../../game/stickers'
import { sfx } from '../../audio/sfx'
import './Panel.css'
import './Personalize.css'

/**
 * Personalization hub (Phase C surface A). Tabs: 頭像 / 戰績 / 成就 / 牌組 / 表情.
 * 頭像 and 牌組 are live; the rest are placeholders for later phases. Back is a
 * ← icon left of the tabs (and clicking outside the panel also returns).
 */

type Tab = 'avatar' | 'stats' | 'achievements' | 'cards' | 'emoji' | 'settings'
const TABS: { id: Tab; label: string; ready: boolean }[] = [
  { id: 'avatar', label: '頭像', ready: true },
  { id: 'stats', label: '戰績', ready: true },
  { id: 'achievements', label: '成就', ready: true },
  { id: 'cards', label: '牌組', ready: true },
  { id: 'emoji', label: '貼圖', ready: true },
  { id: 'settings', label: '設定', ready: true },
]

export default function Personalize() {
  const go = useAppStore((s) => s.go)
  const profile = usePlatformStore((s) => s.profile)
  const username = usePlatformStore((s) => s.username)
  const saveLoadout = usePlatformStore((s) => s.saveLoadout)
  const saveAvatar = usePlatformStore((s) => s.saveAvatar)
  const saveAchievements = usePlatformStore((s) => s.saveAchievements)
  const [tab, setTab] = useState<Tab>('avatar')
  const mw = useMobileWebScale()

  useEffect(() => {
    void usePlatformStore.getState().ensureAccount()
  }, [])

  const allUnlocked = username === 'ricky' // test account: everything open

  return (
    <div className="pz-screen" onClick={() => go('menu')}>
      <motion.div
        className="panel panel--wide"
        initial={{ opacity: 0, y: 16, scale: mw }}
        animate={{ opacity: 1, y: 0, scale: mw }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pz__topbar">
          <button className="pz-back" onClick={() => { sfx.click(); go('menu') }} aria-label="返回" title="返回">
            <svg viewBox="0 0 24 24" width="26" height="26">
              <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="pz__tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`pz__tab${tab === t.id ? ' pz__tab--on' : ''}${t.ready ? '' : ' pz__tab--locked'}`}
                onClick={() => {
                  if (!t.ready) return
                  sfx.click()
                  setTab(t.id)
                }}
                disabled={!t.ready}
                title={t.ready ? undefined : '即將推出'}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel__scroll">
          {tab === 'avatar' && (
            <AvatarTab
              equipped={profile?.equipped.avatar ?? 'cat'}
              unlocked={profile?.unlocked.avatars ?? {}}
              allUnlocked={allUnlocked}
              onSave={saveAvatar}
            />
          )}
          {tab === 'cards' && (
            <LoadoutTab
              equipped={profile?.equipped.specialCards ?? []}
              unlocked={profile?.unlocked.specialCards ?? {}}
              allUnlocked={allUnlocked}
              onSave={saveLoadout}
            />
          )}
          {tab === 'stats' && <StatsTab stats={profile?.stats ?? {}} />}
          {tab === 'achievements' && (
            <AchievementsTab
              stats={profile?.stats ?? {}}
              equipped={profile?.equipped.achievements ?? []}
              onSave={saveAchievements}
            />
          )}
          {tab === 'emoji' && <EmojiTab owned={profile?.unlocked.emojis ?? {}} allUnlocked={allUnlocked} />}
          {tab === 'settings' && <SettingsTab />}
        </div>
      </motion.div>
    </div>
  )
}

/** Shared "□ 顯示全部" toggle — sits to the left of a tab's hint text. */
function ShowAllToggle({ checked, onChange }: { checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 14, color: 'var(--wood-700, #6a4e2c)', fontFamily: 'var(--font-display)', whiteSpace: 'nowrap' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--wood-2, #a9793f)', cursor: 'pointer' }} />
      顯示全部
    </label>
  )
}

/** Big card art sized for the carousel (1.4 card ratio). */
function cardSlideArt(c: SpecialCardDef): ReactNode {
  return (
    <span style={{ display: 'block', width: 150, height: 210 }}>
      <SpecialCardArt id={c.id} color={c.accent} uid={`car-${c.id}`} />
    </span>
  )
}

function stickerSlideArt(s: (typeof STICKERS)[number]): ReactNode {
  return s.emoji ? (
    <span style={{ fontSize: 110, lineHeight: 1 }}>{s.emoji}</span>
  ) : (
    <img src={stickerSrc(s.id)} alt={s.name} style={{ width: 190, height: 190, objectFit: 'contain' }} />
  )
}

/** Button that tells single-tap from double-tap (works on touch — no native dblclick). */
function TapButton({
  onSingle,
  onDouble,
  className,
  style,
  title,
  disabled,
  children,
}: {
  onSingle?: () => void
  onDouble?: () => void
  className?: string
  style?: React.CSSProperties
  title?: string
  disabled?: boolean
  children: ReactNode
}) {
  const clicks = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handle = () => {
    clicks.current += 1
    if (clicks.current === 1) {
      timer.current = setTimeout(() => {
        clicks.current = 0
        onSingle?.()
      }, 240)
    } else {
      if (timer.current) clearTimeout(timer.current)
      clicks.current = 0
      onDouble?.()
    }
  }
  return (
    <button type="button" className={className} style={style} title={title} disabled={disabled} onClick={handle}>
      {children}
    </button>
  )
}

function AvatarTab({
  equipped,
  unlocked,
  allUnlocked,
  onSave,
}: {
  equipped: string
  unlocked: Record<string, true>
  allUnlocked: boolean
  onSave: (id: string) => Promise<void>
}) {
  const [showAll, setShowAll] = useState(false)
  const [popup, setPopup] = useState(-1)
  const avail = (a: (typeof AVATARS)[number]) => allUnlocked || a.free || !!unlocked[a.id]
  const displayed = AVATARS.filter((a) => showAll || avail(a))

  const pick = (id: string) => {
    const a = AVATARS.find((x) => x.id === id)
    if (!a || !avail(a) || id === equipped) return
    sfx.success() // 裝備變更(頭像)
    void onSave(id) // select == equip (applies immediately)
    useToastStore.getState().show('頭像已更新！')
  }

  const slides: CarouselSlide[] = displayed.map((a) => {
    const ok = avail(a)
    const isOn = equipped === a.id
    return {
      key: a.id,
      art: <PlayerAvatar avatarId={a.id} size={150} />,
      name: a.name,
      statusText: !ok ? '未解鎖' : isOn ? '使用中' : '可用',
      statusColor: !ok ? '#8a6a3e' : isOn ? '#c0392b' : 'var(--wood-700, #6a4e2c)',
      selectable: ok && !isOn,
    }
  })

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <ShowAllToggle checked={showAll} onChange={setShowAll} />
        <p className="pz-hint pz-hint--left" style={{ margin: 0, width: 'auto' }}>單擊看大圖 · 雙擊直接選取</p>
      </div>
      <div className="pz-avatars">
        {displayed.map((a, i) => {
          const ok = avail(a)
          const on = equipped === a.id
          return (
            <TapButton
              key={a.id}
              className={`pz-av${on ? ' pz-av--on' : ''}${ok ? '' : ' pz-av--locked'}`}
              onSingle={() => { sfx.click(); setPopup(i) }}
              onDouble={() => pick(a.id)}
              title={ok ? a.name : `${a.name}（未解鎖）`}
            >
              <PlayerAvatar avatarId={a.id} size={60} />
              <span className="pz-av__name">{a.name}</span>
              {!ok && <span className="pz-av__lock">未解鎖</span>}
            </TapButton>
          )
        })}
      </div>
      {popup >= 0 && (
        <CardCarousel
          slides={slides}
          index={popup}
          onIndex={setPopup}
          onClose={() => setPopup(-1)}
          onConfirm={(s) => {
            pick(s.key)
            setPopup(-1)
          }}
        />
      )}
    </>
  )
}

/** stats key for each achievement metric (see platformStore.recordMatchResult). */
const METRIC_KEY: Record<AchMetric, string> = {
  streak: 'pvpBestStreak',
  games: 'pvpGames',
  wins: 'pvpWins',
  soloGames: 'soloGames',
  soloWins: 'soloWins',
  flush: 'bestFlush',
  fullHouse: 'bestFullHouse',
  quads: 'bestQuads',
  straightFlush: 'bestStraightFlush',
  sfDuel: 'sfDuel',
}

/** One column: label on top, number below (使用者:標題放上面). */
function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, flex: 1 }}>
      <span style={{ fontSize: 15, color: 'var(--wood-600, #8a6a3e)' }}>{label}</span>
      <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--wood-800, #4a3418)', fontFamily: 'var(--font-display)' }}>{value}</span>
    </div>
  )
}

/** Horizontal 連勝 stat shown on the title row: 「目前連勝：7」. */
function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontSize: 13, color: 'var(--wood-600, #8a6a3e)' }}>{label}：</span>
      <span style={{ fontSize: 23, fontWeight: 700, color: 'var(--wood-800, #4a3418)', fontFamily: 'var(--font-display)' }}>{value}</span>
    </span>
  )
}

function StatBlock({ title, games, wins, streak }: { title: string; games: number; wins: number; streak?: { cur: number; best: number } }) {
  const rate = games > 0 ? Math.round((100 * wins) / games) : 0
  return (
    <div style={{ background: 'var(--parch-100, #fbf1d9)', border: '2px solid var(--wood-700, #7d5a34)', borderRadius: 12, padding: '14px 16px', flex: 1, minWidth: 260 }}>
      {/* Title row: FIXED height so both blocks' titles + 場次 rows line up regardless
          of whether 連勝 is present. Title left; 連勝 (horizontal) pushed far right. */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, height: 30, marginBottom: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--wood-800, #4a3418)', fontFamily: 'var(--font-display)' }}>{title}</div>
        {streak && (
          <div style={{ display: 'flex', gap: 16 }}>
            <MiniStat label="目前連勝" value={streak.cur} />
            <MiniStat label="最高連勝" value={streak.best} />
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <StatCell label="場次" value={games} />
        <StatCell label="勝" value={wins} />
        <StatCell label="勝率" value={`${rate}%`} />
      </div>
    </div>
  )
}

function StatsTab({ stats }: { stats: Record<string, number> }) {
  return (
    <>
      <p className="pz-hint pz-hint--left">真人對戰與電腦對戰分開統計（打電腦不計入部份排行榜相關成就）。</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <StatBlock title="真人對戰" games={stats.pvpGames ?? 0} wins={stats.pvpWins ?? 0} streak={{ cur: stats.pvpStreak ?? 0, best: stats.pvpBestStreak ?? 0 }} />
        <StatBlock title="電腦(含主線)" games={stats.soloGames ?? 0} wins={stats.soloWins ?? 0} />
      </div>
    </>
  )
}

const SHOWCASE_MAX = 3

function AchievementsTab({
  stats,
  equipped,
  onSave,
}: {
  stats: Record<string, number>
  equipped: string[]
  onSave: (ids: string[]) => Promise<void>
}) {
  const famTier = (fam: (typeof ACHIEVEMENTS)[number]) => tierFor(stats[METRIC_KEY[fam.metric]] ?? 0, fam.thresholds)
  const total = ACHIEVEMENTS.reduce((n, fam) => n + famTier(fam), 0)
  const famById = (id: string) => ACHIEVEMENTS.find((f) => f.id === id)

  // Selection is per-MEDAL: composite id `${famId}:${tier}`. You may show off
  // several tiers of the same family (3+/5+/10+) at once; no "highest" default.
  // Keep only valid `${famId}:${tier}` keys (drops any legacy family-only entries).
  const sanitize = (ids: string[]) =>
    ids.filter((k) => {
      const [f, ts] = k.split(':')
      const n = Number(ts)
      return !!famById(f) && n >= 1 && n <= 3
    })
  const [sel, setSel] = useState<string[]>(() => sanitize(equipped))
  const inited = useRef(false)
  useEffect(() => {
    if (!inited.current && equipped.length) {
      setSel(sanitize(equipped))
      inited.current = true
    }
  }, [equipped])

  const toggle = (famId: string, tier: 1 | 2 | 3, earned: boolean) => {
    if (!earned) return
    const key = `${famId}:${tier}`
    let next: string[]
    if (sel.includes(key)) next = sel.filter((x) => x !== key)
    else if (sel.length >= SHOWCASE_MAX) return // full — ignore
    else next = [...sel, key]
    sfx.click()
    setSel(next)
    void onSave(next)
  }

  return (
    <>
      {/* Frozen header (stays put while the list scrolls): 已解鎖 left, 已展示 slots right. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 3,
          background: 'var(--parch-1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '4px 16px',
          padding: '0 2px 6px',
          borderBottom: '1px solid var(--wood-300, #cdb188)',
        }}
      >
        <span style={{ fontSize: 23, fontWeight: 700, color: 'var(--wood-800, #4a3418)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
          已解鎖：{total} / {ACHIEVEMENTS.length * 3}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 23, fontWeight: 700, color: 'var(--wood-800, #4a3418)', fontFamily: 'var(--font-display)', lineHeight: 1 }}>
            已展示（{sel.length}/{SHOWCASE_MAX}）：
          </span>
          {Array.from({ length: SHOWCASE_MAX }, (_, i) => {
            const key = sel[i]
            if (!key) {
              return <div key={i} style={{ width: 34, height: 34, borderRadius: '50%', border: '2px dashed var(--wood-400, #b89a6c)', boxSizing: 'border-box' }} />
            }
            const [fid, ts] = key.split(':')
            const fam = famById(fid)
            const t = Number(ts) as 1 | 2 | 3
            return fam ? (
              <button key={i} onClick={() => toggle(fid, t, true)} title="點擊取消展示" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex' }}>
                <Badge icon={fam.icon} tier={t} size={34} />
              </button>
            ) : (
              <div key={i} style={{ width: 34, height: 34 }} />
            )
          })}
        </span>
      </div>

      {/* Scrollable family list — tap an individual earned medal to show/hide it.
          Desktop = one per row; short (landscape-phone) viewport = two per row. */}
      <div className="pz-ach-list">
        {ACHIEVEMENTS.map((fam) => {
          const value = stats[METRIC_KEY[fam.metric]] ?? 0
          const tier = tierFor(value, fam.thresholds)
          const [b, s, g] = fam.thresholds
          const nextTh = tier >= 2 ? g : tier === 1 ? s : b
          return (
            <div
              key={fam.id}
              className="pz-ach-row"
              style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--parch-100, #fbf1d9)', border: '2px solid var(--wood-700, #7d5a34)', borderRadius: 12 }}
            >
              {/* left: family name + three medals (each individually selectable) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 auto' }}>
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--wood-800, #4a3418)', fontFamily: 'var(--font-display)' }}>{fam.name}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([1, 2, 3] as const).map((m) => {
                    const earned = tier >= m
                    const chosen = sel.includes(`${fam.id}:${m}`)
                    return (
                      <button
                        key={m}
                        onClick={() => toggle(fam.id, m, earned)}
                        disabled={!earned}
                        title={earned ? (chosen ? '點擊取消展示' : '點擊設為展示') : '達成後才能展示'}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          borderRadius: '50%',
                          cursor: earned ? 'pointer' : 'default',
                          outline: chosen ? '3px solid var(--gold-2, #f6c945)' : 'none',
                          outlineOffset: 2,
                          boxShadow: chosen ? '0 0 10px 2px rgba(246, 201, 69, 0.85)' : 'none',
                        }}
                      >
                        <Badge icon={fam.icon} tier={m} size={46} locked={!earned} />
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* right: explanation + thresholds, pushed to the right, larger text */}
              <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
                <div style={{ fontSize: 16, color: 'var(--wood-700, #6a4e2c)', lineHeight: 1.5 }}>
                  {tier >= 3 ? '全數達成 ✦' : `${TIER_NAME_ZH[(tier + 1) as 1 | 2 | 3]}階:${fam.desc(nextTh)}`}
                </div>
                <div style={{ fontSize: 14, color: 'var(--wood-600, #8a6a3e)', marginTop: 4 }}>
                  {fam.thresholds.map((th, i) => `${TIER_NAME_ZH[(i + 1) as 1 | 2 | 3]} ${th}`).join(' · ')}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function EmojiTab({ owned, allUnlocked }: { owned: Record<string, true>; allUnlocked: boolean }) {
  const [showAll, setShowAll] = useState(false)
  const [popup, setPopup] = useState(-1)
  const have = (s: (typeof STICKERS)[number]) => allUnlocked || ownsSticker(s, owned)
  const displayed = STICKERS.filter((s) => showAll || have(s))

  const slides: CarouselSlide[] = displayed.map((s) => ({
    key: s.id,
    art: stickerSlideArt(s),
    name: s.name,
    statusText: have(s) ? '已擁有' : '未解鎖',
    statusColor: have(s) ? 'var(--wood-700, #6a4e2c)' : '#8a6a3e',
  }))

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <ShowAllToggle checked={showAll} onChange={setShowAll} />
        <p className="pz-hint pz-hint--left" style={{ margin: 0, width: 'auto' }}>點一張看大圖;未擁有的可到商城購買。</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10 }}>
        {displayed.map((s, i) => {
          const owns = have(s)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => { sfx.click(); setPopup(i) }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 8, borderRadius: 12, border: '2px solid var(--wood-600,#8a6a3e)', background: 'var(--parch-100,#fbf1d9)', opacity: owns ? 1 : 0.55, cursor: 'pointer' }}
            >
              <div style={{ width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center', filter: owns ? 'none' : 'grayscale(1)' }}>
                {s.emoji ? <span style={{ fontSize: 48, lineHeight: 1 }}>{s.emoji}</span> : <img src={stickerSrc(s.id)} alt={s.name} style={{ width: 72, height: 72, objectFit: 'contain' }} />}
              </div>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--wood-800,#4a3418)' }}>{s.name}</span>
              {!owns && <span style={{ fontSize: 11, color: 'var(--text-danger,#a3402d)' }}>未解鎖</span>}
            </button>
          )
        })}
      </div>
      {popup >= 0 && <CardCarousel slides={slides} index={popup} onIndex={setPopup} onClose={() => setPopup(-1)} />}
    </>
  )
}

/** 帳號 (read-only identity) + 顯示名稱 (editable — but guests can't; setting one
 *  would make a guest look logged-in). */
function AccountSettingsRows() {
  const uid = usePlatformStore((s) => s.uid)
  const isAnonymous = usePlatformStore((s) => s.isAnonymous)
  const username = usePlatformStore((s) => s.username)
  const email = usePlatformStore((s) => s.email)
  const displayName = usePlatformStore((s) => s.displayName)
  const registered = !!uid && !isAnonymous
  // Game account → its login name; Google → its email; guest → guest.
  const accountLabel = isAnonymous ? 'guest' : username ?? email ?? 'Google 帳號'

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const composing = useRef(false) // don't clamp mid-IME-compose (see ChooseNameForm)
  useEffect(() => { setName(registered ? displayName ?? '' : '') }, [displayName, registered])
  const hasText = name.trim() !== ''
  // Registered users can always press 儲存 (blank → an explicit toast, so nobody
  // thinks they saved an empty name); guests can't press it at all.
  const canPress = registered && !busy
  const save = async () => {
    if (!canPress) return
    if (!hasText) {
      useToastStore.getState().show('顯示名稱不可空白，無法儲存')
      return
    }
    setBusy(true)
    const res = await usePlatformStore.getState().saveDisplayName(name)
    setBusy(false)
    res.ok ? sfx.success() : sfx.error()
    useToastStore.getState().show(res.ok ? '顯示名稱已更新！' : res.error)
  }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 38, padding: '1px 4px', borderBottom: '1px solid var(--wood-300,#cdb188)' }
  const labelStyle: React.CSSProperties = { fontSize: 16, color: 'var(--wood-800,#4a3418)', fontFamily: 'var(--font-display)', flex: '0 0 auto' }
  return (
    <>
      <div style={row}>
        <label style={labelStyle}>帳號</label>
        <span style={{ fontSize: 15, color: 'var(--wood-700,#6a4e2c)', fontFamily: 'var(--font-display)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {accountLabel}
        </span>
      </div>
      <div style={row}>
        <label style={labelStyle}>
          顯示名稱
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--wood-600,#8a6a3e)', marginLeft: 3 }}>（7 中文 / 15 英文）</span>
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={name}
            disabled={!registered}
            placeholder={registered ? '遊戲內名稱' : 'guest（登入後可設定）'}
            onChange={(e) => { const v = e.target.value; setName(composing.current ? v : clampDisplayName(v)) }}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={(e) => { composing.current = false; setName(clampDisplayName(e.currentTarget.value)) }}
            onKeyDown={(e) => e.key === 'Enter' && !composing.current && void save()}
            style={{ width: 170, maxWidth: '40vw', padding: '4px 10px', borderRadius: 8, border: '2px solid var(--wood-600,#8a6a3e)', background: 'var(--parch-100,#fbf1d9)', color: 'var(--wood-800,#4a3418)', fontFamily: 'var(--font-display)', fontSize: 15, opacity: registered ? 1 : 0.55, cursor: registered ? 'text' : 'not-allowed' }}
          />
          <button
            onClick={() => void save()}
            disabled={!canPress}
            style={{ padding: '6px 14px', borderRadius: 8, border: '2px solid var(--wood-600,#8a6a3e)', background: canPress && hasText ? 'var(--wood-1,#c8a06a)' : 'transparent', color: canPress && hasText ? '#fff8ec' : 'var(--wood-700,#6a4e2c)', fontFamily: 'var(--font-display)', fontWeight: 700, cursor: canPress ? 'pointer' : 'default', opacity: busy ? 0.6 : 1 }}
          >
            儲存
          </button>
        </div>
      </div>
    </>
  )
}

function SettingsTab() {
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updateSettings)
  const chip = (on: boolean): React.CSSProperties => ({
    padding: '6px 16px',
    borderRadius: 8,
    border: '2px solid var(--wood-600,#8a6a3e)',
    background: on ? 'var(--wood-1,#c8a06a)' : 'transparent',
    color: on ? '#fff8ec' : 'var(--wood-700,#6a4e2c)',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    cursor: 'pointer',
  })
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 38, padding: '1px 4px', borderBottom: '1px solid var(--wood-300,#cdb188)' }
  return (
    <>
      <AccountSettingsRows />
      <div style={row}>
        <label style={{ fontSize: 16, color: 'var(--wood-800,#4a3418)', fontFamily: 'var(--font-display)' }}>音樂</label>
        <span style={{ fontSize: 13, color: 'var(--wood-600,#8a6a3e)' }}>即將開放</span>
      </div>
      <div style={row}>
        <label style={{ fontSize: 16, color: 'var(--wood-800,#4a3418)', fontFamily: 'var(--font-display)' }}>音效</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={chip(settings.sfx)} onClick={() => { update({ sfx: true }); sfx.success() }}>開</button>
          <button style={chip(!settings.sfx)} onClick={() => { sfx.click(); update({ sfx: false }) }}>關</button>
        </div>
      </div>
      <div style={row}>
        <label style={{ fontSize: 16, color: 'var(--wood-800,#4a3418)', fontFamily: 'var(--font-display)' }}>牌背</label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {(['blue', 'green'] as const).map((key) => {
            const on = settings.cardBack === key
            return (
              <button
                key={key}
                onClick={() => { sfx.success(); update({ cardBack: key }) }}
                style={{
                  position: 'relative',
                  padding: 3,
                  lineHeight: 0,
                  borderRadius: 8,
                  cursor: 'pointer',
                  border: on ? '3px solid var(--gold-2,#f6c945)' : '2px solid var(--wood-600,#8a6a3e)',
                  background: on ? 'var(--wood-1,#c8a06a)' : 'transparent',
                  boxShadow: on ? '0 0 9px 2px rgba(246,201,69,0.85)' : 'none',
                  opacity: on ? 1 : 0.5,
                }}
              >
                <CardBack w={24} theme={key} />
                {on && (
                  <span style={{ position: 'absolute', top: -8, right: -8, width: 20, height: 20, borderRadius: '50%', background: 'var(--gold-2,#f6c945)', color: '#4a3418', fontSize: 13, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff8ec' }}>✓</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

function LoadoutTab({
  equipped,
  unlocked,
  allUnlocked,
  onSave,
}: {
  equipped: string[]
  unlocked: Record<string, true>
  allUnlocked: boolean
  onSave: (ids: string[]) => Promise<void>
}) {
  const [sel, setSel] = useState<string[]>(equipped)
  const inited = useRef(false)
  useEffect(() => {
    if (!inited.current && equipped.length) {
      setSel(equipped)
      inited.current = true
    }
  }, [equipped])

  const [showAll, setShowAll] = useState(false) // 顯示全部 (default off = only what I own)
  const [popup, setPopup] = useState(-1)

  const owns = (id: string) => allUnlocked || !!unlocked[id]
  const displayed = SPECIAL_CARD_LIST.filter((c) => showAll || owns(c.id))

  const toggle = (id: string) => {
    if (!owns(id)) return
    let next: string[]
    if (sel.includes(id)) next = sel.filter((x) => x !== id)
    else if (sel.length >= LOADOUT_SIZE) return // full — ignore
    else next = [...sel, id]
    sfx.success() // 裝備變更(預設牌組)
    setSel(next)
    void onSave(next)
  }

  const slides: CarouselSlide[] = displayed.map((c) => {
    const owned = owns(c.id)
    return {
      key: c.id,
      art: cardSlideArt(c),
      name: c.name,
      desc: c.desc,
      statusText: owned ? '可用' : '未解鎖',
      statusColor: owned ? 'var(--wood-700, #6a4e2c)' : '#8a6a3e',
      selectable: owned,
      selected: sel.includes(c.id),
    }
  })

  return (
    <div className="pz-loadout-wrap">
      <div className="pz-loadout__header">
        <span className="pz-loadout__label">預設牌組（{sel.length}/{LOADOUT_SIZE}）</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <ShowAllToggle checked={showAll} onChange={setShowAll} />
          <span className="pz-loadout__tip">單擊看說明 · 雙擊選取</span>
        </span>
      </div>

      <div className="pz-loadout">
        {/* Left: preset deck — the 3 carried slots (single-click a card to remove) */}
        <div className="pz-loadout__slots">
          {Array.from({ length: LOADOUT_SIZE }, (_, i) => {
            const card = SPECIAL_CARD_LIST.find((c) => c.id === sel[i])
            return (
              <div key={i} className="pz-loslot">
                <span className="pz-loslot__pos">{i + 1}.</span>
                {card ? (
                  <SpecialCard card={card} w={50} onSelect={() => toggle(card.id)} />
                ) : (
                  <span className="pz-loslot__empty">空</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Right: pickable cards — single tap opens the popup, double tap selects */}
        <div className="pz-loadout__pick">
          {displayed.map((c, i) => {
            const idx = sel.indexOf(c.id)
            return (
              <SpecialCard
                key={c.id}
                card={c}
                w={64}
                selected={idx >= 0}
                order={idx >= 0 ? idx + 1 : undefined}
                locked={!owns(c.id)}
                openOnSingle
                onSelect={() => toggle(c.id)}
                onView={() => setPopup(i)}
              />
            )
          })}
        </div>
      </div>

      {popup >= 0 && (
        <CardCarousel
          slides={slides}
          index={popup}
          onIndex={setPopup}
          onClose={() => setPopup(-1)}
          full={sel.length >= LOADOUT_SIZE}
          onConfirm={(s) => {
            toggle(s.key)
            setPopup(-1)
          }}
        />
      )}
    </div>
  )
}
