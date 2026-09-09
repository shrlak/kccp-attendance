import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import type { LogEntry, Member } from '../../lib/api'

// 새가족 탭: 이번 학기 등록자와, 교육이 남아 이전 학기에서 넘어온 새가족이 학기별로
// 나뉘어 보이는지 — 그리고 교육을 마친 사람은 더 이상 보이지 않는지.

const member = (id: string, reg: string | null, extra: Partial<Member> = {}): Member => ({
  id, name: id, group_name: '대학부', subgroup: '', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: true, notes: '', registration_date: reg, ...extra,
})

// today = 2026-06-08 → 기본 학기 경계에서 여름학기(05-10 ~ 08-14).
vi.mock('../../lib/checkinWindow', async () => {
  const actual = await vi.importActual<typeof import('../../lib/checkinWindow')>('../../lib/checkinWindow')
  return { ...actual, easternNow: () => ({ date: '2026-06-08', time: '10:00', ts: 0 }) }
})

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, getConfig: vi.fn().mockResolvedValue({ groupColors: {} }) }
})

const roster = vi.fn()
vi.mock('./useRoster', () => ({ useRoster: () => roster() }))

beforeAll(async () => { await i18n.init() })
beforeEach(() => { vi.clearAllMocks() })

async function renderTab(members: Member[], log: LogEntry[] = []) {
  roster.mockReturnValue({
    data: { role: 'super_admin', members, log, staffMembers: [] },
    isLoading: false,
    isError: false,
  })
  const { AdminNewFamily } = await import('./AdminNewFamily')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider><AdminNewFamily /></ToastProvider>
    </QueryClientProvider>,
  )
}

// 각 학기 섹션은 학기 이름이 붙은 랜드마크다. 이름은 아래 '월별 등록' 롤업에도 나오므로,
// 카드 목록에 있는지는 반드시 해당 섹션 안에서 확인한다.
const term = (name: string) => screen.getByRole('region', { name })

describe('AdminNewFamily 학기 분리', () => {
  it('carries an unfinished 새가족 over from an earlier term, into its own 학기 section', async () => {
    await renderTab([
      member('이번학기', '2026-06-07'),
      member('봄학기미이수', '2026-02-01', { new_member_edu_week1: true }),
    ])

    expect(within(term('2026 여름학기')).getByText('이번학기')).toBeInTheDocument()
    expect(within(term('2026 봄학기')).getByText('봄학기미이수')).toBeInTheDocument()
    // 두 사람이 서로의 섹션에 섞이지 않는다.
    expect(within(term('2026 여름학기')).queryByText('봄학기미이수')).toBeNull()
    expect(screen.getByText('이전 학기 1명')).toBeInTheDocument()
  })

  it('keeps an earlier term 새가족 listed after both education weeks are done', async () => {
    await renderTab([
      member('이번학기', '2026-06-07'),
      member('봄학기이수완료', '2026-02-01', { new_member_edu_week1: true, new_member_edu_week2: true }),
    ])

    expect(within(term('2026 여름학기')).getByText('이번학기')).toBeInTheDocument()
    // 교육을 마쳐도 자기 등록 학기 섹션에 그대로 남는다 — 새가족 표시를 해제해야 내려간다.
    expect(within(term('2026 봄학기')).getByText('봄학기이수완료')).toBeInTheDocument()
  })

  it('keeps this term’s 새가족 listed even after they finish the education', async () => {
    await renderTab([member('이수완료', '2026-06-07', { new_member_edu_week1: true, new_member_edu_week2: true })])

    expect(within(term('2026 여름학기')).getByText('이수완료')).toBeInTheDocument()
    expect(screen.queryByText('교육 미완료')).toBeNull()
  })
})

