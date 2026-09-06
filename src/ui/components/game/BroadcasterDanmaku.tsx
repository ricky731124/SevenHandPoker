import { useEffect, useState } from 'react'
import { useGameStore } from '../../../state/gameStore'
import { watchDanmaku, type DanmakuMsg } from '../../../net/spectate'
import DanmakuLayer from './DanmakuLayer'

/**
 * 廣播端(玩家)看觀眾彈幕 + 進出提示(#8)。玩家端「觀眾彈幕」開關(gameStore.showSpectatorDanmaku,
 * 預設開)開時,訂自己這場的 danmaku/notice,用同一個 DanmakuLayer(右側中間、7 行 5 秒、穿透)顯示。
 */
export default function BroadcasterDanmaku() {
  const code = useGameStore((s) => s.broadcastCode)
  const show = useGameStore((s) => s.showSpectatorDanmaku)
  const [feed, setFeed] = useState<DanmakuMsg[]>([])

  useEffect(() => {
    // 關閉(或沒 code)→ 清空 feed。⚠️ 不清的話:再打開時舊 feed 還在、DanmakuLayer 重掛(processed
    // 清空)會把舊的全部當新的一次補播出來(使用者回報:關了再開又從頭收到全部,#3)。
    // watchDanmaku 用 startAfter 只收「重訂後」新增的,所以再開只會拿到之後的新彈幕。
    if (!code || !show) {
      setFeed([])
      return
    }
    const stop = watchDanmaku(code, (m) => setFeed((f) => [...f, m].slice(-40)))
    return stop
  }, [code, show])

  if (!code || !show) return null
  return <DanmakuLayer feed={feed} />
}
