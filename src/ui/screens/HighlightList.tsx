import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { avatarSrc } from '../components/PlayerAvatar'
import { subscribeHighlights, subscribeUserReplays, type ReplayEntry, type MatchType } from '../../net/replays'
import { useAppStore } from '../../state/appStore'
import { usePlatformStore } from '../../state/platformStore'
import useMobileWebScale from '../hooks/useMobileWebScale'
import { sfx } from '../../audio/sfx'
import './Panel.css'
import './Personalize.css'
import './Leaderboard.css'
import './HighlightList.css'

/**
 * 賽事回放清單(§6.1)——彈窗,骨架完全對齊排行榜/個人化(.pz-screen + .panel--wide + 頁籤在
 * 返回鍵右邊 + 木紋 plank 列 + 隱藏滾軸 + 固定尺寸不忽大忽小)。兩頁籤:精華賽事(全站自然結束)/
 * 專屬賽事(我打的,含手動中離)。點一列 → 直接把該筆 record 交給 ReplayViewer 回放。
 */

type Tab = 'highlights' | 'mine'

const TABS: { id: Tab; label: string }[] = [
  { id: 'highlights', label: '精華賽事' },
  { id: 'mine', label: '專屬賽事' },
]

const matchLabel = (m: MatchType): string => (m === 'friend' ? '對戰好友' : '快速配對')
const roomLabel = (special: boolean): string => (special ? '特殊房' : '一般房')

function fmtTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default function HighlightList({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openReplay = useAppStore((s) => s.openReplay)
  const uid = usePlatformStore((s) => s.uid)
  const mw = useMobileWebScale()
  const [tab, setTab] = useState<Tab>('highlights')
  const [list, setList] = useState<ReplayEntry[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoaded(false)
    setList([])
    const cb = (entries: ReplayEntry[]) => {
      setList(entries)
      setLoaded(true)
    }
    return tab === 'mine' ? subscribeUserReplays(uid ?? '', cb, 8) : subscribeHighlights(cb, 8)
  }, [open, tab, uid])

  if (!open) return null

  const pick = (rec: ReplayEntry) => {
    sfx.click()
    onClose()
    openReplay(rec)
  }
  const emptyMsg = tab === 'mine' ? '你還沒有賽事，去打一場吧！' : '還沒有精華賽事，去打一場吧！'

  return (
    <div className="pz-screen rp-overlay" onClick={onClose}>
      <motion.div
        className="panel panel--wide panel--rp"
        initial={{ opacity: 0, y: 16, scale: mw }}
        animate={{ opacity: 1, y: 0, scale: mw }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pz__topbar">
          <button className="pz-back" onClick={() => { sfx.click(); onClose() }} aria-label="返回" title="返回">
            <svg viewBox="0 0 24 24" width="26" height="26">
              <path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="pz__tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`pz__tab${tab === t.id ? ' pz__tab--on' : ''}`}
                onClick={() => { sfx.click(); setTab(t.id) }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel__scroll">
          {!loaded ? (
            <p className="pz-hint">載入中…</p>
          ) : list.length === 0 ? (
            <p className="pz-hint">{emptyMsg}</p>
          ) : (
            <ol className="rp-hlist">
              {list.map((r, i) => (
                <li key={r.id} className="lb-row rp-hrow" onClick={() => pick(r)}>
                  <span className="lb-rank">{i + 1}.</span>
                  <div className="rp-hmatch">
                    <img className="rp-hava" src={avatarSrc(r.p1?.avatar || 'cat')} alt="" />
                    <span className="rp-hname">{r.p1?.name || '玩家1'}</span>
                    {r.winner === 'p1' && <span className="rp-hwin">WIN</span>}
                    <span className="rp-hvs">VS</span>
                    {r.winner === 'p2' && <span className="rp-hwin">WIN</span>}
                    <span className="rp-hname">{r.p2?.name || '玩家2'}</span>
                    <img className="rp-hava" src={avatarSrc(r.p2?.avatar || 'bird')} alt="" />
                  </div>
                  <div className="rp-hmeta">
                    <div className="rp-hmode">{matchLabel(r.matchType)} - {roomLabel(r.special)}</div>
                    <div className="rp-htime">{fmtTime(r.endedAt)}</div>
                  </div>
                  <span className="rp-hplay" aria-hidden="true">▶</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </motion.div>
    </div>
  )
}
