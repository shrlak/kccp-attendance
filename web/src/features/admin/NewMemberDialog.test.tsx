import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import { NewMemberDialog } from './NewMemberDialog'
import { PASTORAL_CONSENT_TEXT } from './newFamilyCard'

// 손으로 옮겨 적는 새가족 등록 창 — **키오스크와 새가족 탭이 함께 쓴다**. 갈리는 것은
// 오늘 출석까지 찍는가 하나뿐이라(`checkinChoice`), 그 하나를 뺀 나머지는 두 자리에서
// 같은 화면이어야 한다.

vi.mock('../../lib/api', () => ({
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

describe('NewMemberDialog (새가족 등록)', () => {
  it('registers a new family member: 대학생 소속 → 대학부, no 동산, toasts success, closes', async () => {
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    const onClose = vi.fn()
    renderWithProviders(<NewMemberDialog open onClose={onClose} />)

    await userEvent.type(screen.getByLabelText('이름'), '새신자')
    await userEvent.click(screen.getByRole('button', { name: '대학생' }))
    await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

    expect(kioskNewMember).toHaveBeenCalledTimes(1)
    const payload = (kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload).toMatchObject({ name: '새신자', group: '대학부', subgroup: '' })
    // 등록일 is operator-editable and prefilled to today (YYYY-MM-DD), so it's sent.
    expect(payload.registrationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(await screen.findByText('새신자 새가족 등록 완료')).toBeInTheDocument()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it.each(['대학원생', '직장인', 'Other:'])('files a %s 소속 under 청년부', async (categoryButton) => {
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('이름'), '새신자')
    await userEvent.click(screen.getByRole('button', { name: categoryButton }))
    await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

    const payload = (kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload).toMatchObject({ group: '청년부', subgroup: '' })
  })

  it('shows no 부서/동산 pickers — the card is the whole form', () => {
    renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)
    expect(screen.queryByText('부서')).toBeNull()
    expect(screen.queryByText('동산')).toBeNull()
  })

  it('stamps 등록일 to the day they are added — shown fixed on the card, not editable', async () => {
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)

    // No 등록일 input on the blank card — the date is stamped, not typed.
    expect(screen.queryByLabelText('등록일')).toBeNull()

    await userEvent.type(screen.getByLabelText('이름'), '새신자')
    await userEvent.click(screen.getByRole('button', { name: '직장인' }))
    await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

    const payload = (kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.registrationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('card checkboxes enter data directly: 소속/세례/신앙생활/목회자 연락 동의 land in the payload', async () => {
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('이름'), '새신자')
    await userEvent.type(screen.getByLabelText('학교/전공 or 직장'), 'Pitt 컴퓨터공학')
    await userEvent.click(screen.getByRole('button', { name: '대학생' }))
    await userEvent.click(screen.getByRole('button', { name: /^세례 Baptism$/ }))
    await userEvent.click(screen.getByRole('button', { name: '1-3년' }))
    await userEvent.click(screen.getByRole('button', { name: PASTORAL_CONSENT_TEXT }))
    await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

    const payload = (kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload).toMatchObject({
      schoolOrWork: '대학생 · Pitt 컴퓨터공학',
      baptismStatus: '세례',
      faithDuration: '1-3년',
      pastoralVisitRequested: true,
      group: '대학부',
    })
  })

  it('blocks submission without a name and does not call the API', async () => {
    const { kioskNewMember } = await import('../../lib/api')
    renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

    expect(kioskNewMember).not.toHaveBeenCalled()
    expect(await screen.findByText('이름을 입력해주세요')).toBeInTheDocument()
  })

  // 필수는 이름과 소속 둘뿐이다: 소속 네모가 곧 부서라(대학생 → 대학부, 나머지 → 청년부)
  // 비었을 때 기본값으로 떨어뜨리면 그 사람이 틀린 명단에 조용히 앉는다.
  it('blocks submission without a 소속 and does not call the API', async () => {
    const { kioskNewMember } = await import('../../lib/api')
    renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('이름'), '무소속')
    await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

    expect(kioskNewMember).not.toHaveBeenCalled()
    expect(await screen.findByText(/소속을 선택해주세요/)).toBeInTheDocument()
  })

  // 그 둘만 채우면 나머지 칸은 비어 있어도 등록된다 — 빈 칸은 멤버 탭에서 채운다.
  it('registers with just a name + 소속, leaving every other field blank', async () => {
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('이름'), '무연락')
    await userEvent.click(screen.getByRole('button', { name: '직장인' }))
    await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

    await waitFor(() => expect(kioskNewMember).toHaveBeenCalled())
    expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      name: '무연락',
      group: '청년부',
      schoolOrWork: '직장인',
      phone: '',
      subgroup: '',
    })
  })
})

// ── 장년부: 필수 항목이 하나도 없다 ────────────────────────────────────────────────
// 그 부의 등록은 세대 카드를 받아 적는 자리라, 이름 한 칸이 비었다고 세대 전체를 명단에
// 못 올리면 잃는 것이 사람 하나로 끝나지 않는다. 그래서 이름조차 막지 않고, 카드 사진
// 등록과 같은 자리표를 넣는다 — 대신 무엇을 채웠는지 등록 전에 화면에 적어 준다.
describe('NewMemberDialog (장년부) — 필수 항목 없음', () => {
  async function asAdult() {
    const { useAdminAuth } = await import('../../stores/useAdminAuth')
    useAdminAuth.setState({
      status: 'authed',
      identity: { role: 'super_admin', group: '', subgroup: '', ministry: '', partition: 'adult' },
    })
    return useAdminAuth
  }

  it('빈 카드도 등록된다 — 이름은 자리표, 부서는 장년부', async () => {
    const useAdminAuth = await asAdult()
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    try {
      renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)

      // 아무 칸도 채우지 않고 바로 등록. 채워질 이름은 누르기 전에 화면에 적혀 있다.
      expect(screen.getByText(/이름이 비어 있어/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

      await waitFor(() => expect(kioskNewMember).toHaveBeenCalledTimes(1))
      const payload = (kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(payload.group).toBe('장년부')
      // 자리표에 시각이 붙는 이유는 유일성이다 — 서버의 중복 병합이 이름+부서로 사람을
      // 찾으므로, 자리표가 같으면 빈 카드 두 장이 한 줄로 합쳐진다.
      expect(payload.name).toMatch(/^이름 미기재 \d\d-\d\d \d\d:\d\d:\d\d$/)
      expect(screen.queryByText('이름을 입력해주세요')).toBeNull()
    } finally {
      useAdminAuth.setState({ status: 'idle', identity: null })
    }
  })

  // 종이에는 칸이 없는 사실(휠체어·통역·다음 주에 배우자와 함께 온다 …)을 적어 두는
  // 자리다. members.notes로 들어가므로 멤버 탭의 '메모'에서 그대로 이어 쓴다.
  it('카드 밑의 추가 정보가 메모로 실려 나간다', async () => {
    const useAdminAuth = await asAdult()
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    try {
      renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)

      await userEvent.type(screen.getByLabelText('이름'), '김장년')
      await userEvent.type(screen.getByLabelText('추가 정보'), '  휠체어로 오심  ')
      await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

      await waitFor(() => expect(kioskNewMember).toHaveBeenCalledTimes(1))
      expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        name: '김장년',
        notes: '휠체어로 오심',
      })
    } finally {
      useAdminAuth.setState({ status: 'idle', identity: null })
    }
  })

  it('이름을 적으면 그 이름으로 등록되고 자리표 안내도 사라진다', async () => {
    const useAdminAuth = await asAdult()
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    try {
      renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)

      await userEvent.type(screen.getByLabelText('이름'), '  김장년  ')
      expect(screen.queryByText(/이름이 비어 있어/)).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

      await waitFor(() => expect(kioskNewMember).toHaveBeenCalledTimes(1))
      expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
        name: '김장년',
        group: '장년부',
      })
    } finally {
      useAdminAuth.setState({ status: 'idle', identity: null })
    }
  })
})

