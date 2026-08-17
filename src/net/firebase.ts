import { getDatabase, type Database } from 'firebase/database'
import { getFirebaseApp, isFirebaseConfigured } from '../firebaseApp'

/**
 * Realtime Database handle. The app instance itself lives in ../firebaseApp so
 * that Auth (platform/) and RTDB (net/) share one Firebase app.
 *
 * Lazily resolved so single-player / menu flows never touch Firebase until the
 * player actually creates or joins a room.
 */
export { isFirebaseConfigured }

let database: Database | null = null

export function getDb(): Database {
  if (!database) database = getDatabase(getFirebaseApp())
  return database
}
