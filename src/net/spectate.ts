import {
  onValue,
  onChildAdded,
  onDisconnect,
  ref,
  remove,
  get,
  push,
  query,
  orderByKey,
  startAfter,
  limitToLast,
  serverTimestamp,
  set as dbSet,
  type Query,
  type DataSnapshot,
} from 'firebase/database'
import { getDb } from './firebase'
import { deserializeForSpectator, type SpecView } from './sync'
import { usePlatformStore } from '../state/platformStore'
import { pickGuestName } from './spectatePools'
import type { GameState } from '../game/state'
import type { LiveEntry } from './liveIndex'

/**
 * Spectator client (§4.3 / Phase C): join a live match, mark myself in-席 (watch 節點
 * 存我的顯示名,供計數 + 撞名判斷 + 進出提示), stream the全開 view, 收/發彈幕 + 進出提示。
 */

export type LiveMeta = Omit<LiveEntry, 'code'>

/** 一則彈幕/系統提示(進出場)。system=true → 進出提示(灰字),否則觀眾彈幕。 */
export interface DanmakuMsg {
  id: string // pushId(去重/key)
  text: string
  by: string // 送出者顯示名(system 時空字串)
  system?: boolean
}

export interface SpectateHandle {
  stop: () => void
  sendDanmaku: (text: string) => void
}

