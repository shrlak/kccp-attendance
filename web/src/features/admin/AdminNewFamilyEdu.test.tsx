import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import { easternNow } from '../../lib/checkinWindow'
import type { LogEntry, Member, RosterResponse } from '../../lib/api'
import { splitRoster, type RosterData } from './useRoster'

const rosterData: { data: RosterData | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
}
vi.mock('./useRoster', async (orig) => ({
  ...(await orig<typeof import('./useRoster')>()),
  useRoster: () => rosterData,
}))

// 새가족 교육 동산 이름 목록. 이 탭은 이제 그것을 다루지 않으므로, 이 mock은 **부르지
// 않는다는 것**을 검증하는 데 쓰인다 (그 목록은 동산 탭이 맡는다).
const getNewMemberDongsanNames = vi.fn().mockResolvedValue({ 대학부: [], 청년부: [] })
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  getConfig: vi.fn().mockResolvedValue({ groupColors: {} }),
  getNewMemberDongsanNames: () => getNewMemberDongsanNames(),
  updateNewMemberDongsanNames: vi.fn().mockResolvedValue({ status: 'ok' }),
}))

import { AdminNewFamilyEdu } from './AdminNewFamilyEdu'

beforeAll(async () => { await i18n.init() })

const today = easternNow().date

const member = (id: string, name: string): Member => ({
  id, name, group_name: '청년부', subgroup: '', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: true, notes: '', registration_date: today,
})

const row = (m: Member): LogEntry => ({
  memberId: m.id, name: m.name, group: m.group_name, subgroup: m.subgroup,
  date: today, time: '10:00', ts: 1, firstVisit: false,
})

function renderAs(role: string, members: Member[] = [member('m1', '새가족하나')], log: LogEntry[] = []) {
  rosterData.data = splitRoster({
    role, canBulkSubgroup: true, canClearAttendance: true, members, log,
  } as unknown as RosterResponse)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider><AdminNewFamilyEdu /></ToastProvider>
    </QueryClientProvider>,
  )
}

// 이 탭은 교육 진도만 본다. 배정 칸도, 이름 목록 편집기도, 그것으로 거르는 필터도 없다 —
// 이름은 동산 탭에서 정하고, 사람에게 붙이는 일은 멤버 편집 창이 맡는다.
describe('AdminNewFamilyEdu — 새가족 교육 동산은 이 탭에 없다', () => {
  it('배정 칸도 이름 설정 버튼도 없고, super_admin이어도 그 목록을 묻지 않는다', () => {
    getNewMemberDongsanNames.mockClear()
    renderAs('super_admin')

    expect(screen.queryByRole('button', { name: /새가족 교육 동산 이름/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('새가족 교육 동산')).not.toBeInTheDocument()
    // 목록을 아예 부르지 않는다 — 화면에 쓸 곳이 없으므로.
    expect(getNewMemberDongsanNames).not.toHaveBeenCalled()
  })
})

// 새가족 교육은 주일에 그 자리에 있는 사람과 하는 일이라, "오늘 누가 와 있나"가 먼저다.
describe('AdminNewFamilyEdu — 오늘 출석으로 가르기', () => {
  const here = member('m1', '오늘온새가족')
  const away = member('m2', '오늘안온새가족')

  it('칩에 오늘 온 사람 수와 안 온 사람 수를 적는다', () => {
    renderAs('super_admin', [here, away], [row(here)])

    expect(screen.getByRole('button', { name: '오늘 출석 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '오늘 미출석 1' })).toBeInTheDocument()
  })

  it('오늘 출석을 고르면 온 사람만, 미출석을 고르면 안 온 사람만 남는다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderAs('super_admin', [here, away], [row(here)])

    // 처음에는 둘 다 보인다.
    expect(screen.getByText('오늘온새가족')).toBeInTheDocument()
    expect(screen.getByText('오늘안온새가족')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '오늘 출석 1' }))
    expect(screen.getByText('오늘온새가족')).toBeInTheDocument()
    expect(screen.queryByText('오늘안온새가족')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '오늘 미출석 1' }))
    expect(screen.queryByText('오늘온새가족')).not.toBeInTheDocument()
    expect(screen.getByText('오늘안온새가족')).toBeInTheDocument()
  })

  it('오늘 온 사람의 카드에 표가 붙는다 — 칩과 같은 기준이라 목록을 좁히지 않아도 보인다', () => {
    renderAs('super_admin', [here, away], [row(here)])

    expect(screen.getByText('오늘온새가족').closest('li')).toHaveTextContent('오늘 출석')
    expect(screen.getByText('오늘안온새가족').closest('li')).not.toHaveTextContent('오늘 출석')
  })
})