// ── 처지 · 학교 칩 ──────────────────────────────────────────────────────────
// 멤버 탭과 같은 칩 줄이 이 탭에도 선다 (TraitFilter): 대학부는 학교로, 청년부는 처지로
// 갈리고 그 안의 대학원생만 다시 학교로 간다. 새가족을 학교별로 모아 부를 일이 실제로 있고,
// 그때 명단을 멤버 탭으로 옮겨 가서 다시 찾을 이유가 없다.
describe('AdminNewFamily — 처지 · 학교 칩', () => {
  const school = (name: string, school_or_work: string, group_name = '대학부'): Member =>
    member(name, '2026-06-07', { group_name, school_or_work })

  it('대학부 새가족을 학교로 좁힌다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    await renderTab([
      school('김씨엠', '대학생 · CMU Math'),
      school('박핏', '대학생 · UPitt nursing'),
      school('정미상', ''),
    ])

    await userEvent.click(screen.getByRole('button', { name: 'CMU' }))
    // 학기 블록에도, 아래 월별 등록 롤업에도 남는 것은 CMU 한 사람뿐이다 — 한쪽만 좁히면
    // 같은 화면의 두 곳이 다른 명단을 보여준다.
    expect(screen.getAllByText('김씨엠').length).toBeGreaterThan(0)
    expect(screen.queryByText('박핏')).toBeNull()
    expect(screen.queryByText('정미상')).toBeNull()
  })

  it('청년부는 처지와 학교 두 줄을 함께 내건다 — 직장인일 때만 학교가 내려간다', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    await renderTab([
      school('대학씨엠', '대학생 · CMU Math'),
      school('청년원생', '대학원생 · 씨엠유 기계공학', '청년부'),
      school('청년핏', '대학원생 · Pitt Nursing', '청년부'),
      school('청년직장', '직장인 · 발레댄서', '청년부'),
    ])

    await userEvent.click(screen.getByRole('button', { name: '청년부' }))
    expect(screen.getByRole('group', { name: '학생/직장' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '학교' })).toBeInTheDocument()

    // 대학원생을 고르면 학교 칩이 그 사람들의 학교로 좁혀진다 — CMU와 Pitt.
    await userEvent.click(screen.getByRole('button', { name: '대학원생' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pitt' }))
    expect(screen.getAllByText('청년핏').length).toBeGreaterThan(0)
    expect(screen.queryByText('청년원생')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '직장인' }))
    expect(screen.queryByRole('group', { name: '학교' })).toBeNull()
    expect(screen.getAllByText('청년직장').length).toBeGreaterThan(0)
    expect(screen.queryByText('청년원생')).toBeNull()

    // 부서를 되돌리면 아래 줄의 선택도 처음으로 돌아간다 — 사라진 칩으로 계속 좁히고
    // 있으면 화면이 왜 비었는지 알 수 없다.
    await userEvent.click(screen.getByRole('button', { name: '대학부' }))
    expect(screen.getAllByText('대학씨엠').length).toBeGreaterThan(0)
  })

  it('학교를 아무도 적지 않은 부에서는 칩 줄이 없다', async () => {
    await renderTab([school('김장년', '', '장년부'), school('이장년', '', '장년부')])
    expect(screen.queryByRole('group', { name: '학교' })).toBeNull()
    expect(screen.queryByRole('group', { name: '학생/직장' })).toBeNull()
  })
})

// ── 새가족 출석표 ───────────────────────────────────────────────────────────
// 오른쪽 위 '출석표' 버튼 → 출석부와 **같은 표**(AttendanceGrid)를 이 탭의 새가족만으로
// 그린다. 카드에는 등록일만 있어서 "그 뒤로 계속 오고 있나"는 출석부 탭으로 건너가 이름을
// 하나씩 찾아야 알 수 있었다.
describe('AdminNewFamily — 새가족 출석표', () => {
  const log = (name: string, date: string, group = '대학부'): LogEntry =>
    ({ id: `${name}-${date}`, name, date, time: '10:00', group, subgroup: '', member_id: null }) as unknown as LogEntry

  it('출석표 버튼이 새가족만 담은 표를 연다 — 온 주일은 O', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    await renderTab(
      [
        member('새가족갑', '2026-05-10'),
        member('새가족을', '2026-05-10', { group_name: '청년부' }),
        member('일반멤버', null, { is_new_member: false }),
      ],
      [log('새가족갑', '2026-06-07'), log('일반멤버', '2026-06-07')],
    )

    await userEvent.click(screen.getByRole('button', { name: '출석표' }))
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText('새가족 출석표')).toBeInTheDocument()
    // 블록은 부서로 갈린다 — 새가족은 아직 동산이 없는 사람이 많아 동산으로 묶으면 거의
    // 전부가 '동산 미지정' 한 덩어리가 된다.
    expect(sheet.getByRole('heading', { name: '대학부' })).toBeInTheDocument()
    expect(sheet.getByRole('heading', { name: '청년부' })).toBeInTheDocument()
    // 담기는 사람은 이 탭이 보여주는 새가족뿐이다.
    expect(sheet.getByText('새가족갑')).toBeInTheDocument()
    expect(sheet.getByText('새가족을')).toBeInTheDocument()
    expect(sheet.queryByText('일반멤버')).toBeNull()
    // 온 주일에는 그 사람 줄에 O가 서고, 예배 총 출석은 1이 된다.
    const row = sheet.getByText('새가족갑').closest('tr') as HTMLElement
    expect(within(row).getByText('O')).toBeInTheDocument()
    expect(within(row).getByText('1')).toBeInTheDocument()
  })

  it('새가족이 없으면 그릴 표가 없어 버튼이 눌리지 않는다', async () => {
    await renderTab([member('일반멤버', null, { is_new_member: false })])
    expect(screen.getByRole('button', { name: '출석표' })).toBeDisabled()
  })
})
