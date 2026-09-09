import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
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
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  deleteMembers: vi.fn(),
}))

// Build the fixture through the app's own split, so 숨긴 멤버 tests exercise the real rule
// rather than a hand-written hiddenMembers list.
const roster = (members: Member[], over: Partial<RosterResponse> = {}): RosterData =>
  splitRoster({
    role: 'super_admin',
    canBulkSubgroup: true,
    canClearAttendance: true,
    members,
    log: [],
    ...over,
  } as unknown as RosterResponse)

import { deleteMembers } from '../../lib/api'
import { AdminMembers } from './AdminMembers'

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
      expect.arrayContaining([expect.stringContaining('여러 명 선택'), expect.stringContaining('병합')]),
    )
  })

  it('동산 이동을 켜면 이동 줄도 같은 고정 영역 안으로 들어온다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    rosterData.data = roster([member('m1', '김호연'), member('m2', '이하늘')])
    const { container } = renderWithProviders(<AdminMembers />)

    await userEvent.click(screen.getByRole('button', { name: /여러 명 선택/ }))
    const bar = container.querySelector('.sticky')!
    expect(bar.textContent).toContain('선택')
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('이 동산으로'), expect.stringContaining('동산에서 빼기')]),
    )
  })
})

// 새가족팀(kccpwelcome)도 동산 배정을 한다 — 새로 온 사람을 등록하고 어느 동산으로 보낼지까지
// 챙기는 자리라, 등록만 해 두고 최고관리자에게 매번 부탁하게 두지 않는다. 서버의
// canAssignDongsan이 그 자격을 내려주고(canBulkSubgroup), 화면은 그 값만 읽는다.
describe('AdminMembers — 동산 배정 권한', () => {
  it('새가족팀 로그인에도 동산 이동 줄이 나온다', async () => {
    rosterData.data = roster([member('m1', '김호연'), member('m2', '이하늘')], {
      role: 'welcoming',
      canBulkSubgroup: true,
    })
    renderWithProviders(<AdminMembers />)

    await userEvent.click(screen.getByRole('button', { name: /여러 명 선택/ }))
    expect(screen.getByRole('button', { name: /이 동산으로/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /동산에서 빼기/ })).toBeInTheDocument()
  })

  it('배정 자격이 없으면(동산지기 리더 등) 이동 줄 없이 선택만 된다', async () => {
    rosterData.data = roster([member('m1', '김호연'), member('m2', '이하늘')], {
      role: 'leader',
      canBulkSubgroup: false,
    })
    renderWithProviders(<AdminMembers />)

    await userEvent.click(screen.getByRole('button', { name: /여러 명 선택/ }))
    expect(screen.queryByRole('button', { name: /이 동산으로/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /동산에서 빼기/ })).not.toBeInTheDocument()
  })
})

