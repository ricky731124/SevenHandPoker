import { create } from 'zustand'
import { applyDraw, applyPick, applyPlace, resolveShowdown, type GameState, type PlayerId } from '../game/state'
import {
  TUTORIAL_NODES,
  buildCard,
  createTutorialGame,
  type Highlight,
  type TutorialNode,
} from '../game/tutorial'
import { sfx } from '../audio/sfx'

export type TutGate = 'auto' | 'say' | 'sort' | 'pick' | 'place' | 'magnify' | 'swap' | 'showdown' | 'win'

/** The opponent's pushed-out pick, so its picked cards lift like a real match. */
export interface FoeSel {
  total: number
  idx: number[]
}

interface TutorialStore {
  engine: GameState
  idx: number
  gen: number
  coach: string
  gate: TutGate
  highlight: Highlight
  allowedCardIds: string[] | null
  allowedSlots: number[] | null
  selected: string[]
  trayOpen: boolean
  targeting: string | null
  showdownOpen: boolean
  /** magnifier peek target (the 'magnify' teaching step) */
  magnifier: { side: PlayerId; slot: number } | null
  /** opponent's pushed-out pick (shown while the player places it) */
  foeSel: FoeSel | null
  /** sort practice: which of the two sort buttons the player has tried */
  sortModeTapped: boolean
  sortDirTapped: boolean

  start: () => void
  run: () => void
  advance: () => void
  next: () => void
  tapSort: (which: 'mode' | 'dir') => void
  toggleCard: (id: string) => void
  submitPick: () => void
  placeSlot: (slot: number) => void
  openMagnifier: (side: PlayerId, slot: number) => void
  closeMagnifier: () => void
  openTray: () => void
  chooseSwap: () => void
  swapTargetPick: (id: string) => void
  dismissShowdown: () => void
}

/** Inject a scripted opponent pick straight into pendingPick (its hand is a
 *  hidden count, so we don't need the real cards to live there). */
function oppInject(e: GameState, ids: string[]): GameState {
  const cards = ids.map(buildCard)
  return {
    ...e,
    hands: { ...e.hands, p2: e.hands.p2.slice(cards.length) },
    pendingPick: { by: 'p2', cards },
    phase: 'place',
  }
}

/** Hand the player a specific card as their next draw (the "4th flush card" beat)
 *  and pass the turn to the opponent, mirroring applyDraw's turn/phase change. */
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

/** Deterministic tutorial swap: discard the target, hand over the scripted result. */
function tutorialSwap(e: GameState, targetId: string, resultId: string): GameState {
  const hand = e.hands.p1.slice()
  const i = hand.findIndex((x) => x.id === targetId)
  if (i < 0) return e
  const deck = e.deck.slice()
  const di = deck.findIndex((x) => x.id === resultId)
  const drawn = di >= 0 ? deck.splice(di, 1)[0] : buildCard(resultId)
  hand[i] = drawn
  return { ...e, hands: { ...e.hands, p1: hand }, deck, specialUsed: { ...e.specialUsed, p1: true } }
}

const AUTO_DELAY = 950
const DRAW_DELAY = 650

