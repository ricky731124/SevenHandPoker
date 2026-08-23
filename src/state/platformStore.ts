import { create } from 'zustand'
import { isFirebaseConfigured } from '../firebaseApp'
import {
  onAuth,
  ensureUser,
  registerLink,
  login as authLogin,
  loginWithGoogle as authLoginWithGoogle,
  logout as authLogout,
  validateUsername,
  validatePassword,
  validateDisplayName,
} from '../platform/auth'
import {
  ensureProfile,
  subscribeProfile,
  fetchProfile,
  reserveUsername,
  fetchDisplayName,
  setDisplayName,
  setDiamondsEarned,
  grantDailyReward,
  todayStr,
  markTutorialSeen as persistTutorialSeen,
  setUsername,
  setSpecialLoadout,
  setAvatar,
  setEquippedAchievements,
  unlockAll,
  recordStageClear as persistStageClear,
  writeMatchRecord as persistMatchRecord,
  buySticker as persistBuySticker,
  saveActiveSeries as persistActiveSeries,
  type Profile,
  type ActiveSeries,
} from '../platform/profile'
import { writeLeaderboard } from '../platform/leaderboard'
import { writeCard, type CardProfileFields } from '../platform/cards'
import { useLeaderboardCache } from './leaderboardCache'
import { ALL_SPECIAL_CARD_IDS, getSpecialCard } from '../game/specialCards'
import { subStageOrder } from '../game/campaign'
import { ALL_AVATAR_IDS, AVATARS } from '../ui/components/PlayerAvatar'
import { ACHIEVEMENTS, detectUnlocks, getAchievement, tierFor, type AchMetric, type HandTypeMetric } from '../game/achievements'
import { useAchievementStore } from './achievementStore'
import { ALL_PAID_STICKER_IDS, getSticker, stickerPrice } from '../game/stickers'

/** First-clear reward for a campaign sub-stage. */
export interface StageReward {
  card?: string
  avatar?: string
  diamonds: number
}

// The owner's test account: everything unlocked so it can exercise all content.
const TEST_ACCOUNT = 'ricky'

// 每日任務發鑽 (#6): 每項 +5。真人勝發鑽上限 2 場(舊制 3 場已取代)。
const DAILY_REWARD = 5
const PVP_WIN_CAP = 2 // 真人獲勝發鑽最多 2 場/日

/** Result of a PvP win's diamond grant, for the end screen's「+5 💎」line. */
export interface PvpReward {
  amount: number
  /** how many rewarded pvp wins today (1..2) */
  count: number
  /** true if today's pvp-win reward cap was already hit → this win earned nothing */
  capped: boolean
}

// 每日簽到只嘗試發一次/載入(避免 profile 尚未刷新前重複發)。跨載入靠 daily.signin。
let signinGrantedThisLoad = false
// 每次載入把自己的公開名片補寫一次(回訪登入不會經過 syncLeaderboard,名片會缺欄位)。
let cardBackfilledThisLoad = false

/** Build the full achievement-metric map from a stats blob (missing → 0). */
function statMetrics(s: Record<string, number>): Record<AchMetric, number> {
  return {
    streak: s.pvpBestStreak ?? 0,
    games: s.pvpGames ?? 0,
    wins: s.pvpWins ?? 0,
    soloGames: s.soloGames ?? 0,
    soloWins: s.soloWins ?? 0,
    flush: s.bestFlush ?? 0,
    fullHouse: s.bestFullHouse ?? 0,
    quads: s.bestQuads ?? 0,
    straightFlush: s.bestStraightFlush ?? 0,
    sfDuel: s.sfDuel ?? 0,
  }
}

/**
 * Platform account state (portable). Bridges Firebase Auth + profile to the UI.
 * See docs/PLATFORM-SPEC.md §2–§4.
 */

export type AuthResult = { ok: true } | { ok: false; error: string }

