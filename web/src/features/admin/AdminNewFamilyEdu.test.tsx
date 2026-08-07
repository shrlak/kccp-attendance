import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import type { Member, RosterResponse } from '../../lib/api'
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

// 이름 목록은 super_admin 전용 엔드포인트다. 다른 역할이면 403이 나므로 이 mock은 호출
// 자체가 일어나면 안 되는 것을 검증하는 데도 쓰인다.
const getNewMemberDongsanNames = vi.fn().mockResolvedValue({ 대학부: [], 청년부: [] })
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  getConfig: vi.fn().mockResolvedValue({ groupColors: {} }),
  getNewMemberDongsanNames: () => getNewMemberDongsanNames(),
  updateNewMemberDongsanNames: vi.fn().mockResolvedValue({ status: 'ok' }),
}))

import { AdminNewFamilyEdu } from './AdminNewFamilyEdu'

beforeAll(async () => { await i18n.init() })

const member = (id: string, name: string): Member => ({
  id, name, group_name: '청년부', subgroup: '', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: true, notes: '', registration_date: '2026-08-09',
})

function renderAs(role: string) {
  rosterData.data = splitRoster({
    role, canBulkSubgroup: true, canClearAttendance: true,
    members: [member('m1', '새가족하나')], log: [],
  } as unknown as RosterResponse)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider><AdminNewFamilyEdu /></ToastProvider>
    </QueryClientProvider>,
  )
}

// 서버가 읽기·쓰기 모두 super_admin으로 막고 있어서, 다른 역할에게 이 버튼은 눌러도
// 아무 일이 일어나지 않는 죽은 컨트롤이었다 (403 → 데이터가 안 오고 → 다이얼로그가
// 영영 안 열림). 권한이 없으면 버튼 자체를 내린다.
describe('AdminNewFamilyEdu — 새가족 교육 동산 이름 설정 버튼', () => {
  it('super_admin에게는 보이고, 누르면 편집 다이얼로그가 열린다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderAs('super_admin')

    const btn = screen.getByRole('button', { name: /새가족 교육 동산 이름/ })
    await userEvent.click(btn)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it.each(['welcoming', 'leader', 'pastor', 'staff'])('%s 에게는 버튼을 아예 보여주지 않는다', (role) => {
    renderAs(role)
    expect(screen.queryByRole('button', { name: /새가족 교육 동산 이름/ })).not.toBeInTheDocument()
  })

  it('권한이 없으면 super_admin 전용 목록을 요청하지도 않는다', () => {
    getNewMemberDongsanNames.mockClear()
    renderAs('welcoming')
    expect(getNewMemberDongsanNames).not.toHaveBeenCalled()
  })
})
