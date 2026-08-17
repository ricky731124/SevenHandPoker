import { useEffect, useState } from 'react'
import { usePlatformStore } from '../../state/platformStore'
import { isFirebaseConfigured } from '../../firebaseApp'
import { subscribeOnlineCount } from '../../net/presence'
import './OnlineCount.css'

/**
 * 同時在線人數 — bottom-right, OWNER ONLY for now (username === 'ricky'). Used to
 * eyeball concurrency before deciding whether to open 自由匹配 publicly. Only the
 * owner's client subscribes (so nobody else downloads the presence tree); every
 * client still *reports* presence (see App/trackPresence). To open it up later,
 * drop the `isOwner` gate.
 */
const OWNER = 'ricky'

export default function OnlineCount() {
  const username = usePlatformStore((s) => s.username)
  const isOwner = username === OWNER
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!isOwner || !isFirebaseConfigured()) return
    return subscribeOnlineCount(setCount)
  }, [isOwner])

  if (!isOwner || count === null) return null
  return (
    <div className="online-count" aria-live="polite">
      線上人數：{count}
    </div>
  )
}