export const useTutorialStore = create<TutorialStore>((set, get) => ({
  engine: createTutorialGame(),
  idx: 0,
  gen: 0,
  coach: '',
  gate: 'auto',
  highlight: null,
  allowedCardIds: null,
  allowedSlots: null,
  selected: [],
  trayOpen: false,
  targeting: null,
  showdownOpen: false,
  magnifier: null,
  foeSel: null,
  sortModeTapped: false,
  sortDirTapped: false,

  start: () => {
    set({
      engine: createTutorialGame(),
      idx: 0,
      gen: get().gen + 1,
      coach: '',
      gate: 'auto',
      highlight: null,
      allowedCardIds: null,
      allowedSlots: null,
      selected: [],
      trayOpen: false,
      targeting: null,
      showdownOpen: false,
      magnifier: null,
      foeSel: null,
      sortModeTapped: false,
      sortDirTapped: false,
    })
    get().run()
  },

  run: () => {
    const idx = get().idx
    const node: TutorialNode | undefined = TUTORIAL_NODES[idx]
    if (!node) return

    switch (node.k) {
      case 'say':
        set({ coach: node.text, gate: 'say', highlight: node.hl ?? null, allowedCardIds: null, allowedSlots: null, showdownOpen: false, trayOpen: false, targeting: null })
        break
      case 'sort':
        set({ coach: node.text, gate: 'sort', highlight: 'sort', allowedCardIds: null, allowedSlots: null, showdownOpen: false, sortModeTapped: false, sortDirTapped: false })
        break
      case 'pick':
        set({ coach: node.text, gate: 'pick', highlight: node.hl ?? null, allowedCardIds: node.ids, allowedSlots: null, selected: [], showdownOpen: false, trayOpen: false, targeting: null })
        break
      case 'place':
        set({ coach: node.text, gate: 'place', highlight: node.hl ?? null, allowedSlots: [node.slot], allowedCardIds: null, showdownOpen: false, trayOpen: false, targeting: null })
        break
      case 'magnify':
        set({ coach: node.text, gate: 'magnify', highlight: null, allowedSlots: [node.slot], allowedCardIds: null, showdownOpen: false, magnifier: null })
        break
      case 'swap':
        set({ coach: node.text, gate: 'swap', highlight: 'special', allowedCardIds: null, allowedSlots: null, trayOpen: false, targeting: null, showdownOpen: false })
        break
      case 'showdown': {
        // Show the coach line as the pile lands, but hold the popup ~0.8s so the
        // player sees WHERE the cards were placed before the showdown modal opens.
        set({ coach: node.text, gate: 'showdown', showdownOpen: false, highlight: null, allowedCardIds: null, allowedSlots: null })
        const gen = get().gen
        setTimeout(() => {
          if (get().gen !== gen || get().gate !== 'showdown') return
          set({ showdownOpen: true })
          // 對標真實對戰:撞擊音 → 0.4s 後贏家「搶金幣成功」/輸家「失敗」。
          sfx.showdown()
          const iWon = get().engine.lastShowdown?.winner === 'p1' || get().engine.lastShowdown?.winner === 'both'
          setTimeout(() => { if (get().gen === gen) (iWon ? sfx.coinWin() : sfx.coinFail()) }, 400)
        }, 800)
        break
      }
      case 'win':
        set({ coach: node.text, gate: 'win', showdownOpen: false, highlight: null, allowedCardIds: null, allowedSlots: null })
        sfx.win() // 教學通關(對標真實對戰勝利音)
        break
      default:
        set({ coach: '', gate: 'auto', highlight: null, allowedCardIds: null, allowedSlots: null, showdownOpen: false })
    }

    if (node.k === 'oppPick' || node.k === 'oppPlace' || node.k === 'draw' || node.k === 'deal') {
      const gen = get().gen
      setTimeout(
        () => {
          if (get().gen !== gen) return
          const e = get().engine
          let next = e
          // Match the real game's per-action SFX (gameStore) instead of playing
          // 發牌 for everything: 推牌出來=deal、放進格子=place、補牌=draw(n)。
          if (node.k === 'oppPick') {
            const total = e.hands.p2.length
            const n = node.ids.length
            set({ foeSel: { total, idx: Array.from({ length: n }, (_, i) => i) } })
            next = oppInject(e, node.ids)
            sfx.deal() // 對手把牌推出來(發牌滑音)
          } else if (node.k === 'oppPlace') {
            next = applyPlace(e, 'p2', node.slot)
            sfx.place() // 放進格子
          } else if (node.k === 'draw') {
            next = applyDraw(e)
            const drew = next.hands.p1.length - e.hands.p1.length
            if (drew > 0) sfx.draw(drew) // 固定補牌
          } else if (node.k === 'deal') {
            next = dealPlayer(e, node.id)
            sfx.deal() // 補一張牌
          }
          set({ engine: next, idx: idx + 1 })
          get().run()
        },
        node.k === 'draw' ? DRAW_DELAY : AUTO_DELAY,
      )
    }
  },

  advance: () => {
    set({ idx: get().idx + 1 })
    get().run()
  },

  next: () => {
    if (get().gate === 'say') get().advance()
  },

  tapSort: (which) => {
    if (get().gate !== 'sort') return
    const patch = which === 'mode' ? { sortModeTapped: true } : { sortDirTapped: true }
    set(patch)
    if (get().sortModeTapped && get().sortDirTapped) get().advance()
  },

  toggleCard: (id) => {
    if (get().gate !== 'pick') return
    const allowed = get().allowedCardIds
    if (allowed && !allowed.includes(id)) return
    const sel = get().selected
    set({ selected: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] })
    sfx.select()
  },

  submitPick: () => {
    const node = TUTORIAL_NODES[get().idx]
    if (get().gate !== 'pick' || node.k !== 'pick') return
    const want = new Set(node.ids)
    const sel = get().selected
    if (sel.length !== want.size || !sel.every((id) => want.has(id))) return
    set({ engine: applyPick(get().engine, 'p1', node.ids), selected: [] })
    sfx.click() // 送出(對標真實對戰:送出=click)
    get().advance()
  },

  placeSlot: (slot) => {
    if (get().gate !== 'place') return
    const allowed = get().allowedSlots
    if (allowed && !allowed.includes(slot)) return
    set({ engine: applyPlace(get().engine, 'p1', slot), foeSel: null })
    sfx.place() // 放進格子
    get().advance()
  },

  openMagnifier: (side, slot) => {
    if (get().gate !== 'magnify') return
    sfx.click()
    set({ magnifier: { side, slot } })
  },

  closeMagnifier: () => {
    const m = get().magnifier
    set({ magnifier: null })
    // Advance only after they've peeked at the OPPONENT's revealed pile (p2);
    // opening their own pile just closes (own cards are always viewable).
    if (get().gate === 'magnify' && m && m.side === 'p2') get().advance()
  },

  openTray: () => {
    if (get().gate !== 'swap') return
    sfx.click()
    set({ trayOpen: true })
  },

  chooseSwap: () => {
    const node = TUTORIAL_NODES[get().idx]
    if (node.k !== 'swap') return
    sfx.click()
    set({ trayOpen: false, targeting: node.target, coach: node.targetText, highlight: 'hand', allowedCardIds: [node.target] })
  },

  swapTargetPick: (id) => {
    const node = TUTORIAL_NODES[get().idx]
    if (node.k !== 'swap' || id !== node.target) return
    set({ engine: tutorialSwap(get().engine, node.target, node.result), targeting: null })
    sfx.special() // 發動特殊牌(偷天換日)
    get().advance()
  },

  dismissShowdown: () => {
    if (get().gate !== 'showdown') return
    set({ engine: resolveShowdown(get().engine), showdownOpen: false })
    get().advance()
  },
}))

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __tut: typeof useTutorialStore }).__tut = useTutorialStore
}
