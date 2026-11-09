// 在頁面裡跑的自動檢查(page.evaluate):超出畫面、互相重疊、被 overflow:hidden 切掉。
// 只看「看得到的」:元素上取幾個點用 elementFromPoint 測,全被別的圖層蓋住(彈窗底下的大廳、
// 回放底下的選單)就不算;部分露出來的照算 → 橫幅蓋到按鈕這種真問題抓得到。
// 文字換行的行內元素逐行量(getClientRects),不會因為整塊外框而誤報。
// 元素標 data-layout-ok 可略過(刻意疊在一起的徽章之類)。
export function pageChecks() {
  const W = innerWidth
  const H = innerHeight
  const label = (el) => {
    const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 18)
    const c = typeof el.className === 'string' ? el.className.split(' ')[0] : ''
    return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${t ? `「${t}」` : ''}`
  }
  const shown = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
      if (e.hasAttribute('data-layout-ok') || e.getAttribute('aria-hidden') === 'true') return false
    }
    return true
  }
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
  /** 取 5 個點(中心+四角內縮),任一點最上層是自己(或自己裡面的東西)→ 看得到。 */
  const onTop = (el, r) => {
    const pts = [
      [0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8],
    ]
    return pts.some(([fx, fy]) => {
      const x = r.left + r.width * fx
      const y = r.top + r.height * fy
      if (x < 0 || y < 0 || x >= W || y >= H) return false
      const hit = document.elementFromPoint(x, y)
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el))
    })
  }
  const all = [...document.body.querySelectorAll('*')].filter((el) => {
    const tag = el.tagName
    const interactive = tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.getAttribute('role') === 'button'
    return (interactive || ownText(el)) && shown(el)
  })
  // 捲軸區裡的東西只算露出來的那一截(捲到一半、被裁到框外的訊息不算跟框外的標題重疊)
  const clipTo = (rect, c) => {
    if (!c) return rect
    const left = Math.max(rect.left, c.left), top = Math.max(rect.top, c.top)
    const right = Math.min(rect.right, c.right), bottom = Math.min(rect.bottom, c.bottom)
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
  }
  const scrollBox = (el) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) return e.getBoundingClientRect()
    }
    return null
  }
  const items = all
    .map((el) => {
      const c = scrollBox(el)
      return { el, r: el.getBoundingClientRect(), lines: [...el.getClientRects()].map((x) => clipTo(x, c)) }
    })
    .filter(({ r }) => r.width > 2 && r.height > 2)
  // 超出畫面的不用 onTop(本來就測不到);其餘只留看得到的
  const visible = items.filter(({ el, r }) => onTop(el, r))

  const offscreen = []
  for (const { el, r } of items) {
    const out = Math.max(0, -r.left, -r.top, r.right - W, r.bottom - H)
    if (out > 2 && !inScroller(el) && !coveredLayer(el, r)) offscreen.push(`${label(el)} 超出 ${Math.round(out)}px`)
  }

  const overlaps = []
  const btn = (e) => e.closest('button,[role=button]')
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i]
      const b = visible[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      // 同一顆按鈕裡的圖示和字之類:共同祖先是按鈕 → 不算
      if (btn(a.el) && btn(a.el) === btn(b.el)) continue
      let best = null
      for (const ra of a.lines) {
        for (const rb of b.lines) {
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
          const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
          if (w <= 5 || h <= 5) continue
          const small = Math.min(ra.width * ra.height, rb.width * rb.height)
          if ((w * h) / small < 0.15) continue
          if (!best || w * h > best.w * best.h) best = { w, h }
        }
      }
      if (best) overlaps.push(`${label(a.el)} ↔ ${label(b.el)}(${Math.round(best.w)}×${Math.round(best.h)})`)
    }
  }

  const clipped = []
  for (const { el, r } of visible) {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowY === 'auto' || cs.overflowY === 'scroll') break
      if (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowY === 'hidden' || cs.overflow === 'clip') {
        const p = e.getBoundingClientRect()
        const cut = Math.max(p.left - r.left, p.top - r.top, r.right - p.right, r.bottom - p.bottom)
        if (cut > 3 && p.width > 0) clipped.push(`${label(el)} 被 ${label(e)} 切掉 ${Math.round(cut)}px`)
        break
      }
    }
  }

  function inScroller(el) {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) return true
    }
    return false
  }
  /** 超出畫面的元素:它在畫面內的那一截被別的圖層蓋住 → 是底層的東西,不報。 */
  function coveredLayer(el, r) {
    const x0 = Math.max(0, r.left), x1 = Math.min(W, r.right)
    const y0 = Math.max(0, r.top), y1 = Math.min(H, r.bottom)
    if (x1 - x0 < 2 || y1 - y0 < 2) return false // 整個在畫面外 → 照報
    return !onTop(el, { left: x0, top: y0, width: x1 - x0, height: y1 - y0 })
  }

  const uniq = (xs) => [...new Set(xs)].slice(0, 40)
  return { offscreen: uniq(offscreen), overlaps: uniq(overlaps), clipped: uniq(clipped) }
}
