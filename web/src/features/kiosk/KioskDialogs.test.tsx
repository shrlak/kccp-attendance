import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import { KioskGuestDialog } from './KioskGuestDialog'
import { KioskNewMemberDialog } from './KioskNewMemberDialog'

vi.mock('../../lib/api', () => ({
  guestCheckin: vi.fn(),
  kioskNewMember: vi.fn(),
}))

beforeAll(async () => { await i18n.init() })
beforeEach(() => { vi.clearAllMocks() })

function renderWithProviders(ui: React.ReactElement) {
  // A fresh QueryClient per test so invalidateQueries is a no-op against an empty cache.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  )
}

describe('KioskGuestDialog (방문자 체크인)', () => {
  it('checks in a guest: calls guestCheckin with the trimmed name, toasts success, closes', async () => {
    const { guestCheckin } = await import('../../lib/api')
    ;(guestCheckin as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', time: '12:00', name: '김방문' })
    const onClose = vi.fn()
    renderWithProviders(<KioskGuestDialog open onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('방문자 이름'), '  김방문  ')
    await userEvent.click(screen.getByRole('button', { name: '체크인' }))

    expect(guestCheckin).toHaveBeenCalledWith('김방문')
    expect(await screen.findByText('김방문 체크인되었습니다')).toBeInTheDocument()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows the "already" warning when the guest is already checked in', async () => {
    const { guestCheckin } = await import('../../lib/api')
    ;(guestCheckin as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'already', name: '박방문' })
    renderWithProviders(<KioskGuestDialog open onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('방문자 이름'), '박방문')
    await userEvent.click(screen.getByRole('button', { name: '체크인' }))

    expect(await screen.findByText('박방문 님은 이미 체크인했습니다')).toBeInTheDocument()
  })

  it('does not call the API for an empty name (submit disabled)', async () => {
    const { guestCheckin } = await import('../../lib/api')
    renderWithProviders(<KioskGuestDialog open onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: '체크인' })).toBeDisabled()
    expect(guestCheckin).not.toHaveBeenCalled()
  })

  it('keeps the dialog open and surfaces the real error message when the API rejects', async () => {
    const { guestCheckin } = await import('../../lib/api')
    ;(guestCheckin as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not authorized'))
    const onClose = vi.fn()
    renderWithProviders(<KioskGuestDialog open onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('방문자 이름'), '오류방문')
    await userEvent.click(screen.getByRole('button', { name: '체크인' }))

    // The actual failure reason is shown (not a generic "연결 오류"), so a broken
    // kiosk is diagnosable on-screen.
    expect(await screen.findByText('Not authorized')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('KioskNewMemberDialog (새가족 등록)', () => {
  it('registers a new family member: sends name + group (+defaults), toasts success, closes', async () => {
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    const onClose = vi.fn()
    renderWithProviders(<KioskNewMemberDialog open onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('이름'), '새신자')
    await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

    expect(kioskNewMember).toHaveBeenCalledTimes(1)
    const payload = (kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload).toMatchObject({ name: '새신자', group: '대학부' })
    // 등록일자 is stamped server-side with the add date — the kiosk never sends it.
    expect(payload).not.toHaveProperty('registrationDate')
    expect(await screen.findByText('새신자 새가족 등록 완료')).toBeInTheDocument()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('blocks submission without a name and does not call the API', async () => {
    const { kioskNewMember } = await import('../../lib/api')
    renderWithProviders(<KioskNewMemberDialog open onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

    expect(kioskNewMember).not.toHaveBeenCalled()
    expect(await screen.findByText('이름과 부서를 입력해주세요')).toBeInTheDocument()
  })
})