interface PlatformStore {
  ready: boolean // auth listener attached (or Firebase not configured)
  uid: string | null
  isAnonymous: boolean
  /** Login account name (ASCII) — password accounts only; used for login + the
   *  test-account check. NOT the in-game name (that's displayName). */
  username: string | null
  /** In-game / leaderboard name (free-form, can be Chinese). Falls back to
   *  username for legacy password accounts that predate displayName. */
  displayName: string | null
  /** The auth email (Google accounts) — shown as the read-only account label.
   *  Game accounts use a synthetic email so they show `username` instead. */
  email: string | null
  profile: Profile | null
  _authUnsub: (() => void) | null
  _profileUnsub: (() => void) | null

  /** Attach the auth listener once (call on app boot). Does NOT sign anyone in. */
  init: () => void
  /** Lazily create an anonymous account + profile at a persistence-worthy action. */
  ensureAccount: () => Promise<void>
  register: (username: string, password: string) => Promise<AuthResult>
  login: (username: string, password: string) => Promise<AuthResult>
  /** Google sign-in (no password). `needsName` = first time, must pick a display
   *  name next (chooseDisplayName); `suggestedName` prefills it from the Google
   *  account name. */
  loginWithGoogle: () => Promise<{ ok: true; needsName: boolean; suggestedName: string } | { ok: false; error: string }>
  /** Set the display name for a freshly signed-in Google account (first time). */
  chooseDisplayName: (name: string) => Promise<AuthResult>
  /** Change the display name later (個人化設定). Ensures an account first. */
  saveDisplayName: (name: string) => Promise<AuthResult>
  logout: () => Promise<void>
  /** Save the special-card loadout (ensures an account exists first). */
  saveLoadout: (ids: string[]) => Promise<void>
  /** Save the equipped avatar (ensures an account exists first). */
  saveAvatar: (id: string) => Promise<void>
  /** Save the displayed achievements (≤3 family ids; ensures an account first). */
  saveAchievements: (ids: string[]) => Promise<void>
  /** Persist a campaign sub-stage clear + grant its first-clear reward. */
  recordStageClear: (subId: string, reward: StageReward) => Promise<void>
  /** Tally a finished match: 戰績 (pvp/solo 場次·勝·連勝) + 連勝/場次/勝場成就。
   *  牌型成就改在送出當下即時判定(reportHandPlayed),不在這裡算。 */
  recordMatchResult: (category: 'pvp' | 'solo', won: boolean) => Promise<void>
  /** 每日簽到:今天第一次(有登入、手機需橫向)自動發 +5 鑽並跳 5 秒 toast。冪等。 */
  claimDailySignin: () => Promise<void>
  /** The last PvP win's diamond grant (for the end screen line); null on a loss. */
  lastPvpReward: PvpReward | null
  /** 送出一疊牌時即時回報其牌型的「單場累計數」;跨越門檻就當場解鎖 + 彈通知。 */
  reportHandPlayed: (metric: HandTypeMetric, matchCount: number) => Promise<void>
  /** A showdown revealed 同花順 vs 同花順 → tally 狹路相逢 (may unlock + notify). */
  reportSfDuel: () => Promise<void>
  /** Buy a sticker with 鑽石 (checks funds + ownership). */
  buySticker: (id: string) => Promise<{ ok: boolean; error?: string }>
  /** Save (or clear) the in-progress BO series for cross-session resume. */
  saveActiveSeries: (series: ActiveSeries | null) => Promise<void>
  /** Mark the tutorial as entered (unlocks 第1關). Ensures an account first. */
  markTutorialSeen: () => Promise<void>
}

