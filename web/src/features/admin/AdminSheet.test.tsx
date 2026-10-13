import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { i18n } from '../../lib/i18n'
import type { Member, LogEntry } from '../../lib/api'
import { AdminSheet } from './AdminSheet'

beforeAll(async () => { await i18n.init() })

function member(id: string, name: string, subgroup: string, extra: Partial<Member> = {}): Member {
  return {
    id, name, group_name: '청년부', subgroup, member_role: 'member', gender: '',
    phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '', ...extra,
  }
}
function entry(name: string, subgroup: string, date: string, ts: number): LogEntry {
  return { name, group: '청년부', subgroup, date, time: '10:00', ts }
}

// 두 동산. 믿음동산: A는 6/7·6/21 출석, C는 결석, D는 6/14부터 기간이 정해진 방학(명단에 남되
// 그 기간은 회색), E는 6/14부터 무기한 한국 귀국(숨긴 멤버 → 시트에서 아예 빠진다). 소망동산(B)은
// 출석 데이터가 아예 없음 → 열 전체 빈칸(집계 전). easternNow() 기준 2026-06-21 → 열은 여름학기
// 전체(06/07–08/02, exportSundays). 데이터 있는 주일만 O/X, 6/14(데이터 없음)·다가오는 주일은 빈칸.
const members: Member[] = [
  member('1', 'A', '믿음동산'),
  member('3', 'C', '믿음동산'),
  member('4', 'D', '믿음동산', { status_marks: [{ note: '방학', start: '2026-06-14', end: '2026-08-02' }] }),
  member('5', 'E', '믿음동산', { status_note: '한국 귀국', status_start: '2026-06-14', status_end: null }),
  member('2', 'B', '소망동산'),
]
const log: LogEntry[] = [
  entry('A', '믿음동산', '2026-06-07', 1),
  entry('A', '믿음동산', '2026-06-21', 2),
]
const roster = { role: 'super_admin', members, log }

beforeEach(() => {
  queryClient.clear()
  // Fake only Date (keep real setTimeout so react-query/RTL async still resolve), then
  // pin "now" to a Sunday whose Eastern date is 2026-06-21.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-06-21T16:00:00Z'))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(roster), { status: 200 })))
})
afterEach(() => { vi.useRealTimers() })

function renderSheet() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminSheet />
    </QueryClientProvider>,
  )
}

