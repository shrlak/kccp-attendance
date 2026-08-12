import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import type { DongsanLink } from '../../lib/api'

const getDongsanLinks = vi.fn()
vi.mock('../../lib/api', () => ({
  getDongsanLinks: () => getDongsanLinks(),
  createDongsanLink: vi.fn(),
  revokeDongsanLink: vi.fn(),
}))

import { DongsanLinksSection } from './DongsanLinks'

beforeAll(async () => { await i18n.init() })
beforeEach(() => { getDongsanLinks.mockReset().mockResolvedValue({ links: [] }) })

const names = { 대학부: ['호연선규', '건영동산'], 청년부: ['중호동산'] }

function renderSection({ summer = false, links = [] as DongsanLink[] } = {}) {
  getDongsanLinks.mockResolvedValue({ links })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DongsanLinksSection names={names} summer={summer} partition="youth" />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('동산 리더 링크 — 낼 수 있는 자리', () => {
  it('학기 중에는 부서 두 줄이 먼저, 그 아래 그 학기의 동산들', async () => {
    renderSection()

    expect(await screen.findByText('대학부 전체')).toBeInTheDocument()
    expect(screen.getByText('청년부 전체')).toBeInTheDocument()
    expect(screen.getByText('호연선규')).toBeInTheDocument()
    expect(screen.getByText('중호동산')).toBeInTheDocument()
  })

  // 여름 동산 출석은 시트가 갖고 온다 — 같은 동산을 둘로 적으면 다음 동기화가 덮어쓴다.
  it('여름학기에는 낼 자리가 없다 — 이유만 적히고 목록은 비어 있다', async () => {
    renderSection({ summer: true })

    expect(await screen.findByText(/여름학기 동산 출석은 구글 시트로 들어옵니다/)).toBeInTheDocument()
    expect(screen.queryByText('대학부 전체')).not.toBeInTheDocument()
    expect(screen.queryByText('호연선규')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '링크 만들기' })).not.toBeInTheDocument()
  })

  // 여름에 이미 낸 것이 있으면 거둘 수 있어야 한다 — 목록에서 지워 버리면 폐기할 방법이 없다.
  it('여름이어도 이미 낸 링크는 남아서 폐기할 수 있다', async () => {
    renderSection({
      summer: true,
      links: [{ token: 'tok1', group: '', subgroup: '지난여름동산', createdAt: 1 }],
    })

    expect(await screen.findByText('지난여름동산')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '폐기' })).toBeInTheDocument()
  })
})
