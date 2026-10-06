import { useEffect, useRef, useState } from 'react'
import { subscribeOnlineUids } from '../../net/presence'
import { fetchCard } from '../../platform/cards'
import './OnlineWho.css'

/**
 * 「誰在線上」名單 —— 只給 owner(ricky) 看（未來線上好友名單的測試）。放在左上「賽事回放」下面。
 * 名單 = 在線人數同一套判定的真人 uid（不含人機、不含自己）；名字讀玩家資訊卡，訪客沒卡就顯示「訪客·xxxx」。
 * 沒有別人在線 → 整塊不顯示；多人 → 一人一行往下排。
 */
const nameCache = new Map<string, string>()

export default function OnlineWho({ selfUid }: { selfUid: string | null }) {
  const [uids, setUids] = useState<string[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    const un = subscribeOnlineUids((all) => setUids(all))
    return () => { alive.current = false; un() }
  }, [])

  const others = uids.filter((u) => u !== selfUid)

  useEffect(() => {
    for (const u of others) {
      if (nameCache.has(u)) continue
      nameCache.set(u, '') // 佔位，避免重複抓
      void fetchCard(u).then((c) => {
        nameCache.set(u, c?.displayName || `訪客·${u.slice(0, 4)}`)
        if (alive.current) setNames((n) => ({ ...n, [u]: nameCache.get(u)! }))
      })
    }
  }, [others.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!others.length) return null
  return (
    <ul className="onlinewho" aria-label="線上玩家">
      {others.map((u) => (
        <li key={u} className="onlinewho__row">
          <span className="onlinewho__dot" aria-hidden="true" />
          <span className="onlinewho__name">{names[u] || nameCache.get(u) || '…'}</span>
        </li>
      ))}
    </ul>
  )
}
