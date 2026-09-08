import { onValue, push, query, limitToLast, ref, remove, serverTimestamp } from 'firebase/database'
import { getDb } from './firebase'
import type { PlayerId } from '../game/state'
import type { Move } from '../game/replay'

/**
 * 賽事回放(§6.1)。存的是**棋譜**(move-log),不是影片:回放時 `createGame(seed, firstPicker)`
 * 後把 `moves` 套回 `state.ts` 純函式即可重現整場。每筆 2~5KB,公開讀。兩份清單:
 *  - **精華賽事**(全站)：`replays/{id}` —— 只收「自然正常結束」的真人/人機局,cap 8。
 *  - **我的賽事**(每人)：`userReplays/{uid}/{id}` —— 我打的(自然結束 + **手動中離**),cap 8/人。
 *    線上局由 host 推、同時幫**雙方 uid** 各記一份 → 連我當 guest 的那場也在我的清單(對方需新版)。
 *    中離目前只做 casual(快速配對 vs 人機)自己離開;線上中離不記回放(仍記敗績)。
 */

/** 配對方式:casual=快速配對(vs 人機)、match=快速配對(vs 真人)、friend=對戰好友(開房)。 */
export type MatchType = 'casual' | 'match' | 'friend'

export interface ReplayPlayer {
  name: string
  avatar: string
  uid: string | null
  isBot?: boolean
}

export interface ReplayRecord {
  v: 1
  seed: number
  firstPicker: PlayerId
  special: boolean // 房型:true=特殊(牌)房、false=一般房
  matchType: MatchType
  /** true = 手動中離(未自然結束)→ winner 為對手;回放播到離開那步為止。 */
  abandoned?: boolean
  p1: ReplayPlayer
  p2: ReplayPlayer
  winner: PlayerId
  endedAt: number
  moves: Move[]
}

/** 清單一筆(帶 push key 當 id)。清單本身就帶 moves → 點入直接回放,不必再 fetch。 */
export type ReplayEntry = ReplayRecord & { id: string }

const KEEP = 8 // 精華 / 每人 各留最新 8 筆(後蓋前)。

const globalRef = () => ref(getDb(), 'replays')
const userRef = (uid: string) => ref(getDb(), `userReplays/${uid}`)

/** RTDB 拒收 undefined、掉空陣列 → JSON round-trip 去掉 undefined(moves 全純值,安全)。 */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function payloadOf(rec: Omit<ReplayRecord, 'v' | 'endedAt'>): object {
  return clean({
    v: 1,
    seed: rec.seed,
    firstPicker: rec.firstPicker,
    special: rec.special,
    matchType: rec.matchType,
    ...(rec.abandoned ? { abandoned: true } : {}),
    p1: rec.p1,
    p2: rec.p2,
    winner: rec.winner,
    endedAt: serverTimestamp(),
    moves: rec.moves,
  })
}

/** 推一筆「精華賽事」(全站,只在自然結束時呼叫)。best-effort。 */
export async function pushHighlight(rec: Omit<ReplayRecord, 'v' | 'endedAt'>): Promise<void> {
  if (!rec.moves?.length) return
  try {
    await push(globalRef(), payloadOf(rec))
  } catch {
    /* best-effort — 規則未發布 / 離線 */
  }
}

/** 推一筆到某位玩家的「我的賽事」。自然結束時幫雙方真人各推一份;中離時推離開者(+對手)。 */
export async function pushUserReplay(uid: string, rec: Omit<ReplayRecord, 'v' | 'endedAt'>): Promise<void> {
  if (!uid || !rec.moves?.length) return
  try {
    await push(userRef(uid), payloadOf(rec))
  } catch {
    /* best-effort */
  }
}

/** 訂閱全站「精華賽事」最新 8 場(新→舊),順手清潔工留 8。 */
export function subscribeHighlights(cb: (entries: ReplayEntry[]) => void, n = KEEP): () => void {
  return subscribeList(globalRef(), (id) => remove(ref(getDb(), `replays/${id}`)), cb, n)
}

