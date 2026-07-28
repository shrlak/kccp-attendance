import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import { easternNow } from '../../lib/checkinWindow'
import { addIsoDays } from '../../lib/semester'
import { worshipSunday } from './newFamily'
import type { Member, RosterResponse } from '../../lib/api'

const rosterData: { data: (RosterResponse & { staffMembers: Member[] }) | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
}
vi.mock('./useRoster', () => ({ useRoster: () => rosterData }))

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
    rosterData.data = {
      role: 'super_admin',
      canBulkSubgroup: true,
      canClearAttendance: true,
      members: [
        member('m1', '이번주새신자', { is_new_member: true, registration_date: sunday }),
        member('m2', '지난주새신자', { is_new_member: true, registration_date: addIsoDays(sunday, -7) }),
        member('m3', '오래된새신자', { is_new_member: true, registration_date: addIsoDays(sunday, -35) }),
        member('m4', '일반멤버'),
      ],
      staffMembers: [],
      log: [],
    } as unknown as RosterResponse & { staffMembers: Member[] }

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
