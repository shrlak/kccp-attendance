import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { i18n } from '../../lib/i18n'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { AdminApp } from './AdminApp'

beforeAll(async () => { await i18n.init() })

// Kitchen-sink payload that satisfies every query the admin tabs fire on mount
// (config, roster, pending) — the rail behavior under test never reads it.
const apiStub = {
  announcement: '', checkinDays: [0], checkinStartMin: 780, checkinEndMin: 900,
  requireApproval: false, summerMode: false, demoMode: false, individualCheckinEnabled: false,
  role: 'super_admin', members: [], log: [], pending: [],
}

beforeEach(() => {
  queryClient.clear()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(apiStub), { status: 200 })))
  useAdminAuth.setState({
    status: 'authed',
    identity: { role: 'super_admin', group: '', subgroup: '', ministry: '' },
  })
})

function renderApp() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin']}>
        <AdminApp />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AdminApp nav rail', () => {
  it('starts collapsed and expands on hover', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    expect(aside.className).toContain('w-16')
    fireEvent.mouseEnter(aside)
    expect(aside.className).toContain('w-60')
  })

  it('collapses as soon as a tab is selected, and switches the tab', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    fireEvent.mouseEnter(aside)
    expect(aside.className).toContain('w-60')

    const sheetTab = screen.getByRole('button', { name: '출석부' })
    fireEvent.click(sheetTab)

    expect(aside.className).toContain('w-16') // collapsed immediately, pointer still inside
    expect(sheetTab).toHaveAttribute('aria-current', 'page')
  })

  it('re-expands on the next hover after a selection', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    fireEvent.mouseEnter(aside)
    fireEvent.click(screen.getByRole('button', { name: '멤버' }))
    expect(aside.className).toContain('w-16')

    fireEvent.mouseLeave(aside)
    fireEvent.mouseEnter(aside)
    expect(aside.className).toContain('w-60')
  })

  it('expands on keyboard focus and collapses when focus leaves', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    const todayTab = screen.getByRole('button', { name: '오늘' })
    fireEvent.focus(todayTab)
    expect(aside.className).toContain('w-60')
    fireEvent.blur(todayTab) // focus leaves the rail entirely (relatedTarget null)
    expect(aside.className).toContain('w-16')
  })
})
