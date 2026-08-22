import { create } from 'zustand'
import type { AchUnlock } from '../game/achievements'

/**
 * Queue of things to announce via the shared popup (AchievementToast): freshly
 * unlocked achievements AND one-off rewards (e.g. a PvP-win diamond drop). Shown
 * one at a time so they never overlap; rewards are enqueued before achievements
 * so the diamond pops first. Deliberately separate from the tiny login Toast
 * (使用者:那個太不起眼,不適合當成就/獎勵通知).
 */
/** Art shown in a reward toast: a real unlocked card / avatar (rendered by the
 *  toast), instead of a plain emoji icon. */
export type RewardArt = { kind: 'card' | 'avatar'; id: string }
export interface RewardNotice {
  kind: 'reward'
  /** emoji fallback when there's no `art` (e.g. the 💎 diamond reward) */
  icon?: string
  art?: RewardArt
  title: string
  sub?: string
  /** override the on-screen duration in ms (default 2000). e.g. 每日簽到 = 5000. */
  dur?: number
}
export type Notice = ({ kind: 'ach' } & AchUnlock) | RewardNotice

interface AchievementStore {
  queue: Notice[]
  /** Epoch-ms until which the toast must hold (no show/sound). Used at match end so
   *  勝利/失敗 音效先站穩,再放行鑽石/成就佇列(避免第一個「叮」與勝負號角疊在一起)。*/
  gateUntil: number
  /** enqueue achievement unlocks (appended after anything already queued) */
  push: (unlocks: AchUnlock[]) => void
  /** enqueue a one-off reward notice */
  pushReward: (reward: Omit<RewardNotice, 'kind'>) => void
  shift: () => void
  /** hold the queue for `ms` from now (only the first item is affected in practice). */
  hold: (ms: number) => void
}

export const useAchievementStore = create<AchievementStore>((set) => ({
  queue: [],
  gateUntil: 0,
  push: (unlocks) =>
    unlocks.length && set((s) => ({ queue: [...s.queue, ...unlocks.map((u) => ({ kind: 'ach' as const, ...u }))] })),
  pushReward: (reward) =>
    set((s) => {
      const n: Notice = { kind: 'reward', ...reward }
      const q = s.queue
      if (q.length === 0) return { queue: [n] }
      // Insert after the item on screen (q[0]) and after any already-queued
      // rewards, but before the first achievement → rewards stay in push order
      // and lead the achievements (獎勵先, 再成就), without interrupting q[0].
      let i = 1
      while (i < q.length && q[i].kind === 'reward') i++
      return { queue: [...q.slice(0, i), n, ...q.slice(i)] }
    }),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
  hold: (ms) => set({ gateUntil: Date.now() + ms }),
}))

// DEV-only test hooks (成就/獎勵很難自然觸發 → 手動彈假的來測 toast 序列與音效)。
// 在瀏覽器 console 執行:__testToast()(只彈通知)、__testWin()(勝利音→1.8s→鑽石/頭像/特殊牌→成就)。
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const enqueueFakes = () => {
    const s = useAchievementStore.getState()
    s.pushReward({ icon: '💎', title: '+5 💎', sub: '每日勝利獎勵' })
    s.pushReward({ title: '解鎖頭像', sub: '新頭像', art: { kind: 'avatar', id: 'dog' } })
    s.pushReward({ title: '解鎖特殊牌', sub: '新卡片', art: { kind: 'card', id: 'swap' } })
    s.push([{ id: 'wins', tier: 1 }])
  }
  const w = window as unknown as { __testToast: () => void; __testWin: () => void }
  w.__testToast = enqueueFakes
  w.__testWin = () => {
    void import('../audio/sfx').then(({ sfx }) => sfx.win())
    useAchievementStore.getState().hold(700)
    enqueueFakes()
  }
}
