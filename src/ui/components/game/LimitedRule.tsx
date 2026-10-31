import { useCallback, useEffect, useState } from 'react'
import type { Card as TCard, Rank, Suit } from '../../../game/cards'
import { LIMITED_INFO, LIMITED_ROTA, type LimitedMode, type TieStep } from '../../../game/limited'
import Card from '../Card'
import SpecialCard from '../SpecialCard'
import { getSpecialCard, type SpecialCardId } from '../../../game/specialCards'
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
  // 左欄:比牌範例;火力全開沒有比牌變化 → 放「帶 5 用 3、每回合 1 張」示意(使用者 2026-10-31)
  const split = !!info.examples || mode === 'fire'
  return (
    <Modal open={open} onClose={onClose} title={`限定房・${info.name}`} width={split ? 680 : 380} panelClass="limited-rule">
      {/* 有範例的玩法分兩欄(左:範例、右:規則 + 知道了),手機橫向才不用往下捲 */}
      <div className={split ? 'limited-rule__split' : undefined}>
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
        {mode === 'fire' && (
          <div className="limited-rule__ties">
            <FireDemo />
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

/** 火力全開示意卡:一張小特殊卡,可加打勾 / 打叉 / 已用 / 變暗。 */
function DemoCard({ id, mark, dim }: { id: SpecialCardId; mark?: 'ok' | 'no' | 'used'; dim?: boolean }) {
  const def = getSpecialCard(id)!
  return (
    <span className={`fire-demo__card${dim ? ' fire-demo__card--dim' : ''}`}>
      <SpecialCard card={def} w={46} interactive={false} />
      {mark === 'ok' && <span className="tie-step__check">✔</span>}
      {mark === 'no' && <span className="tie-step__check fire-demo__x">✘</span>}
      {mark === 'used' && <span className="fire-demo__used">🚫 已用</span>}
    </span>
  )
}
/** 規則卡左欄(火力全開):① 帶 5 用 3 ② 每回合最多 1 張 ③ 每張只能用一次。 */
function FireDemo() {
  const five: SpecialCardId[] = ['explode', 'spy', 'hearts', 'refresh', 'deathEye']
  return (
    <div className="tie-steps">
      <div className="tie-step">
        <div className="tie-step__title">
          ① 帶 5 張，整場用 3 張<span className="tie-step__note">哪 3 張你自己決定</span>
        </div>
        <div className="tie-step__row fire-demo__row">
          {five.map((id, k) => (
            <DemoCard key={id} id={id} mark={k < 3 ? 'ok' : undefined} dim={k >= 3} />
          ))}
        </div>
      </div>
      <div className="tie-step">
        <div className="tie-step__title">
          ② 每回合最多 1 張<span className="tie-step__note">輪到你出牌、送出前用</span>
        </div>
        <div className="tie-step__row fire-demo__row">
          <span className="fire-demo__label">這回合</span>
          <DemoCard id="explode" mark="ok" />
          <span className="tie-step__vs">再用</span>
          <DemoCard id="spy" mark="no" dim />
        </div>
      </div>
      <div className="tie-step">
        <div className="tie-step__title">
          ③ 每張只能用一次<span className="tie-step__note">用過的卡會標「已用」</span>
        </div>
        <div className="tie-step__row fire-demo__row">
          <DemoCard id="explode" mark="used" dim />
          <DemoCard id="spy" />
          <DemoCard id="hearts" />
        </div>
      </div>
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