/** 訂閱某人「我的賽事」最新 8 場(新→舊),順手清潔工留 8。 */
export function subscribeUserReplays(uid: string, cb: (entries: ReplayEntry[]) => void, n = KEEP): () => void {
  if (!uid) {
    cb([])
    return () => {}
  }
  return subscribeList(userRef(uid), (id) => remove(ref(getDb(), `userReplays/${uid}/${id}`)), cb, n)
}

function subscribeList(
  node: ReturnType<typeof ref>,
  del: (id: string) => Promise<unknown>,
  cb: (entries: ReplayEntry[]) => void,
  n: number,
): () => void {
  const q = query(node, limitToLast(Math.max(n, KEEP) + 4))
  const unsub = onValue(
    q,
    (snap) => {
      const all = (snap.val() ?? {}) as Record<string, ReplayRecord>
      const list: ReplayEntry[] = Object.entries(all)
        .filter(([, r]) => r && r.moves && r.p1 && r.p2)
        .map(([id, r]) => ({ ...r, id, endedAt: typeof r.endedAt === 'number' ? r.endedAt : 0 }))
        .sort((a, b) => b.endedAt - a.endedAt)
      // 清潔工:超過 n 的舊筆刪掉(後蓋前)。
      void Promise.all(list.slice(n).map((e) => del(e.id).catch(() => {})))
      cb(list.slice(0, n))
    },
    () => cb([]),
  )
  return unsub
}

if (import.meta.env.DEV) {
  // 造一場完整結束的假賽事(含 swap),同時推進精華 + 自己的我的賽事,方便目視驗證兩個頁籤。
  ;(window as unknown as { __seedReplay: (matchType?: MatchType) => Promise<void> }).__seedReplay = async (
    matchType: MatchType = 'casual',
  ) => {
    const { createGame, applyPick, applyPlace, applyDraw, applySwap, resolveShowdown, emptySlotsFor, otherPlayer, swapTargets } =
      await import('../game/state')
    const { recordingRng } = await import('../game/replay')
    const { usePlatformStore } = await import('../state/platformStore')
    const seed = Math.floor(Math.random() * 1e9)
    let g = createGame(seed, 'p1')
    const moves: Move[] = []
    let didSwap = false
    for (let i = 0; i < 300 && g.phase !== 'ended'; i++) {
      const picker = g.turn
      if (!didSwap) {
        const t = swapTargets(g, picker)[0]
        if (t) {
          const rec = recordingRng()
          g = applySwap(g, picker, t.id, rec.rng)
          moves.push({ t: 'special', by: picker, card: 'swap', targetId: t.id, rng: rec.out })
          didSwap = true
        }
      }
      const card = g.hands[picker][0]
      g = applyPick(g, picker, [card.id])
      moves.push({ t: 'pick', by: picker, ids: [card.id] })
      const slot = emptySlotsFor(g, picker)[0]
      g = applyPlace(g, otherPlayer(picker), slot)
      moves.push({ t: 'place', by: otherPlayer(picker), slot })
      if (g.phase === 'showdown') g = resolveShowdown(g)
      if (g.phase === 'draw') g = applyDraw(g)
    }
    const myUid = usePlatformStore.getState().uid
    const rec: Omit<ReplayRecord, 'v' | 'endedAt'> = {
      seed,
      firstPicker: 'p1',
      special: matchType === 'friend',
      matchType,
      p1: { name: '測試甲', avatar: 'cat', uid: myUid },
      p2: { name: '測試乙人機', avatar: 'bird', uid: 'bot_demo', isBot: true },
      winner: g.winner ?? 'p1',
      moves,
    }
    await pushHighlight(rec)
    if (myUid) await pushUserReplay(myUid, rec)
    console.log('[seedReplay] pushed', moves.length, 'moves; winner', g.winner, 'matchType', matchType)
  }
  ;(window as unknown as { __delReplay: (id: string) => Promise<void> }).__delReplay = async (id: string) => {
    await remove(ref(getDb(), `replays/${id}`))
    console.log('[delReplay] removed', id)
  }
}
