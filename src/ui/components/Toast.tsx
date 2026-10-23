import { motion } from 'framer-motion'
import { createPortal } from 'react-dom'
import { useToastStore } from '../../state/toastStore'
import './Toast.css'

/** Top-center transient message (login/logout feedback). Enter-only animation. */
export default function Toast() {
  const message = useToastStore((s) => s.message)
  if (!message) return null
  // The anchor owns the fixed top-center positioning (translateX(-50%)); the
  // inner motion element only animates y/opacity. Keeping them separate stops
  // framer-motion's transform from clobbering the centering translate (which
  // made the toast drift off to the right).
  //
  // Portal 到 <body>,跟彈窗(Modal 也是 portal 到 body)在同一層比 z-index:
  // 手機直放時 #root 整個轉 90 度(transform)→ 自成一個圖層,留在 #root 裡的提示 z-index 再高
  // 也只在 #root 裡面算,會被 body 底下的彈窗蓋住還被模糊(例:特殊卡選單裡死神之眼「不能用」看不到)。
  return createPortal(
    <div className="toast-anchor">
      <motion.div
        className="toast"
        initial={{ y: -18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      >
        {message}
      </motion.div>
    </div>,
    document.body,
  )
}
