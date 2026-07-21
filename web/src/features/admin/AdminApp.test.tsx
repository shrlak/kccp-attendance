import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { i18n } from '../../lib/i18n'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { AdminApp } from './AdminApp'

beforeAll(async () => { await i18n.init() })

// Kitchen-sink payload that satisfies every query the admin tabs fire on mount
// (config, roster) — the rail behavior under test never reads it.
const apiStub = {
  announcement: '', summerMode: false,
  role: 'super_admin', members: [], log: [],
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
  it('starts as a compact 64 px rail and expands on hover', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    expect(aside.className).toContain('w-16')
    fireEvent.mouseEnter(aside)
    expect(aside.className).toContain('w-60')
  })

  it('switches tabs and returns the rail to its compact state', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    fireEvent.mouseEnter(aside)
    const sheetTab = within(aside).getByRole('button', { name: '출석부' })
    fireEvent.click(sheetTab)
    expect(aside.className).toContain('w-16')
    expect(sheetTab).toHaveAttribute('aria-current', 'page')
  })

  it('expands for keyboard focus and collapses when focus leaves', () => {
    const { container } = renderApp()
    const aside = container.querySelector('aside')!
    const todayTab = within(aside).getByRole('button', { name: '오늘' })
    fireEvent.focus(todayTab)
    expect(aside.className).toContain('w-60')
    fireEvent.blur(todayTab)
    expect(aside.className).toContain('w-16')
  })

  it('mobile bottom bar: 4 everyday tabs + 더보기 sheet holding the rest', () => {
    renderApp()
    const bottom = screen.getByRole('navigation', { name: '빠른 이동' })
    for (const name of ['오늘', '출석부', '멤버', '통계', '더보기']) {
      expect(within(bottom).getByRole('button', { name })).toBeInTheDocument()
    }
    // Overflow tabs are not in the bar, only inside the 더보기 sheet.
    expect(within(bottom).queryByRole('button', { name: '설정' })).toBeNull()
    fireEvent.click(within(bottom).getByRole('button', { name: '더보기' }))
    const sheet = screen.getByRole('dialog')
    for (const name of ['새가족', '방문자', '관리자', '동산', '설정']) {
      expect(within(sheet).getByRole('button', { name })).toBeInTheDocument()
    }
    // Selecting a tab from the sheet closes it and marks 더보기 as the active area.
    fireEvent.click(within(sheet).getByRole('button', { name: '설정' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(bottom).getByRole('button', { name: '더보기' })).toHaveAttribute('aria-current', 'page')
  })

  it('staff (break-glass 운영진) sees operational tabs but not super-only ones', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'staff', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    const rail = screen.getByRole('navigation', { name: '관리자 페이지' })
    // 리더+새가족팀 combined: day-to-day tabs + kiosk are available.
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
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
    const rail = screen.getByRole('navigation', { name: '관리자 페이지' })
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자', '관리자', '동산', '설정']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('break-glass leader password lands on the 리더 dashboard (all-roster, no super tabs)', () => {
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'leader', group: '', subgroup: '', ministry: '' },
    })
    renderApp()
    const rail = screen.getByRole('navigation', { name: '관리자 페이지' })
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
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
    const rail = screen.getByRole('navigation', { name: '관리자 페이지' })
    for (const name of ['오늘', '출석부', '멤버', '통계', '새가족', '방문자']) {
      expect(within(rail).getByRole('button', { name })).toBeInTheDocument()
    }
    for (const name of ['관리자', '동산', '설정']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.getAllByText(/새가족팀 · 전체/).length).toBeGreaterThan(0)
  })
})
