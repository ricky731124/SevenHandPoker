import { describe, it, expect } from 'vitest'
import { admitLines, DANMAKU_MAX_LINES, DANMAKU_LIFE_MS } from './danmakuLines'

/** 用跟 DanmakuLayer 一樣的規則跑一條時間軸：每秒可能進一則；回傳每一秒畫面上有哪幾則。 */
function simulate(arrivals: Record<number, string[]>, until: number): Record<number, string[]> {
  let lines: { id: string; at: number }[] = []
  const shots: Record<number, string[]> = {}
  for (let t = 0; t <= until; t++) {
    lines = lines.filter((l) => t * 1000 - l.at < DANMAKU_LIFE_MS)          // ① 滿 15 秒自己滑掉
    const incoming = (arrivals[t] ?? []).map((id) => ({ id, at: t * 1000 }))
    lines = admitLines(lines, incoming).lines                                // ② 滿行 → 最舊的被擠掉
    shots[t] = lines.map((l) => l.id)
  }
  return shots
}

describe('彈幕：同時最多 6 行、15 秒消失、滿了擠掉最舊的', () => {
  it('上限 6 行、存活 15 秒', () => {
    expect(DANMAKU_MAX_LINES).toBe(6)
    expect(DANMAKU_LIFE_MS).toBe(15000)
  })

  it('使用者的例子：第 1~6 秒各來一則 → 第 7 秒第 7 則進來時，第 1 則(才 6 秒)就被擠掉', () => {
    const arr: Record<number, string[]> = {}
    for (let i = 1; i <= 9; i++) arr[i] = ['#' + i]
    const s = simulate(arr, 30)
    expect(s[6]).toEqual(['#1', '#2', '#3', '#4', '#5', '#6'])
    expect(s[7]).toEqual(['#2', '#3', '#4', '#5', '#6', '#7']) // #1 被擠掉，整串往上
    expect(s[8]).toEqual(['#3', '#4', '#5', '#6', '#7', '#8'])
    expect(s[9]).toEqual(['#4', '#5', '#6', '#7', '#8', '#9'])
    // 之後沒人講話 → 各自滿 15 秒才滑掉：#4 在第 19 秒消失、#9 在第 24 秒消失
    expect(s[18]).toEqual(['#4', '#5', '#6', '#7', '#8', '#9'])
    expect(s[19]).toEqual(['#5', '#6', '#7', '#8', '#9'])
    expect(s[23]).toEqual(['#9'])
    expect(s[24]).toEqual([])
  })

  it('沒滿 6 行時不會被擠：一則就是顯示滿 15 秒', () => {
    const s = simulate({ 0: ['a'], 5: ['b'] }, 25)
    expect(s[14]).toEqual(['a', 'b'])
    expect(s[15]).toEqual(['b'])
    expect(s[19]).toEqual(['b'])
    expect(s[20]).toEqual([])
  })

  it('同一瞬間湧進很多則 → 只留最新的 6 則，不排隊', () => {
    const burst = Array.from({ length: 10 }, (_, i) => 'x' + i)
    const s = simulate({ 0: burst }, 1)
    expect(s[0]).toEqual(['x4', 'x5', 'x6', 'x7', 'x8', 'x9'])
  })

  it('admitLines 回報被擠掉的是哪幾則（元件要取消它們的計時）', () => {
    const r = admitLines(['a', 'b', 'c', 'd', 'e', 'f'], ['g', 'h'])
    expect(r.lines).toEqual(['c', 'd', 'e', 'f', 'g', 'h'])
    expect(r.dropped).toEqual(['a', 'b'])
  })
})
