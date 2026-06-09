import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { I18nextProvider } from 'react-i18next'
import { i18n } from './lib/i18n'
import './stores/useTheme'
import { queryClient } from './lib/queryClient'
import { AppRoutes } from './app/routes'

registerSW({ immediate: true })

// Match the Vite base (GitHub Project Pages subpath) so client routes resolve under
// /kccp-attendance/ instead of the domain root. BASE_URL is '/' in dev → basename '/'.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <BrowserRouter basename={basename}>
          <AppRoutes />
        </BrowserRouter>
      </I18nextProvider>
    </QueryClientProvider>
  </StrictMode>,
)