describe('AdminMembers — 여러 명 삭제', () => {
  it('숨긴 멤버를 펼쳐 선택하면 일반 멤버와 함께 삭제한다', async () => {
    ;(deleteMembers as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', deleted: 2 })
    const today = easternNow().date
    rosterData.data = roster([
      member('m1', '김호연'),
      member('m2', '졸업한멤버', {
        status_marks: [{ note: '졸업', start: addIsoDays(today, -10), end: null }],
      }),
    ])
    renderWithProviders(<AdminMembers />)

    await userEvent.click(screen.getByRole('button', { name: /여러 명 선택/ }))
    await userEvent.click(screen.getByRole('button', { name: /김호연/ }))
    await userEvent.click(screen.getByRole('button', { name: /숨긴 멤버/ }))
    await userEvent.click(screen.getByRole('button', { name: /졸업한멤버/ }))

    expect(screen.getByText('2명 선택')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '선택 삭제' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('김호연')
    expect(dialog).toHaveTextContent('졸업한멤버')
    expect(dialog).toHaveTextContent('기존 출석 기록은 남아 있습니다')

    await userEvent.click(screen.getByRole('button', { name: '2명 삭제' }))
    await waitFor(() => expect(deleteMembers).toHaveBeenCalledWith(['m1', 'm2']))
  })

  it('confirms the selected names, keeps attendance records, and deletes them together', async () => {
    ;(deleteMembers as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', deleted: 2 })
    rosterData.data = roster([
      member('m1', '김호연'),
      member('m2', '이하늘'),
      member('m3', '박사랑'),
    ])
    renderWithProviders(<AdminMembers />)

    await userEvent.click(screen.getByRole('button', { name: /여러 명 선택/ }))
    await userEvent.click(screen.getByRole('button', { name: /김호연/ }))
    await userEvent.click(screen.getByRole('button', { name: /이하늘/ }))
    await userEvent.click(screen.getByRole('button', { name: '선택 삭제' }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('김호연')
    expect(dialog).toHaveTextContent('이하늘')
    expect(dialog).toHaveTextContent('기존 출석 기록은 남아 있습니다')

    await userEvent.click(screen.getByRole('button', { name: '2명 삭제' }))
    await waitFor(() => expect(deleteMembers).toHaveBeenCalledWith(['m1', 'm2']))
    expect(await screen.findByText('2명이 삭제되었습니다')).toBeInTheDocument()
  })
})

// 부서 칩 — 아래 섹션 머리줄이 이미 부서를 가르지만 그것은 **함께** 놓고 보는 자리라,
// 한 부서만 훑으려면 다른 부서를 지나 내려가야 했다.
describe('AdminMembers — 부서 칩', () => {
  const people = [
    member('c1', '김대학'),
    member('y1', '이청년', { group_name: '청년부' }),
    member('n1', '박무소속', { group_name: '' }),
  ]
  const chips = () => within(screen.getByRole('group', { name: '부서' }))

  it('부서를 고르면 그 부서 사람만 남는다', async () => {
    rosterData.data = roster(people)
    renderWithProviders(<AdminMembers />)
    await userEvent.click(chips().getByRole('button', { name: '청년부' }))
    expect(screen.getByText('이청년')).toBeInTheDocument()
    expect(screen.queryByText('김대학')).toBeNull()
    expect(screen.queryByText('박무소속')).toBeNull()
    // 전체로 되돌리면 다시 다 보인다 — 고른 것을 무를 자리가 있어야 한다.
    await userEvent.click(chips().getByRole('button', { name: '전체' }))
    expect(screen.getByText('김대학')).toBeInTheDocument()
  })

  it('부서가 비어 있는 사람도 자기 칩이 있다 — 칩을 다 더하면 전체가 된다', async () => {
    rosterData.data = roster(people)
    renderWithProviders(<AdminMembers />)
    await userEvent.click(chips().getByRole('button', { name: '부서 미기재' }))
    expect(screen.getByText('박무소속')).toBeInTheDocument()
    expect(screen.queryByText('김대학')).toBeNull()
  })

  it('부서가 하나뿐인 부(장년부)에서는 칩 줄이 없다', () => {
    rosterData.data = roster([member('a', '김장년', { group_name: '장년부' })])
    renderWithProviders(<AdminMembers />)
    expect(screen.queryByRole('group', { name: '부서' })).toBeNull()
  })
})

// 부서마다 명단을 가르는 축이 다르다 — 대학부는 학교로, 청년부는 처지로 갈라 보고 그 안에서
// 대학원생만 다시 학교로 간다.
describe('AdminMembers — 부서마다 다른 축', () => {
  const people = [
    member('c1', '대학씨엠', { school_or_work: '대학생 · CMU Math' }),
    member('c2', '대학듀크', { school_or_work: '대학생 · Duquesne nursing' }),
    member('y1', '청년원생씨엠', { group_name: '청년부', school_or_work: '대학원생 · CMU 기계공학' }),
    member('y2', '청년원생듀크', { group_name: '청년부', school_or_work: '대학원생 · 듀케인 음악' }),
    member('y3', '청년직장', { group_name: '청년부', school_or_work: '직장인 · 발레댄서' }),
  ]
  const row = (name: string) => within(screen.getByRole('group', { name }))

  it('대학부는 학교로 갈린다 — CMU · Pitt · Duquesne · 기타', async () => {
    rosterData.data = roster(people)
    renderWithProviders(<AdminMembers />)
    await userEvent.click(row('부서').getByRole('button', { name: '대학부' }))
    await userEvent.click(row('학교').getByRole('button', { name: 'Duquesne' }))
    expect(screen.getByText('대학듀크')).toBeInTheDocument()
    expect(screen.queryByText('대학씨엠')).toBeNull()
    // 처지는 대학부의 축이 아니다.
    expect(screen.queryByRole('group', { name: '학생/직장' })).toBeNull()
  })

  it('청년부는 처지와 학교 두 줄을 함께 내걸고, 대학원생을 고르면 학교가 그 사람들의 것으로 좁혀진다', async () => {
    rosterData.data = roster(people)
    renderWithProviders(<AdminMembers />)
    await userEvent.click(row('부서').getByRole('button', { name: '청년부' }))
    // 두 줄이 함께 선다 — 청년부를 고르는 순간 학교 줄이 사라지면 "이 부서는 학교로 못
    // 가른다"로 읽힌다 (실제로는 한 번 더 눌러야 나오는 것이었다).
    expect(screen.getByRole('group', { name: '학생/직장' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '학교' })).toBeInTheDocument()

    await userEvent.click(row('학생/직장').getByRole('button', { name: '대학원생' }))
    expect(screen.queryByText('청년직장')).toBeNull()
    await userEvent.click(row('학교').getByRole('button', { name: 'Duquesne' }))
    expect(screen.getByText('청년원생듀크')).toBeInTheDocument()
    expect(screen.queryByText('청년원생씨엠')).toBeNull()

    // 직장인으로 옮기면 학교 줄과 그 선택이 함께 걷힌다 — 사라진 칩으로 계속 좁히고 있으면
    // 화면이 왜 비었는지 알 수가 없다.
    await userEvent.click(row('학생/직장').getByRole('button', { name: '직장인' }))
    expect(screen.queryByRole('group', { name: '학교' })).toBeNull()
    expect(screen.getByText('청년직장')).toBeInTheDocument()
  })

  it('부서를 바꾸면 그 아래 줄의 선택은 처음으로 돌아간다', async () => {
    rosterData.data = roster(people)
    renderWithProviders(<AdminMembers />)
    await userEvent.click(row('부서').getByRole('button', { name: '청년부' }))
    await userEvent.click(row('학생/직장').getByRole('button', { name: '직장인' }))
    await userEvent.click(row('부서').getByRole('button', { name: '대학부' }))
    expect(screen.getByText('대학씨엠')).toBeInTheDocument()
    expect(screen.getByText('대학듀크')).toBeInTheDocument()
  })
})

// 학교 칩 — **이 탭에만 있다.** 명단을 CMU/Pitt으로 갈라 보는 자리는 멤버 탭 하나이고,
// 출석부·통계·오늘에는 이 줄이 없다 (그쪽이 세는 것은 그 주일에 누가 왔는가다).
describe('AdminMembers — 학교 칩', () => {
  const people = [
    member('c1', '김씨엠', { school_or_work: '대학생 · CMU Math' }),
    member('c2', '이씨엠', { group_name: '청년부', school_or_work: '대학원생 · 씨엠유 기계공학' }),
    member('p1', '박핏', { school_or_work: '대학생 · UPitt nursing' }),
    member('x1', '정미상', { school_or_work: '' }),
  ]

  it('CMU를 고르면 그 학교 사람만 남는다 — 한글로 적힌 이름도 같이', async () => {
    rosterData.data = roster(people)
    renderWithProviders(<AdminMembers />)
    await userEvent.click(screen.getByRole('button', { name: 'CMU' }))
    expect(screen.getByText('김씨엠')).toBeInTheDocument()
    expect(screen.getByText('이씨엠')).toBeInTheDocument()
    expect(screen.queryByText('박핏')).toBeNull()
    expect(screen.queryByText('정미상')).toBeNull()
  })

  it('학교를 읽어낼 수 없는 사람도 자기 칩이 있다 — 세 칩을 더하면 전체가 된다', async () => {
    rosterData.data = roster(people)
    renderWithProviders(<AdminMembers />)
    await userEvent.click(screen.getByRole('button', { name: '기타' }))
    expect(screen.getByText('정미상')).toBeInTheDocument()
    expect(screen.queryByText('김씨엠')).toBeNull()
  })

  it('아무도 학교를 적지 않은 부에서는 칩 줄이 없다 (장년부)', () => {
    rosterData.data = roster([member('a', '김장년', { group_name: '장년부', school_or_work: '' })])
    renderWithProviders(<AdminMembers />)
    expect(screen.queryByRole('button', { name: 'CMU' })).toBeNull()
    expect(screen.queryByRole('group', { name: '학교' })).toBeNull()
  })
})