export const usePlatformStore = create<PlatformStore>((set, get) => ({
  ready: false,
  uid: null,
  isAnonymous: false,
  username: null,
  displayName: null,
  email: null,
  profile: null,
  lastPvpReward: null,
  _authUnsub: null,
  _profileUnsub: null,

  init: () => {
    if (get()._authUnsub) return
    if (!isFirebaseConfigured()) {
      set({ ready: true })
      return
    }
    const unsub = onAuth((user) => {
      get()._profileUnsub?.()
      cardBackfilledThisLoad = false // 換帳號 → 允許重新補寫名片(含最新成就)
      signinGrantedThisLoad = false
      if (!user) {
        set({ uid: null, isAnonymous: false, username: null, displayName: null, email: null, profile: null, _profileUnsub: null, ready: true })
        return
      }
      set({ uid: user.uid, isAnonymous: user.isAnonymous, email: user.email ?? null, ready: true })
      void ensureProfile(user.uid, user.isAnonymous)
      const punsub = subscribeProfile(user.uid, (p) => {
        set({ profile: p, username: p?.username ?? null, displayName: p?.displayName ?? p?.username ?? null })
        // 補寫自己的公開名片一次/載入(回訪登入沒經過 syncLeaderboard → 名片會缺頭像/牌組/戰績)。
        if (!cardBackfilledThisLoad && p && !p.isAnonymous && (p.displayName ?? p.username)) {
          cardBackfilledThisLoad = true
          void writeCard(user.uid, cardFromProfile(p))
        }
        // Test account: keep everything unlocked (idempotent — only writes when
        // something is still missing, so the resulting update doesn't loop).
        if (p?.username === TEST_ACCOUNT) {
          const needCard = ALL_SPECIAL_CARD_IDS.some((id) => !p.unlocked.specialCards[id])
          const needAv = ALL_AVATAR_IDS.some((id) => !p.unlocked.avatars[id])
          const needStk = ALL_PAID_STICKER_IDS.some((id) => !p.unlocked.emojis?.[id])
          if (needCard || needAv || needStk) void unlockAll(user.uid, ALL_SPECIAL_CARD_IDS, ALL_AVATAR_IDS, ALL_PAID_STICKER_IDS)
        }
      })
      set({ _profileUnsub: punsub })
    })
    set({ _authUnsub: unsub })
  },

  ensureAccount: async () => {
    if (!isFirebaseConfigured()) return
    const user = await ensureUser()
    await ensureProfile(user.uid, user.isAnonymous)
  },

  register: async (username, password) => {
    const ve = validateUsername(username) ?? validatePassword(password)
    if (ve) return { ok: false, error: ve }
    try {
      const user = await registerLink(username, password)
      // linkWithCredential upgrades the same uid in place — onAuthStateChanged
      // does NOT fire, so push the now-registered state immediately (otherwise
      // the top-left stays "登入/註冊" until a refresh).
      set({ isAnonymous: user.isAnonymous, email: user.email ?? null })
      await ensureProfile(user.uid, false)
      await reserveUsername(username, user.uid)
      await setUsername(user.uid, username)
      // Seed the display name from the account name; editable later in 個人化設定.
      await setDisplayName(user.uid, username)
      // Push any progress accrued while anonymous onto the leaderboards now.
      void syncLeaderboard(user.uid)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: mapAuthError(e) }
    }
  },

  login: async (username, password) => {
    const ve = validateUsername(username)
    if (ve) return { ok: false, error: ve }
    try {
      await authLogin(username, password)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: mapAuthError(e) }
    }
  },

  loginWithGoogle: async () => {
    try {
      const user = await authLoginWithGoogle()
      // Same-uid link (anonymous → Google) doesn't fire onAuthStateChanged;
      // push the registered state now so the UI updates without a refresh.
      set({ uid: user.uid, isAnonymous: user.isAnonymous, email: user.email ?? null })
      await ensureProfile(user.uid, false)
      const name = await fetchDisplayName(user.uid)
      // Returning Google user: push existing progress to the boards now. A first-
      // timer (no name yet) gets synced by chooseDisplayName instead.
      if (name) void syncLeaderboard(user.uid)
      // Prefill the name picker with the Google account name (often the player's
      // real name, may be Chinese) so first-timers can just confirm.
      return { ok: true, needsName: !name, suggestedName: (user.displayName ?? '').slice(0, 12) }
    } catch (e) {
      return { ok: false, error: mapAuthError(e) }
    }
  },

  chooseDisplayName: async (name) => {
    const ve = validateDisplayName(name)
    if (ve) return { ok: false, error: ve }
    const uid = get().uid
    if (!uid) return { ok: false, error: '尚未登入，請重新登入' }
    try {
      await setDisplayName(uid, name)
      void syncLeaderboard(uid)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: mapAuthError(e) }
    }
  },

  saveDisplayName: async (name) => {
    const ve = validateDisplayName(name)
    if (ve) return { ok: false, error: ve }
    if (!isFirebaseConfigured()) return { ok: false, error: '離線中無法變更' }
    // Guests must not set a display name — it would make them look "logged in"
    // (the top-left bar keys off a registered account). Log in first.
    if (get().isAnonymous || !get().uid) return { ok: false, error: '登入後才能設定顯示名稱' }
    let uid = get().uid
    if (!uid) {
      await get().ensureAccount()
      uid = get().uid
    }
    if (!uid) return { ok: false, error: '需要帳號' }
    try {
      await setDisplayName(uid, name)
      // Renaming updates the denormalized name already shown on the boards.
      void syncLeaderboard(uid)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: mapAuthError(e) }
    }
  },

  logout: async () => {
    await authLogout()
  },

  markTutorialSeen: async () => {
    if (!isFirebaseConfigured()) return
    if (get().profile?.tutorialSeen) return // already set — no write
    let uid = get().uid
    if (!uid) {
      await get().ensureAccount()
      uid = get().uid
    }
    if (uid) await persistTutorialSeen(uid)
  },

  saveLoadout: async (ids) => {
    if (!isFirebaseConfigured()) return
    let uid = get().uid
    if (!uid) {
      await get().ensureAccount()
      uid = get().uid
    }
    if (uid) {
      await setSpecialLoadout(uid, ids)
      void syncCard(uid) // 更新公開名片的預設牌組(#5)
    }
  },

  saveAvatar: async (id) => {
    if (!isFirebaseConfigured()) return
    let uid = get().uid
    if (!uid) {
      await get().ensureAccount()
      uid = get().uid
    }
    if (uid) {
      await setAvatar(uid, id)
      // Changing the avatar must refresh the denormalized 頭像 on the boards too
      // (same as renaming does) — otherwise the leaderboard keeps the old art.
      void syncLeaderboard(uid)
    }
  },

  saveAchievements: async (ids) => {
    if (!isFirebaseConfigured()) return
    let uid = get().uid
    if (!uid) {
      await get().ensureAccount()
      uid = get().uid
    }
    if (uid) {
      await setEquippedAchievements(uid, ids)
      void syncCard(uid) // 展示成就變更 → 更新公開名片(#5/#2)
    }
  },

  recordStageClear: async (subId, reward) => {
    if (!isFirebaseConfigured()) return
    let uid = get().uid
    if (!uid) {
      await get().ensureAccount()
      uid = get().uid
    }
    if (!uid) return
    // maxStageCleared = the furthest-reached sub-stage (for map gating).
    const cur = get().profile?.progress.maxStageCleared ?? null
    const maxStageCleared = cur && subStageOrder(cur) >= subStageOrder(subId) ? cur : subId
    await persistStageClear(uid, {
      subId,
      maxStageCleared,
      cardId: reward.card,
      avatarId: reward.avatar,
      diamonds: reward.diamonds,
    })
    // Also announce every reward through the shared queue (toast + sound) — the
    // 通關 modal already reveals them, but the pops give the "earned" feel. Order:
    // 特殊牌 → 頭像 → 鑽石 (→ 成就). Card/avatar toasts show the REAL unlocked art.
    const notify = useAchievementStore.getState().pushReward
    if (reward.card) notify({ art: { kind: 'card', id: reward.card }, title: `解鎖特殊牌「${getSpecialCard(reward.card)?.name ?? reward.card}」` })
    if (reward.avatar) notify({ art: { kind: 'avatar', id: reward.avatar }, title: `解鎖頭像「${AVATARS.find((a) => a.id === reward.avatar)?.name ?? reward.avatar}」` })
    if (reward.diamonds > 0) notify({ icon: '💎', title: `過關獎勵　+${reward.diamonds} 💎` })
    void syncLeaderboard(uid)
  },

  saveActiveSeries: async (series) => {
    if (!isFirebaseConfigured()) return
    let uid = get().uid
    if (!uid) {
      await get().ensureAccount()
      uid = get().uid
    }
    if (uid) await persistActiveSeries(uid, series)
  },

  recordMatchResult: async (category, won) => {
    if (!isFirebaseConfigured()) return
    let uid = get().uid
    if (!uid) {
      await get().ensureAccount()
      uid = get().uid
    }
    if (!uid) return
    const s = get().profile?.stats ?? {}
    // Absolute stat values (streak resets → read-modify-write).
    const next: Record<string, number> = {
      [`${category}Games`]: (s[`${category}Games`] ?? 0) + 1,
      [`${category}Wins`]: (s[`${category}Wins`] ?? 0) + (won ? 1 : 0),
    }
    if (category === 'pvp') {
      const streak = won ? (s.pvpStreak ?? 0) + 1 : 0
      next.pvpStreak = streak
      next.pvpBestStreak = Math.max(s.pvpBestStreak ?? 0, streak)
    }
    // Detect 連勝/場次/勝場/電腦 tiers (牌型 tiers are handled live in reportHandPlayed).
    const metrics = statMetrics({ ...s, ...next })
    const { updated, newly } = detectUnlocks(get().profile?.unlocked.achievements ?? {}, metrics)
    await persistMatchRecord(uid, next, updated)

    // 每日任務發鑽 (#6): 達成即自動發,走同一個 toast 佇列(獎勵先於成就)。訪客不發。
    //   完成任意一場對戰 +5(pvp/電腦/主線都算)、真人獲勝 1 場 +5、真人獲勝 2 場 +5。
    let reward: PvpReward | null = null
    const p = get().profile
    if (uid && p && !p.isAnonymous) {
      const today = todayStr()
      const d = p.daily?.date === today ? p.daily : undefined
      const day = {
        date: today,
        signin: !!d?.signin,
        match: !!d?.match,
        pvpWin1: !!d?.pvpWin1,
        pvpWin2: !!d?.pvpWin2,
      }
      const toasts: { title: string }[] = []
      let total = 0
      if (!day.match) {
        day.match = true
        total += DAILY_REWARD
        toasts.push({ title: `每日任務：完成一場對戰　+${DAILY_REWARD} 💎` })
      }
      if (category === 'pvp' && won) {
        if (!day.pvpWin1) {
          day.pvpWin1 = true
          total += DAILY_REWARD
          toasts.push({ title: `每日任務：真人對戰獲勝一場　+${DAILY_REWARD} 💎` })
          reward = { amount: DAILY_REWARD, count: 1, capped: false }
        } else if (!day.pvpWin2) {
          day.pvpWin2 = true
          total += DAILY_REWARD
          toasts.push({ title: `每日任務：真人對戰獲勝二場　+${DAILY_REWARD} 💎` })
          reward = { amount: DAILY_REWARD, count: 2, capped: false }
        } else {
          reward = { amount: 0, count: PVP_WIN_CAP, capped: true } // 今日真人勝已領滿
        }
      }
      if (total > 0) {
        await grantDailyReward(uid, total, day)
        toasts.forEach((t) => useAchievementStore.getState().pushReward({ icon: '💎', title: t.title }))
      }
    }
    set({ lastPvpReward: reward })

    useAchievementStore.getState().push(newly)
    void syncLeaderboard(uid)
  },

  claimDailySignin: async () => {
    // 由「點每日任務」這個手勢觸發(音效已解鎖、profile 也已載入)→ 比登入自動發穩。
    if (!isFirebaseConfigured() || signinGrantedThisLoad) return
    const uid = get().uid
    const p = get().profile
    if (!uid || !p || p.isAnonymous) return // 訪客不領
    const today = todayStr()
    if (p.daily?.date === today && p.daily?.signin) return // 今天已領
    signinGrantedThisLoad = true
    const d = p.daily?.date === today ? p.daily : undefined
    try {
      await grantDailyReward(uid, DAILY_REWARD, {
        date: today,
        signin: true,
        match: !!d?.match,
        pvpWin1: !!d?.pvpWin1,
        pvpWin2: !!d?.pvpWin2,
      })
      // 5 秒特製 toast + 入帳音(reward 音)。
      useAchievementStore.getState().pushReward({ icon: '💎', title: `每日簽到　+${DAILY_REWARD} 💎`, dur: 5000 })
    } catch {
      signinGrantedThisLoad = false // 失敗 → 允許再試
    }
  },

  reportHandPlayed: async (metric, matchCount) => {
    if (!isFirebaseConfigured()) return
    const uid = get().uid
    if (!uid) return // never blocks a pick; only tallies for a real account
    const s = get().profile?.stats ?? {}
    const key = `best${metric[0].toUpperCase()}${metric.slice(1)}`
    const best = Math.max(s[key] ?? 0, matchCount)
    if (best <= (s[key] ?? 0)) return // not a new single-match record → nothing to unlock
    const metrics = statMetrics({ ...s, [key]: best })
    const { updated, newly } = detectUnlocks(get().profile?.unlocked.achievements ?? {}, metrics)
    await persistMatchRecord(uid, { [key]: best }, updated)
    useAchievementStore.getState().push(newly)
    void syncLeaderboard(uid)
  },

  reportSfDuel: async () => {
    if (!isFirebaseConfigured()) return
    const uid = get().uid
    if (!uid) return // never blocks play; only tallies for a real account
    const s = get().profile?.stats ?? {}
    const nextCount = (s.sfDuel ?? 0) + 1
    const metrics = statMetrics({ ...s, sfDuel: nextCount })
    const { updated, newly } = detectUnlocks(get().profile?.unlocked.achievements ?? {}, metrics)
    await persistMatchRecord(uid, { sfDuel: nextCount }, updated)
    useAchievementStore.getState().push(newly)
    void syncLeaderboard(uid)
  },

  buySticker: async (id) => {
    if (!isFirebaseConfigured()) return { ok: false, error: '離線中無法購買' }
    let uid = get().uid
    if (!uid) {
      await get().ensureAccount()
      uid = get().uid
    }
    if (!uid) return { ok: false, error: '需要帳號' }
    const p = get().profile
    if (p?.unlocked.emojis?.[id]) return { ok: false, error: '已擁有' }
    const sticker = getSticker(id)
    if (!sticker) return { ok: false, error: '找不到貼圖' }
    const price = stickerPrice(sticker)
    if ((p?.diamonds ?? 0) < price) return { ok: false, error: '鑽石不足' }
    await persistBuySticker(uid, id, price)
    return { ok: true }
  },
}))

