import type { GameState, PlayerId } from '../../../game/state'
import { evaluate } from '../../../game/evaluate'
import Modal from '../Modal'
import Card from '../Card'

export default function MagnifierModal({
  target,
  engine,
  me,
  onClose,
}: {
  target: { side: PlayerId; slot: number } | null
  engine: GameState | null
  me: PlayerId
  onClose: () => void
}) {
  if (!target || !engine) return <Modal open={false} onClose={onClose} children={null} />
  const cards = engine.slots[target.slot][target.side]
  const who = target.side === me ? '你的牌' : '對手的牌'
  const name = cards.length ? evaluate(cards).name : '—'
  return (
    <Modal open title={`第 ${target.slot + 1} 格・${who}`} onClose={onClose} width={460}>
      <div className="confirm__cards">
        {cards.map((c) => (
          <Card key={c.id} card={c} w={62} />
        ))}
      </div>
      <div className="confirm__type">
        牌型：<b className="accent">{name}</b>（{cards.length} 張）
      </div>
    </Modal>
  )
}
