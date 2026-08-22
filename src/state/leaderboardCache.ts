import { create } from 'zustand'
import { fetchTop, fetchMyRank, BOARDS, type Board, type LbRow, type MyRank } from '../platform/leaderboard'

/**
 * Cross-screen leaderboard cache (使用者定案的省流量策略).
 *
 * - 第一次進排行榜:一定抓。先抓第一個榜(拓域先鋒)立刻呈現,其餘 3 榜在背景抓好放快取。
 * - 停在排行榜切頁籤:全讀快取,不再打 DB。
 * - 離開再進來:只有「打過對戰(dirty)」或「距上次抓滿 5 分鐘」才重抓整批;否則吃快取。
 * - 只要真的抓了,就把 lastFetch 設為現在、dirty 清為 false。
 * 「我的名次」只在該榜沒進前 20 時才另外查一次,並跟著快取(重抓時一起清)。
 */
const STALE_MS = 5 * 60 * 1000

interface LbCacheState {
  tops: Partial<Record<Board, LbRow[]>>
  myRanks: Partial<Record<Board, MyRank | null>>
  lastFetch: number // 0 = 從未抓過(這個 app 生命週期)
  dirty: boolean // 打過對戰 / 分數可能變動 → 下次進來重抓
  loading: boolean // 第一個榜還沒回來
  error: boolean
  /** 標記「我的資料可能變了」(打完一場對戰、解成就、拿鑽…) */
  markDirty: () => void
  /** 進入排行榜時呼叫:決定吃快取還是重抓一批。 */
  open: () => Promise<void>
  /** 某個榜沒進前 20 時,補查我的確切名次(快取)。 */
  ensureMyRank: (board: Board, uid: string) => Promise<void>
}

export const useLeaderboardCache = create<LbCacheState>((set, get) => ({
  tops: {},
  myRanks: {},
  lastFetch: 0,
  dirty: false,
  loading: false,
  error: false,

  markDirty: () => set({ dirty: true }),

  open: async () => {
    const s = get()
    const now = Date.now()
    const fresh = s.lastFetch !== 0 && !s.dirty && now - s.lastFetch < STALE_MS
    if (fresh && Object.keys(s.tops).length > 0) return // 吃快取,不打 DB

    // 重抓一批:先清舊快取,抓第一個榜立刻呈現,其餘背景抓。
    set({ loading: true, error: false, tops: {}, myRanks: {} })
    const [first, ...rest] = BOARDS
    try {
      const firstRows = await fetchTop(first)
      set((st) => ({
        tops: { ...st.tops, [first]: firstRows },
        loading: false,
        lastFetch: now,
        dirty: false,
      }))
    } catch {
      set({ loading: false, error: true })
      return
    }
    for (const b of rest) {
      void fetchTop(b)
        .then((rows) => set((st) => ({ tops: { ...st.tops, [b]: rows } })))
        .catch(() => {})
    }
  },

  ensureMyRank: async (board, uid) => {
    const s = get()
    if (s.myRanks[board] !== undefined) return // 已查過(含 null)
    const rows = s.tops[board]
    if (!rows) return // 該榜還沒載回來
    if (rows.some((r) => r.uid === uid)) return // 已在前 20,不用另查
    try {
      const mr = await fetchMyRank(board, uid)
      set((st) => ({ myRanks: { ...st.myRanks, [board]: mr } }))
    } catch {
      /* ignore */
    }
  },
}))