/**
 * Recompute this account's three leaderboard scores from the freshly-committed
 * profile and push the denormalized snapshot. Registered accounts only (guests
 * have no persistent identity). Best-effort: never blocks/throws into the caller.
 */
async function syncLeaderboard(uid: string): Promise<void> {
  try {
    const p = await fetchProfile(uid)
    if (!p || p.isAnonymous) return
    const displayName = p.displayName ?? p.username
    if (!displayName) return
    const maxStage = p.progress.maxStageCleared
    const order = maxStage ? subStageOrder(maxStage) : -1
    const stage =
      maxStage && order >= 0
        ? { score: order + 1, subId: maxStage, clearedAt: p.progress.stageClearedAt[maxStage] ?? 0 }
        : null
    const achievements = ACHIEVEMENTS.reduce((sum, f) => sum + (p.unlocked.achievements[f.id] ?? 0), 0)
    // Lifetime diamonds: use the tally, but floor it at the current balance for
    // legacy accounts that earned before the tally existed (one-time backfill so
    // it stays monotonic afterwards — spending must never drop the score).
    let diamonds = p.stats.diamondsEarned ?? 0
    if (diamonds < p.diamonds) {
      diamonds = p.diamonds
      await setDiamondsEarned(uid, diamonds)
    }
    await writeLeaderboard(uid, {
      displayName,
      avatarId: p.equipped.avatar,
      stage,
      wins: p.stats.pvpWins ?? 0,
      achievements,
      diamonds,
    })
    // 我的成績剛變動 → 下次進排行榜要重抓(不然看到的是舊快取)。
    useLeaderboardCache.getState().markDirty()
    // 同步公開名片(#5):頭像/名/牌組/戰績,供別人的資訊卡讀取。lastOnline 由 presence 管。
    await writeCard(uid, cardFromProfile(p))
  } catch {
    /* leaderboard is best-effort — a failed write must never break the game flow */
  }
}

