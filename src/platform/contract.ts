/**
 * Integration contract between the portable platform layer (src/platform/) and
 * a specific game's core (src/game/). See docs/PLATFORM-SPEC.md §1.
 *
 * The platform NEVER imports game code; the game talks to the platform only
 * through these types. Keep this file game-agnostic — no poker/board/boss terms,
 * only opaque ids (stageId, cardId) and free-form stats.
 *
 * Phase A: types only. Event emission (emitPlatformEvent) is wired in later
 * phases as each system that consumes an event comes online.
 */

/** A game-defined, per-match stats bag. The platform stores it but never interprets it. */
export interface MatchStats {
  coins?: number
  [key: string]: unknown
}

/** Events the game core reports UP to the platform. */
export type PlatformEvent =
  | {
      type: 'matchEnded'
      result: 'win' | 'lose' | 'draw'
      mode: 'campaign' | 'pvp' | 'ai'
      stageId?: string
      opponentId?: string
      stats: MatchStats
    }
  | { type: 'seriesEnded'; stageId: string; won: boolean }
  | { type: 'stageCleared'; stageId: string }
  | { type: 'achievementProgress'; key: string; delta?: number; absolute?: number }
  | { type: 'abilityUsed'; cardId: string }

/** Config the platform hands DOWN to the game core at match start. */
export interface PlatformContextForMatch {
  me: { uid: string; username: string | null; isAnonymous: boolean; avatarId: string }
  ability: {
    /** Card ids usable this match (PvP = both players' intersection; campaign = per stage rule). */
    poolCardIds: string[]
    /** The 3 cards I brought in (subset of pool after greying-out). */
    myLoadout: string[]
    /** How many may actually be played per match ("choose 3, use 1" ⇒ 1). */
    useLimitPerMatch: number
  }
  /** Present only for campaign matches; the game decides how to read `config`. */
  stage?: { stageId: string; bestOf: number; winsNeeded: number; config: unknown }
}
