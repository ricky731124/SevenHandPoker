import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../state/appStore'
import { usePlatformStore } from '../../state/platformStore'
import { useLeaderboardCache } from '../../state/leaderboardCache'
import { isFirebaseConfigured } from '../../firebaseApp'
import { type Board, type LbRow } from '../../platform/leaderboard'
import { ACHIEVEMENTS } from '../../game/achievements'
import PlayerAvatar from '../components/PlayerAvatar'
import PlayerInfoCard from '../components/PlayerInfoCard'
import { sfx } from '../../audio/sfx'
import './Panel.css'
import './Personalize.css'
import './Leaderboard.css'

const TABS: { id: Board; label: string }[] = [
  { id: 'byStage', label: '拓域先鋒' },
  { id: 'byWins', label: '常勝獵手' },
  { id: 'byAchievements', label: '徽章大師' },
  { id: 'byDiamonds', label: '積鑽達人' },
]

// Max achievement score = every family at gold (3 tiers each).
const ACH_MAX = ACHIEVEMENTS.length * 3

/** Format a board's score for display. */
function scoreLabel(board: Board, row: LbRow): string {
  switch (board) {
    case 'byStage':
      // subId 's1-2' → 「第 1-2 關」; fall back to the raw score if it's missing.
      return row.subId ? `第 ${row.subId.slice(1)} 關` : `第 ${row.score} 關`
    case 'byWins':
      return `${row.score} 勝`
    case 'byAchievements':
      return `${row.score} / ${ACH_MAX}`
    case 'byDiamonds':
      return `${row.score} 鑽`
  }
}

const MEDALS = ['🥇', '🥈', '🥉']

export default function Leaderboard() {
  const go = useAppStore((s) => s.go)
  const uid = usePlatformStore((s) => s.uid)
  const isAnonymous = usePlatformStore((s) => s.isAnonymous)
  const registered = !!uid && !isAnonymous

  const [tab, setTab] = useState<Board>('byStage')
  const [cardRow, setCardRow] = useState<LbRow | null>(null)
  const cache = useLeaderboardCache()

  // On entering the screen: fetch-or-use-cache (see leaderboardCache). Fires once
  // per mount — switching tabs never refetches; leaving+re-entering only refetches
  // when dirty (played a match) or 5 min stale.
  useEffect(() => {
    if (!isFirebaseConfigured()) return
    void cache.open()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = cache.tops[tab]
  const myRankCache = cache.myRanks
  const myTopIndex = uid && rows ? rows.findIndex((r) => r.uid === uid) : -1

  // My exact rank — only when registered and NOT already in the top-N (cached).
  useEffect(() => {
    if (!rows || !registered || !uid) return
    if (myTopIndex >= 0) return
    void cache.ensureMyRank(tab, uid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, rows, myTopIndex, registered, uid])

  // rows === undefined → this board hasn't arrived yet (first fetch or a still-
  // resolving background board); [] → loaded but empty.
  const error = cache.error
  const loading = rows === undefined && !error && isFirebaseConfigured()
  const top = rows ?? []

  return (
    <>
    <div className="pz-screen" onClick={() => go('menu')}>
      <motion.div
        className="panel panel--wide panel--lb"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
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
                className={`pz__tab${tab === t.id ? ' pz__tab--on' : ''}`}
                onClick={() => {
                  sfx.click()
                  setTab(t.id)
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel__scroll">
          {!isFirebaseConfigured() ? (
            <p className="pz-hint">離線中，無法載入排行榜。</p>
          ) : error ? (
            <p className="pz-hint">載入失敗，請稍後再試。</p>
          ) : loading ? (
            <p className="pz-hint">載入中…</p>
          ) : top.length === 0 ? (
            <p className="pz-hint">還沒有人上榜，快來搶頭香！</p>
          ) : (
            <ol className="lb-list">
              {top.map((row, i) => (
                <LbRowView
                  key={row.uid}
                  board={tab}
                  row={row}
                  rank={i + 1}
                  me={row.uid === uid}
                  onOpen={() => { sfx.click(); setCardRow(row) }}
                />
              ))}
            </ol>
          )}
        </div>

        {/* Frozen "my rank" bar — pinned at the bottom, never scrolls. */}
        {!loading && !error && isFirebaseConfigured() && rows && (
          <div className="lb-selfbar">
            {(() => {
              if (!registered) return <span className="lb-selfbar__note">登入後遊玩即可列入排行榜！</span>
              // In the top-N already → reuse that row.
              if (myTopIndex >= 0) {
                return <SelfRow rank={myTopIndex + 1} row={rows[myTopIndex]} board={tab} />
              }
              const mine = myRankCache[tab]
              if (mine === undefined) return <span className="lb-selfbar__note">查詢名次中…</span>
              if (mine === null) return <span className="lb-selfbar__note">你還沒有這個榜的成績，繼續加油！</span>
              return <SelfRow rank={mine.rank} row={mine.row} board={tab} />
            })()}
          </div>
        )}
      </motion.div>
    </div>
    {cardRow && (
      <PlayerInfoCard
        uid={cardRow.uid}
        fallback={{ name: cardRow.displayName, avatarId: cardRow.avatarId }}
        onClose={() => setCardRow(null)}
      />
    )}
    </>
  )
}

/** Contents of the frozen "我的排名" bar. */
function SelfRow({ rank, row, board }: { rank: number; row: LbRow; board: Board }) {
  return (
    <>
      <span className="lb-selfbar__label">我的排名</span>
      <span className="lb-selfbar__rank">{rank}</span>
      <PlayerAvatar avatarId={row.avatarId} size={40} />
      <span className="lb-selfbar__name">{row.displayName}</span>
      <span className="lb-selfbar__score">{scoreLabel(board, row)}</span>
    </>
  )
}

function LbRowView({ board, row, rank, me, onOpen }: { board: Board; row: LbRow; rank: number; me: boolean; onOpen: () => void }) {
  const tierClass = rank === 1 ? ' lb-row--gold' : rank === 2 ? ' lb-row--silver' : rank === 3 ? ' lb-row--bronze' : ''
  return (
    <li className={`lb-row${tierClass}${me ? ' lb-row--me' : ''}`} onClick={onOpen} style={{ cursor: 'pointer' }}>
      <span className="lb-rank">{rank <= 3 ? <span className="lb-medal">{MEDALS[rank - 1]}</span> : rank}</span>
      <PlayerAvatar avatarId={row.avatarId} size={44} />
      <span className="lb-name">{row.displayName}</span>
      <span className="lb-score">{scoreLabel(board, row)}</span>
    </li>
  )
}
