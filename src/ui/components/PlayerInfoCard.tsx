import { useEffect, useState } from 'react'
import { fetchCard, fetchIsOnline, type PlayerCard } from '../../platform/cards'
import { getSpecialCard, type SpecialCardId } from '../../game/specialCards'
import { getAchievement, type AchTier } from '../../game/achievements'
import Modal from './Modal'
import PlayerAvatar from './PlayerAvatar'
import SpecialCard from './SpecialCard'
import Badge from './Badge'
import './PlayerInfoCard.css'

/** Fallback identity when the player has no public card yet (e.g. a guest foe): we
 *  still show name/avatar/deck from what we already know, just no stats. */
export interface CardFallback {
  name?: string
  avatarId?: string
  loadout?: string[]
}

function fmtLastOnline(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const rate = (games: number, wins: number) => (games > 0 ? `${Math.round((wins / games) * 100)}%` : '—')

/**
 * 玩家資訊卡 (#5) — a read-only popup shown when tapping a player (排行榜點列 /
 * 遊戲中對手頭像 / 未來找好友). Reads the public `cards/{uid}` + presence.
 */
export default function PlayerInfoCard({
  uid,
  fallback,
  onClose,
}: {
  uid: string | null
  fallback?: CardFallback
  onClose: () => void
}) {
  const [card, setCard] = useState<PlayerCard | null>(null)
  const [online, setOnline] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void Promise.all([fetchCard(uid), fetchIsOnline(uid)]).then(([c, on]) => {
      if (!alive) return
      setCard(c)
      setOnline(on)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [uid])

  // "populated" = the card has its profile fields written (not just presence's
  // lastOnline). Until then, fall back to the caller's known name/avatar/deck.
  const populated = !!card?.displayName
  const name = card?.displayName || fallback?.name || '玩家'
  const avatarId = card?.avatarId || fallback?.avatarId || 'cat'
  const loadout = (populated ? card!.loadout : fallback?.loadout ?? []) as SpecialCardId[]
  const achievements = populated ? card!.achievements ?? [] : []
  const pvp = card?.pvp ?? { games: 0, wins: 0, streak: 0, bestStreak: 0 }
  const solo = card?.solo ?? { games: 0, wins: 0 }
  const hasStats = populated

  return (
    <Modal open onClose={onClose} onBack={onClose} title="玩家資訊" width={480} panelClass="modal__panel--pic">
      {loading ? (
        <p className="pz-hint">載入中…</p>
      ) : (
        <div className="pic">
          <div className="pic__head">
            <PlayerAvatar avatarId={avatarId} size={72} />
            <div className="pic__id">
              <div className="pic__name">{name}</div>
              <div className={`pic__online${online ? ' pic__online--on' : ''}`}>
                {online ? '● 線上' : `上次上線：${fmtLastOnline(card?.lastOnline ?? 0)}`}
              </div>
            </div>
          </div>

          <div className="pic__decks">
            <div className="pic__deck">
              <div className="pic__label">預設牌組：</div>
              <div className="pic__cards">
                {loadout.length > 0 ? (
                  loadout.map((id) => {
                    const def = getSpecialCard(id)
                    return def ? <SpecialCard key={id} card={def} w={58} interactive={false} /> : null
                  })
                ) : (
                  <span className="pic__muted">無</span>
                )}
              </div>
            </div>

            <div className="pic__deck">
              <div className="pic__label">成就展示：</div>
              <div className="pic__cards">
                {achievements.length > 0 ? (
                  achievements.map((a, i) => {
                    const fam = getAchievement(a.id)
                    return fam ? <Badge key={`${a.id}:${a.tier}:${i}`} icon={fam.icon} tier={a.tier as AchTier} size={52} /> : null
                  })
                ) : (
                  <span className="pic__muted">無</span>
                )}
              </div>
            </div>
          </div>

          <div className="pic__stats">
            <div className="pic__stat">
              <div className="pic__stat-title">真人對戰</div>
              {hasStats ? (
                <>
                  <div className="pic__stat-row">
                    <span>場次 {pvp.games}</span>
                    <span>勝 {pvp.wins}</span>
                    <span>勝率 {rate(pvp.games, pvp.wins)}</span>
                  </div>
                  <div className="pic__stat-sub">目前連勝 {pvp.streak}　最高連勝 {pvp.bestStreak}</div>
                </>
              ) : (
                <div className="pic__muted">—</div>
              )}
            </div>
            <div className="pic__stat">
              <div className="pic__stat-title">電腦（含主線）</div>
              {hasStats ? (
                <div className="pic__stat-row">
                  <span>場次 {solo.games}</span>
                  <span>勝 {solo.wins}</span>
                  <span>勝率 {rate(solo.games, solo.wins)}</span>
                </div>
              ) : (
                <div className="pic__muted">—</div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
