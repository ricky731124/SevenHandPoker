import { useEffect, useState } from 'react'
import { isFirebaseConfigured } from '../../firebaseApp'
import { subscribeOnlineCount } from '../../net/presence'
import { usePlatformStore } from '../../state/platformStore'
import './OnlineCount.css'

/**
 * 在線人數 — bottom-right, shown to EVERYONE。每個 client 心跳回報 presence(見
 * App/trackPresence),數字 = 最近 10 分鐘活躍的 distinct uid + 人機保底(BOTS_ONLINE)。
 * 更新觸發 = presence 變動(即時) + 60 秒重算(抓過期),都在 subscribeOnlineCount 內。
 *
 * 讀 presence 目前需 auth != null → 依 uid 重訂閱(登入完成後才讀得到);被權限擋(登出)
 * 時 onError 直接把數字清成 null(隱藏),不留凍結的假數字。首次顯示前緩衝 ~1s,讓初始
 * presence 寫入沉澱,「算好再呈現」——避免數字從只有人機(15)跳到含真人。
 */
export default function OnlineCount() {
  const uid = usePlatformStore((s) => s.uid)
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured()) return
    let revealed = false
    let latest: number | null = null
    const revealTimer = setTimeout(() => {
      revealed = true
      if (latest != null) setCount(latest)
    }, 1000)
    const unsub = subscribeOnlineCount(
      (n) => {
        latest = n
        if (revealed) setCount(n)
      },
      () => {
        latest = null
        setCount(null) // denied (logged out) → hide cleanly instead of freezing
      },
    )
    return () => {
      clearTimeout(revealTimer)
      unsub()
    }
  }, [uid])

  if (count === null) return null
  return (
    <div className="online-count" aria-live="polite">
      在線人數：{count}
    </div>
  )
}
