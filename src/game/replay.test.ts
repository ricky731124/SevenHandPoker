import { describe, expect, it } from 'vitest'
import {
  createGame,
  applyPick,
  applyPlace,
  applyDraw,
  applySwap,
  resolveShowdown,
  emptySlotsFor,
  swapTargets,
  otherPlayer,
  type GameState,
  type PlayerId,
} from './state'
import { recordingRng, replayRng, buildFrames, type Move } from './replay'

/**
 * 獨立(不呼叫 buildFrames)地把一整場打到自然結束,一邊照 gameStore 的方式錄棋譜:
 * pick/place/special 記進 moves,而「開牌→翻幣→補牌」不記(決定性、buildFrames 會自己補)。
 * 中途插一次偷天換日以驗證 rng 決定性。回傳 {moves, finalState} 供對照。
 */
function simulateMatch(seed: number): { moves: Move[]; finalState: GameState } {
  let g = createGame(seed, 'p1')
  const moves: Move[] = []
  let didSwap = false
  for (let guard = 0; guard < 300 && g.phase !== 'ended'; guard++) {
    // pick 階段:選牌者出第一張手牌;第一次輪到時先偷天換日一次(驗 rng)。
    const picker: PlayerId = g.turn
    if (!didSwap) {
      const t = swapTargets(g, picker)[0]
      if (t) {
        const rec = recordingRng()
        g = applySwap(g, picker, t.id, rec.rng)
        moves.push({ t: 'special', by: picker, card: 'swap', targetId: t.id, rng: rec.out })
        didSwap = true
      }
    }
    const card = g.hands[picker][0]
    g = applyPick(g, picker, [card.id])
    moves.push({ t: 'pick', by: picker, ids: [card.id] })

    // place 階段:對手放進選牌者側的第一個空格。
    const placer = otherPlayer(picker)
    const slot = emptySlotsFor(g, picker)[0]
    g = applyPlace(g, placer, slot)
    moves.push({ t: 'place', by: placer, slot })

    // 自動推進 開牌→翻幣→補牌(不記進 moves) —— 對齊引擎、也對齊 buildFrames 的補幀邏輯。
    if (g.phase === 'showdown') g = resolveShowdown(g)
    if (g.phase === 'draw') g = applyDraw(g)
  }
  return { moves, finalState: g }
}

/**
 * 決定性核心驗證(§6.3):偷天換日(swap)是唯一非決定性效果。錄製時用 recordingRng 包住
 * Math.random 記下輸出;回放時 replayRng 照吐同樣的值 → applySwap 必須產生「一模一樣」的
 * 手牌 + 牌堆。這證明回放能重現含 swap 的對局,而完全不動 live 的隨機行為。
 */
describe('swap rng round-trip (replay determinism)', () => {
  it('replayRng reproduces the exact hand+deck that recordingRng captured', () => {
    const g = createGame(4242, 'p1')
    const target = swapTargets(g, 'p1')[0]
    expect(target).toBeDefined()

    // 錄製:用真隨機跑一次 swap,順手記下 rng 輸出。
    const rec = recordingRng() // 預設包 Math.random
    const live = applySwap(g, 'p1', target.id, rec.rng)
    expect(live).not.toBe(g) // 合法目標 → 有變動
    expect(rec.out.length).toBe(2) // 抽牌 index + 塞回 index 各消耗一次

    // 回放:同一起始 state + 記錄的 rng → 必須完全一致。
    const replayed = applySwap(g, 'p1', target.id, replayRng(rec.out))
    expect(replayed.hands.p1.map((c) => c.id)).toEqual(live.hands.p1.map((c) => c.id))
    expect(replayed.deck.map((c) => c.id)).toEqual(live.deck.map((c) => c.id))
    expect(replayed.specialUsed).toEqual(live.specialUsed)
  })

  it('a different rng stream would (almost always) diverge — proving the capture matters', () => {
    const g = createGame(777, 'p2')
    const target = swapTargets(g, 'p2')[0]
    const a = applySwap(g, 'p2', target.id, replayRng([0, 0])) // draw first, insert front
    const b = applySwap(g, 'p2', target.id, replayRng([0.99, 0.99])) // draw last, insert back
    // 抽到的新牌不同 → 手牌不同(證明 rng 真的決定結果,故必須錄下來)。
    expect(a.hands.p2.map((c) => c.id)).not.toEqual(b.hands.p2.map((c) => c.id))
  })
})

describe('buildFrames reproduces a whole recorded match', () => {
  // 幾個種子都跑,確保不同開局(含開牌/補牌/swap)都能重現到最後一幀完全一致。
  for (const seed of [1, 42, 777, 20260907, 31337]) {
    it(`seed ${seed}: final frame === the real final state (winner/slots/hands/deck)`, () => {
      const { moves, finalState } = simulateMatch(seed)
      expect(finalState.phase).toBe('ended') // 這些種子都能自然分出勝負
      expect(finalState.winner).not.toBeNull()

      const frames = buildFrames({ seed, firstPicker: 'p1', moves, names: { p1: '甲', p2: '乙' } })
      expect(frames[0].caption).toBe('開局發牌')
      const last = frames[frames.length - 1]
      // 決定性核心:回放跑完的牌桌,必須和當時實際結束的牌桌「一模一樣」(含含 swap 的那局)。
      expect(last.state).toEqual(finalState)
      // 最後一幀 caption 是「X 獲勝(…)」。
      expect(last.caption).toContain('獲勝')
    })
  }

  it('captions cover pick / place-showdown / special, in order', () => {
    const { moves } = simulateMatch(42)
    const frames = buildFrames({ seed: 42, firstPicker: 'p1', moves, names: { p1: '甲', p2: '乙' } })
    const caps = frames.map((f) => f.caption)
    expect(caps.some((c) => c.includes('出') && c.includes('張'))).toBe(true)
    expect(caps.some((c) => c.includes('開牌'))).toBe(true)
    expect(caps.some((c) => c.includes('使用「偷天換日」'))).toBe(true) // swap caption 帶「棄→抽」
  })
})
