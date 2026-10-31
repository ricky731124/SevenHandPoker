import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { myUnlockedSpecialCount, useGameStore } from '../../../state/gameStore'
import { usePlatformStore } from '../../../state/platformStore'
import { useNetStore } from '../../../state/netStore'
import { BASELINE_SPECIAL_CARD } from '../../../platform/profile'
import SpecialCard, { SpecialCardArt } from '../SpecialCard'
import CardCarousel, { type CarouselSlide } from '../CardCarousel'
import Button from '../Button'
import { SPECIAL_CARD_LIST, FIRE_LOADOUT, LOADOUT_SIZE, firePool, firePoolSize, unlockedCount, usableInMatch, type SpecialCardDef, type SpecialCardId } from '../../../game/specialCards'
import { usesSpecials } from '../../../game/limited'
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
 * chosen (PvP intersection pool — 只限快速配對;朋友房各帶各的). No 顯示全部 toggle here — at the table you only
 * care about what you can actually bring. Single-tap a card → detail popup;
 * double-tap → select; single-tap a carried slot → remove.
 *
 * 限定房「火力全開」(LIMITED-ROOM-SPEC §6):卡池 = 照解鎖順序的前 N 張(最少 10 張,沒解鎖的也能用;
 * 快配真人 N 看兩人比較少的,規則見 specialCards `firePoolSize`)、要選滿 5 張;我有但超出卡池的卡
 * 顯示灰色「對手未解鎖」。預設帶上次的火力全開牌組,第一次 = 特殊房的牌組 + 隨機補滿(新手不用想,
 * 直接按確認就能開打)。出戰欄 1~3 一欄、4~5 在右邊第二欄。
 */
/** 火力全開預設牌組:上次存的 5 張;沒有就拿特殊房牌組再隨機補滿。都只取卡池裡的。 */
function fireDefault(saved: string[] | undefined, special: string[] | undefined, pool: SpecialCardId[]): SpecialCardId[] {
  const valid = (ids: string[] | undefined) => [...new Set(ids ?? [])].filter((id) => pool.includes(id as SpecialCardId)) as SpecialCardId[]
  const last = valid(saved)
  if (last.length === FIRE_LOADOUT) return last
  const out = valid(special).slice(0, FIRE_LOADOUT)
  const rest = pool.filter((id) => !out.includes(id))
  while (out.length < FIRE_LOADOUT && rest.length) out.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0])
  return out
}

export default function PreMatchSpecial() {
  const confirmLoadout = useGameStore((s) => s.confirmLoadout)
  const initial = useGameStore((s) => s.loadout)
  const waiting = useGameStore((s) => s.loadoutWaiting)
  const online = useGameStore((s) => s.online)
  const profile = usePlatformStore((s) => s.profile)
  const username = usePlatformStore((s) => s.username)
  const room = useNetStore((s) => s.room)
  const fire = usesSpecials(useGameStore((s) => s.limitedMode))
  const size = fire ? FIRE_LOADOUT : LOADOUT_SIZE
  const allUnlocked = username === 'ricky' // test account: everything open
  const [popup, setPopup] = useState(-1)

  const owns = (id: SpecialCardId) => allUnlocked || !!profile?.unlocked.specialCards[id]
  const foeSpecials: string[] | null = online
    ? (room?.players?.[online.role === 'host' ? 'guest' : 'host']?.specials ?? null)
    : null
  // 共同卡池只套在快速配對配到的真人;朋友房各帶各的(規則見 usableInMatch / firePoolSize)
  const matchedHuman = !!online && room?.origin === 'match'
  const pool: SpecialCardId[] = fire
    ? firePool(firePoolSize(myUnlockedSpecialCount(), matchedHuman ? unlockedCount(foeSpecials) : undefined))
    : []
  const iHave = (id: SpecialCardId) => owns(id) || pool.includes(id) // 火力全開:卡池裡的沒解鎖也能用
  const usable = (id: SpecialCardId) =>
    fire
      ? pool.includes(id)
      : usableInMatch(id, { iHave: iHave(id), online: !!online, origin: room?.origin, foeSpecials, baseline: BASELINE_SPECIAL_CARD })
  const sharedPool = fire ? SPECIAL_CARD_LIST.some((c) => owns(c.id) && !pool.includes(c.id)) : matchedHuman

  // Show only cards I own (hide my-locked — no meaning at the table).
  const displayed = SPECIAL_CARD_LIST.filter((c) => iHave(c.id as SpecialCardId))

  const [sel, setSel] = useState<SpecialCardId[]>(() =>
    fire
      ? initial.length === FIRE_LOADOUT && initial.every((id) => pool.includes(id))
        ? initial // 再來一局:沿用上一局
        : fireDefault(profile?.equipped.fireCards, profile?.equipped.specialCards, pool)
      : ((initial.length ? initial : ((profile?.equipped.specialCards as SpecialCardId[] | undefined) ?? []))
          .filter((id) => usable(id as SpecialCardId))
          .slice(0, LOADOUT_SIZE) as SpecialCardId[]),
  )

  const toggle = (id: SpecialCardId) => {
    if (!usable(id)) return
    if (sel.includes(id)) setSel(sel.filter((x) => x !== id))
    else if (sel.length < size) setSel([...sel, id])
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
            : fire
              ? `選 5 張特殊卡帶上場（整場可用 3 次・每回合 1 張）${sharedPool ? '· 灰色為對手未解鎖' : ''}`
              : sharedPool
              ? '選擇本場帶上場的特殊牌（整場只能發動 1 張）· 灰色為對手未解鎖'
              : '選擇本場帶上場的特殊牌（整場只能發動 1 張）'}
        </div>

        <div className="pz-loadout-wrap">
          <div className="pz-loadout__header">
            <span className="pz-loadout__label">出戰牌組（{sel.length}/{size}）</span>
            <span className="pz-loadout__tip">單擊看說明 · 雙擊選取</span>
          </div>

          <div className="pz-loadout">
            {/* Left: the 3 carried slots (single-click a card to remove it);火力全開 5 格 = 3 + 2 兩欄 */}
            <div className={`pz-loadout__slots${fire ? ' pz-loadout__slots--fire' : ''}`}>
              {Array.from({ length: size }, (_, i) => {
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

        <Button size="sm" disabled={(fire ? sel.length < size : sel.length === 0) || waiting} onClick={() => confirmLoadout(sel)}>
          {waiting ? '等待對手…' : '確認出戰'}
        </Button>
      </motion.div>

      {popup >= 0 && (
        <CardCarousel
          slides={slides}
          index={popup}
          onIndex={setPopup}
          onClose={() => setPopup(-1)}
          full={sel.length >= size}
          onConfirm={(s) => {
            toggle(s.key as SpecialCardId)
            setPopup(-1)
          }}
        />
      )}
    </div>
  )
}
