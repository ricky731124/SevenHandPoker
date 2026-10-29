import { useCallback, useEffect, useState } from 'react'
import type { Card as TCard, Rank, Suit } from '../../../game/cards'
import { LIMITED_INFO, LIMITED_ROTA, type LimitedMode, type TieStep } from '../../../game/limited'
import Card from '../Card'
import Modal from '../Modal'
import Button from '../Button'
import { sfx } from '../../../audio/sfx'
import './LimitedRule.css'

/**
 * 限定房規則卡(LIMITED-ROOM-SPEC §8.3):VS 畫面之後跳一次;牌桌上的標籤點了也能再看。
 * autoCloseMs:連線對戰時自動收掉,避免一方一直開著、另一方乾等。
 */
export function LimitedRuleModal({
  mode,
  open,
  onClose,
  autoCloseMs,
}: {
  mode: LimitedMode
  open: boolean
  onClose: () => void
  autoCloseMs?: number
}) {
  useEffect(() => {
    if (!open || !autoCloseMs) return
    const t = setTimeout(onClose, autoCloseMs)
    return () => clearTimeout(t)
  }, [open, autoCloseMs, onClose])

  const info = LIMITED_INFO[mode]
  return (
    <Modal open={open} onClose={onClose} title={`限定房・${info.name}`} width={info.examples ? 680 : 380} panelClass="limited-rule">
      {/* 有範例的玩法分兩欄(左:範例、右:規則 + 知道了),手機橫向才不用往下捲 */}
      <div className={info.examples ? 'limited-rule__split' : undefined}>
        <ul className="limited-rule__list">
          {info.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {info.examples && (
          <div className="limited-rule__ties">
            <div className="limited-rule__ties-intro">{info.examples.intro}</div>
            <TieSteps steps={info.examples.steps} />
          </div>
        )}
        <div className="limited-rule__ok">
          <Button
            full
            onClick={() => {
              sfx.click()
              onClose()
            }}
          >
            知道了
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** 範例牌 id → 牌('J' = 鬼牌、'B' = 空白,其他是 cardId 格式:花色 + 點數)。 */
function exampleCard(id: string, k: number): TCard {
  if (id === 'J') return { id: `ex-joker-${k}`, suit: 'S', rank: 14, kind: 'joker' }
  if (id === 'B') return { id: `ex-blank-${k}`, suit: 'C', rank: 2, kind: 'blank' }
  const r = id.slice(1)
  const rank = (r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r)) as Rank
  return { id: `ex-${id}`, suit: id[0] as Suit, rank }
}
function ExamplePile({ ids, win }: { ids: string[]; win?: boolean }) {
  return (
    <span className={`tie-step__pile${win ? ' tie-step__pile--win' : ''}`}>
      {ids.map((id, k) => (
        <span key={k} className="tie-step__card">
          <Card card={exampleCard(id, k)} w={30} />
        </span>
      ))}
      {win && <span className="tie-step__check">✔</span>}
    </span>
  )
}
/** 規則卡範例(spec §8.3):每個一行標題(後接小字說明)+ 左疊 vs 右疊,贏的那邊打勾。 */
function TieSteps({ steps }: { steps: TieStep[] }) {
  return (
    <div className="tie-steps">
      {steps.map((s) => (
        <div key={s.title} className="tie-step">
          <div className="tie-step__title">
            {s.title}
            <span className="tie-step__note">{s.note}</span>
          </div>
          <div className="tie-step__row">
            <ExamplePile ids={s.left} win={s.winner !== 'right'} />
            <span className="tie-step__vs">vs</span>
            <ExamplePile ids={s.right} win={s.winner === 'right'} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 牌桌右側「?」正上方的玩法方鈕(§8.4),點了再看一次規則卡。 */
export function LimitedBadge({ mode, onClick }: { mode: LimitedMode; onClick?: () => void }) {
  const info = LIMITED_INFO[mode]
  return (
    <button
      type="button"
      className={`limited-badge limited-badge--${mode}${info.badge.length > 1 ? '' : ' limited-badge--one'}`}
      onClick={
        onClick
          ? () => {
              sfx.click()
              onClick()
            }
          : undefined
      }
      title="看規則"
      aria-label={`限定房・${info.name}`}
    >
      {info.badge.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </button>
  )
}

/**
 * 快速配對 / 建立房間「?」:限定房輪值表(§8.2)。同一種玩法的星期併一列、今天那列金框;
 * 每列「玩法介紹」疊開那個玩法的規則卡(玩之前先看規則)。左上返回鍵關閉(沒有「知道了」)。
 * 測試期固定玩法時多一行說明。
 */
export function LimitedRotaModal({ open, onClose, today, testMode }: { open: boolean; onClose: () => void; today: number; testMode: LimitedMode | null }) {
  const [rule, setRule] = useState<LimitedMode | null>(null)
  const closeRule = useCallback(() => setRule(null), [])
  return (
    <>
      <Modal open={open} onClose={onClose} onBack={onClose} title="限定房輪值表" width={440} panelClass="limited-week">
        <ul className="limited-week__list">
          {LIMITED_ROTA.map(({ mode, days, label }) => (
            <li key={mode} className={days.includes(today) ? 'limited-week__row limited-week__row--today' : 'limited-week__row'}>
              <span>{label}</span>
              <span>{LIMITED_INFO[mode].name}</span>
              <button
                type="button"
                className="limited-week__intro"
                onClick={() => {
                  sfx.click()
                  setRule(mode)
                }}
              >
                玩法介紹
              </button>
            </li>
          ))}
        </ul>
        {testMode && <p className="limited-week__note">測試期間每天都是{LIMITED_INFO[testMode].name}</p>}
      </Modal>
      {rule && <LimitedRuleModal mode={rule} open onClose={closeRule} />}
    </>
  )
}
