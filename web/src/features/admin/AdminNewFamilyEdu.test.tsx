import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
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

const apiMocks = vi.hoisted(() => ({ assignEduDongsan: vi.fn() }))
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  getConfig: vi.fn().mockResolvedValue({ groupColors: {} }),
  assignEduDongsan: apiMocks.assignEduDongsan,
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

// 교육을 다 마친 사람이 목록에서 사라지면 '수강 완료'로 걸러도 아무도 안 나온다 — 정작 누가
// 이수했는지를 이 탭에서 볼 수 없었다. 그래서 이수는 더 이상 목록에서 사람을 내리지 않는다.
describe('AdminNewFamilyEdu — 수강 완료도 목록에 남는다', () => {
  const done = { ...member('m1', '이수완료'), new_member_edu_week1: true, new_member_edu_week2: true }
  // 지난 학기에 등록하고 두 주를 다 마친 사람 — 예전 규칙이라면 사라졌을 자리.
  const oldDone = {
    ...member('m2', '지난학기이수완료'),
    registration_date: '2026-01-05',
    new_member_edu_week1: true,
    new_member_edu_week2: true,
  }
  const none = member('m3', '교육전')

  it('교육을 마친 사람도 그대로 보인다 — 지난 학기 등록이어도', () => {
    renderAs('super_admin', [done, oldDone, none])

    expect(screen.getByText('이수완료')).toBeInTheDocument()
    expect(screen.getByText('지난학기이수완료')).toBeInTheDocument()
  })

  it("'수강 완료'로 걸러면 이수한 사람들이 나온다", async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderAs('super_admin', [done, oldDone, none])

    await userEvent.click(screen.getByRole('button', { name: '수강 완료' }))
    expect(screen.getByText('이수완료')).toBeInTheDocument()
    expect(screen.getByText('지난학기이수완료')).toBeInTheDocument()
    expect(screen.queryByText('교육전')).not.toBeInTheDocument()
  })
})

