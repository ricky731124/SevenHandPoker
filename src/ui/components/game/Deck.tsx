import CardBack from '../CardBack'

/** Draw pile shown at the left of the board. */
export default function Deck({ count, cardW = 46 }: { count: number; cardW?: number }) {
  const layers = Math.min(6, Math.ceil(count / 6))
  return (
    <div className="deck" title={`牌堆剩 ${count} 張`}>
      <div className="deck__stack" style={{ width: cardW + 10, height: cardW * 1.4 + 10 }}>
        {Array.from({ length: Math.max(1, layers) }).map((_, i) => (
          <div key={i} className="deck__layer" style={{ left: i * 2, top: -i * 2 }}>
            <CardBack w={cardW} />
          </div>
        ))}
      </div>
      <div className="deck__count">{count}</div>
    </div>
  )
}
