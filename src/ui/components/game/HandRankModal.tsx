import Modal from '../Modal'
import '../../screens/Panel.css'
import './HandRankModal.css'

/** 牌型大小(梭哈式・大→小) — 與「如何遊玩」同一份內容,做成遊戲內可隨時查的小彈窗
 *  (很多人記不住牌型大小)。刻意做緊湊,避免與頂端計時器疊到、也不需要捲動。 */
const HAND_ORDER: [string, string, string][] = [
  ['同花順', 'Straight Flush', '5 張同花且連續'],
  ['鐵支（四條）', 'Four of a Kind', '4 張同點'],
  ['葫蘆', 'Full House', '三條 + 一對'],
  ['同花', 'Flush', '5 張同花色'],
  ['順子', 'Straight', '5 張連續'],
  ['三條', 'Three of a Kind', '3 張同點'],
  ['兩對', 'Two Pair', '兩組對子'],
  ['對子', 'Pair', '2 張同點'],
  ['高牌', 'High Card', '以上皆非，比最大牌'],
]

export default function HandRankModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} onBack={onClose} title="牌型（大到小）" width={480} scrimClass="modal__scrim--light" panelClass="modal__panel--hands">
      <div className="hands">
        <table className="panel__table">
          <tbody>
            {HAND_ORDER.map(([zh, en, desc]) => (
              <tr key={en}>
                <td className="panel__hand">{zh}</td>
                <td className="panel__en">{en}</td>
                <td className="panel__desc">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hands__note">
          ※ 順子與同花<b>只有剛好 5 張才成立</b>（4 張以下不算）。點數相同時比花色：
          <b>♠ &gt; ♥ &gt; ♦ &gt; ♣</b>。
        </p>
      </div>
    </Modal>
  )
}
