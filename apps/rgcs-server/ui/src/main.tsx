import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/components.css'
import './styles/app.css'
import { App } from './app/App'
import { authStore } from './features/auth/store'
import { setUnauthorizedHandler } from './shared/api/client'

setUnauthorizedHandler(() => authStore.setAnon())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
