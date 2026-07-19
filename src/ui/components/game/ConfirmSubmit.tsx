import type { Card as TCard } from '../../../game/cards'
import Modal from '../Modal'
import Button from '../Button'
import Card from '../Card'

export default function ConfirmSubmit({
  data,
  onConfirm,
  onCancel,
}: {
  data: { cards: TCard[]; name: string } | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal open={!!data} onClose={onCancel} title="確認送出" width={460}>
      {data && (
        <>
          <div className="confirm__cards">
            {data.cards.map((c) => (
              <Card key={c.id} card={c} w={64} />
            ))}
          </div>
          <div className="confirm__type">
            這手是 <b className="accent">{data.name}</b>（{data.cards.length} 張）
          </div>
          <div className="confirm__actions">
            <Button variant="secondary" onClick={onCancel}>
              取消
            </Button>
            <Button onClick={onConfirm}>確認</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
