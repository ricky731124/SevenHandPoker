import { useState, useSyncExternalStore } from 'react'
import { getCanvas, subscribeCanvas } from '../../platform/canvas'
import { artUrl, currentTheme, heroMode } from '../theme/themes'
import './HeroArt.css'

/**
 * 滿版主圖(標題畫在圖上):大廳和開場頁共用,圖從目前主題讀(ui/theme/themes.ts)。
 * 畫面比任何手機全螢幕都寬時(手機網頁版橫拿)改用主題的寬版圖;主題沒有寬版圖就原圖置中、兩側模糊補。
 */
export default function HeroArt({ onLoad }: { onLoad?: () => void }) {
  const [ok, setOk] = useState(true)
  const theme = currentTheme()
  const c = useSyncExternalStore(subscribeCanvas, getCanvas)
  const mode = heroMode(c.w, c.h, theme)
  const art = mode === 'wide' && theme.wide ? theme.wide : theme.art
  if (!ok) {
    return (
      <div className="menu__hero-fallback">
        <h1 className="menu__fallback-title">Seven Hand Poker</h1>
      </div>
    )
  }
  return (
    <>
      {mode === 'boxed' && <img className="menu__hero-blur" src={artUrl(art)} alt="" aria-hidden />}
      <img
        className={`menu__hero is-${mode}`}
        src={artUrl(art)}
        alt="Seven Hand Poker"
        style={{ objectPosition: `center ${art.posY * 100}%` }}
        onLoad={onLoad}
        onError={() => {
          setOk(false)
          onLoad?.()
        }}
      />
    </>
  )
}
