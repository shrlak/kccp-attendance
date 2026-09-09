import { render, screen, within, fireEvent } from '@testing-library/react'
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

const apiMocks = vi.hoisted(() => ({ assignEduDongsan: vi.fn(), clearAllEduDongsan: vi.fn() }))
vi.mock('../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../lib/api')>()),
  getConfig: vi.fn().mockResolvedValue({ groupColors: {} }),
  assignEduDongsan: apiMocks.assignEduDongsan,
  clearAllEduDongsan: apiMocks.clearAllEduDongsan,
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

  it('교육이 안 끝난 사람은 어느 주일이든 모두 위로 올라온다', () => {
    on('2026-09-06') // 1주차 주일
    renderAs('super_admin', all)

    const heading = screen.getByText(/아직 교육이 남은 사람/)
    expect(heading).toHaveTextContent('· 3')
    // 미수강 · 2주차만(오늘 것이 비었다) + 1주차만(오늘 것은 들었지만 나머지가 남았다)
    expect(dueNames(heading)).toHaveLength(3)
    expect(dueNames(heading).join(' ')).toContain('아무것도안들음')
    expect(dueNames(heading).join(' ')).toContain('이주차만')
    expect(dueNames(heading).join(' ')).toContain('일주차만')
    // 두 주를 다 마친 사람만 아래로 내려간다 — 사라지지는 않는다 (이수 기록을 고칠 자리).
    expect(screen.getByText(/수강 완료 ·/)).toHaveTextContent('· 1')
    expect(screen.getByText('수강완료')).toBeInTheDocument()
  })

  it('2주차 주일에도 같다 — 2주차만 들은 사람이 그대로 남는다', () => {
    on('2026-09-13')
    renderAs('super_admin', all)

    const heading = screen.getByText(/아직 교육이 남은 사람/)
    expect(dueNames(heading)).toHaveLength(3)
    expect(dueNames(heading).join(' ')).toContain('이주차만')
  })

  it('그 블록 안에서는 오늘 여는 주차가 비어 있는 사람이 먼저다', () => {
    on('2026-09-13') // 2주차 — 2주차가 비어 있는 미수강·1주차만이 앞
    renderAs('super_admin', all)

    const order = dueNames(screen.getByText(/아직 교육이 남은 사람/))
    expect(order[2]).toContain('이주차만') // 오늘 것은 이미 들은 사람이 맨 뒤
  })

  it('쉬는 주일에는 다음에 열리는 교육을 가리킨다', () => {
    on('2026-09-20')
    renderAs('super_admin', all)

    expect(screen.getByText('다음 교육')).toBeInTheDocument()
    expect(screen.getByText(/아직 교육이 남은 사람/)).toBeInTheDocument()
  })

  it('일정이 끝난 뒤에는 가르지 않고 그 사실을 적는다', () => {
    on('2027-01-03')
    renderAs('super_admin', all)

    expect(screen.getByText('예정된 새가족 교육이 없습니다')).toBeInTheDocument()
    expect(screen.queryByText(/아직 교육이 남은 사람/)).not.toBeInTheDocument()
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
    // 미리보기가 곧 결과다 — 부서 × 교육 단계 한 줄이 조 하나. 셋 다 미수강이므로 두 줄.
    expect(screen.getByText('대학부 미수강')).toBeInTheDocument()
    expect(screen.getByText('청년부 미수강')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '무작위 배정' }))

    const sent = apiMocks.assignEduDongsan.mock.calls.at(-1)![0] as { memberId: string; dongsan: string }[]
    const byId = new Map(sent.map((a) => [a.memberId, a.dongsan]))
    expect([...byId.keys()].sort()).toEqual(['m1', 'm2', 'm3']) // 고르지 않은 청년둘은 빠진다
    // 부서를 넘지 않고, 같은 부서·같은 단계면 한 조다. 이름은 번호이고 번호는 배정 전체에서
    // 이어진다 — 대학부 미수강이 1조, 청년부 미수강이 2조.
    expect(byId.get('m1')).toBe('1조')
    expect(byId.get('m2')).toBe('1조')
    expect(byId.get('m3')).toBe('2조')
  })

  it('이미 배정된 조는 조별 명단으로 한자리에 모인다', () => {
    renderAs('super_admin', [
      { ...people[0], new_member_dongsan: '1조' },
      { ...people[1], new_member_dongsan: '1조' },
      { ...people[2], new_member_dongsan: '2조' },
    ])

    expect(screen.getByText('이번 교육 동산')).toBeInTheDocument()
    // 이름은 조 카드 안에 이름표 하나씩 앉는다 (누르면 옮길 수 있는 버튼).
    expect(screen.getByRole('button', { name: '대학하나' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '대학둘' })).toBeInTheDocument()
    // 조 이름은 명단 블록과 카드 배지 양쪽에 나온다.
    expect(screen.getAllByText('2조').length).toBeGreaterThan(1)
    // 이름이 번호뿐이라 그 조가 어느 부서 어느 단계인지는 카드가 적어 준다.
    expect(screen.getByText('대학부 · 미수강')).toBeInTheDocument()
    expect(screen.getByText('청년부 · 미수강')).toBeInTheDocument()
  })
})

