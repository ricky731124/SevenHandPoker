import { motion } from 'framer-motion'
import { useAppStore } from '../../state/appStore'
import BackButton from '../components/BackButton'
import useMobileWebScale from '../hooks/useMobileWebScale'
import './Panel.css'

const HAND_ORDER = [
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

export default function HowToPlay() {
  const go = useAppStore((s) => s.go)
  const mw = useMobileWebScale()
  return (
    <motion.div className="panel" initial={{ opacity: 0, y: 20, scale: mw }} animate={{ opacity: 1, y: 0, scale: mw }}>
      <div className="panel__titlebar">
        <BackButton onClick={() => go('menu')} />
        <h1 className="panel__h1">如何遊玩</h1>
      </div>
      <div className="panel__scroll">
        <section>
          <h3>🎯 獲勝條件</h3>
          <p>牌桌中央有一排 7 個金幣格。透過對決贏得金幣，<b>先拿到 4 枚金幣</b>，或讓<b>金幣三連線（相鄰 3 格同屬你）</b>即獲勝。</p>
        </section>

        <section>
          <h3>🔄 流程</h3>
          <ol>
            <li>開場擲硬幣決定誰先「選牌」。</li>
            <li>選牌方從手牌選 <b>1~5 張</b>送出；由<b>對手</b>決定放進你哪一個空格子。</li>
            <li>接著換對手選牌、你來放置，如此交替。</li>
            <li>某格上下兩側都有牌時 → <b>立即對決</b>，勝方獲得該格金幣。</li>
            <li>每次放置後補牌（依序 3/3/3/3/2/2），最多累積 26 張。</li>
            <li>手牌不必用完，7 格放滿或達成勝利條件即結束。</li>
          </ol>
        </section>

        <section>
          <h3>🃏 牌型大小（梭哈式・大 → 小）</h3>
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
          <p className="panel__note">
            ※ 順子與同花<b>只有剛好 5 張才成立</b>（4 張以下不算）。點數相同時比花色：<b>♠ 黑桃 &gt; ♥ 紅心 &gt; ♦ 方塊 &gt; ♣ 梅花</b>。
          </p>
        </section>

        <section>
          <h3>🔍 情報戰</h3>
          <p>對手選牌時你會即時看到他手牌「哪幾張被推上來」（僅背面）。用放大鏡可查看自己已放的牌，以及對手<b>已翻開</b>的格子——推敲他還握有哪些牌。</p>
        </section>
      </div>
    </motion.div>
  )
}