/** Build the public name-card fields from a profile (#5). */
function cardFromProfile(p: Profile): CardProfileFields {
  const s = p.stats ?? {}
  return {
    displayName: p.displayName ?? p.username ?? '玩家',
    avatarId: p.equipped.avatar,
    loadout: p.equipped.specialCards ?? [],
    // 展示成就。equipped.achievements 存的是「每面獎章」的複合鍵 `${famId}:${tier}`
    // (個人化成就頁可同時展示同族不同階,見 Personalize toggle),所以這裡要拆鍵取
    // famId,再用 stats 即時算的階級驗證(玩家仍達標才顯示;同源於個人化畫面)。
    // ⚠️ 以前直接把整個鍵當族 id 丟 getAchievement → 永遠 undefined → 全被濾掉 →
    //    名片成就恆為「無」。相容舊資料:沒有 ':' 的純族 id 則用達標階級。
    achievements: (() => {
      const m = statMetrics(s)
      const out: { id: string; tier: number }[] = []
      for (const key of p.equipped.achievements ?? []) {
        const [famId, ts] = String(key).split(':')
        const fam = getAchievement(famId)
        if (!fam) continue
        const earned = tierFor(m[fam.metric], fam.thresholds)
        const shown = ts != null && ts !== '' ? Number(ts) : earned
        if (shown >= 1 && earned >= shown) out.push({ id: famId, tier: shown })
      }
      return out
    })(),
    pvp: {
      games: s.pvpGames ?? 0,
      wins: s.pvpWins ?? 0,
      streak: s.pvpStreak ?? 0,
      bestStreak: s.pvpBestStreak ?? 0,
    },
    solo: { games: s.soloGames ?? 0, wins: s.soloWins ?? 0 },
  }
}