const randomWatcherId = () => `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function resolveWatcherName(code: string, watchNode: ReturnType<typeof ref>): Promise<string> {
  const displayName = usePlatformStore.getState().displayName
  if (displayName) return displayName
  const skey = `shp.spec.name.${code}`
  try {
    const saved = sessionStorage.getItem(skey)
    if (saved) return saved
  } catch {
    /* private mode */
  }
  let taken = new Set<string>()
  try {
    const snap = await get(watchNode)
    const v = (snap.val() ?? {}) as Record<string, unknown>
    taken = new Set(Object.values(v).filter((x): x is string => typeof x === 'string'))
  } catch {
    /* best-effort */
  }
  const name = pickGuestName(taken)
  try {
    sessionStorage.setItem(skey, name)
  } catch {
    /* ignore */
  }
  return name
}

/**
 * 只訂閱「進場後新增」的 child(避免補播舊訊息,§4.6)。先讀當前最後一個 key,再用
 * `startAfter(lastKey)` 只收之後的;節點原本為空則直接 onChildAdded(僅未來)。
 * 回傳 unsub;`onNew` 對每個新 child 觸發。
 */
function subscribeNew(node: ReturnType<typeof ref>, onNew: (snap: DataSnapshot) => void): () => void {
  let unsub: (() => void) | null = null
  let killed = false
  void get(query(node, limitToLast(1)))
    .then((snap) => {
      if (killed) return
      let lastKey: string | null = null
      snap.forEach((c) => {
        lastKey = c.key
      })
      const q: Query = lastKey ? query(node, orderByKey(), startAfter(lastKey)) : node
      unsub = onChildAdded(q, (s) => onNew(s), () => {})
    })
    .catch(() => {})
  return () => {
    killed = true
    unsub?.()
  }
}

/**
 * 廣播端(玩家)訂閱自己這場的彈幕 + 進出提示(#8,只讀、不佔 watch、不送)。玩家端「觀眾彈幕」
 * 開關開時用它,讓玩家也看得到觀眾彈幕/進出。只收進場後新增的(subscribeNew)。
 */
export function watchDanmaku(code: string, onMsg: (m: DanmakuMsg) => void): () => void {
  const db = getDb()
  const u1 = subscribeNew(ref(db, `spectate/${code}/danmaku`), (snap) => {
    const v = snap.val() as { text?: string; by?: string } | null
    if (!v?.text) return
    onMsg({ id: snap.key ?? String(Math.random()), text: v.text, by: v.by || '觀眾' })
  })
  const u2 = subscribeNew(ref(db, `spectate/${code}/notice`), (snap) => {
    const v = snap.val() as { kind?: string; name?: string } | null
    if (!v?.name) return
    const text = v.kind === 'leave' ? `${v.name} 離開房間了` : `${v.name} 進來觀戰了`
    onMsg({ id: snap.key ?? String(Math.random()), text, by: '', system: true })
  })
  return () => {
    u1()
    u2()
  }
}

export function joinSpectate(
  code: string,
  handlers: {
    onSpec: (engine: GameState | null, view: SpecView | null) => void
    onLive?: (meta: LiveMeta | null) => void
    /** 收到彈幕 / 進出提示(§4.6,system=進出提示)。 */
    onDanmaku?: (msg: DanmakuMsg) => void
    /** 解析出本觀眾顯示名(訪客/顯示名)後回呼一次。 */
    onName?: (name: string) => void
  },
): SpectateHandle {
  const db = getDb()
  let stopped = false
  let myName = ''
  const watcherId = randomWatcherId()
  const watchNode = ref(db, `spectate/${code}/watch`)
  const watchRef = ref(db, `spectate/${code}/watch/${watcherId}`)
  const specRef = ref(db, `spectate/${code}/spec`)
  const liveRef = ref(db, `liveIndex/${code}`)
  const danmakuNode = ref(db, `spectate/${code}/danmaku`)
  const noticeNode = ref(db, `spectate/${code}/notice`)

  void usePlatformStore
    .getState()
    .ensureAccount()
    .catch(() => {})
    .then(async () => {
      if (stopped) return
      myName = await resolveWatcherName(code, watchNode)
      if (stopped) return
      handlers.onName?.(myName)
      void dbSet(watchRef, myName).catch(() => {})
      void onDisconnect(watchRef).remove().catch(() => {})
      void push(noticeNode, { kind: 'join', name: myName, at: serverTimestamp() }).catch(() => {}) // 進場提示
    })

  const unsubSpec = onValue(
    specRef,
    (snap) => {
      if (stopped) return
      const v = snap.val() as SpecView | null
      handlers.onSpec(v ? deserializeForSpectator(v) : null, v)
    },
    () => {},
  )

  const unsubLive = onValue(
    liveRef,
    (snap) => {
      if (stopped) return
      handlers.onLive?.(snap.exists() ? (snap.val() as LiveMeta) : null)
    },
    () => {},
  )

  // 彈幕:只收進場後新增的(§4.6)。
  const unsubDanmaku = subscribeNew(danmakuNode, (snap) => {
    if (stopped) return
    const v = snap.val() as { text?: string; by?: string } | null
    if (!v?.text) return
    handlers.onDanmaku?.({ id: snap.key ?? String(Math.random()), text: v.text, by: v.by || '觀眾' })
  })

  // 進出提示:也走同一個顯示區(§4.5/#4);略過自己的進出。
  const unsubNotice = subscribeNew(noticeNode, (snap) => {
    if (stopped) return
    const v = snap.val() as { kind?: string; name?: string } | null
    if (!v?.name || v.name === myName) return
    const text = v.kind === 'leave' ? `${v.name} 離開房間了` : `${v.name} 進來觀戰了`
    handlers.onDanmaku?.({ id: snap.key ?? String(Math.random()), text, by: '', system: true })
  })

  return {
    sendDanmaku: (text) => {
      if (stopped || !text) return
      void push(danmakuNode, { text, by: myName || '觀眾', at: serverTimestamp() }).catch(() => {})
    },
    stop: () => {
      if (stopped) return
      stopped = true
      unsubSpec()
      unsubLive()
      unsubDanmaku()
      unsubNotice()
      if (myName) void push(noticeNode, { kind: 'leave', name: myName, at: serverTimestamp() }).catch(() => {}) // 離場提示
      void onDisconnect(watchRef).cancel().catch(() => {})
      void remove(watchRef).catch(() => {})
    },
  }
}
