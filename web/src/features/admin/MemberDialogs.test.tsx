import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import { EditModal } from './MemberDialogs'
import type { Member } from '../../lib/api'

vi.mock('../../lib/api', () => ({
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
  addMemberAttendance: vi.fn(),
  removeAttendance: vi.fn(),
}))

beforeAll(async () => { await i18n.init() })
beforeEach(() => { vi.clearAllMocks() })

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  )
}

const member = {
  id: 'm1',
  name: '홍길동',
  group_name: '대학부',
  subgroup: '1동산',
  member_role: '',
  is_new_member: false,
  gender: '',
  phone: '',
  kakao_id: '',
  birth_date: '',
  notes: '',
} as unknown as Member

describe('EditModal — member delete', () => {
  it('hides the delete control unless allowDelete is set', () => {
    renderWithProviders(<EditModal member={member} onClose={vi.fn()} onAttendance={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '멤버 삭제' })).toBeNull()
  })

  it('requires confirmation, then deletes the member, toasts, and closes', async () => {
    const { deleteMember } = await import('../../lib/api')
    ;(deleteMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok' })
    const onClose = vi.fn()
    renderWithProviders(<EditModal member={member} allowDelete onClose={onClose} onAttendance={vi.fn()} />)

    // First click only reveals the irreversible confirm — no API call yet.
    await userEvent.click(screen.getByRole('button', { name: '멤버 삭제' }))
    expect(deleteMember).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '삭제' }))
    expect(deleteMember).toHaveBeenCalledWith('m1')
    expect(await screen.findByText('홍길동 님이 삭제되었습니다')).toBeInTheDocument()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