// 배정 해제는 고른 사람만 지운다. 화면이 모르는 사람(표시가 내려갔거나 필터 밖)에게 남아
// 있는 값은 그 길로는 닿지 않으므로, 조별 명단 위에 '전체 초기화'를 둔다.
describe('AdminNewFamilyEdu — 교육 동산 전체 초기화', () => {
  const assigned = [
    { ...member('m1', '배정된하나'), group_name: '대학부', new_member_dongsan: '1조' },
    { ...member('m2', '배정된둘'), group_name: '대학부', new_member_dongsan: '1조' },
  ]

  it('조별 명단 위의 버튼으로 전부 지운다 — 확인을 한 번 거친다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    apiMocks.clearAllEduDongsan.mockResolvedValue({ status: 'ok', updated: 5 })
    renderAs('super_admin', assigned)

    await userEvent.click(screen.getByRole('button', { name: '전체 초기화' }))
    // 바로 지우지 않는다 — 화면 밖 사람까지 지워지는 일이라 무엇이 지워지는지 먼저 적는다.
    expect(apiMocks.clearAllEduDongsan).not.toHaveBeenCalled()
    expect(screen.getByText(/화면에 보이는 2명/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '모두 지우기' }))
    expect(apiMocks.clearAllEduDongsan).toHaveBeenCalledTimes(1)
  })

  it('목사(읽기 전용)에게는 버튼이 없다', () => {
    renderAs('pastor', assigned)
    expect(screen.getByText('이번 교육 동산')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '전체 초기화' })).not.toBeInTheDocument()
  })
})

