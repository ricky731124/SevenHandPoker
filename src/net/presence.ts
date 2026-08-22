import { ref, onValue, onDisconnect, set, remove, push, serverTimestamp, type DatabaseReference } from 'firebase/database'
import { getDb } from './firebase'

/**
 * Lightweight presence, for an at-a-glance「同時在線人數」(currently owner-only —
 * see OnlineCount). Standard RTDB pattern: each live connection pushes a child
 * under `presence/$uid/$conn` and arms `onDisconnect().remove()`, so a closed
 * tab / dropped socket is cleaned up server-side. The online-person count is the
 * number of `presence/$uid` branches (multi-tab = still one person).
 *
 * Writes happen for EVERY signed-in client (anonymous included); only the owner
 * subscribes to the count. See database.rules.json `presence`.
 */

/** Start reporting this uid as online; returns a cleanup that goes offline. */
export function trackPresence(uid: string): () => void {
  const db = getDb()
  const connectedRef = ref(db, '.info/connected')
  let conRef: DatabaseReference | null = null
  const cardLastOnline = ref(db, `cards/${uid}/lastOnline`)
  const unsub = onValue(connectedRef, (snap) => {
    if (snap.val() !== true) return
    // A fresh child per (re)connection; auto-removed on disconnect.
    conRef = push(ref(db, `presence/${uid}`))
    void onDisconnect(conRef).remove()
    void set(conRef, true)
    // Stamp the player card's lastOnline on disconnect (#5) — so an offline
    // player's card shows when they were last on. Also stamp now, so a currently
    // online player has a recent value (the card shows「線上」for them anyway).
    void onDisconnect(cardLastOnline).set(serverTimestamp())
    void set(cardLastOnline, serverTimestamp())
  })
  return () => {
    unsub()
    if (conRef) void remove(conRef)
  }
}

/** Subscribe to the count of online people (distinct uids). */
export function subscribeOnlineCount(cb: (n: number) => void): () => void {
  return onValue(ref(getDb(), 'presence'), (snap) => cb(snap.size))
}
