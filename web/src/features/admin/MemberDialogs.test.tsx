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

describe('EditModal — 새가족 등록 카드 view', () => {
  it("renders the paper-card replica with all of the member's card info", () => {
    const filled = {
      ...member,
      gender: '남',
      phone: '412-555-0142',
      kakao_id: 'gil_dong',
      birth_date: '2004-03-15',
      registration_date: '2026-07-05',
      baptism_status: '세례',
      school_or_work: '대학생 · Pitt 컴퓨터공학',
      faith_duration: '1-3년',
      pastoral_visit_requested: true,
    } as unknown as Member
    renderWithProviders(<EditModal member={filled} onClose={vi.fn()} onAttendance={vi.fn()} />)

    expect(screen.getByText('< KCCP 빛주사랑 대학청년부 - 새가족 등록 카드 >')).toBeInTheDocument()
    // Every card field is shown: phone, kakao, dates (MM / DD / YYYY), affiliation
    // detail, and the checkbox options (세례/신앙생활/심방 O·X).
    expect(screen.getByText('412-555-0142')).toBeInTheDocument()
    expect(screen.getByText('gil_dong')).toBeInTheDocument()
    expect(screen.getByText('03 / 15 / 2004')).toBeInTheDocument()
    expect(screen.getByText('07 / 05 / 2026')).toBeInTheDocument()
    expect(screen.getByText('Pitt 컴퓨터공학')).toBeInTheDocument()
    expect(screen.getByText('유아세례')).toBeInTheDocument()
    expect(screen.getByText('모태신앙')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '카드 다운로드 (JPG)' })).toBeInTheDocument()
  })
})

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
