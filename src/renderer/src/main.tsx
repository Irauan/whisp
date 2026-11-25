import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { AetherBridge } from '../../shared/bridge'
import { App } from './App'
import './styles.css'

declare global {
  interface Window {
    aether: AetherBridge
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('The page has no root element.')
document.documentElement.dataset.platform = window.aether.platform

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
