import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { i18n } from '../../lib/i18n'
import type { DongsanBoard } from '../../lib/api'
import { ToastProvider } from '../../components/ui/Toast'

const getDongsanBoard = vi.fn()
const markDongsan = vi.fn()
vi.mock('../../lib/api', () => ({
  getDongsanBoard: (...args: unknown[]) => getDongsanBoard(...args),
  markDongsan: (...args: unknown[]) => markDongsan(...args),
}))

import { DongsanBoardScreen } from './DongsanBoardScreen'

beforeAll(async () => { await i18n.init() })

// 2026-08-09 · 08-02 두 주일, 세 사람. 김출석은 지난 주일에 왔고, 이귀국은 기한 없는 '한국 귀국'
// 표기가 붙어 명단에서 빠진 사람이다.
const board: DongsanBoard = {
  partition: 'youth',
  group: '대학부',
  subgroup: '',
  dates: ['2026-08-02', '2026-08-09'],
  members: [
    { id: 'm1', name: '김출석', group: '대학부', subgroup: '건영동산' },
    { id: 'm2', name: '박결석', group: '청년부', subgroup: '건영동산' },
    { id: 'm3', name: '이귀국', group: '대학부', subgroup: '건영동산', status_marks: [{ note: '한국 귀국', start: '2026-07-01', end: null }] },
  ],
  marks: ['m1|2026-08-09'],
}

// 부서 링크 — subgroup이 비어 있고, 그 부서의 동산이 다 담긴다.
const groupBoard: DongsanBoard = {
  partition: 'youth',
  group: '대학부',
  subgroup: '',
  dates: ['2026-08-02', '2026-08-09'],
  members: [
    { id: 'g1', name: '가동산원', group: '대학부', subgroup: '건영동산' },
    { id: 'g2', name: '나동산원', group: '대학부', subgroup: '윤서동산' },
    { id: 'g3', name: '다미지정', group: '대학부', subgroup: '' },
  ],
  marks: [],
}

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/dongsan/tok123']}>
          <Routes>
            <Route path="/dongsan/:token" element={<DongsanBoardScreen />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  getDongsanBoard.mockReset().mockResolvedValue(board)
  markDongsan.mockReset().mockResolvedValue({ status: 'ok', present: true })
})

describe('/dongsan/:token — 동산지기 출석 화면', () => {
  it('opens with the most recent Sunday and shows each member as O or X', async () => {
    renderScreen()

    expect(await screen.findByRole('heading', { name: '대학부 전체' })).toBeInTheDocument()
    expect(getDongsanBoard).toHaveBeenCalledWith('tok123')

    // 이번 주일(목록의 마지막)이 먼저 열린다 — 리더가 열자마자 적는 곳이 이번 주이기 때문.
    const present = screen.getByRole('combobox', { name: '김출석' }) as HTMLSelectElement
    const absent = screen.getByRole('combobox', { name: '박결석' }) as HTMLSelectElement
    expect(present.value).toBe('O')
    expect(absent.value).toBe('X')

    // 명단에서 빠진 사람(기한 없는 귀국 표기)은 리더 화면에도 없다.
    expect(screen.queryByText('이귀국')).not.toBeInTheDocument()
    expect(screen.getByText('1명 출석 · 전체 2명')).toBeInTheDocument()
  })

  it('saves the pick as 동산 attendance for the chosen Sunday', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('heading', { name: '대학부 전체' })

    await user.selectOptions(screen.getByRole('combobox', { name: '박결석' }), 'O')

    await waitFor(() => expect(markDongsan).toHaveBeenCalledWith('tok123', 'm2', '2026-08-09', true))
    // 왕복을 기다리지 않고 화면이 먼저 바뀐다.
    expect((screen.getByRole('combobox', { name: '박결석' }) as HTMLSelectElement).value).toBe('O')
    expect(screen.getByText('2명 출석 · 전체 2명')).toBeInTheDocument()
  })

  it('turning a member back to X takes the mark away', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('heading', { name: '대학부 전체' })

    await user.selectOptions(screen.getByRole('combobox', { name: '김출석' }), 'X')

    await waitFor(() => expect(markDongsan).toHaveBeenCalledWith('tok123', 'm1', '2026-08-09', false))
    expect(screen.getByText('0명 출석 · 전체 2명')).toBeInTheDocument()
    // O가 하나도 없는 주일은 "안 왔다"가 아니라 "아직 안 적었다"일 수 있으므로 그렇게 알린다.
    expect(screen.getByText('아직 아무도 적히지 않았습니다')).toBeInTheDocument()
  })

  it('another Sunday shows that week, and the pick lands on that date', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('heading', { name: '대학부 전체' })

    const weeks = screen.getByLabelText('주일 고르기')
    await user.selectOptions(weeks, '2026-08-02')

    // 지난 주일에는 아무도 적혀 있지 않다 (marks는 08-09 것뿐).
    expect((screen.getByRole('combobox', { name: '김출석' }) as HTMLSelectElement).value).toBe('X')

    await user.selectOptions(screen.getByRole('combobox', { name: '김출석' }), 'O')
    await waitFor(() => expect(markDongsan).toHaveBeenCalledWith('tok123', 'm1', '2026-08-02', true))
  })

  it('names the department and blocks its members by 동산', async () => {
    getDongsanBoard.mockResolvedValue(groupBoard)
    renderScreen()

    // 제목은 이 링크가 가리키는 자리다 — 동산 이름이 없으므로 '대학부 전체'.
    expect(await screen.findByRole('heading', { name: '대학부 전체' })).toBeInTheDocument()
    expect(screen.getByText('건영동산')).toBeInTheDocument()
    expect(screen.getByText('윤서동산')).toBeInTheDocument()
    // 동산이 아직 없는 사람도 빠지지 않는다 — 편성 전에 이 링크를 쓰는 경우가 그것이다.
    expect(screen.getByText('동산 미지정')).toBeInTheDocument()
    expect(screen.getByText('0명 출석 · 전체 3명')).toBeInTheDocument()
  })

  it('a 동산 link draws no 동산 headers — there is only the one', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: '대학부 전체' }) // 제목에 한 번 (머리글로는 그리지 않는다)
    expect(screen.getAllByText('건영동산')).toHaveLength(1)
  })

  it('a revoked or mistyped link says so instead of showing an empty sheet', async () => {
    getDongsanBoard.mockRejectedValue(new Error('이 링크는 더 이상 쓸 수 없습니다'))
    renderScreen()

    expect(await screen.findByText('이 링크는 더 이상 쓸 수 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('puts the failed pick back when the save is rejected', async () => {
    const user = userEvent.setup()
    markDongsan.mockRejectedValue(new Error('nope'))
    renderScreen()
    await screen.findByRole('heading', { name: '대학부 전체' })

    await user.selectOptions(screen.getByRole('combobox', { name: '박결석' }), 'O')

    await waitFor(() =>
      expect((screen.getByRole('combobox', { name: '박결석' }) as HTMLSelectElement).value).toBe('X'),
    )
  })
})