// 기준이 뽑아 준 배치가 늘 맞는 것은 아니라(친한 사람 둘, 늦게 온 한 사람) 손으로 고칠
// 자리가 있어야 한다 — 조마다 카드 하나, 그 안의 이름을 눌러 다른 조로 옮긴다.
describe('AdminNewFamilyEdu — 조 갯수와 사람 옮기기', () => {
  const boarded = [
    { ...member('m1', '가나'), group_name: '대학부', new_member_dongsan: '1조' },
    { ...member('m2', '다라'), group_name: '대학부', new_member_dongsan: '2조' },
    { ...member('m3', '마바'), group_name: '청년부', new_member_dongsan: '3조' },
  ]

  it('조 갯수를 고르면 미리보기가 그만큼 갈린다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderAs('super_admin', [
      { ...member('a', '하나'), group_name: '대학부' },
      { ...member('b', '둘'), group_name: '대학부' },
      { ...member('c', '셋'), group_name: '대학부' },
      { ...member('d', '넷'), group_name: '대학부' },
    ])

    await userEvent.click(screen.getByRole('button', { name: '전체 선택' }))
    await userEvent.click(screen.getByRole('button', { name: '동산 배정' }))
    // 기본값 1 — 단계 하나가 곧 조 하나라 나눗셈을 적을 것이 없다 (인원이 곧 그 조다).
    expect(screen.getByText(/4명\s*→\s*1조$/)).toBeInTheDocument()

    // 한 묶음(대학부 미수강)뿐이라 적은 수가 곧 그 묶음의 조 수다.
    expect(screen.getByText(/1~4조로 나눌 수 있습니다/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('조 갯수'), { target: { value: '2' } })
    expect(screen.getByText(/4명\s*→\s*1조 2 · 2조 2/)).toBeInTheDocument()
  })

  it('묶음보다 적게 적으면 칸이 최소 조 갯수로 당겨진다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderAs('super_admin', [
      { ...member('a', '대학하나'), group_name: '대학부' },
      { ...member('b', '대학둘'), group_name: '대학부' },
      { ...member('c', '청년하나'), group_name: '청년부' },
      { ...member('d', '청년둘'), group_name: '청년부' },
    ])

    await userEvent.click(screen.getByRole('button', { name: '전체 선택' }))
    await userEvent.click(screen.getByRole('button', { name: '동산 배정' }))
    const input = screen.getByLabelText('조 갯수') as HTMLInputElement
    // 두 부서 = 두 묶음이라 1조로는 나눌 수 없다 — 칸에도 당겨진 값이 그대로 보인다.
    fireEvent.change(input, { target: { value: '1' } })
    expect(input.value).toBe('2')
    expect(screen.getByText(/2~4조로 나눌 수 있습니다/)).toBeInTheDocument()
    // 인원보다 많이 적어도 마찬가지 — 한 조에 한 명씩이 끝이다.
    fireEvent.change(input, { target: { value: '9' } })
    expect(input.value).toBe('4')
  })

  it('이름을 누르면 같은 부서의 다른 조로만 옮길 수 있다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    apiMocks.assignEduDongsan.mockResolvedValue({ status: 'ok', updated: 1 })
    renderAs('super_admin', boarded)

    await userEvent.click(screen.getByRole('button', { name: '가나' }))
    // 같은 부서의 다른 조만 보인다 — 청년부 조(3조)는 고를 수 없다 (부서를 넘지 않는다).
    expect(screen.getByRole('button', { name: '2조' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '3조' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '2조' }))
    expect(apiMocks.assignEduDongsan).toHaveBeenLastCalledWith([{ memberId: 'm1', dongsan: '2조' }])
  })

  it('그 자리에서 배정을 해제할 수도 있다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    apiMocks.assignEduDongsan.mockResolvedValue({ status: 'ok', updated: 1 })
    renderAs('super_admin', boarded)

    await userEvent.click(screen.getByRole('button', { name: '마바' }))
    await userEvent.click(screen.getByRole('button', { name: '배정 해제' }))
    expect(apiMocks.assignEduDongsan).toHaveBeenLastCalledWith([{ memberId: 'm3', dongsan: '' }])
  })

  it('목사(읽기 전용)에게는 이름이 눌리지 않는다', () => {
    renderAs('pastor', boarded)
    expect(screen.getAllByText('가나').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '가나' })).not.toBeInTheDocument()
  })
})

// 학교는 **적어 주기만 한다** — 카드에 CMU/Pitt 마크가 붙지만 조를 가르지는 않는다
// (조를 가르는 것은 부서와 교육 단계뿐이다).
describe('AdminNewFamilyEdu — 학교 마크', () => {
  it('카드에 CMU · Pitt을 적어 준다 — 한글로 적힌 이름도 읽는다', () => {
    renderAs('super_admin', [
      { ...member('m1', '김씨엠'), school_or_work: '대학생 · CMU Math' },
      { ...member('m2', '박핏'), school_or_work: '핏대 심리학' },
    ])
    expect(screen.getByText('CMU')).toBeInTheDocument()
    expect(screen.getByText('Pitt')).toBeInTheDocument()
  })

  it('학교를 읽어낼 수 없으면 아무것도 붙이지 않는다 — 모름 딱지는 알려주는 것이 없다', () => {
    renderAs('super_admin', [{ ...member('m1', '정미상'), school_or_work: 'ballet' }])
    expect(screen.queryByText('CMU')).toBeNull()
    expect(screen.queryByText('Pitt')).toBeNull()
  })

  it('배정 창에는 학교로 가르는 칸이 없다 — 조는 부서와 단계로만 갈린다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    renderAs('super_admin', [{ ...member('m1', '김씨엠'), school_or_work: '대학생 · CMU Math' }])
    await userEvent.click(screen.getByRole('button', { name: '김씨엠 선택' }))
    await userEvent.click(screen.getByRole('button', { name: '동산 배정' }))
    expect(screen.queryByText(/학교로도 나누기/)).toBeNull()
    expect(screen.getByText('청년부 미수강')).toBeInTheDocument()
  })
})