// 교육은 세 주일이 한 바퀴라(1주차 · 2주차 · 쉼) 그 주일에 여는 것이 몇 주차인지가 매주
// 바뀐다. 그 주차를 아직 안 들은 사람이 그 자리에 있어야 할 사람이므로, 목록도 그렇게
// 갈린다 — 미수강도, 다른 한 주차만 들은 사람도 함께 위로 올라온다.
describe('AdminNewFamilyEdu — 이번 주차를 들을 사람이 위로', () => {
  const none = member('m1', '아무것도안들음')
  const w1 = { ...member('m2', '일주차만'), new_member_edu_week1: true }
  const w2 = { ...member('m3', '이주차만'), new_member_edu_week2: true }
  const both = { ...member('m4', '수강완료'), new_member_edu_week1: true, new_member_edu_week2: true }
  const all = [none, w1, w2, both]

  // 'due' 블록에 실제로 담긴 이름들 — 머리줄 바로 다음 목록이 그 블록이다.
  const dueNames = (heading: HTMLElement) =>
    within(heading.nextElementSibling as HTMLElement)
      .getAllByRole('listitem')
      .map((li) => li.textContent)

  afterEach(() => vi.useRealTimers())

  const on = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${iso}T16:00:00Z`)) // 정오(Eastern)의 그 주일
  }

  it('1주차 주일에는 미수강과 2주차만 들은 사람이 대상이다', () => {
    on('2026-09-06')
    renderAs('super_admin', all)

    const heading = screen.getByText(/1주차 들을 사람/)
    expect(heading).toHaveTextContent('· 2')
    expect(dueNames(heading)).toEqual(expect.arrayContaining([expect.stringContaining('아무것도안들음'), expect.stringContaining('이주차만')]))
    expect(dueNames(heading)).toHaveLength(2)
  })

  it('2주차 주일에는 미수강과 1주차만 들은 사람이 대상이다', () => {
    on('2026-09-13')
    renderAs('super_admin', all)

    const heading = screen.getByText(/2주차 들을 사람/)
    expect(dueNames(heading)).toEqual(expect.arrayContaining([expect.stringContaining('아무것도안들음'), expect.stringContaining('일주차만')]))
    expect(dueNames(heading)).toHaveLength(2)
    // 이미 들은 사람도 사라지지 않는다 — 이수 기록을 고칠 자리이므로.
    expect(screen.getByText(/이미 들은 새가족/)).toHaveTextContent('· 2')
    expect(screen.getByText('이주차만')).toBeInTheDocument()
  })

  it('쉬는 주일에는 다음에 열리는 교육을 가리킨다', () => {
    on('2026-09-20')
    renderAs('super_admin', all)

    expect(screen.getByText('다음 교육')).toBeInTheDocument()
    expect(screen.getByText(/1주차 들을 사람/)).toBeInTheDocument()
  })

  it('일정이 끝난 뒤에는 가르지 않고 그 사실을 적는다', () => {
    on('2027-01-03')
    renderAs('super_admin', all)

    expect(screen.getByText('예정된 새가족 교육이 없습니다')).toBeInTheDocument()
    expect(screen.queryByText(/들을 사람/)).not.toBeInTheDocument()
    expect(screen.getByText('아무것도안들음')).toBeInTheDocument()
    expect(screen.getByText('수강완료')).toBeInTheDocument()
  })
})

// 교육 동산 배정: 카드에서 사람을 고르고 → 오른쪽 위 버튼으로 조를 나눈다. 부서를 넘지
// 않는 것이 이 기능의 전부라, 테스트도 거기에 걸려 있다.
describe('AdminNewFamilyEdu — 새가족 교육 동산 배정', () => {
  const people = [
    { ...member('m1', '대학하나'), group_name: '대학부' },
    { ...member('m2', '대학둘'), group_name: '대학부' },
    { ...member('m3', '청년하나'), group_name: '청년부' },
    { ...member('m4', '청년둘'), group_name: '청년부' },
  ]

  it('전체 선택으로 고르고, 고른 수가 보인다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderAs('super_admin', people)

    await userEvent.click(screen.getByRole('button', { name: '전체 선택' }))
    expect(screen.getByText('4명 선택')).toBeInTheDocument()
    // 다시 누르면 풀린다 (같은 버튼이 '선택 해제'로 바뀐다).
    await userEvent.click(screen.getByRole('button', { name: '선택 해제' }))
    expect(screen.queryByText('4명 선택')).not.toBeInTheDocument()
  })

  it('고른 사람만, 부서 안에서만 나눈다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    apiMocks.assignEduDongsan.mockResolvedValue({ status: 'ok', updated: 3 })
    renderAs('super_admin', people)

    // 대학부 둘 + 청년부 하나만 고른다.
    await userEvent.click(screen.getByRole('button', { name: '대학하나 선택' }))
    await userEvent.click(screen.getByRole('button', { name: '대학둘 선택' }))
    await userEvent.click(screen.getByRole('button', { name: '청년하나 선택' }))

    await userEvent.click(screen.getByRole('button', { name: '동산 배정' }))
    // 미리보기는 부서마다 한 줄 — 대학부 2명 → 1·1, 청년부 1명 → 1·0.
    expect(screen.getByText('2명 → 1 · 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '무작위 배정' }))

    const sent = apiMocks.assignEduDongsan.mock.calls.at(-1)![0] as { memberId: string; dongsan: string }[]
    const byId = new Map(sent.map((a) => [a.memberId, a.dongsan]))
    expect([...byId.keys()].sort()).toEqual(['m1', 'm2', 'm3']) // 고르지 않은 청년둘은 빠진다
    expect(byId.get('m1')!.startsWith('대학부 ')).toBe(true)
    expect(byId.get('m2')!.startsWith('대학부 ')).toBe(true)
    expect(byId.get('m3')).toBe('청년부 1동산')
    // 2동산(기본값)으로 나눴으므로 대학부 둘은 서로 다른 조다.
    expect(byId.get('m1')).not.toBe(byId.get('m2'))
  })

  it('이미 배정된 조는 조별 명단으로 한자리에 모인다', () => {
    renderAs('super_admin', [
      { ...people[0], new_member_dongsan: '대학부 1동산' },
      { ...people[1], new_member_dongsan: '대학부 1동산' },
      { ...people[2], new_member_dongsan: '청년부 1동산' },
    ])

    expect(screen.getByText('이번 교육 동산')).toBeInTheDocument()
    expect(screen.getByText('대학둘 · 대학하나')).toBeInTheDocument() // 이름순
    // 조 이름은 명단 블록과 카드 배지 양쪽에 나온다.
    expect(screen.getAllByText('청년부 1동산').length).toBeGreaterThan(1)
  })
})
