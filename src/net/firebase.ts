import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getDatabase, type Database } from 'firebase/database'

/**
 * Firebase init for the Realtime Database connection. Values come from `.env`
 * (VITE_FB_*, see docs/FIREBASE_SETUP.md). Web config is public by design —
 * security is enforced by the RTDB rules, not by hiding these values.
 *
 * Lazily initialised so the single-player / menu flows never touch Firebase
 * until the player actually creates or joins a room.
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
let database: Database | null = null

/** True when the build has Firebase config wired up (so UI can disable online play if not). */
export function isFirebaseConfigured(): boolean {
  return !!config.apiKey && !!config.databaseURL
}

export function getDb(): Database {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase 尚未設定（缺少 VITE_FB_* 環境變數）')
  }
  if (!app) app = initializeApp(config)
  if (!database) database = getDatabase(app)
  return database
}
