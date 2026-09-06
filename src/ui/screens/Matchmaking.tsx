import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../state/appStore'
import { usePlatformStore } from '../../state/platformStore'
import { useToastStore } from '../../state/toastStore'
import { useGameStore } from '../../state/gameStore'
import { joinMatchmaking } from '../../net/matchmaking'
import { leaseBot, releaseLeasedBot } from '../../net/bots'
import { rollCasualBot } from '../../game/casualBots'
import type { SpecialCardId } from '../../game/specialCards'
import Modal from '../components/Modal'
import Button from '../components/Button'
import { sfx } from '../../audio/sfx'
import './Matchmaking.css'

const SEARCH_SECS = 23

/** The "matching…" status line ticks through phases so the wait feels alive. A
 *  real human still connects instantly whenever one appears — this text is only
 *  flavour for the empty wait. 使用者定案:兩段文案(15/16–23 配對時序). */
function phaseText(elapsed: number): string {
  if (elapsed < 16) return '請耐心等候…' // 0–15 秒(純等真人)
  return '即將配對完成…' // 16–23 秒(邊等真人邊配人機)
}

/**
 * Free-match ("自由匹配") overlay — a locked Modal on top of the menu (mask blocks
 * the menu behind). Queues for a human of the chosen room type; if none appears
 * within 30s, drops into a LOCAL bot match dressed as a matched player. 取消 closes
 * the overlay and returns to the menu.
 */
export default function Matchmaking() {
  const matchType = useAppStore((s) => s.matchType) ?? 'normal'
  const launchGame = useAppStore((s) => s.launchGame)
  const close = useAppStore((s) => s.closeMatchmaking)
  const [elapsed, setElapsed] = useState(0)
  const cancelRef = useRef<null | (() => void)>(null)

  useEffect(() => {
    let cancelled = false
    const special = matchType === 'special'
    const startBot = async () => {
      if (cancelled) return
      const profile = usePlatformStore.getState().profile
      const loadout = (profile?.equipped.specialCards ?? []) as SpecialCardId[]
      // Bot draws from the SAME unlocked pool as the player (fair mirror, like x-3).
      const unlocked = Object.keys(profile?.unlocked?.specialCards ?? {}) as SpecialCardId[]
      // §3.3 lease a FREE persona (exclusivity). No uid (offline) → random persona,
      // no lease. All 15 busy → keep searching, retry shortly (使用者可取消).
      const uid = usePlatformStore.getState().uid
      const persona = uid ? await leaseBot(uid) : undefined
      if (cancelled) {
        if (persona) void releaseLeasedBot()
        return
      }
      if (uid && !persona) {
        setTimeout(() => void startBot(), 3000) // all busy → try again soon
        return
      }
      const bot = rollCasualBot(special, unlocked, Math.random, persona ?? undefined)
      useGameStore.getState().startCasualBotMatch({
        special,
        timeLimit: 99,
        loadout,
        aiLoadout: bot.aiLoadout,
        boss: bot.boss,
        foe: { name: bot.name, avatarId: bot.avatarId, botId: bot.botId },
      })
      launchGame({ mode: 'ai', special, timeLimit: 99, casualBot: true })
      close()
    }
    void (async () => {
      // ensureAccount 內含 users/{uid} transaction;剛重開分頁連線未穩時它可能 reject。
      // 絕不能因此中斷後面的 joinMatchmaking(否則永遠入不了佇列=卡在 23 秒)。ensureProfile
      // 已改成不 reject,這裡再包一層 try/catch 當保險:有 uid 就照常配對,沒有才走本機人機。
      try {
        await usePlatformStore.getState().ensureAccount()
      } catch {
        /* 連線未穩 → 用既有 uid 照常配對;真沒 uid 才落本機人機 */
      }
      if (cancelled) return
      const uid = usePlatformStore.getState().uid
      if (!uid) return startBot() // no Firebase → straight to a bot
      const name = usePlatformStore.getState().displayName || '玩家'
      const avatar = usePlatformStore.getState().profile?.equipped?.avatar || 'cat'
      cancelRef.current = joinMatchmaking(
        matchType,
        { uid, name, avatar },
        {
          onMatched: (role, code) => {
            if (cancelled) return
            launchGame({ mode: role, roomId: code, special, timeLimit: 99 })
            close()
          },
          onTimeout: startBot,
          onError: (msg) => {
            if (cancelled) return
            useToastStore.getState().show(msg)
            close()
          },
        },
      )
    })()
    return () => {
      cancelled = true
      cancelRef.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => (s < SEARCH_SECS ? s + 1 : s)), 1000)
    return () => clearInterval(t)
  }, [])

  const cancel = () => {
    sfx.click()
    cancelRef.current?.()
    close()
  }

  return (
    <Modal open locked width={340} title="尋找對手中…">
      <div className="mm">
        <div className="mm__spinner" aria-hidden="true" />
        <p className="mm__sub">
          {matchType === 'special' ? '特殊房' : '一般房'} · 配對時間：{elapsed} 秒
        </p>
        <p className="mm__phase">{phaseText(elapsed)}</p>
        {/* Lock 取消 for the first 2s: an instant pairing (someone already waiting)
            can land in the same tick a fast tap hits 取消 → the canceller bails but
            the peer is left connected to a room nobody joins. #7 (no countdown text
            — 使用者:倒數會讓人看不懂) */}
        <Button variant="secondary" onClick={cancel} disabled={elapsed < 2}>
          取消
        </Button>
      </div>
    </Modal>
  )
}
