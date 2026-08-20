import { CAMPAIGN } from './campaign'
import { rollMain, type BossRuntime } from './bossAI'
import type { SpecialCardId } from './specialCards'

/**
 * Free-match ("自由匹配") bot opponents. When matchmaking finds no human, we run
 * a normal LOCAL game against a campaign boss brain, dressed up as a matched
 * player (fake name + the boss's avatar) so it reads as PvP. Rewards/wins count
 * exactly like a real match (使用者定案). The player is never told it's a bot.
 */

/** Believable player-style handles (NOT campaign stage names). 使用者提供. */
const BOT_NAMES = ['山石宮分', '梅川伊芙', '海 Chris 爛', '無法顯示名稱', '金色狂蜂']

/** Mixed skill so it feels like a real playerbase (有弱有中偶爾強), never a
 *  merciless 100% that churns新人. Same tiers as the campaign sub-stages. */
const EXECUTIONS = [0.6, 0.75, 0.9]

export interface CasualBot {
  /** display name shown in the VS intro / board (fake, from the pool) */
  name: string
  /** avatar id — reuses the chosen boss's portrait */
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
): CasualBot {
  const stage = pick(CAMPAIGN, rng)
  const boss: BossRuntime = { profile: stage.profile, main: rollMain(stage.profile, rng), execution: pick(EXECUTIONS, rng) }
  const aiLoadout = special ? pickSome(unlocked, 3, rng) : []
  return { name: pick(BOT_NAMES, rng), avatarId: stage.bossAvatar, boss, aiLoadout }
}
