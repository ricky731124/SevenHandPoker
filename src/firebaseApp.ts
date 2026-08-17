import { initializeApp, type FirebaseApp } from 'firebase/app'

/**
 * Shared Firebase app instance for BOTH the Realtime Database (net/) and
 * Authentication (platform/). Values come from `.env` (VITE_FB_*, see
 * docs/FIREBASE_SETUP.md). Web config is public by design — security is
 * enforced by rules, not by hiding these values.
 *
 * Neutral location (not net/, not platform/) so the portable platform layer
 * never has to import the game's networking code.
 */
const config = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FB_DATABASE_URL,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
}

let app: FirebaseApp | null = null

/** True when the build has Firebase config wired up. */
export function isFirebaseConfigured(): boolean {
  return !!config.apiKey && !!config.databaseURL
}

/** Lazily create (once) and return the single shared Firebase app. */
export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase 尚未設定（缺少 VITE_FB_* 環境變數）')
  }
  if (!app) app = initializeApp(config)
  return app
}
