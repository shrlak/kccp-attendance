import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { i18n } from '../../lib/i18n'
import type { Member, LogEntry } from '../../lib/api'
import { AdminSheet } from './AdminSheet'

beforeAll(async () => { await i18n.init() })

function member(id: string, name: string, subgroup: string): Member {
  return {
    id, name, group_name: '청년부', subgroup, member_role: 'member', gender: '',
    phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
  }
}
function entry(name: string, subgroup: string, date: string, ts: number): LogEntry {
  return { name, group: '청년부', subgroup, date, time: '10:00', ts }
}

// 두 동산, A는 6/7·6/21 출석(6/14 결석), B는 결석. easternNow() 기준 2026-06-21 → 열은 여름학기
// 전체(06/07–08/02, exportSundays). 지난 주일은 O/X, 다가오는 주일(06/28~)은 빈칸으로 채워짐.
const members: Member[] = [
  member('1', 'A', '믿음동산'),
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

  it('marks past Sundays O/X and leaves upcoming ones blank, counting 예배 총 출석', async () => {
    const { container } = renderSheet()
    await screen.findByRole('heading', { name: '믿음동산' })

    // A attended 2 of the past Sundays → 예배 총 출석 = 2; 06/28–08/02 are still upcoming → blank.
    const aRow = await waitFor(() => {
      const cell = [...container.querySelectorAll('td')].find((td) => td.textContent === 'A')
      expect(cell).toBeTruthy()
      return cell!.parentElement!
    })
    const cells = [...aRow.querySelectorAll('td')].map((td) => td.textContent)
    expect(cells).toEqual(['A', '2', 'O', 'X', 'O', '', '', '', '', '', ''])
  })
})
