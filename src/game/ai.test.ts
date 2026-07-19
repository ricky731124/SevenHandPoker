import { describe, expect, it } from 'vitest'
import { aiPick, aiStep } from './ai'
import { applyDraw, createGame, resolveShowdown, validatePick } from './state'

describe('AI', () => {
  it('always produces a legal pick', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = createGame(seed * 7, 'p1')
      const ids = aiPick(g, 'p1')
      expect(validatePick(g, 'p1', ids)).toBeNull()
    }
  })

  it('AI vs AI terminates with a winner', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let s = createGame(seed * 101, seed % 2 ? 'p1' : 'p2')
      let guard = 0
      while (s.phase !== 'ended' && guard++ < 400) {
        if (s.phase === 'showdown') {
          s = resolveShowdown(s)
          continue
        }
        if (s.phase === 'draw') {
          s = applyDraw(s)
          continue
        }
        const actor = s.phase === 'pick' ? s.turn : s.pendingPick!.by === 'p1' ? 'p2' : 'p1'
        s = aiStep(s, actor)
      }
      expect(s.phase).toBe('ended')
      expect(['p1', 'p2']).toContain(s.winner)
    }
  })
})