/** Refresh only the public name-card (used where the leaderboard sync isn't — e.g.
 *  changing the preset deck). Registered players only; best-effort. */
async function syncCard(uid: string): Promise<void> {
  try {
    const p = await fetchProfile(uid)
    if (!p || p.isAnonymous || !(p.displayName ?? p.username)) return
    await writeCard(uid, cardFromProfile(p))
  } catch {
    /* best-effort */
  }
}

function mapAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
    case 'auth/account-exists-with-different-credential':
      return '這個帳號已被註冊，請換一個或改用登入'
    case 'auth/weak-password':
      return '密碼至少 6 個字'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-login-credentials':
      return '帳號或密碼錯誤'
    case 'auth/too-many-requests':
      return '嘗試太多次，請稍後再試'
    case 'auth/network-request-failed':
      return '網路連線失敗，請檢查網路'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '已取消登入'
    case 'auth/popup-blocked':
      return '瀏覽器擋住了登入視窗，請允許彈出視窗後再試'
    case 'auth/unauthorized-domain':
      return '此網域尚未開放 Google 登入（請在 Firebase 後台加入授權網域）'
    case 'auth/operation-not-supported-in-this-environment':
      return '目前的瀏覽器不支援 Google 登入，請改用 Safari / Chrome 開啟'
    default:
      return '發生錯誤，請再試一次'
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __platform: typeof usePlatformStore }).__platform = usePlatformStore
}
