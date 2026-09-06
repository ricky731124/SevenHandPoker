import { CAMPAIGN } from './campaign'
import { rollMain, type BossRuntime } from './bossAI'
import { BOTS } from './bots'
import type { SpecialCardId } from './specialCards'

/**
 * Free-match ("自由匹配") bot opponents. When matchmaking finds no human, we run
 * a normal LOCAL game against a campaign boss brain, dressed up as a matched
 * player so it reads as PvP. Rewards/wins count exactly like a real match (使用者
 * 定案). The player is never told it's a bot.
 *
 * §3: the identity (name/avatar/id) is a FIXED persona from BOTS (stable, has a
 * real win/loss record + clickable card); only the boss BRAIN is rolled per match.
 */

/** Mixed skill so it feels like a real playerbase (有弱有中偶爾強), never a
 *  merciless 100% that churns新人. Same tiers as the campaign sub-stages. */
const EXECUTIONS = [0.6, 0.75, 0.9]

export interface CasualBot {
  /** persona id (bots/{botId}) — for the win/loss record + lease (§3.2/§3.3) */
  botId: string
  /** display name shown in the VS intro / board (fixed persona) */
  name: string
  /** avatar id (fixed persona) */
  avatarId: string
  /** the boss brain (random campaign profile + rolled main style + execution) */
  boss: BossRuntime
  /** special cards the bot carries in a 特殊房 (empty in a 一般房) */
  aiLoadout: SpecialCardId[]
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] ?? arr[0]
}

/** Up to `n` random distinct items from `arr` (fewer if the pool is smaller). */
function pickSome<T>(arr: T[], n: number, rng: () => number): T[] {
  const pool = [...arr]
  const out: T[] = []
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0])
  return out
}

/**
 * Roll a random free-match bot.
 * @param special  a 特殊房 → the bot carries a loadout; 一般房 → no specials.
 * @param unlocked the PLAYER's unlocked special-card pool. The bot draws its
 *   loadout (≤3) from the same pool, so its card access mirrors the player's
 *   progress boundary — the same fairness as a campaign x-3 boss. 使用者定案.
 */
export function rollCasualBot(
  special: boolean,
  unlocked: SpecialCardId[] = [],
  rng: () => number = Math.random,
  persona = pick(BOTS, rng), // §3.3 may pass a specific LEASED persona; else random
): CasualBot {
  const stage = pick(CAMPAIGN, rng)
  const boss: BossRuntime = { profile: stage.profile, main: rollMain(stage.profile, rng), execution: pick(EXECUTIONS, rng) }
  const aiLoadout = special ? pickSome(unlocked, 3, rng) : []
  return { botId: persona.id, name: persona.name, avatarId: persona.avatarId, boss, aiLoadout }
}
