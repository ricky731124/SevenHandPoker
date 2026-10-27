import { serverNow } from './lobby'
import { limitedModeAt, type LimitedMode } from '../game/limited'

/**
 * 今天的限定房玩法(LIMITED-ROOM-SPEC §9):用伺服器時間(.info/serverTimeOffset 校正)換算台灣時間。
 * 離線拿不到偏移時 serverNow 就是手機時間。開房 / 進配對那一刻呼叫一次,寫進房間後就不再變。
 */
export function limitedModeNow(): LimitedMode {
  return limitedModeAt(serverNow())
}
