import { useGameStore } from '../../../state/gameStore'
import { getSpecialCard } from '../../../game/specialCards'
import { fireUsedOf, fireUsesLeft, otherPlayer } from '../../../game/state'
import { sortHand } from '../../../game/sort'
import Modal from '../Modal'
import Card from '../Card'
import SpecialCard from '../SpecialCard'
import Button from '../Button'
import './SpecialControls.css'

/**
 * In-game special-card activation (Phase C surface C), single-player.
 *  - SpecialTray: the "特殊牌" button opens a tray of the ≤3 carried cards;
 *    tapping one either enters hand-targeting (swap/clubs) or resolves info now.
 *  - SpecialInfoModal: shows the peek (next draw) / spy (foe hand) result.
 * Only one card may be activated per match; after that the button is greyed.
 * 火力全開(LIMITED-ROOM-SPEC §6):標題寫自己剩幾次、說明寫每回合限 1 張 + 對手剩幾次,用過的卡蓋「已用」點不了。
 */
export function SpecialTray() {
  const open = useGameStore((s) => s.specialTrayOpen)
  const loadout = useGameStore((s) => s.loadout)
  const choose = useGameStore((s) => s.chooseSpecial)
  const close = useGameStore((s) => s.closeSpecialTray)
  const engine = useGameStore((s) => s.engine)
  const me = useGameStore((s) => s.me)
  const fire = engine?.mode === 'fire'
  const used = fire ? fireUsedOf(engine, me) : []

  return (
    <Modal
      open={open}
      onClose={close}
      title={fire ? `發動特殊牌（剩 ${fireUsesLeft(engine, me)} 次）` : '發動特殊牌'}
      // 火力全開帶 5 張:寬到 5 張排一排(5×84 + 間距 4×12 + 內距/框線),不再上 4 下 1、三星不用捲(§8.2)
      width={fire ? 560 : 380}
      panelClass={fire ? 'spx-tray-panel--fire' : undefined}
    >
      <p className="spx-tray__hint">
        {fire ? `每回合限 1 張・對手剩 ${fireUsesLeft(engine, otherPlayer(me))} 次` : '點一張發動（整場僅限一次）'}
      </p>
      <div className="spx-tray">
        {loadout.map((id) => {
          const def = getSpecialCard(id)
          if (!def) return null
          return (
            <SpecialCard
              key={id}
              card={def}
              w={fire ? 84 : 92}
              locked={used.includes(id)}
              lockLabel="🚫 已用"
              onSelect={() => choose(id)}
            />
          )
        })}
      </div>
    </Modal>
  )
}

export function SpecialInfoModal() {
  const info = useGameStore((s) => s.specialInfo)
  const close = useGameStore((s) => s.closeSpecialInfo)
  const open = !!info
  const isPeek = info?.kind === 'peek'
  const cards = info ? (isPeek ? info.cards : sortHand(info.cards, 'rank', 'asc')) : []

  return (
    <Modal
      open={open}
      onClose={close}
      onBack={close}
      title={isPeek ? '偷窺 · 下次補牌' : '讓我看看 · 對手手牌'}
      width={520}
      scrimClass="modal__scrim--light"
    >
      {/* 偷窺不放說明那行(2026-11-02 使用者:多餘,省下高度才不會擋到手牌;標題已寫「下次補牌」) */}
      {!isPeek && <p className="spx-info__hint">對手目前的手牌（對手會被告知你正在查看）：</p>}
      <div className={`spx-info__cards${isPeek ? ' spx-info__cards--peek' : ''}`}>
        {cards.map((c) => (
          <Card key={c.id} card={c} w={54} />
        ))}
        {cards.length === 0 && <span className="spx-info__empty">沒有可顯示的牌</span>}
      </div>
      {/* 自己看完自己關(使用者:要能自己關掉彈窗) */}
      <div className="confirm__actions">
        <Button onClick={close}>知道了</Button>
      </div>
    </Modal>
  )
}
