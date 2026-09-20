import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './app/App'
import './styles.css'

// No StrictMode: dog mode owns the camera, fullscreen and wake lock, and must mount exactly once.
registerSW({ immediate: true })
createRoot(document.getElementById('root')!).render(<App />)
