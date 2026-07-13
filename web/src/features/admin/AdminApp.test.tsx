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

describe('AdminApp ministry navigation', () => {
  it('keeps the ministry navigation visible and marks Today as current', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    expect(aside.className).toContain('md:w-[248px]')
    expect(screen.getByRole('button', { name: '오늘' })).toHaveAttribute('aria-current', 'page')
  })

  it('switches tabs without changing the persistent navigation', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    const sheetTab = screen.getByRole('button', { name: '출석부' })
    fireEvent.click(sheetTab)
    expect(aside.className).toContain('md:w-[248px]')
    expect(sheetTab).toHaveAttribute('aria-current', 'page')
  })

  it('uses one horizontally scrollable nav that also works on smaller screens', () => {
    const { container } = renderApp()
    const nav = container.querySelector('nav')!
    expect(nav.className).toContain('overflow-x-auto')
    fireEvent.click(screen.getByRole('button', { name: '멤버' }))
    expect(screen.getByRole('button', { name: '멤버' })).toHaveAttribute('aria-current', 'page')
  })

  it('staff (break-glass 운영진) sees operational tabs but not super-only ones', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'staff', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    // 리더+새가족팀 combined: day-to-day tabs + kiosk are available.
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    // super-only tabs (admins/dongsan/settings) stay hidden.
    for (const name of ['관리자', '동산', '설정']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // Header shows the 운영진 role label.
    expect(screen.getAllByText(/운영진 · 전체/).length).toBeGreaterThan(0)
  })

  it('break-glass super password lands on the full panel (super-only tabs visible)', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'super_admin', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자', '관리자', '동산', '설정']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('break-glass leader password lands on the 리더 dashboard (all-roster, no super tabs)', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'leader', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    for (const name of ['관리자', '동산', '설정']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // Role label + "전체" scope (a group-less break-glass leader sees everyone).
    expect(screen.getAllByText(/리더 · 전체/).length).toBeGreaterThan(0)
  })

  it('break-glass welcoming password lands on the 새가족팀 dashboard', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'welcoming', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    for (const name of ['관리자', '동산', '설정']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.getAllByText(/새가족팀 · 전체/).length).toBeGreaterThan(0)
  })
})
