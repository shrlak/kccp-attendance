import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import { easternNow } from '../../lib/checkinWindow'
import { addIsoDays } from '../../lib/semester'
import type { LogEntry, Member, RosterResponse } from '../../lib/api'

// Isolate AdminToday from its data hooks (which run their own queries).
const rosterData: { data: (RosterResponse & { staffMembers: Member[] }) | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
}
vi.mock('./useRoster', () => ({ useRoster: () => rosterData }))

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
    // The redundant three-card summary does not appear on the Today tab.
    expect(screen.queryByText('전체 멤버 수')).not.toBeInTheDocument()
    expect(screen.queryByText('예배 주일 수')).not.toBeInTheDocument()
    // ...and the 오늘 header count includes the guest (member + guest = 2).
    expect(
      screen.getByText((_, el) => el?.textContent === '오늘 출석 · 2' && el.tagName === 'SPAN'),
    ).toBeInTheDocument()
  })
})

describe('AdminToday — 새가족 / 방문자 status labels in the 오늘 tab', () => {
  it('tags 새가족 and 방문자 with readable labels and a legend', () => {
    const today = easternNow().date
    const nf = { ...member('m2', '새신자'), is_new_member: true, registration_date: today }
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [nf],
      staffMembers: [],
      log: [{ ...memberRow(nf, today, 2), firstVisit: true }, guestRow('박방문', today, 3)],
    } as unknown as RosterResponse & { staffMembers: Member[] }

    renderWithProviders(<AdminToday />)

    expect(screen.getAllByText('새가족').length).toBeGreaterThan(0)
    expect(screen.getAllByText('방문자').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('상태 안내')).toBeInTheDocument()
  })

  it('marks only the 새가족 who registered today, not earlier newcomers', () => {
    const today = easternNow().date
    const fresh = { ...member('m3', '오늘등록새신자'), is_new_member: true, registration_date: today }
    const prior = { ...member('m4', '지난주새신자'), is_new_member: true, registration_date: addIsoDays(today, -7) }
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [fresh, prior],
      staffMembers: [],
      log: [memberRow(fresh, today, 2), memberRow(prior, today, 3)],
    } as unknown as RosterResponse & { staffMembers: Member[] }

    renderWithProviders(<AdminToday />)

    expect(screen.getByText('오늘등록새신자').closest('li')).toHaveTextContent('새가족')
    expect(screen.getByText('지난주새신자').closest('li')).not.toHaveTextContent('새가족')
  })

  it('leaves a regular member unmarked even on their first recorded visit', () => {
    const today = easternNow().date
    const m1 = member('m1', '김지체')
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [m1],
      staffMembers: [],
      log: [{ ...memberRow(m1, today, 2), firstVisit: true }],
    } as unknown as RosterResponse & { staffMembers: Member[] }

    renderWithProviders(<AdminToday />)

    const regularRow = screen.getByText('김지체').closest('li')
    expect(regularRow).not.toHaveTextContent('새가족')
    expect(regularRow).not.toHaveTextContent('방문자')
  })
})
