import { describe, it, expect } from 'vitest'
import { SPECIAL_CARDS, usableInMatch } from './specialCards'

// 2026-10-27 使用者定:朋友房各帶各的,只有快速配對配到真人才用共同卡池
const base = { baseline: 'swap' as const }

describe('這場能帶哪些特殊卡', () => {
  it('自己沒有的卡,哪裡都不能帶', () => {
    expect(usableInMatch('explode', { ...base, iHave: false, online: false, foeSpecials: null })).toBe(false)
    expect(usableInMatch('explode', { ...base, iHave: false, online: true, origin: 'friend', foeSpecials: ['explode'] })).toBe(false)
  })
  it('單機(對電腦/主線):自己有就能帶', () =>
    expect(usableInMatch('deathEye', { ...base, iHave: true, online: false, foeSpecials: null })).toBe(true))
  it('朋友房:對手沒有也能帶(不受共同卡池限制)', () =>
    expect(usableInMatch('deathEye', { ...base, iHave: true, online: true, origin: 'friend', foeSpecials: ['swap'] })).toBe(true))
  it('舊房間沒標記來源 → 當朋友房', () =>
    expect(usableInMatch('deathEye', { ...base, iHave: true, online: true, foeSpecials: ['swap'] })).toBe(true))
  it('快速配對真人:對手也有才能帶', () => {
    expect(usableInMatch('deathEye', { ...base, iHave: true, online: true, origin: 'match', foeSpecials: ['swap'] })).toBe(false)
    expect(usableInMatch('swap', { ...base, iHave: true, online: true, origin: 'match', foeSpecials: ['swap'] })).toBe(true)
  })
  it('快速配對、還沒收到對手卡池 → 只開基本卡', () => {
    expect(usableInMatch('swap', { ...base, iHave: true, online: true, origin: 'match', foeSpecials: null })).toBe(true)
    expect(usableInMatch('peek', { ...base, iHave: true, online: true, origin: 'match', foeSpecials: null })).toBe(false)
  })
})

describe('對手用了我沒有的卡 → 介紹文字', () => {
  it('會動到對手的卡都有「被打的人」看得懂的介紹', () => {
    for (const c of Object.values(SPECIAL_CARDS)) {
      if (c.affectsFoe) expect(c.foeNote, c.id).toBeTruthy()
      else expect(c.foeNote, c.id).toBeUndefined() // 沒動到對手的卡不告訴對手是哪張
    }
  })
})
