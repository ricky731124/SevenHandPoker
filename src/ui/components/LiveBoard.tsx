import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../state/appStore'
import { usePlatformStore } from '../../state/platformStore'
import { subscribeLiveIndex, type LiveEntry, type LivePlayer } from '../../net/liveIndex'
import PlayerAvatar from './PlayerAvatar'
import { sfx } from '../../audio/sfx'
import './LiveBoard.css'

/**
 * 主畫面右側「即時戰況」Live 版(§5)。訂閱 liveIndex → 排序後的前 5 場,一次露 2 張、
 * `< >` 跑馬燈切換。沒有任何 live/ended 場次時整塊不顯示(要有 live 感)。設計 token 見 §7。
 */

function winRateLabel(p: LivePlayer): string {
  if (!p?.games) return '—'
  return `${Math.round(((p.wins ?? 0) / p.games) * 100)}%`
}

function LiveCard({ entry, myUid }: { entry: LiveEntry; myUid: string | null }) {
  const openSpectate = useAppStore((s) => s.openSpectate)
  const live = entry.status === 'live'
  const mine = live && !!myUid && entry.p1.uid === myUid // 不能觀戰自己那場
  const winnerName = entry.winner ? (entry.winner === 'p1' ? entry.p1.name : entry.p2.name) : ''

  return (
    <div className={`livecard${live ? '' : ' livecard--ended'}`}>
      <div className="livecard__head">
        {live ? (
          <span className="livecard__live">
            <span className="livecard__dot" aria-hidden="true" />
            LIVE
          </span>
        ) : (
          <span className="livecard__ended-tag">已結束</span>
        )}
        {live ? (
          <span className="livecard__watchers" title="觀戰人數">
            👁 {entry.spectators ?? 0}
          </span>
        ) : (
          // 已結束卡右上:結束時間(讓別人知道這是何時玩的)。長度不夠 → 兩行(日期/時間),不動卡片尺寸。
          entry.endedAt ? (
            <span className="livecard__ended-time" title="結束時間">
              {(() => {
                const d = new Date(entry.endedAt)
                const p = (n: number) => String(n).padStart(2, '0')
                return (
                  <>
                    <span>{d.getFullYear()}/{p(d.getMonth() + 1)}/{p(d.getDate())}</span>
                    <span>{p(d.getHours())}:{p(d.getMinutes())}:{p(d.getSeconds())}</span>
                  </>
                )
              })()}
            </span>
          ) : null
        )}
      </div>

      <div className="livecard__players">
        <Side p={entry.p1} />
        <span className="livecard__vs">VS</span>
        <Side p={entry.p2} />
      </div>

      {live ? (
        mine ? (
          <div className="livecard__mine">你的對戰進行中</div>
        ) : (
          <button
            type="button"
            className="livecard__join"
            onClick={() => {
              sfx.click()
              openSpectate(entry.code)
            }}
          >
            加入觀戰
          </button>
        )
      ) : (
        <div className="livecard__result">對戰結束・{winnerName || '—'} 獲勝</div>
      )}
    </div>
  )
}

function Side({ p }: { p: LivePlayer }) {
  return (
    <div className="liveside">
      <PlayerAvatar avatarId={p?.avatar || 'cat'} size={58} />
      <div className="liveside__name" title={p?.name || '玩家'}>
        {p?.name || '玩家'}
      </div>
      <div className="liveside__stat">
        勝場 {p?.wins ?? 0}
        <span className="liveside__rate">（{winRateLabel(p)}）</span>
      </div>
    </div>
  )
}

const TICK_MS = 20_000 // 每 20 秒跑到下一頁(第六批#5)

export default function LiveBoard() {
  const [entries, setEntries] = useState<LiveEntry[]>([])
  const [center, setCenter] = useState(0)
  const myUid = usePlatformStore((s) => s.uid)

  useEffect(() => subscribeLiveIndex(setEntries, 8), []) // 取 8 呈現 1(#1)

  const total = entries.length
  const liveCount = entries.filter((e) => e.status === 'live').length
  // 輪播範圍:有 live 時只輪 live 群(排序已把 live 推到最前);全結束才輪全部。
  const range = liveCount > 0 ? liveCount : total

  // 讓 interval 讀到最新值(不重建 timer)。
  const rangeRef = useRef(range)
  const totalRef = useRef(total)
  rangeRef.current = range
  totalRef.current = total
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevLive = useRef<Set<string>>(new Set())

  const stop = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }
  // (重)啟動自動輪播:每 TICK_MS 往右一頁(有 live 只在 live 群內循環;跑出 live 群→拉回 1)。
  const start = () => {
    stop()
    timer.current = setInterval(() => {
      setCenter((c) => {
        const r = Math.max(1, rangeRef.current)
        const next = c + 1
        return next >= r ? 0 : next
      })
    }, TICK_MS)
  }
  // 手動翻頁:全部場次都能瀏覽(循環),並「重新數 10 秒」。
  const manual = (delta: number) => {
    sfx.click()
    const t = Math.max(1, totalRef.current)
    setCenter((c) => (c + delta + t) % t)
    start()
  }

  useEffect(() => {
    start()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 偵測「新 live」→ 直接跳回第 1 頁 + 重新數(§跑馬規則)。
  const liveKey = entries.filter((e) => e.status === 'live').map((e) => e.code).join(',')
  useEffect(() => {
    const cur = new Set(liveKey ? liveKey.split(',') : [])
    let hasNew = false
    for (const c of cur) if (!prevLive.current.has(c)) hasNew = true
    prevLive.current = cur
    if (hasNew) {
      setCenter(0)
      start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey])

  // center 超出目前場次數 → 夾回(場次被清/結束時)。
  useEffect(() => {
    setCenter((c) => (c >= total ? 0 : c))
  }, [total])

  if (total === 0) return null // 沒場次 → 整塊不顯示(§5.1)

  const main = entries[Math.min(center, total - 1)]
  const canPage = total > 1

  return (
    <div className="liveboard">
      <div className="liveboard__title">
        <span className="liveboard__title-dot" aria-hidden="true" />
        即時戰況
        <span className="liveboard__count">{liveCount} 場進行中</span>
      </div>

      {/* 單卡跑馬燈:箭頭放進圖片內、頂部中央顯示編號(依跑馬燈順序,對齊下方圓點) */}
      <div className="liveboard__stage">
        {canPage && <div className="liveboard__num" aria-hidden="true">{center + 1}</div>}

        <div className="liveboard__slot liveboard__slot--main">
          <LiveCard entry={main} myUid={myUid} />
        </div>

        {canPage && (
          <>
            <button type="button" className="liveboard__arrow liveboard__arrow--prev" onClick={() => manual(-1)} aria-label="上一場">
              ‹
            </button>
            <button type="button" className="liveboard__arrow liveboard__arrow--next" onClick={() => manual(1)} aria-label="下一場">
              ›
            </button>
          </>
        )}
      </div>

      {canPage && (
        <div className="liveboard__dots" aria-hidden="true">
          {entries.map((e, i) => (
            <span key={e.code} className={`liveboard__dot${i === center ? ' liveboard__dot--on' : ''}`} />
          ))}
        </div>
      )}
    </div>
  )
}
