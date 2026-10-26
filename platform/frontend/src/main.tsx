import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './interaction.css'
import App from './App'
import { clearLegacyTokens } from './auth/token-store'
import { InteractionHost } from './components/Interaction'
import PageErrorBoundary from './components/PageErrorBoundary'

clearLegacyTokens()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PageErrorBoundary><App /></PageErrorBoundary>
      <InteractionHost />
    </BrowserRouter>
  </StrictMode>,
)
