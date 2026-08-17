import { describe, expect, it } from 'vitest'
import { applyDraw, applyPick, applyPlace, resolveShowdown, type GameState } from './state'
import { TUTORIAL_NODES, buildCard, createTutorialGame } from './tutorial'

// Mirrors of the tutorialStore's non-engine helpers, kept in sync for replay.
function oppInject(e: GameState, ids: string[]): GameState {
  const cards = ids.map(buildCard)
  return { ...e, hands: { ...e.hands, p2: e.hands.p2.slice(cards.length) }, pendingPick: { by: 'p2', cards }, phase: 'place' }
}
function dealPlayer(e: GameState, id: string): GameState {
  return {
    ...e,
    hands: { ...e.hands, p1: [...e.hands.p1, buildCard(id)] },
    deck: e.deck.slice(1),
    drawsDone: { ...e.drawsDone, p1: e.drawsDone.p1 + 1 },
    turn: 'p2',
    phase: 'pick',
    postPicker: null,
  }
}
function tutorialSwap(e: GameState, targetId: string, resultId: string): GameState {
  const hand = e.hands.p1.slice()
  const i = hand.findIndex((x) => x.id === targetId)
  const deck = e.deck.slice()
  const di = deck.findIndex((x) => x.id === resultId)
  const drawn = di >= 0 ? deck.splice(di, 1)[0] : buildCard(resultId)
  hand[i] = drawn
  return { ...e, hands: { ...e.hands, p1: hand }, deck, specialUsed: { ...e.specialUsed, p1: true } }
}

describe('Phase D tutorial script', () => {
  it('replays end-to-end: every move is legal and the player wins by a 3-in-a-row', () => {
    let e = createTutorialGame()
    for (const node of TUTORIAL_NODES) {
      switch (node.k) {
        case 'oppPick':
          e = oppInject(e, node.ids)
          break
        case 'oppPlace':
          e = applyPlace(e, 'p2', node.slot)
          break
        case 'draw':
          e = applyDraw(e)
          break
        case 'deal':
          e = dealPlayer(e, node.id)
          break
        case 'pick':
          e = applyPick(e, 'p1', node.ids)
          break
        case 'place':
          e = applyPlace(e, 'p1', node.slot)
          break
        case 'swap':
          e = tutorialSwap(e, node.target, node.result)
          break
        case 'showdown':
          e = resolveShowdown(e)
          break
        default:
          break // say / sort / win — no engine effect
      }
    }
    expect(e.winner).toBe('p1')
    expect(e.winReason).toBe('line3')
    // The player wins slots 2,3,4 (第3/4/5格); the opponent took slot 0 (第1格).
    expect([2, 3, 4].every((i) => e.slots[i].owner === 'p1')).toBe(true)
    expect(e.slots[0].owner).toBe('p2')
  })

  it('round 1 loss: the opponent flush beats our pair of kings at slot 0', () => {
    let e = createTutorialGame()
    e = oppInject(e, ['C2', 'C4', 'C6', 'C8', 'C9']) // opp flush
    e = applyPlace(e, 'p1', 0) // we place it (opp side)
    e = applyDraw(e)
    e = applyPick(e, 'p1', ['H13', 'D13']) // our KK
    e = applyPlace(e, 'p2', 0) // opp forces the showdown
    expect(e.slots[0].owner).toBe('p2') // flush > pair → we lose the coin
  })

  it('the swap turns ♦2 into ♠13, completing the straight flush', () => {
    const g = createTutorialGame()
    const s = tutorialSwap(g, 'D2', 'S13')
    const ids = s.hands.p1.map((c) => c.id)
    expect(ids).not.toContain('D2')
    expect(ids).toContain('S13')
    expect(s.hands.p1).toHaveLength(g.hands.p1.length)
  })
})
