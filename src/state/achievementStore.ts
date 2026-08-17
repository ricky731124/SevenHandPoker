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
}
export type Notice = ({ kind: 'ach' } & AchUnlock) | RewardNotice

interface AchievementStore {
  queue: Notice[]
  /** enqueue achievement unlocks (appended after anything already queued) */
  push: (unlocks: AchUnlock[]) => void
  /** enqueue a one-off reward notice */
  pushReward: (reward: Omit<RewardNotice, 'kind'>) => void
  shift: () => void
}

export const useAchievementStore = create<AchievementStore>((set) => ({
  queue: [],
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
}))
