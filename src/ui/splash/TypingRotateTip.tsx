import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { getCanvas, isPhone, portalRoot, subscribeCanvas } from '../../platform/canvas'
import { isAndroid, isIOS } from '../../platform/pwa'
import { sfx } from '../../audio/sfx'
import Modal from '../components/Modal'
import Button from '../components/Button'
import { ROTATE_TIP, RotateGuide } from './guides'
import { closeRotateHelp, openRotateHelp, useRotateHelp } from './rotateHelp'

/**
 * 假橫向(沒開自動旋轉、手機直拿,畫布轉了 90°)時,一點聊天 / 登入 / 改名這類要打字的框,
 * 系統鍵盤會直著跳出來 → 在畫面上方冒一行小提示,點「怎麼開？」看圖解。
 * 不打字的玩家永遠不會看到(docs/MOBILE-LANDSCAPE-SPEC.md 改動 B)。疊在最上層、不佔版面,不會讓畫面跑版。
 * 圖解彈窗也負責「安卓按了進入遊戲卻沒轉成橫的」那次(Splash 呼叫 openRotateHelp('android'))。
 */
export default function TypingRotateTip() {
  const rot = useSyncExternalStore(subscribeCanvas, () => getCanvas().rot)
  const os = useRotateHelp((s) => s.os)
  const [typing, setTyping] = useState(false)
  const myOs = isIOS() ? 'ios' : isAndroid() ? 'android' : null
  const active = !!myOs && isPhone() && rot === 90

  useEffect(() => {
    if (!active) {
      setTyping(false)
      return
    }
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'number'].includes(el.type) && el.inputMode !== 'numeric')
    const onIn = (e: FocusEvent) => setTyping(isField(e.target))
    const onOut = () => setTyping(false)
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [active])

  return (
    <>
      {active &&
        typing &&
        createPortal(
          <div className="rtip" role="status">
            <span className="rtip__text">{ROTATE_TIP.line}</span>
            <button
              type="button"
              className="rtip__btn"
              // 按下去不要先讓輸入框失焦(失焦 → 提示消失 → 這一下點不到)
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                sfx.click()
                ;(document.activeElement as HTMLElement | null)?.blur()
                openRotateHelp(myOs!)
              }}
            >
              {ROTATE_TIP.action}
            </button>
          </div>,
          portalRoot(),
        )}
      <Modal open={os !== null} onClose={closeRotateHelp} onBack={closeRotateHelp} title={ROTATE_TIP.guideTitle} scrimClass="gguide__scrim" panelClass="gguide" width={460}>
        {os && <RotateGuide os={os} />}
        <div className="gguide__actions">
          <Button variant="primary" onClick={closeRotateHelp}>
            知道了
          </Button>
        </div>
      </Modal>
    </>
  )
}
