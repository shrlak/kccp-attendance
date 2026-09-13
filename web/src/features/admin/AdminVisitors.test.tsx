import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import { easternNow } from '../../lib/checkinWindow'
import type { LogEntry, Member, RosterResponse } from '../../lib/api'

// 방문 기록 삭제는 네트워크 한 줄이라 그 호출만 세운다 — 이 탭의 사실은 "무엇을 지우라고
// 보내는가"이고, 그 단위가 화면의 한 줄(이름+날짜)인지가 여기서 갈린다.
const deleteVisitor = vi.fn(async () => ({ status: 'ok', deleted: 1 }))
vi.mock('../../lib/api', () => ({ deleteVisitor: (...a: unknown[]) => deleteVisitor(...(a as [])) }))
vi.mock('../../lib/live', () => ({ refreshRoster: vi.fn() }))

// Isolate AdminVisitors from the roster query — the tab is a pure view over data.log.
const rosterData: { data: (RosterResponse & { staffMembers: Member[] }) | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
}
vi.mock('./useRoster', () => ({ useRoster: () => rosterData }))

import { AdminVisitors } from './AdminVisitors'

beforeAll(async () => { await i18n.init() })
beforeEach(() => { deleteVisitor.mockClear() })

// 목사(읽기 전용)에게는 삭제 버튼이 없어야 하므로 역할을 받는다.
function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider><AdminVisitors /></ToastProvider>
    </QueryClientProvider>,
  )
}

const guestRow = (name: string, date: string, ts: number, group = ''): LogEntry => ({
  name, group, subgroup: '', date, time: '10:01', ts, memberRole: 'visitor', memberId: null,
})
const memberRow = (name: string, date: string, ts: number): LogEntry => ({
  name, group: '대학부', subgroup: '1동산', date, time: '10:00', ts,
})

function setLog(log: LogEntry[], role = 'super_admin') {
  rosterData.data = {
    role,
    members: [],
    staffMembers: [],
    log,
  } as unknown as RosterResponse & { staffMembers: Member[] }
}

describe('AdminVisitors — 방문자 tab', () => {
  it('lists visitors under their date (today included), excluding member rows', () => {
    const today = easternNow().date
    setLog([
      memberRow('김지체', today, 1),
      guestRow('박방문', today, 2, '대학부'),
      guestRow('이손님', '2026-06-28', 3),
    ])
    renderTab()

    // Both visitors show, each under its own date header; the member row is excluded.
    expect(screen.getByText('박방문')).toBeInTheDocument()
    expect(screen.getByText('이손님')).toBeInTheDocument()
    expect(screen.queryByText('김지체')).toBeNull()
    expect(screen.getByText(today)).toBeInTheDocument()
    expect(screen.getByText('2026-06-28')).toBeInTheDocument()
  })

  it('badges a returning visitor with their visit count', () => {
    setLog([
      guestRow('박방문', '2026-06-21', 1),
      guestRow('박방문', '2026-06-28', 2),
    ])
    renderTab()
    expect(screen.getAllByText('재방문 2회')).toHaveLength(2)
  })

  it('shows the empty state when the log has no visitors', () => {
    setLog([memberRow('김지체', '2026-06-28', 1)])
    renderTab()
    expect(screen.getByText('방문자 기록이 없습니다')).toBeInTheDocument()
  })
})

// 키오스크에서 찍히는 이름이라 오타·중복·시험 삼아 찍어 본 줄이 남는다 — 방문자는 멤버가
// 아니라 멤버 탭에서 고칠 방법도 없으므로 이 탭이 지우는 자리다.
describe('AdminVisitors — 방문 기록 삭제', () => {
  it('확인을 거친 뒤 그 줄의 이름+날짜로 삭제를 보낸다', async () => {
    setLog([guestRow('박방문', '2026-06-28', 1)])
    renderTab()

    fireEvent.click(screen.getByRole('button', { name: /방문 기록 삭제 — 박방문 2026-06-28/ }))
    // 창이 뜨기만 하고 아직 아무것도 지우지 않는다.
    expect(screen.getByText(/박방문 님의 2026-06-28 방문 기록이 삭제됩니다/)).toBeInTheDocument()
    expect(deleteVisitor).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(deleteVisitor).toHaveBeenCalledWith('박방문', '2026-06-28'))
  })

  it('취소하면 아무것도 보내지 않는다', () => {
    setLog([guestRow('박방문', '2026-06-28', 1)])
    renderTab()

    fireEvent.click(screen.getByRole('button', { name: /방문 기록 삭제 — 박방문/ }))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(deleteVisitor).not.toHaveBeenCalled()
  })

  it('목사(읽기 전용)에게는 삭제 버튼이 없다', () => {
    setLog([guestRow('박방문', '2026-06-28', 1)], 'pastor')
    renderTab()

    expect(screen.getByText('박방문')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /방문 기록 삭제/ })).toBeNull()
  })
})
