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
  it('renders the KCCP landing at / (kiosk-first: branded page, no check-in button)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      announcement: '공지 테스트', checkinDays: [0], checkinStartMin: 780, checkinEndMin: 900,
      requireApproval: false, summerMode: false, demoMode: false, individualCheckinEnabled: false,
    }), { status: 200 })))
    renderAt('/')
    expect(await screen.findByRole('link', { name: '교회 키오스크 시작' })).toBeInTheDocument()
    // The hero heading is a live clock (Pittsburgh time), not a slogan.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/\d{1,2}:\d{2}/)
    expect(screen.queryByRole('button', { name: '체크인' })).not.toBeInTheDocument()
    expect(screen.queryByText('지금은 출석 시간이 아닙니다')).not.toBeInTheDocument()
    // Announcement only shows when individual check-in is on.
    expect(screen.queryByText('공지 테스트')).not.toBeInTheDocument()
  })

  it('surfaces the check-in button at / when individual check-in is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      announcement: '공지 테스트', checkinDays: [0], checkinStartMin: 780, checkinEndMin: 900,
      requireApproval: false, summerMode: false, demoMode: false, individualCheckinEnabled: true,
    }), { status: 200 })))
    renderAt('/')
    expect(await screen.findByRole('button', { name: '체크인' })).toBeInTheDocument()
    expect(screen.getByText('공지 테스트')).toBeInTheDocument()
  })

  it('renders the admin login gate at /admin', () => {
    renderAt('/admin')
    expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeInTheDocument()
  })

  it('gates /kiosk behind the kiosk login gate when not authed (password + Google)', () => {
    renderAt('/kiosk')
    expect(screen.getByLabelText('키오스크 비밀번호')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '키오스크 시작' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeInTheDocument()
  })

  it('renders the 404 page for an unknown path', () => {
    renderAt('/does-not-exist')
    expect(screen.getByText('Error · 404')).toBeInTheDocument()
  })
})
