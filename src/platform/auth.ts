import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  signInWithPopup,
  signInWithCredential,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { getFirebaseApp } from '../firebaseApp'

/**
 * Auth wrapper (portable). See docs/PLATFORM-SPEC.md §2.
 *
 * Model: silent-anonymous baseline created LAZILY (not on boot) + in-place
 * upgrade to a username/password account via linkWithCredential. Players only
 * ever type a username + password; we map the username to a synthetic email.
 */

// Synthetic email domain — players never see it. See PLATFORM-SPEC §2.3.
const EMAIL_DOMAIN = 'shp.local'

let _auth: Auth | null = null
function auth(): Auth {
  if (!_auth) _auth = getAuth(getFirebaseApp())
  return _auth
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}
function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${EMAIL_DOMAIN}`
}

export const USERNAME_RE = /^[A-Za-z0-9]{2,16}$/
export function validateUsername(username: string): string | null {
  return USERNAME_RE.test(username.trim()) ? null : '帳號需 2–16 字，僅限英文或數字'
}
export function validatePassword(pw: string): string | null {
  return pw.length >= 6 ? null : '密碼至少 6 個字'
}

/**
 * Validate a display name (the in-game/leaderboard name). Free-form — Chinese,
 * English, numbers, symbols, emoji all allowed — just non-empty and ≤12 chars.
 * Uniqueness is NOT required. Distinct from the login `username` (which must be
 * ASCII because it maps to a synthetic email).
 */
/** Display-name "width": CJK/full-width chars count as 2, ASCII as 1. Cap of 15
 *  = 7 中文字 (14) OR 15 英文字 — the in-game / battle name boxes are sized to fit
 *  this without clipping. */
const NAME_MAX_WIDTH = 15
export function displayNameWidth(s: string): number {
  let w = 0
  for (const ch of s) w += (ch.codePointAt(0) ?? 0) > 255 ? 2 : 1
  return w
}

/** Truncate a name so its width ≤ NAME_MAX_WIDTH (used on input to stop over-typing). */
export function clampDisplayName(s: string): string {
  let w = 0
  let out = ''
  for (const ch of s) {
    const cw = (ch.codePointAt(0) ?? 0) > 255 ? 2 : 1
    if (w + cw > NAME_MAX_WIDTH) break
    out += ch
    w += cw
  }
  return out
}

export const DISPLAY_NAME_HINT = '最多 7 個中文字或 15 個英文字'

export function validateDisplayName(name: string): string | null {
  const n = name.trim()
  if (n.length < 1) return '請輸入顯示名稱'
  if (displayNameWidth(n) > NAME_MAX_WIDTH) return `顯示名稱${DISPLAY_NAME_HINT}`
  return null
}

export function currentUser(): User | null {
  return auth().currentUser
}

/** Subscribe to auth state; fires immediately with the current user (or null). */
export function onAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth(), cb)
}

/**
 * Ensure a signed-in user exists (anonymous if none). Call this at the FIRST
 * persistence-worthy action, never on app boot. See PLATFORM-SPEC §2.2.
 */
export async function ensureUser(): Promise<User> {
  const u = auth().currentUser
  if (u) return u
  const cred = await signInAnonymously(auth())
  return cred.user
}

/**
 * Register = upgrade the current (anonymous) user in place, keeping the same
 * uid and all data. Creates an anonymous user first if there isn't one.
 */
export async function registerLink(username: string, password: string): Promise<User> {
  const user = await ensureUser()
  const cred = EmailAuthProvider.credential(usernameToEmail(username), password)
  const res = await linkWithCredential(user, cred)
  return res.user
}

/** Sign in to an existing username/password account. */
export async function login(username: string, password: string): Promise<User> {
  const res = await signInWithEmailAndPassword(auth(), usernameToEmail(username), password)
  return res.user
}

/**
 * Sign in with Google (no password to remember — the whole point). If the
 * current user is anonymous we upgrade in place (keeps the same uid + all
 * progress); if that Google account already exists we switch to it instead.
 *
 * Uses popup (not redirect): the app is on github.io while the auth handler is
 * on *.firebaseapp.com, and cross-site cookie blocking breaks signInWithRedirect
 * there — popup returns its result via postMessage and is reliable. Google
 * blocks OAuth inside in-app browsers (LINE/FB), which is why we gate those out.
 */
export async function loginWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider()
  // Always show the Google account chooser (don't silently reuse the last one),
  // so a user with multiple Google accounts can pick which to sign in with.
  provider.setCustomParameters({ prompt: 'select_account' })
  const cur = auth().currentUser
  if (cur && cur.isAnonymous) {
    try {
      const res = await linkWithPopup(cur, provider)
      return res.user
    } catch (e) {
      if ((e as { code?: string })?.code === 'auth/credential-already-in-use') {
        // Already has a real account — sign into it (drops throwaway guest data).
        const cred = GoogleAuthProvider.credentialFromError(e as never)
        if (cred) {
          const res = await signInWithCredential(auth(), cred)
          return res.user
        }
      }
      throw e
    }
  }
  const res = await signInWithPopup(auth(), provider)
  return res.user
}

/** Sign out. We do NOT auto re-create an anonymous user (stays lazy). */
export async function logout(): Promise<void> {
  await signOut(auth())
}
