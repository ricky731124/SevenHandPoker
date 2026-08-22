import { useEffect, useState } from 'react'
import { isFirebaseConfigured } from '../../firebaseApp'
import { subscribeOnlineCount } from '../../net/presence'
import './OnlineCount.css'

/**
 * 在線人數 — bottom-right, shown to EVERYONE (使用者 2026-08-22 開放全體;原本只有
 * ricky 看得到)。每個 client 都會 *回報* presence(見 App/trackPresence),現在也都
 * *訂閱* 顯示。
 */
export default function OnlineCount() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured()) return
    return subscribeOnlineCount(setCount)
  }, [])

  if (count === null) return null
  return (
    <div className="online-count" aria-live="polite">
      在線人數：{count}
    </div>
  )
}
