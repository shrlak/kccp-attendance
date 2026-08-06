import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import { easternNow } from '../../lib/checkinWindow'
import { addIsoDays } from '../../lib/semester'
import { worshipSunday } from './newFamily'
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

// Build the fixture through the app's own split, so 숨긴 멤버 tests exercise the real rule
// rather than a hand-written hiddenMembers list.
const roster = (members: Member[]): RosterData =>
  splitRoster({
    role: 'super_admin',
    canBulkSubgroup: true,
    canClearAttendance: true,
    members,
    log: [],
  } as unknown as RosterResponse)

import { AdminMembers } from './AdminMembers'

beforeAll(async () => { await i18n.init() })

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  )
}

const member = (id: string, name: string, extra: Partial<Member> = {}): Member => ({
  id, name, group_name: '대학부', subgroup: '1동산', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: false, notes: '', ...extra,
})

describe('AdminMembers — 새가족 등록 주차 색 구분', () => {
  it('shows the same 이번 주일 / 지난주 chips as the 새가족 tab, and the plain badge for older newcomers', () => {
    // Anchor on the 주일 the component itself computes so the cohorts hold on any weekday.
    const sunday = worshipSunday(easternNow().date)
    rosterData.data = roster([
      member('m1', '이번주새신자', { is_new_member: true, registration_date: sunday }),
      member('m2', '지난주새신자', { is_new_member: true, registration_date: addIsoDays(sunday, -7) }),
      member('m3', '오래된새신자', { is_new_member: true, registration_date: addIsoDays(sunday, -35) }),
      member('m4', '일반멤버'),
    ])

    renderWithProviders(<AdminMembers />)

    expect(screen.getByText('이번주새신자').closest('button')).toHaveTextContent('이번 주일 등록')
    expect(screen.getByText('지난주새신자').closest('button')).toHaveTextContent('지난주 등록')
    // Older newcomers keep the plain 새가족 badge instead of a week chip.
    const older = screen.getByText('오래된새신자').closest('button')
    expect(older).toHaveTextContent('새가족')
    expect(older).not.toHaveTextContent('등록')
    expect(screen.getByText('일반멤버').closest('button')).not.toHaveTextContent('새가족')
  })
})

describe('AdminMembers — 숨긴 멤버', () => {
  const today = easternNow().date

  function renderRoster() {
    rosterData.data = roster([
      member('m1', '계속나오는멤버'),
      member('m2', '귀국한멤버', { status_marks: [{ note: '한국 귀국', start: addIsoDays(today, -30), end: null }] }),
      member('m3', '졸업한멤버', { status_marks: [{ note: '졸업', start: addIsoDays(today, -10), end: null }] }),
      member('m4', '이주한멤버', { status_note: '이주', status_start: addIsoDays(today, -5), status_end: null }),
      member('m5', '방학중인멤버', { status_marks: [{ note: '방학', start: addIsoDays(today, -3), end: addIsoDays(today, 20) }] }),
      member('m6', '타교회정착멤버', { status_marks: [{ note: '타교회 정착', start: addIsoDays(today, -20), end: null }] }),
    ])
    return renderWithProviders(<AdminMembers />)
  }

  it('무기한 표기(졸업·타교회 정착·귀국·이주) 멤버를 명단에서 내리고, 기간이 정해진 방학은 그대로 둔다', () => {
    renderRoster()
    // 부서 섹션의 카드에는 남아 있으면 안 된다 (숨김 섹션은 접혀 있으므로 화면에 없다).
    expect(screen.queryByText('귀국한멤버')).not.toBeInTheDocument()
    expect(screen.queryByText('졸업한멤버')).not.toBeInTheDocument()
    expect(screen.queryByText('이주한멤버')).not.toBeInTheDocument()
    expect(screen.getByText('계속나오는멤버')).toBeInTheDocument()
    expect(screen.getByText('방학중인멤버')).toBeInTheDocument() // 종료일이 있으면 그대로
    // 문구와 상관없이 종료일 없는(무기한) 표기는 숨긴다.
    expect(screen.queryByText('타교회정착멤버')).not.toBeInTheDocument()
    // 부서 헤더의 인원수도 보이는 멤버만 센다.
    expect(screen.getByRole('heading', { name: /대학부/ })).toHaveTextContent('2')
  })

  it('맨 밑 "숨긴 멤버"를 펼치면 표기와 함께 보이고, 눌러서 편집할 수 있다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderRoster()

    const toggle = screen.getByRole('button', { name: /숨긴 멤버/ })
    expect(toggle).toHaveTextContent('4')
    await userEvent.click(toggle)

    for (const [name, note] of [['귀국한멤버', '한국 귀국'], ['졸업한멤버', '졸업'], ['이주한멤버', '이주'], ['타교회정착멤버', '타교회 정착']]) {
      expect(screen.getByText(name).closest('button')).toHaveTextContent(note)
    }
    // 카드를 누르면 편집 다이얼로그가 열려 표기를 풀 수 있다.
    await userEvent.click(screen.getByText('졸업한멤버'))
    expect(await screen.findByText('상태 표기 추가')).toBeInTheDocument()
  })
})

// 검색·동산 이동·병합은 명단을 한참 내려가도 손이 닿아야 한다 — 아래에서 사람을 고르다가
// 옮기려고 매번 맨 위로 되돌아가지 않도록 패널 헤더 밑에 붙어 있다.
describe('AdminMembers — 상단 도구줄 고정', () => {
  it('검색·동산 이동·병합이 헤더 밑에 붙어서 스크롤을 따라온다', () => {
    rosterData.data = roster([member('m1', '김호연'), member('m2', '이하늘')])
    const { container } = renderWithProviders(<AdminMembers />)

    const bar = container.querySelector('.sticky')
    expect(bar).toBeTruthy()
    // 헤더 높이만큼 내려 붙는다 (AdminApp이 --admin-header-h로 실측값을 publish한다).
    expect(bar!.className).toContain('top-[var(--admin-header-h,4.5rem)]')
    // 카드가 이 줄 뒤로 지나가므로 배경이 비치면 안 된다.
    expect(bar!.className).toContain('bg-canvas')
    // 세 컨트롤이 모두 그 안에 들어 있어야 같이 따라온다.
    expect(bar!.querySelector('input[placeholder]')).toBeTruthy()
    expect([...bar!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('동산 이동'), expect.stringContaining('병합')]),
    )
  })

  it('동산 이동을 켜면 이동 줄도 같은 고정 영역 안으로 들어온다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    rosterData.data = roster([member('m1', '김호연'), member('m2', '이하늘')])
    const { container } = renderWithProviders(<AdminMembers />)

    await userEvent.click(screen.getByRole('button', { name: /동산 이동/ }))
    const bar = container.querySelector('.sticky')!
    expect(bar.textContent).toContain('선택')
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('이 동산으로'), expect.stringContaining('동산에서 빼기')]),
    )
  })
})
