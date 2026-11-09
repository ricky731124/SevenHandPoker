import { useLayoutEffect, useState, type RefObject } from 'react'
import { getCanvas, subscribeCanvas } from '../../platform/canvas'

/** 最多縮到多小;再小字會看不清楚 → 寧可留著捲軸。 */
const MIN = 0.72

/**
 * 彈窗放不下時整個等比縮小(docs/MOBILE-LANDSCAPE-SPEC.md §8.2)。
 * 矮的手機(360、384 高)很多彈窗原本要捲、按鈕被切一半 → 改成內容超過可用高度
 * (看得到的高度 × 0.92)就整塊縮到剛好放得下,放得下就是 1(跟以前一樣)。
 * framer-motion 擁有面板的 transform,所以回傳值要餵進它的 animate.scale;
 * 面板的 max-height 用 --fit 放大回去(見 Modal.css / Panel.css),縮完剛好 = 可用高度。
 */
export default function useFitHeight(ref: RefObject<HTMLElement | null>, active = true): number {
  const [fit, setFit] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const measure = () => {
      // 跟 CSS 的 max-height 同一個比例:矮螢幕(畫布高 ≤ 480)0.95、其他 0.92(Modal.css)
      const ratio = el.classList.contains('modal__panel') && getCanvas().h <= 480 ? 0.95 : 0.92
      const avail = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vvh')) || window.innerHeight) * ratio
      // 內容全高(被 max-height 夾住也量得到)+ 上下框線 + 面板裡捲動區(.panel__scroll)藏起來的高度
      const inner = el.querySelector<HTMLElement>('.panel__scroll')
      const natural = el.scrollHeight + (el.offsetHeight - el.clientHeight) + (inner ? inner.scrollHeight - inner.clientHeight : 0)
      const next = natural > avail + 1 ? Math.max(MIN, avail / natural) : 1
      setFit((cur) => (Math.abs(cur - next) < 0.005 ? cur : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    for (const c of el.children) ro.observe(c)
    ro.observe(el)
    const un = subscribeCanvas(measure)
    return () => { ro.disconnect(); un() }
  }, [ref, active])
  return fit
}
