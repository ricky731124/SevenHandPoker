/**
 * 主題:開場頁和大廳共用的背景圖 + 特效(docs/MOBILE-LANDSCAPE-SPEC.md 改動 B)。
 * 這次只有預設主題(= 現在的大廳背景 + 咖啡廳特效)。之後做節慶主題、或用鑽石買背景 + 下雪/煙火,
 * 只要在 THEMES 加一筆、讓 currentTheme() 選到它,開場頁和大廳會一起換,不用改畫面程式。
 */

/** 圖上的一個點(原圖的像素座標)。特效以圖為準定位,畫面拉寬、縮放都不會跑掉。 */
export type ArtPoint = readonly [x: number, y: number]

/** 特效要用的位置:貓、麻雀頭上冒符號的地方;蓋著的牌堆(可以點來抽牌);Logo 火焰中心;吊燈燈泡 */
export interface ArtAnchors {
  cat: ArtPoint
  bird: ArtPoint
  deck: ArtPoint
  /** 牌堆本體的框(x, y, 寬, 高):外圍發亮 + 點了抽牌的範圍 */
  deckBox: readonly [x: number, y: number, w: number, h: number]
  fire: ArtPoint
  lamps: readonly ArtPoint[]
  /** Logo 掃光:Logo 所在的框(原圖座標 x, y, 寬, 高)+ 跟框一樣大的遮罩圖(public/ 底下;白光只掃過字和籌碼) */
  logo: { box: readonly [x: number, y: number, w: number, h: number]; mask: string }
}

export interface Art {
  /** public/ 底下的檔名(標題已經畫在圖上) */
  src: string
  /** 原始寬高 */
  w: number
  h: number
  /** object-position 的垂直位置(0~1) */
  posY: number
  anchors: ArtAnchors
}

export interface Theme {
  id: string
  /** 一般畫面用的圖(手機全螢幕、電腦) */
  art: Art
  /** 畫面寬於 WIDE_ASPECT 時(只有手機網頁版會)改用的寬版圖;沒有就用 art 置中 + 兩側模糊補 */
  wide?: Art
  /** 開場頁 + 大廳的特效;null = 沒有。'cafe' = 貓鳥互動、牌堆發亮 + 點了抽牌、Logo 火焰 + 掃光、吊燈光暈、飄浮光點(ui/components/HeroFx.tsx) */
  fx: 'cafe' | null
}

/** 比這個寬(只有手機網頁版橫拿會)就換寬版圖 */
export const WIDE_ASPECT = 2.25

export const THEMES: Record<string, Theme> = {
  default: {
    id: 'default',
    art: {
      src: 'title.webp',
      w: 1315,
      h: 628,
      posY: 0.42,
      anchors: {
        cat: [250, 200],
        bird: [1045, 205],
        deck: [280, 462],
        deckBox: [234, 440, 88, 64],
        fire: [665, 48],
        lamps: [[1040, 100]],
        logo: { box: [390, 70, 555, 222], mask: 'fx/logo-mask.webp' },
      },
    },
    // 用 Gemini 往兩側延伸的版本(art/lobby/title-wide2.png 放大到 Logo 跟原圖一樣大)。
    // 中間是重畫的,貓、麻雀、牌桌的位置跟原圖不完全一樣 → 特效位置另外一套。
    wide: {
      src: 'title-wide.webp',
      w: 1760,
      h: 628,
      posY: 0.5,
      anchors: {
        cat: [530, 268],
        bird: [1228, 262],
        deck: [555, 535],
        deckBox: [514, 510, 81, 62],
        fire: [890, 45],
        lamps: [[218, 108], [1238, 152], [1745, 100]],
        logo: { box: [612, 78, 558, 220], mask: 'fx/logo-mask-wide.webp' },
      },
    },
    fx: 'cafe',
  },
}

export function currentTheme(): Theme {
  return THEMES.default
}

export type HeroMode = 'normal' | 'wide' | 'boxed'

/** 這個畫面大小要用哪張圖、怎麼放:normal = 一般;wide = 寬版圖;boxed = 沒有寬版圖,原圖置中 + 兩側模糊。 */
export function heroMode(w: number, h: number, t: Theme = currentTheme()): HeroMode {
  if (w / h < WIDE_ASPECT) return 'normal'
  return t.wide ? 'wide' : 'boxed'
}

export const artUrl = (a: Art): string => `${import.meta.env.BASE_URL}${a.src}`

/**
 * 背景圖實際畫在哪裡(畫布座標) + 用的是哪張圖。規則要跟 HeroArt.css 一致:
 * object-fit: cover;boxed 時圖框只有 WIDE_ASPECT 倍高、置中。
 */
export function artRect(w: number, h: number, t: Theme = currentTheme()): { art: Art; x: number; y: number; w: number; h: number } {
  const mode = heroMode(w, h, t)
  const art = mode === 'wide' && t.wide ? t.wide : t.art
  const boxW = mode === 'boxed' ? WIDE_ASPECT * h : w
  const boxX = (w - boxW) / 2
  const s = Math.max(boxW / art.w, h / art.h)
  const dw = art.w * s
  const dh = art.h * s
  return { art, x: boxX + (boxW - dw) / 2, y: (h - dh) * art.posY, w: dw, h: dh }
}
