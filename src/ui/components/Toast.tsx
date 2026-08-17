import { motion } from 'framer-motion'
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
  return (
    <div className="toast-anchor">
      <motion.div
        className="toast"
        initial={{ y: -18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      >
        {message}
      </motion.div>
    </div>
  )
}
