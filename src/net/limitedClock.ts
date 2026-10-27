import { serverNow } from './lobby'
import { limitedModeAt, taiwanDay, type LimitedMode } from '../game/limited'

/**
 * 今天的限定房玩法(LIMITED-ROOM-SPEC §9):用伺服器時間(.info/serverTimeOffset 校正)換算台灣時間。
 * 離線拿不到偏移時 serverNow 就是手機時間。開房 / 進配對那一刻呼叫一次,寫進房間後就不再變。
 */
export function limitedModeNow(): LimitedMode {
  return limitedModeAt(serverNow())
}

/** 今天是台灣的星期幾(0 = 星期日),一週表標「今天」用。 */
export function limitedDayNow(): number {
  return taiwanDay(serverNow())
}
