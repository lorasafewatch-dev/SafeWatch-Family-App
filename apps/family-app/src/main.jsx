import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

// Safari can allow page pinch-zoom even with a fixed viewport scale.
const preventPageZoom = event => event.preventDefault()
document.addEventListener('gesturestart', preventPageZoom, { passive: false })
document.addEventListener('gesturechange', preventPageZoom, { passive: false })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Reload the running app when its updated offline worker activates. The default
// injected registration installs updates but leaves already-loaded JS running.
registerSW({ immediate: true })
