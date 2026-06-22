import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import { easternNow } from '../../lib/checkinWindow'
import type { LogEntry, Member, RosterResponse } from '../../lib/api'

// Isolate AdminToday from its data hooks / badge widgets (which run their own queries).
const rosterData: { data: (RosterResponse & { staffMembers: Member[] }) | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
}
vi.mock('./useRoster', () => ({ useRoster: () => rosterData }))
vi.mock('./useDongsanRole', () => ({ useDongsanRole: () => () => null }))
vi.mock('./Officers', () => ({ OfficerBadge: () => null }))
vi.mock('./DongsanLeaders', () => ({ DongsanBadge: () => null }))

import { AdminToday } from './AdminToday'

beforeAll(async () => { await i18n.init() })

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  )
}

const member = (id: string, name: string): Member => ({
  id, name, group_name: '대학부', subgroup: '1동산', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})
// A 방문자 row as the API returns it: no 부서/동산, member_role "visitor", no member link.
const guestRow = (name: string, date: string, ts: number): LogEntry => ({
  name, group: '', subgroup: '', date, time: '10:01', ts, firstVisit: false, memberRole: 'visitor', memberId: null,
})
const memberRow = (m: Member, date: string, ts: number): LogEntry => ({
  name: m.name, group: m.group_name, subgroup: m.subgroup, date, time: '10:00', ts, firstVisit: false,
})

describe('AdminToday — 방문자(guests) in the 오늘 tab', () => {
  it('shows guest names and counts them in the total alongside members', () => {
    // Use the same "today" source AdminToday does, so the rows always land on today
    // regardless of when the suite runs.
    const today = easternNow().date
    const m1 = member('m1', '김지체')
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [m1],
      staffMembers: [],
      log: [memberRow(m1, today, 2), guestRow('박방문', today, 3)],
    } as unknown as RosterResponse & { staffMembers: Member[] }

    renderWithProviders(<AdminToday />)

    // The guest appears in today's list alongside the member...
    expect(screen.getByText('박방문')).toBeInTheDocument()
    expect(screen.getByText('김지체')).toBeInTheDocument()
    // ...and the 오늘 header count includes the guest (member + guest = 2).
    expect(
      screen.getByText((_, el) => el?.textContent === '오늘 출석 · 2' && el.tagName === 'SPAN'),
    ).toBeInTheDocument()
  })
})
