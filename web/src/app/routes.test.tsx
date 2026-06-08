import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'
import { i18n } from '../lib/i18n'
import { AppRoutes } from './routes'

// Importing + awaiting i18n makes our custom instance react-i18next's default and
// guarantees it's ready, so useTranslation() resolves real strings (not keys).
beforeAll(async () => { await i18n.init() })
beforeEach(() => { queryClient.clear() })

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('routes', () => {
  it('renders the check-in screen at /', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      announcement: '', checkinDays: [0], checkinStartMin: 780, checkinEndMin: 900,
      requireApproval: false, summerMode: false, demoMode: false, individualCheckinEnabled: false,
    }), { status: 200 })))
    renderAt('/')
    expect(await screen.findByRole('button', { name: '체크인' })).toBeInTheDocument()
  })

  it('renders the admin placeholder at /admin', () => {
    renderAt('/admin')
    expect(screen.getByText(/admin/i)).toBeInTheDocument()
  })
})