describe('AdminSheet 출석부 (Excel-style grid)', () => {
  it('renders color-coded 동산 blocks mirroring the exported sheet', async () => {
    renderSheet()

    // 동산 headings + the export sheet's column labels. (동산 names also appear as
    // GroupFilter pills, so scope to the block heading.)
    await screen.findByRole('heading', { name: '믿음동산' })
    expect(screen.getByRole('heading', { name: '소망동산' })).toBeInTheDocument()
    // One header row per 동산 block → labels/dates repeat, so match all.
    expect(screen.getAllByText('예배 총 출석').length).toBeGreaterThan(0)
    expect(screen.getAllByText('총 출석').length).toBeGreaterThan(0)

    // Columns span the whole summer term — past Sundays and the future 08/02 alike.
    expect(screen.getAllByText('06/07/2026').length).toBeGreaterThan(0)
    expect(screen.getAllByText('06/21/2026').length).toBeGreaterThan(0)
    expect(screen.getAllByText('08/02/2026').length).toBeGreaterThan(0) // upcoming Sunday column

    // O = present / X = absent cells, and the KEY legend that closes the sheet.
    expect(screen.getAllByText('O').length).toBeGreaterThan(0)
    expect(screen.getAllByText('X').length).toBeGreaterThan(0)
    expect(screen.getByText('KEY')).toBeInTheDocument()
  })

  it('marks data Sundays O/X, blanks no-data + upcoming ones, counting 예배 총 출석', async () => {
    const { container } = renderSheet()
    await screen.findByRole('heading', { name: '믿음동산' })

    const rowOf = (name: string) =>
      waitFor(() => {
        const cell = [...container.querySelectorAll('td')].find((td) => td.textContent === name)
        expect(cell).toBeTruthy()
        return cell!.parentElement!
      })
    const cellsOf = (row: HTMLElement) => [...row.querySelectorAll('td')].map((td) => td.textContent)

    // A attended 2 Sundays → 예배 총 출석 = 2. 06/14 has no check-ins at all → blank (not X);
    // 06/28–08/02 are still upcoming → blank.
    expect(cellsOf(await rowOf('A'))).toEqual(['A', '2', 'O', '', 'O', '', '', '', '', '', ''])
    // C absent on the two Sundays that have data.
    expect(cellsOf(await rowOf('C'))).toEqual(['C', '0', 'X', '', 'X', '', '', '', '', '', ''])
    // B's 동산 has no attendance data at all → every date cell stays blank.
    expect(cellsOf(await rowOf('B'))).toEqual(['B', '0', '', '', '', '', '', '', '', '', ''])
  })

  it('이름 · 예배 총 출석 열은 왼쪽에, 머리줄은 그 동산 표의 위쪽에 고정된다', async () => {
    const { container } = renderSheet()
    await screen.findByRole('heading', { name: '믿음동산' })

    // 표는 두 방향으로 스크롤되는 상자 하나 안에 있다 — 그래야 머리줄이 붙을 자리가 생긴다.
    const viewport = screen.getByTestId('attendance-grid-viewport')
    expect(viewport.className).toContain('grid-viewport')
    expect(viewport.className).toContain('overflow-y-auto')

    // 동산마다 자기 머리줄이 있고, 그 칸들이 위쪽에 붙는다 (이름 칸은 왼쪽에도).
    const heads = [...container.querySelectorAll('thead th')]
    expect(heads.length).toBeGreaterThan(0)
    for (const th of heads) expect(th.className).toMatch(/sticky top-\[var\(--band-h\)\]/)

    // 몸통의 이름 칸과 예배 총 출석 칸이 왼쪽에 고정된다 — 두 번째 열은 이름 열 폭만큼 떨어져.
    const row = [...container.querySelectorAll('tbody td')].find((td) => td.textContent === 'A')!.parentElement!
    const [name, total] = [...row.querySelectorAll('td')]
    expect(name.className).toContain('sticky left-0')
    expect(total.className).toContain('sticky left-[var(--name-col)]')

    // 동산 이름 띠도 상자 맨 위에 붙어, 머리줄만 남았을 때 어느 동산인지 읽힌다.
    const band = screen.getByRole('heading', { name: '믿음동산' }).parentElement!
    expect(band.className).toContain('sticky top-0')
  })

  it('tells you when the running term will be archived, while nothing is finished yet', async () => {
    renderSheet()
    await screen.findByRole('heading', { name: '믿음동산' })

    expect(screen.getByRole('heading', { name: '지난 학기 · 연도 출석부' })).toBeInTheDocument()
    // 여름학기 (기본 일정: 05/10–08/14) is still running on 06/21 → no archives yet.
    expect(screen.getByText(/이번 학기가 끝나면\(2026\.08\.14\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /다운로드/ })).not.toBeInTheDocument()
  })

  it('lists the finished term (and the closed 학년도) with a download once the term is over', async () => {
    vi.setSystemTime(new Date('2026-09-15T16:00:00Z')) // 가을학기 중 — 여름학기는 끝났다
    renderSheet()
    await screen.findByRole('heading', { name: '지난 학기 · 연도 출석부' })

    expect(screen.getByText('2026 여름 학기')).toBeInTheDocument()
    expect(screen.getByText('2025–26 학년도')).toBeInTheDocument() // 08/14에 끝난 학년도
    // 두 아카이브 모두 같은 두 주일을 담고 있다 (학년도는 여름학기를 포함).
    expect(screen.getAllByText(/예배 2주 · 기록 2건/).length).toBe(2)
    expect(screen.getAllByRole('button', { name: /다운로드/ }).length).toBe(2)
  })

  it('renders a bounded status mark as one grey cell spanning the covered dates (master-sheet style)', async () => {
    const { container } = renderSheet()
    await screen.findByRole('heading', { name: '믿음동산' })

    // D: X on 06/07, then 방학 from 06/14 — one grey cell merged across 06/14–08/02. 돌아올
    // 날이 정해진 표기라 명단에는 그대로 남는다.
    const dRow = await waitFor(() => {
      const cell = [...container.querySelectorAll('td')].find((td) => td.textContent === 'D')
      expect(cell).toBeTruthy()
      return cell!.parentElement!
    })
    const cells = [...dRow.querySelectorAll('td')]
    expect(cells.map((td) => td.textContent)).toEqual(['D', '0', 'X', '방학'])
    const note = cells[3]
    expect(note.colSpan).toBe(8) // 06/14 → 08/02
    expect(note.style.background).toBe('rgb(204, 204, 204)') // #CCCCCC
    // The KEY legend now includes the grey 기타 entry.
    expect(screen.getByText('기타')).toBeInTheDocument()
  })

  // 표의 이름을 누르면 멤버 탭 · 오늘 탭과 같은 멤버 정보 창이 열린다 — 출석부를 보다가 그
  // 사람이 누구인지 보려고 멤버 탭으로 건너가 이름을 다시 찾지 않아도 된다.
  it('opens the member dialog when a name in the grid is tapped', async () => {
    renderSheet()
    await screen.findByRole('heading', { name: '믿음동산' })

    await userEvent.click(await screen.findByRole('button', { name: 'C' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('heading', { name: '멤버 편집' })).toBeInTheDocument()
    expect(dialog.getByDisplayValue('C')).toBeInTheDocument()

    // 그 창에서 '출석 기록'으로 넘어가는 것도 다른 탭과 같다.
    await userEvent.click(dialog.getByRole('button', { name: '출석 기록' }))
    expect(within(screen.getByRole('dialog')).getByText('출석 기록 · C')).toBeInTheDocument()
  })

  // 숨긴 멤버는 출석부에도 나오지 않는다 — 종료일 없는 표기는 명단에서 빠진 사람이고,
  // 학기 중간에 그렇게 됐더라도 화면의 출석부에는 남기지 않는다 (지난 학기 아카이브 파일은
  // 그때 있던 사람을 그대로 담는다 — archive.test.ts).
  it('leaves an open-ended 한국 귀국 member off the sheet entirely', async () => {
    const { container } = renderSheet()
    await screen.findByRole('heading', { name: '믿음동산' })

    await waitFor(() => {
      expect([...container.querySelectorAll('td')].some((td) => td.textContent === 'A')).toBe(true)
    })
    expect([...container.querySelectorAll('td')].some((td) => td.textContent === 'E')).toBe(false)
  })
})
