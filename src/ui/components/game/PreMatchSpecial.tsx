import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useGameStore } from '../../../state/gameStore'
import { usePlatformStore } from '../../../state/platformStore'
import { useNetStore } from '../../../state/netStore'
import { BASELINE_SPECIAL_CARD } from '../../../platform/profile'
import SpecialCard, { SpecialCardArt } from '../SpecialCard'
import CardCarousel, { type CarouselSlide } from '../CardCarousel'
import Button from '../Button'
import { SPECIAL_CARD_LIST, LOADOUT_SIZE, type SpecialCardDef, type SpecialCardId } from '../../../game/specialCards'
import '../../screens/Personalize.css'
import './PreMatchSpecial.css'

function cardArt(c: SpecialCardDef): ReactNode {
  return (
    <span style={{ display: 'block', width: 150, height: 210 }}>
      <SpecialCardArt id={c.id} color={c.accent} uid={`pm-${c.id}`} />
    </span>
  )
}

/**
 * Pre-match special-card pick (Phase C surface B). Shown for a special-card room
 * after the VS intro and before the coin toss. Shows the cards I OWN; online, a
 * card the opponent hasn't unlocked is shown greyed as「對手未解鎖」and cannot be
 * chosen (PvP intersection pool). No 顯示全部 toggle here — at the table you only
 * care about what you can actually bring. Single-tap a card → detail popup;
 * double-tap → select; single-tap a carried slot → remove.
 */
export default function PreMatchSpecial() {
  const confirmLoadout = useGameStore((s) => s.confirmLoadout)
  const initial = useGameStore((s) => s.loadout)
  const waiting = useGameStore((s) => s.loadoutWaiting)
  const online = useGameStore((s) => s.online)
  const profile = usePlatformStore((s) => s.profile)
  const username = usePlatformStore((s) => s.username)
  const room = useNetStore((s) => s.room)
  const allUnlocked = username === 'ricky' // test account: everything open
  const [popup, setPopup] = useState(-1)

  const iHave = (id: SpecialCardId) => allUnlocked || !!profile?.unlocked.specialCards[id]
  const foeSpecials: string[] | null = online
    ? (room?.players?.[online.role === 'host' ? 'guest' : 'host']?.specials ?? null)
    : null
  // Usable this match = I own it AND (single-player OR the opponent also owns it).
  const usable = (id: SpecialCardId) => {
    if (!iHave(id)) return false
    if (!online) return true
    return foeSpecials ? foeSpecials.includes(id) : id === BASELINE_SPECIAL_CARD
  }

  // Show only cards I own (hide my-locked — no meaning at the table).
  const displayed = SPECIAL_CARD_LIST.filter((c) => iHave(c.id as SpecialCardId))

  const [sel, setSel] = useState<SpecialCardId[]>(() =>
    (initial.length ? initial : ((profile?.equipped.specialCards as SpecialCardId[] | undefined) ?? []))
      .filter((id) => usable(id as SpecialCardId))
      .slice(0, LOADOUT_SIZE) as SpecialCardId[],
  )

  const toggle = (id: SpecialCardId) => {
    if (!usable(id)) return
    if (sel.includes(id)) setSel(sel.filter((x) => x !== id))
    else if (sel.length < LOADOUT_SIZE) setSel([...sel, id])
  }

  const slides: CarouselSlide[] = displayed.map((c) => {
    const ok = usable(c.id as SpecialCardId)
    return {
      key: c.id,
      art: cardArt(c),
      name: c.name,
      desc: c.desc,
      statusText: ok ? '可用' : '對手未解鎖',
      statusColor: ok ? 'var(--wood-700, #6a4e2c)' : '#a3402d',
      selectable: ok,
      selected: sel.includes(c.id as SpecialCardId),
    }
  })

  return (
    <div className="prematch">
      <motion.div
        className="prematch__panel"
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      >
        <div className="prematch__sub">
          {waiting
            ? '已確認，等待對手選牌…'
            : online
              ? '選擇本場帶上場的特殊牌（整場只能發動 1 張）· 灰色為對手未解鎖'
              : '選擇本場帶上場的特殊牌（整場只能發動 1 張）'}
        </div>

        <div className="pz-loadout-wrap">
          <div className="pz-loadout__header">
            <span className="pz-loadout__label">出戰牌組（{sel.length}/{LOADOUT_SIZE}）</span>
            <span className="pz-loadout__tip">單擊看說明 · 雙擊選取</span>
          </div>

          <div className="pz-loadout">
            {/* Left: the 3 carried slots (single-click a card to remove it) */}
            <div className="pz-loadout__slots">
              {Array.from({ length: LOADOUT_SIZE }, (_, i) => {
                const card = SPECIAL_CARD_LIST.find((c) => c.id === sel[i])
                return (
                  <div key={i} className="pz-loslot">
                    <span className="pz-loslot__pos">{i + 1}.</span>
                    {card ? (
                      <SpecialCard card={card} w={50} onSelect={() => toggle(card.id as SpecialCardId)} />
                    ) : (
                      <span className="pz-loslot__empty">空</span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Right: the pickable pool — single tap opens the popup, double tap selects */}
            <div className="pz-loadout__pick">
              {displayed.map((c, i) => {
                const idx = sel.indexOf(c.id as SpecialCardId)
                return (
                  <SpecialCard
                    key={c.id}
                    card={c}
                    w={64}
                    selected={idx >= 0}
                    order={idx >= 0 ? idx + 1 : undefined}
                    locked={!usable(c.id as SpecialCardId)}
                    lockLabel="對手未解鎖"
                    openOnSingle
                    onSelect={() => toggle(c.id as SpecialCardId)}
                    onView={() => setPopup(i)}
                  />
                )
              })}
            </div>
          </div>
        </div>

        <Button size="sm" disabled={sel.length === 0 || waiting} onClick={() => confirmLoadout(sel)}>
          {waiting ? '等待對手…' : '確認出戰'}
        </Button>
      </motion.div>

      {popup >= 0 && (
        <CardCarousel
          slides={slides}
          index={popup}
          onIndex={setPopup}
          onClose={() => setPopup(-1)}
          full={sel.length >= LOADOUT_SIZE}
          onConfirm={(s) => {
            toggle(s.key as SpecialCardId)
            setPopup(-1)
          }}
        />
      )}
    </div>
  )
}
