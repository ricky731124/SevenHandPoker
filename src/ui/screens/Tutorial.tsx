import { useEffect, useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '../../state/appStore'
import { useTutorialStore } from '../../state/tutorialStore'
import { usePlatformStore } from '../../state/platformStore'
import { getSpecialCard } from '../../game/specialCards'
import { TUTORIAL_NODES, TUTORIAL_SWAP } from '../../game/tutorial'
import Button from '../components/Button'
import Modal from '../components/Modal'
import PlayerAvatar from '../components/PlayerAvatar'
import Deck from '../components/game/Deck'
import Hand from '../components/game/Hand'
import OpponentHand from '../components/game/OpponentHand'
import SlotView from '../components/game/SlotView'
import SortButtons from '../components/game/SortButtons'
import SpecialCard from '../components/SpecialCard'
import ShowdownModal from '../components/game/ShowdownModal'
import MagnifierModal from '../components/game/MagnifierModal'
import useBoardSizes from '../hooks/useBoardSizes'
import useFitScale from '../hooks/useFitScale'
import type { SortDir, SortMode } from '../../game/sort'
import { sfx } from '../../audio/sfx'
import './Game.css'
import './Tutorial.css'

/**
 * Phase D — the scripted tutorial screen. Reuses the real board layout + leaf
 * components, driven by the tutorialStore director (fixed deal, scripted+injected
 * opponent, light-gated player moves). See game/tutorial.ts.
 */
export default function Tutorial() {
  const go = useAppStore((s) => s.go)
  const t = useTutorialStore()
  const engine = t.engine
  const sz = useBoardSizes()
  const fit = useFitScale(sz.stageW, sz.stageH)
  const [sortMode, setSortMode] = useState<SortMode>('rank')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    t.start()
    // Entering the tutorial unlocks 第1關 (see campaign gating).
    void usePlatformStore.getState().markTutorialSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Enter / Space advances the "one-way" gates (下一步 / 繼續 / 完成).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const g = useTutorialStore.getState()
      if (g.gate === 'say' || g.gate === 'showdown' || g.gate === 'win') {
        e.preventDefault()
        if (g.gate === 'say') g.next()
        else if (g.gate === 'showdown') g.dismissShowdown()
        else go('campaignStages')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  const nameStyle: CSSProperties = {
    textAlign: 'center',
    marginTop: 2,
    maxWidth: sz.avatar + 34,
    fontSize: 14,
    fontWeight: 800,
    color: '#fff',
    textShadow: '0 1px 2px rgba(0,0,0,0.75)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-display)',
  }

  const pickMode = t.gate === 'pick'
  const targeting = t.gate === 'swap' && !!t.targeting
  const handInteractive = pickMode || targeting
  const targetable = pickMode
    ? new Set(t.allowedCardIds ?? [])
    : targeting
      ? new Set([t.targeting!])
      : null
  const onToggle = targeting ? t.swapTargetPick : t.toggleCard

  const want = t.allowedCardIds ?? []
  const canSubmit = pickMode && t.selected.length === want.length && t.selected.every((id) => want.includes(id))

  const placeable = (i: number) => t.gate === 'place' && (t.allowedSlots ?? []).includes(i)
  const hl = (h: typeof t.highlight) => (t.highlight === h ? ' tut-hl' : '')
  const swapDef = getSpecialCard(TUTORIAL_SWAP)
  const curNode = TUTORIAL_NODES[t.idx]
  // First placement step carries a「把牌放這格」call-to-action shown inside the slot.
  const placeDropHint = curNode?.k === 'place' ? curNode.dropHint : undefined
  // Magnify step: only the OPPONENT's pile is tappable (tapping your own can't advance).
  const magnifyFoeOnly = t.gate === 'magnify'

  const foeCount = t.foeSel ? t.foeSel.total : engine.hands.p2.length
  const foeIdx = t.foeSel ? t.foeSel.idx : []

  // Align the coach bar to the opponent's card row: from the centre of the first
  // card to the centre of the last card (so it sits over the cards, not the
  // corner avatars). Computed from sz (same layout maths as OpponentHand).
  const rowWidth = (n: number) => {
    const ideal = sz.card + 6
    const fit = n > 1 ? (sz.handMax - sz.card) / (n - 1) : ideal
    const overlap = Math.max(sz.card * 0.34, Math.min(ideal, fit))
    return overlap * (Math.max(n, 1) - 1) + sz.card
  }
  const rowCenter = sz.reserve + (sz.stageW - sz.reserve - sz.rightReserve) / 2
  // Fixed to the FULL 12-card row width (the opening hand), so the bar stays a
  // constant size instead of resizing as the opponent's card count changes.
  const coachW = Math.max(rowWidth(12) - sz.card, 220)
  const coachLeft = Math.round(rowCenter - coachW / 2)

  return (
    <div
      className="game tut"
      style={{
        width: sz.stageW,
        height: sz.stageH,
        transform: fit < 1 ? `scale(${fit})` : undefined,
        transformOrigin: 'center center',
        ['--reserve' as string]: `${sz.reserve}px`,
        ['--reserve-r' as string]: `${sz.rightReserve}px`,
        ['--stage-w' as string]: `${sz.stageW}px`,
        ['--stage-h' as string]: `${sz.stageH}px`,
      }}
    >
      <button type="button" className="tut-exit" onClick={() => { sfx.click(); go('campaignStages') }}>
        離開
        <br />
        教學
      </button>

      {/* Opponent (top-right) — kept above the coach bar so it's never hidden */}
      <div className="game__foe-avatar">
        <div className="avatar-wrap">
          <PlayerAvatar avatarId="bird" size={sz.avatar} />
        </div>
        <div style={nameStyle}>對手</div>
      </div>
      {t.foeSel && <div className="foe-bubble">{t.foeSel.idx.length} 張</div>}

      {/* Me (bottom-left) */}
      <div className="game__me-avatar">
        <div className="avatar-wrap">
          <PlayerAvatar avatarId="cat" size={sz.avatar} />
        </div>
        <div style={nameStyle}>你</div>
      </div>

      <div className={`game__ohand${hl('foe')}`}>
        <OpponentHand count={foeCount} selectedIdx={foeIdx} cardW={sz.card} maxWidth={sz.handMax} />
      </div>

      <div className="game__mid">
        <div className={`game__deck${hl('deck')}`}>
          <Deck count={engine.deck.length} cardW={sz.card} />
        </div>

        <div className={`game__band${hl('board')}`} style={{ gridTemplateColumns: `repeat(7, ${sz.card}px)`, width: sz.bandWidth }}>
          {engine.slots.map((slot, i) => (
            <SlotView
              key={i}
              slot={slot}
              index={i}
              me="p1"
              placeable={placeable(i)}
              onPlace={t.placeSlot}
              onMagnify={t.openMagnifier}
              highlight={t.gate === 'magnify' && (t.allowedSlots ?? []).includes(i)}
              magnifyOnly={magnifyFoeOnly ? 'p2' : undefined}
              dropHint={placeable(i) ? placeDropHint : undefined}
              cardW={sz.card}
              coinSize={sz.coin}
            />
          ))}
        </div>

        {/* empty right reserve — keeps the band centred; the sort buttons are
            positioned absolutely in the .game coord system (below), identical to
            the real game, so they line up with pause/? instead of anchoring to
            the shorter .game__mid box (which pushed them onto 送出). */}
        <div className="game__sort" />
      </div>

      {/* Sort pair — direct child of .game (NOT inside .game__mid) so the absolute
          .sortbtn children anchor to the full stage via --sbtn-top-q. */}
      <SortButtons
        mode={sortMode}
        dir={sortDir}
        hlMode={t.gate === 'sort' && !t.sortModeTapped}
        hlDir={t.gate === 'sort' && !t.sortDirTapped}
        onToggleMode={() => {
          setSortMode((m) => (m === 'rank' ? 'suit' : 'rank'))
          t.tapSort('mode')
        }}
        onToggleDir={() => {
          setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
          t.tapSort('dir')
        }}
      />

      {/* Coach message bar (top-center) */}
      {t.coach && (
        <motion.div
          className="tut-coach"
          key={t.idx + t.coach.slice(0, 6)}
          style={{ left: coachLeft, width: coachW }}
          initial={{ y: -16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        >
          <PlayerAvatar avatarId="cat" size={34} />
          <p className="tut-coach__text">{t.coach}</p>
          {t.gate === 'say' && (
            <button type="button" className="tut-coach__btn" onClick={() => { sfx.click(); t.next() }}>
              下一步 ▶
            </button>
          )}
          {t.gate === 'win' && (
            <button type="button" className="tut-coach__btn" onClick={() => { sfx.click(); go('campaignStages') }}>
              完成教學
            </button>
          )}
        </motion.div>
      )}

      <div className={`game__hand${hl('hand')}`}>
        <Hand
          cards={engine.hands.p1}
          selected={pickMode ? t.selected : []}
          sortMode={sortMode}
          sortDir={sortDir}
          interactive={handInteractive}
          onToggle={onToggle}
          targetableIds={targetable}
          cardW={sz.card}
          maxWidth={sz.handMax}
        />
      </div>

      {t.gate === 'swap' && !t.targeting && (
        <button type="button" className={`game__special-trigger${hl('special')}`} onClick={t.openTray}>
          <span className="game__special-trigger__star">✦</span>
          特殊牌
        </button>
      )}

      {pickMode && (
        <div className={`game__action${canSubmit ? ' tut-action-hl' : ''}`}>
          <Button size="sm" disabled={!canSubmit} onClick={t.submitPick}>
            送出 {t.selected.length}
          </Button>
        </div>
      )}

      <Modal open={t.trayOpen} onClose={() => {}} title="發動特殊牌" width={320}>
        <p style={{ textAlign: 'center', marginBottom: 10, color: 'var(--parch-muted)' }}>點這張發動</p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {swapDef && <SpecialCard card={swapDef} w={100} onSelect={t.chooseSwap} />}
        </div>
      </Modal>

      <ShowdownModal
        open={t.showdownOpen}
        showdown={engine.lastShowdown}
        slot={engine.lastShowdown ? engine.slots[engine.lastShowdown.slot] : null}
        me="p1"
        onClose={t.dismissShowdown}
      />

      <MagnifierModal target={t.magnifier} engine={engine} me="p1" onClose={t.closeMagnifier} />
    </div>
  )
}
