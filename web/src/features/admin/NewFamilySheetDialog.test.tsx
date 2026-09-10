import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import type { LogEntry, Member } from '../../lib/api'

// 새가족 출석표의 날짜 열 — 출석부의 그 주일들에 **학기 앞쪽**이 더해진다
// (exports.ts newFamilySundays). 2026 가을의 새가족은 학기가 열리기(9/6) 전인 8/16부터
// 왔으므로, 그 주일들이 없으면 등록일 뒤로 몇 주가 통째로 표 밖에 남는다.

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, getConfig: vi.fn().mockResolvedValue({ groupColors: {} }), getDongsanLeaders: vi.fn().mockResolvedValue({}) }
})

const member = (name: string, reg: string): Member => ({
  id: name, name, group_name: '대학부', subgroup: '', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: true, notes: '', registration_date: reg,
} as unknown as Member)

// 프로덕션의 저장된 일정 — 여름 06-07~08-02, 가을 09-06~12-13.
const cal = {
  spring: { start: '01-01', end: '05-09' },
  summer: { start: '06-07', end: '08-02' },
  fall: { start: '09-06', end: '12-13' },
}

beforeAll(async () => { await i18n.init() })

function renderSheet(members: Member[], log: LogEntry[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return import('./NewFamilySheetDialog').then(({ NewFamilySheetDialog }) =>
    render(
      <QueryClientProvider client={qc}>
        <NewFamilySheetDialog
          members={members}
          log={log}
          dongsanLog={[]}
          filter={{ group: '', subgroup: '' }}
          today="2026-09-10"
          lang="ko"
          semesterDates={cal}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    ),
  )
}

describe('NewFamilySheetDialog', () => {
  it('가을 학기가 열리기 전 8/16부터 그린다', async () => {
    await renderSheet(
      [member('새가족갑', '2026-08-16')],
      [{ id: '1', name: '새가족갑', date: '2026-08-23', time: '10:00', group: '대학부', subgroup: '', member_id: null } as unknown as LogEntry],
    )
    // 앞으로 늘어난 세 주일 + 학기의 주일들 (다가오는 주일은 빈칸으로 남는다).
    expect(screen.getByText('08/16/2026')).toBeInTheDocument()
    expect(screen.getByText('08/23/2026')).toBeInTheDocument()
    expect(screen.getByText('08/30/2026')).toBeInTheDocument()
    expect(screen.getByText('09/06/2026')).toBeInTheDocument()
    // 학기 앞쪽 주일의 출석도 그대로 세어진다 — 8/23에 온 것이 그 줄의 O 한 칸이고,
    // 예배 총 출석도 1이 된다 (범례의 O는 표 밖이라 줄 안에서 센다).
    const row = screen.getByText('새가족갑').closest('tr') as HTMLElement
    expect(within(row).getAllByText('O')).toHaveLength(1)
    expect(within(row).getByText('1')).toBeInTheDocument()
  })
})
