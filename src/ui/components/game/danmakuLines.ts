/**
 * 彈幕「同時顯示幾行」的規則（純函式，方便測試；DanmakuLayer 用它）。
 * 2026-10 使用者定案：
 *   - 同時最多 DANMAKU_MAX_LINES 行，新的從最下面進、整串往上推。
 *   - 正常情況每行顯示 DANMAKU_LIFE_MS（15 秒）後自己滑掉。
 *   - 已經滿行又來新的 → 不排隊等，最舊的那行立刻被擠掉（就算還沒滿 15 秒）。
 */
export const DANMAKU_MAX_LINES = 6
export const DANMAKU_LIFE_MS = 15000

/** 把新進的彈幕接到目前顯示的後面；超過上限就從最舊(最上面)開始擠掉。回傳新的顯示串 + 被擠掉的。 */
export function admitLines<T>(cur: T[], incoming: T[], max = DANMAKU_MAX_LINES): { lines: T[]; dropped: T[] } {
  const all = [...cur, ...incoming]
  const cut = Math.max(0, all.length - max)
  return { lines: all.slice(cut), dropped: all.slice(0, cut) }
}
