import { create } from 'zustand'
import {
  CAMPAIGN,
  advanceSeries,
  bossCardPool,
  getSubStage,
  newSeries,
  nextSubStageId,
  rewardForClear,
  rollBossRuntime,
  seriesOutcome,
  type CampaignStage,
  type MatchResult,
  type SeriesOutcome,
  type SeriesState,
  type SubStage,
} from '../game/campaign'
import type { SpecialCardId } from '../game/specialCards'
import { useGameStore } from './gameStore'
import { usePlatformStore, type StageReward } from './platformStore'
import { useAppStore } from './appStore'

/**
 * Campaign orchestrator (platform layer). Drives a BO series against a boss by
 * launching gameStore matches and folding each result via advanceSeries. The
 * in-progress series is persisted to the account after every match, so it
 * resumes across sessions (the point of logging in). Pure BO / unlock / reward
 * logic lives in campaign.ts; this store wires it to the engine, persistence,
 * and navigation.
 *
 * Flow: map node → openStart (戰前/接續 dialog) → startSeries → (match →
 * reportMatchResult)×N → 結算/通關/落敗. surrender = 放棄重打 (0-0).
 */

const CAMPAIGN_TIME_LIMIT = 99

interface CampaignStore {
  series: SeriesState | null
  stage: CampaignStage | null
  outcome: SeriesOutcome | null
  reward: StageReward | null
  viewStageId: string | null
  /** sub-stage id whose pre-match (or resume) dialog is open on the map */
  pendingStart: string | null
  /** A first-clear happened while anonymous — show the save-progress nudge once
   *  the player dismisses the 通關 reward screen (not on top of it). */
  pendingUpgrade: boolean

  openMap: (stageId: string) => void
  /** Open the 戰前/接續 dialog for a sub-stage (on the map). */
  openStart: (subId: string) => void
  cancelStart: () => void
  /** Begin/resume/reset a series and launch its next match. */
  startSeries: (subId: string, opts?: { resume?: boolean; reset?: boolean }) => void
  reportMatchResult: (winnerIsMe: boolean) => void
  nextMatch: () => void
  surrender: () => void
  /** Go straight to the next sub-stage (its map + start dialog), after clearing one. */
  goNextStage: () => void
  /** Leaving mid-match forfeits it as a loss, then returns to the stage map. */
  forfeit: () => void
  exit: () => void
}

export const useCampaignStore = create<CampaignStore>((set, get) => ({
  series: null,
  stage: null,
  outcome: null,
  reward: null,
  viewStageId: null,
  pendingStart: null,
  pendingUpgrade: false,

  openMap: (stageId) => {
    set({ viewStageId: stageId })
    useAppStore.getState().go('campaign')
  },

  openStart: (subId) => set({ pendingStart: subId }),
  cancelStart: () => set({ pendingStart: null }),

  startSeries: (subId, opts = {}) => {
    const found = getSubStage(subId)
    if (!found) return
    const { stage, sub } = found
    const active = usePlatformStore.getState().profile?.progress.activeSeries
    const canResume = !opts.reset && (opts.resume ?? false) && active?.subId === subId
    const series: SeriesState = canResume
      ? { subId, bestOf: sub.bestOf, winsNeeded: sub.winsNeeded, results: active!.results as MatchResult[] }
      : newSeries(sub)
    if (opts.reset) void usePlatformStore.getState().saveActiveSeries(null)
    set({ series, stage, outcome: seriesOutcome(series), reward: null, pendingStart: null })
    // Seed the loadout from the player's equipped set on a fresh series start.
    const loadout = (usePlatformStore.getState().profile?.equipped.specialCards ?? []) as SpecialCardId[]
    launchMatch(stage, sub, loadout)
    useAppStore.getState().launchGame({ mode: 'ai', special: sub.special, campaignSubId: subId })
  },

  reportMatchResult: (winnerIsMe) => {
    const s = get().series
    const stage = get().stage
    if (!s || !stage) return
    const { series, outcome } = advanceSeries(s, winnerIsMe)
    set({ series, outcome })
    const ps = usePlatformStore.getState()

    if (outcome === 'ongoing') {
      void ps.saveActiveSeries({ subId: series.subId, bestOf: series.bestOf, winsNeeded: series.winsNeeded, results: series.results })
      return
    }

    // Series decided → clear the saved in-progress state.
    void ps.saveActiveSeries(null)
    if (outcome === 'won') {
      const sub = stage.subStages.find((ss) => ss.id === series.subId)!
      const cleared = ps.profile?.progress.stageClearedAt ?? {}
      const reward = rewardForClear(sub, !!cleared[series.subId])
      set({ reward })
      if (reward) {
        void ps.recordStageClear(series.subId, reward)
        // Defer the save-progress nudge until AFTER the player sees the reward
        // screen (fired on exit / goNextStage), so it doesn't cover 通關. (#9)
        if (usePlatformStore.getState().isAnonymous) set({ pendingUpgrade: true })
      }
    }
  },

  nextMatch: () => {
    const { series, stage, outcome } = get()
    if (!series || !stage || outcome !== 'ongoing') return
    const sub = stage.subStages.find((ss) => ss.id === series.subId)
    // Carry the loadout the player used last match (their in-B adjustment sticks).
    if (sub) launchMatch(stage, sub, useGameStore.getState().loadout)
  },

  surrender: () => {
    const { stage, series } = get()
    if (!stage || !series) return
    const sub = stage.subStages.find((ss) => ss.id === series.subId)
    if (!sub) return
    void usePlatformStore.getState().saveActiveSeries(null)
    set({ series: newSeries(sub), outcome: 'ongoing', reward: null })
    launchMatch(stage, sub, useGameStore.getState().loadout)
  },

  goNextStage: () => {
    const s = get().series
    const nudge = get().pendingUpgrade
    set({ series: null, stage: null, outcome: null, reward: null, pendingUpgrade: false })
    const nextId = s ? nextSubStageId(s.subId) : null
    const found = nextId ? getSubStage(nextId) : undefined
    if (found) {
      set({ viewStageId: found.stage.id, pendingStart: nextId })
      useAppStore.getState().go('campaign')
    } else {
      // no next stage (all cleared) → back to the current map
      useAppStore.getState().go('campaign')
    }
    if (nudge && usePlatformStore.getState().isAnonymous) useAppStore.getState().askUpgrade()
  },

  forfeit: () => {
    // Record the abandoned match as a loss, persist, then leave to the map.
    get().reportMatchResult(false)
    get().exit()
  },

  exit: () => {
    const back = get().viewStageId
    const nudge = get().pendingUpgrade
    set({ series: null, stage: null, outcome: null, reward: null, pendingUpgrade: false })
    useAppStore.getState().go(back ? 'campaign' : 'campaignStages')
    if (nudge && usePlatformStore.getState().isAnonymous) useAppStore.getState().askUpgrade()
  },
}))

/** Start one match of a series: roll the boss's per-match brain and hand the
 *  match to gameStore, wiring its end back to reportMatchResult. */
function launchMatch(stage: CampaignStage, sub: SubStage, loadout: SpecialCardId[]): void {
  const boss = rollBossRuntime(stage, sub)
  useGameStore.getState().startCampaignMatch({
    special: sub.special,
    timeLimit: CAMPAIGN_TIME_LIMIT,
    loadout,
    aiLoadout: bossCardPool(stage, sub),
    boss,
    onMatchEnd: (winnerIsMe) => useCampaignStore.getState().reportMatchResult(winnerIsMe),
  })
}

export { CAMPAIGN }

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __campaign: typeof useCampaignStore }).__campaign = useCampaignStore
}
