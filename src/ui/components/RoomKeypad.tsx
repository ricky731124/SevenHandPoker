import { useEffect } from 'react'
import { sfx } from '../../audio/sfx'
import './RoomKeypad.css'

/**
 * 加入房間的 3 碼房號:遊戲內自己畫的數字鍵盤(docs/MOBILE-LANDSCAPE-SPEC.md 改動 C)。
 * 不叫系統鍵盤 → 假橫向(畫面轉 90°)也能正常按,也不會把畫面擠掉。
 * 電腦一樣可以直接打數字、Backspace 刪、Enter 送出。
 *
 * 排法:上方三格房號;下面兩排 1~5 / 6~9、0,右邊一顆跨兩排的刪除鍵(橫的畫面比較矮,兩排比電話式四排省高度)。
 */
export default function RoomKeypad({
  value,
  onChange,
  onEnter,
  length = 3,
}: {
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  length?: number
}) {
  const press = (d: string) => {
    if (value.length >= length) return
    sfx.click()
    onChange(value + d)
  }
  const back = () => {
    if (!value) return
    sfx.click()
    onChange(value.slice(0, -1))
  }

  // 實體鍵盤(電腦)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        if (value.length < length) onChange(value + e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        onChange(value.slice(0, -1))
      } else if (e.key === 'Enter' && value.length === length) {
        e.preventDefault()
        onEnter?.()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [value, length, onChange, onEnter])

  return (
    <div className="rkey">
      <div className="rkey__slots" aria-label={`房號 ${value}`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`rkey__slot${i === value.length ? ' is-cur' : ''}${value[i] ? ' is-on' : ''}`}>
            {value[i] ?? ''}
          </span>
        ))}
      </div>
      <div className="rkey__pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => (
          <button key={d} type="button" className="rkey__key" onClick={() => press(d)} disabled={value.length >= length}>
            {d}
          </button>
        ))}
        <button type="button" className="rkey__key rkey__key--back" onClick={back} disabled={!value} aria-label="刪除">
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z" />
            <path d="M12.5 9.5l5 5M17.5 9.5l-5 5" />
          </svg>
        </button>
      </div>
    </div>
  )
}
