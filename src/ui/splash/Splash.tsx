import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { getCanvas, isPhone, portalRoot } from '../../platform/canvas'
import { isAndroid, isIOS, isPwaInstalled, promptInstall, usePwaStore } from '../../platform/pwa'
import { enterLandscapeFullscreen, keepFullscreen, wantsFullscreen } from '../../platform/fullscreen'
import { openRotateHelp } from './rotateHelp'
import { useAppStore } from '../../state/appStore'
import { sfx } from '../../audio/sfx'
import HeroArt from '../components/HeroArt'
import Modal from '../components/Modal'
import Button from '../components/Button'
import HeroFx from '../components/HeroFx'
import { A2hsGuide, ENTER_TEXT, InstallGuide, SETUP, SETUP_TITLE, type SetupId } from './guides'
import { AddHomeIcon, InstallIcon } from './icons'
import './Splash.css'

/**
 * 開場頁(docs/MOBILE-LANDSCAPE-SPEC.md 改動 B)。每次冷開都會先看到這一頁(所有平台)。
 * 按「進入遊戲」→ 解鎖音效、安卓進全螢幕鎖橫,開場頁淡出、露出底下已經載好的大廳。
 *
 * 三層:背景圖(主題) / 特效層(主題,HeroFx) / 進入遊戲 + 右下角「最佳體驗設定」看板。
 * 看板只有手機、而且還沒做到時才出現,同時最多一項:
 *   - iOS 用 Safari 開 → 加入主畫面(按「怎麼加？」看圖解)
 *   - 安卓用瀏覽器開、還沒安裝 → 安裝 App(按下去直接叫出系統安裝視窗)
 * 「開啟自動旋轉」不放這裡:假橫向只有打字時才有差,改成點輸入框時提醒(TypingRotateTip)。
 */
export default function Splash({ onStart }: { onStart: () => void }) {
  const [ready, setReady] = useState(() => document.readyState === 'complete')
  const [leaving, setLeaving] = useState(false)
  const [guide, setGuide] = useState<SetupId | null>(null)
  const setup = useSetupItem()
  const canInstall = usePwaStore((s) => s.canInstall)

  // 東西載完(window load)才能進;萬一 load 一直不來,4 秒後也放行
  useEffect(() => {
    if (ready) return
    const on = () => setReady(true)
    window.addEventListener('load', on)
    const t = window.setTimeout(on, 4000)
    return () => {
      window.removeEventListener('load', on)
      window.clearTimeout(t)
    }
  }, [ready])

  const enter = () => {
    if (!ready || leaving) return
    sfx.unlock()
    sfx.click()
    enterLandscapeFullscreen() // 安卓瀏覽器:全螢幕 + 鎖橫向(其他平台什麼都不做)
    keepFullscreen()
    // 安卓:等全螢幕 / 鎖方向生效後還是直的(瀏覽器不讓鎖)→ 進大廳後直接教開自動旋轉
    if (wantsFullscreen()) window.setTimeout(() => getCanvas().rot === 90 && openRotateHelp('android'), 1200)
    setLeaving(true)
  }

  const doSetup = async (id: SetupId) => {
    sfx.unlock()
    sfx.click()
    // 安卓:瀏覽器有給一鍵安裝就直接叫出來;沒有才教 ⋮ 選單
    if (id === 'install' && canInstall) {
      await promptInstall()
      return
    }
    setGuide(id)
  }

  return createPortal(
    <motion.div
      className="splash"
      initial={{ opacity: 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.5 }}
      onAnimationComplete={() => leaving && onStart()}
      style={{ pointerEvents: leaving ? 'none' : undefined }}
    >
      {/* 背景層 + 下方淡淡的漸層(讓按鈕、看板看得清楚,整張圖不壓暗) */}
      <div className="splash__bg">
        <HeroArt />
        <div className="splash__shade" />
      </div>
      {/* 特效層(以圖定位,大廳也是同一層) */}
      <HeroFx />
      {/* 按鈕和看板 */}
      <div className="splash__ui">
        <div className="senter">
          {ready && ENTER_MOTES.map((m, i) => <span key={i} className="senter__mote" style={{ left: m.x, animationDelay: m.d, animationDuration: m.t }} aria-hidden />)}
          <button type="button" className={`woodbtn woodbtn--primary woodbtn--lg splash__enter${ready ? '' : ' is-loading'}`} disabled={!ready} onClick={enter}>
            {ready ? ENTER_TEXT.ready : ENTER_TEXT.loading}
          </button>
        </div>
        {setup && (
          <div className="ssetup">
            <div className="ssetup__title">{SETUP_TITLE}</div>
            <div className="ssetup__row">
              <span className="ssetup__icon">{setup === 'a2hs' ? <AddHomeIcon /> : <InstallIcon />}</span>
              <span className="ssetup__text">
                <span className="ssetup__label">{SETUP[setup].label}</span>
                <span className="ssetup__gain">{SETUP[setup].gain}</span>
              </span>
              <button type="button" className="ssetup__btn" onClick={() => void doSetup(setup)}>
                {SETUP[setup].action}
              </button>
            </div>
          </div>
        )}
      </div>
      <SetupGuide id={guide} onClose={() => setGuide(null)} />
    </motion.div>,
    portalRoot(),
  )
}

/** 「進入遊戲」周圍往上飄的金色光粒子(固定位置,截圖比對才穩) */
const ENTER_MOTES = [8, 22, 35, 50, 63, 77, 91].map((x, i) => ({ x: `${x}%`, d: `${-(i * 0.47) % 2.6}s`, t: `${2.2 + (i % 3) * 0.45}s` }))

/** 還沒做到的那一項(手機才有;電腦、iPad、安裝版、已安裝 → 沒有)。 */
function useSetupItem(): SetupId | null {
  const standalone = usePwaStore((s) => s.standalone)
  // 安卓:有沒有裝過(在瀏覽器開也偵測得到);null = 偵測中,先不顯示,免得閃一下
  const [androidInstalled, setAndroidInstalled] = useState<boolean | null>(isAndroid() ? null : false)
  useEffect(() => {
    if (isAndroid()) void isPwaInstalled().then(setAndroidInstalled)
  }, [])
  if (!isPhone() || standalone) return null
  if (isIOS()) return 'a2hs'
  if (isAndroid() && androidInstalled === false) return 'install'
  return null
}

/** 圖解彈窗。玩家照著做(例如按了分享鈕)再回來,彈窗還開在原地。 */
function SetupGuide({ id, onClose }: { id: SetupId | null; onClose: () => void }) {
  const room = useAppStore((s) => s.pendingRoom)
  return (
    <Modal open={id !== null} onClose={onClose} onBack={onClose} title={id ? SETUP[id].guideTitle : ''} scrimClass="gguide__scrim" panelClass="gguide" width={460}>
      {id === 'a2hs' && <A2hsGuide room={room} />}
      {id === 'install' && <InstallGuide room={room} />}
      <div className="gguide__actions">
        <Button variant="primary" onClick={onClose}>
          知道了
        </Button>
      </div>
    </Modal>
  )
}
