import { readLocalSnapshot, readLocalOpen, clearLocalMatch } from './localMatch'
import { isMatchSettled, markMatchSettled } from './room'
import { recordBotResult, releaseBotById } from './bots'
import { useGameStore } from '../state/gameStore'
import { useCampaignStore } from '../state/campaignStore'
import { useAppStore } from '../state/appStore'
import { usePlatformStore } from '../state/platformStore'
import { advanceSeries, getSubStage, seriesOutcome } from '../game/campaign'

/**
 * Boot-time handling of a LOCAL match (§3.7), mirroring the online tryReconnect /
 * reconcileAbandonedMatch:
 *  - **重整**(sessionStorage 快照還在)→ resumeLocalMatch() 還原對局續玩。
 *  - **關分頁**(快照沒了、只剩 localStorage marker)→ reconcileAbandonedLocal() 補判該場敗
 *    (快配人機同時補寫人機勝場;主線再推進 series 敗)。
 */

/** Reload → restore the in-progress local match and resume. Returns true if resumed. */
export function resumeLocalMatch(): boolean {
  const snap = readLocalSnapshot()
  if (!snap || !snap.engine) return false
  useGameStore.getState().restoreLocal(snap)
  if (snap.mode === 'campaign' && snap.subId && snap.series) {
    // Rehydrate the campaign BO series + re-wire the end callback (in-memory only,
    // lost on reload). The engine itself came from the snapshot above.
    const found = getSubStage(snap.subId)
    if (found) {
      useCampaignStore.setState({
        series: snap.series,
        stage: found.stage,
        outcome: seriesOutcome(snap.series),
        reward: null,
        pendingStart: null,
      })
      useGameStore.setState({ onMatchEnd: (won) => useCampaignStore.getState().reportMatchResult(won) })
    }
  }
  useAppStore.getState().launchGame({
    mode: 'ai',
    special: snap.special,
    timeLimit: snap.timeLimit,
    campaignSubId: snap.subId,
    casualBot: snap.mode === 'casual',
  })
  return true
}

/** Closed a tab mid-match (no snapshot, marker remains) → settle it as a loss once.
 *  ⚠️ 全程 try/catch:這裡跑的 recordMatchResult/recordBotResult 是 RTDB transaction,
 *  剛開分頁連線未穩時可能 maxretry → 若讓它 reject(此函式在 App boot 被 void 呼叫)會變
 *  uncaught,且和「重開分頁配對卡死」同源。補判是 best-effort,失敗就算了、絕不外拋。 */
export async function reconcileAbandonedLocal(): Promise<void> {
  const open = readLocalOpen()
  if (!open) return
  clearLocalMatch()
  if (isMatchSettled(open.matchId)) return
  markMatchSettled(open.matchId)
  const ps = usePlatformStore.getState()
  try {
    if (open.mode === 'casual') {
      await ps.recordMatchResult('pvp', false, { silentDaily: true }) // 我判敗(補判不發每日獎/toast)
      if (open.botId) {
        await recordBotResult(open.botId, false) // 人機得勝(由我補寫)
        await releaseBotById(open.botId) // 釋放該人機租借(關分頁的 onDisconnect 可能沒觸發)
      }
    } else if (open.mode === 'solo') {
      await ps.recordMatchResult('solo', false, { silentDaily: true })
    } else if (open.mode === 'campaign') {
      await ps.recordMatchResult('solo', false, { silentDaily: true })
      if (open.series) {
        const { series, outcome } = advanceSeries(open.series, false) // series 記一敗
        await ps.saveActiveSeries(
          outcome === 'ongoing'
            ? { subId: series.subId, bestOf: series.bestOf, winsNeeded: series.winsNeeded, results: series.results }
            : null, // 系列已輸掉 → 清掉進行中系列
        )
      }
    }
  } catch {
    /* best-effort 補判 — 連線未穩/交易失敗都不外拋 */
  }
}
