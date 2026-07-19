import { create } from 'zustand'
import {
  createRoom,
  joinRoom,
  leaveRoom,
  maintainPresence,
  saveSession,
  subscribeRoom,
  getClientId,
  type Role,
  type Room,
} from '../net/room'

export type NetPhase = 'idle' | 'connecting' | 'waiting' | 'connected' | 'error'

interface NetStore {
  code: string | null
  role: Role | null
  room: Room | null
  phase: NetPhase
  error: string | null
  _unsub: (() => void) | null
  _presenceUnsub: (() => void) | null

  /** host: create a room and wait for a guest */
  create: () => Promise<void>
  /** guest: join an existing room by code */
  join: (code: string) => Promise<void>
  /** re-subscribe to an existing room after an accidental reload (no re-join) */
  reconnect: (code: string, role: Role) => void
  /** tear down subscription + presence and reset */
  leave: () => void
}

export const useNetStore = create<NetStore>((set, get) => ({
  code: null,
  role: null,
  room: null,
  phase: 'idle',
  error: null,
  _unsub: null,
  _presenceUnsub: null,

  create: async () => {
    get()._unsub?.()
    get()._presenceUnsub?.()
    set({ phase: 'connecting', error: null, role: 'host', code: null, room: null })
    try {
      const { code } = await createRoom()
      saveSession(code, 'host')
      const unsub = subscribeRoom(code, (room) => update(set, get, room))
      const presence = maintainPresence(code, 'host')
      set({ code, _unsub: unsub, _presenceUnsub: presence, phase: 'waiting' })
    } catch (e) {
      set({ phase: 'error', error: (e as Error).message ?? '建立房間失敗' })
    }
  },

  join: async (code) => {
    get()._unsub?.()
    get()._presenceUnsub?.()
    set({ phase: 'connecting', error: null, role: 'guest', code, room: null })
    try {
      await joinRoom(code)
      saveSession(code, 'guest')
      const unsub = subscribeRoom(code, (room) => update(set, get, room))
      const presence = maintainPresence(code, 'guest')
      set({ _unsub: unsub, _presenceUnsub: presence })
    } catch (e) {
      set({ phase: 'error', error: (e as Error).message ?? '加入房間失敗' })
    }
  },

  reconnect: (code, role) => {
    get()._unsub?.()
    get()._presenceUnsub?.()
    const unsub = subscribeRoom(code, (room) => update(set, get, room))
    const presence = maintainPresence(code, role)
    set({ code, role, phase: 'connecting', error: null, room: null, _unsub: unsub, _presenceUnsub: presence })
  },

  leave: () => {
    const { code, role, _unsub, _presenceUnsub } = get()
    _unsub?.()
    _presenceUnsub?.()
    if (code && role) void leaveRoom(code, role)
    set({ code: null, role: null, room: null, phase: 'idle', error: null, _unsub: null, _presenceUnsub: null })
  },
}))

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __net: typeof useNetStore }).__net = useNetStore
}

/** Recompute the connection phase from a fresh room snapshot. */
function update(
  set: (partial: Partial<NetStore>) => void,
  get: () => NetStore,
  room: Room | null,
) {
  const { role } = get()
  if (!room) {
    // Room vanished (host left an empty waiting room, etc.).
    set({ room: null, phase: role === 'guest' ? 'error' : 'idle', error: role === 'guest' ? '房間已關閉' : null })
    return
  }
  const me = getClientId()
  // "connected" = both players have JOINED the room (guestId present). Live
  // presence flags (players.*.connected) drive the in-game disconnect overlay
  // only — a transient drop must not un-start the game.
  const bothJoined = !!room.guestId && room.guestId !== room.hostId
  // guard: I must still belong to this room
  const mine = room.hostId === me || room.guestId === me
  set({
    room,
    phase: !mine ? 'error' : bothJoined ? 'connected' : 'waiting',
    error: !mine ? '你已不在此房間' : null,
  })
}
