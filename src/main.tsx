import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initPwa } from './platform/pwa'
import { initViewportVars } from './platform/viewport'
import './ui/theme/global.css'

// Point the button wood texture at the public asset (respects the Pages base path).
document.documentElement.style.setProperty('--wood-tex', `url("${import.meta.env.BASE_URL}wood.png")`)

// Track the real visible viewport size (--vvh/--vvw) for modal/overlay sizing on
// mobile web — dvh on fixed elements is unreliable on iOS Safari. Run before render.
initViewportVars()

// Capture the install prompt, track standalone, register the service worker.
initPwa()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