// ── 새가족 탭에서 부를 때: 오늘 출석을 고른다 ──────────────────────────────────────
// 밀린 카드를 주중에 옮겨 적는 일이 있어서다 — 그때 오늘 출석이 함께 찍히면 오지 않은
// 주일에 사람이 선다. 카드 사진 등록이 이미 들고 있던 그 선택이고, 키오스크에는 없다.
describe('NewMemberDialog — checkinChoice (새가족 탭)', () => {
  it('키오스크에는 오늘 출석 스위치가 없다', () => {
    renderWithProviders(<NewMemberDialog open onClose={vi.fn()} />)
    expect(screen.queryByLabelText('오늘 출석 체크')).toBeNull()
    expect(screen.getByRole('button', { name: '등록 후 출석' })).toBeInTheDocument()
  })

  it('기본은 찍기 — 스위치를 그대로 두면 출석까지 찍는다', async () => {
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    renderWithProviders(<NewMemberDialog open checkinChoice onClose={vi.fn()} />)

    expect(screen.getByLabelText('오늘 출석 체크')).toBeChecked()
    await userEvent.type(screen.getByLabelText('이름'), '새신자')
    await userEvent.click(screen.getByRole('button', { name: '대학생' }))
    await userEvent.click(screen.getByRole('button', { name: '등록 후 출석' }))

    await waitFor(() => expect(kioskNewMember).toHaveBeenCalledTimes(1))
    const payload = (kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload).toMatchObject({ name: '새신자', group: '대학부' })
    expect(payload.skipCheckin).toBeUndefined()
  })

  it('끄면 등록만 한다 — 버튼의 말도 따라 바뀐다', async () => {
    const { kioskNewMember } = await import('../../lib/api')
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    renderWithProviders(<NewMemberDialog open checkinChoice onClose={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('이름'), '지난주새신자')
    await userEvent.click(screen.getByRole('button', { name: '직장인' }))
    await userEvent.click(screen.getByLabelText('오늘 출석 체크'))

    // 누르기 전에 무엇이 일어나는지가 버튼에 적혀 있다.
    expect(screen.queryByRole('button', { name: '등록 후 출석' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    await waitFor(() => expect(kioskNewMember).toHaveBeenCalledTimes(1))
    expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      name: '지난주새신자',
      group: '청년부',
      skipCheckin: true,
    })
  })
})
