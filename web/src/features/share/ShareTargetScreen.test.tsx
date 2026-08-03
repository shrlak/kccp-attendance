import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'

vi.mock('../../lib/api', () => ({
  adminVerify: vi.fn(),
  adminVerifyGoogle: vi.fn(),
  getLoginPosition: vi.fn().mockResolvedValue(null),
  setAdminPassword: vi.fn(),
  setAdminToken: vi.fn(),
  extractCard: vi.fn(),
  kioskNewMember: vi.fn(),
  getCardScanUsage: vi.fn().mockResolvedValue({
    limit: 60,
    remaining: 57,
    day: '2026-08-02',
    resetsAt: 1,
    updatedAt: 1,
  }),
}))

// The auth store registers onAuthStateChange at import time.
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
}))

// Canvas isn't available in jsdom, so the photo pipeline is stubbed — what's under test
// is the hand-off, not the encoder.
vi.mock('../admin/cardPhoto', () => ({
  fileToCardImage: vi.fn().mockResolvedValue({ base64: 'img', mediaType: 'image/jpeg' }),
}))

vi.mock('../../lib/sharedCards', () => ({
  readSharedCards: vi.fn().mockResolvedValue([]),
  clearSharedCards: vi.fn().mockResolvedValue(undefined),
}))

beforeAll(async () => { await i18n.init() })
beforeEach(async () => {
  sessionStorage.clear()
  vi.clearAllMocks()
  // clearAllMocks drops recorded calls but keeps implementations, so re-arm the default
  // "nothing was shared" — otherwise a previous test's photo leaks into the next one.
  const { readSharedCards } = await import('../../lib/sharedCards')
  ;(readSharedCards as ReturnType<typeof vi.fn>).mockResolvedValue([])
  const { useAdminAuth } = await import('../../stores/useAdminAuth')
  useAdminAuth.setState({ status: 'idle', identity: null })
})

const sharedPhoto = (name = 'card.jpg') => new File(['x'], name, { type: 'image/jpeg' })

async function renderShare() {
  const { ShareTargetScreen } = await import('./ShareTargetScreen')
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/share']}>
          <ShareTargetScreen />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function signIn(role: 'welcoming' | 'pastor' = 'welcoming') {
  const { useAdminAuth } = await import('../../stores/useAdminAuth')
  useAdminAuth.setState({
    status: 'authed',
    identity: { role, group: '', subgroup: '', ministry: '' },
  })
}

describe('ShareTargetScreen', () => {
  it('shows the login gate when the shared-to device has no session', async () => {
    const { readSharedCards } = await import('../../lib/sharedCards')
    ;(readSharedCards as ReturnType<typeof vi.fn>).mockResolvedValue([sharedPhoto()])
    await renderShare()

    expect(await screen.findByRole('button', { name: 'Google로 로그인' })).toBeInTheDocument()
    // The photos must survive the sign-in — including the Google redirect, which reloads
    // the page — so nothing is consumed until the scan dialog actually has them.
    const { clearSharedCards } = await import('../../lib/sharedCards')
    expect(clearSharedCards).not.toHaveBeenCalled()
  })

  it('takes a shared photo straight into card review, and consumes the hand-off', async () => {
    const { readSharedCards, clearSharedCards } = await import('../../lib/sharedCards')
    ;(readSharedCards as ReturnType<typeof vi.fn>).mockResolvedValue([sharedPhoto()])
    const { extractCard } = await import('../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'ok',
      cards: [{ name: '김새가', affiliationCategory: '대학생' }],
      model: 'Gemini 2.5 Flash',
      usage: { limit: 60, remaining: 56, day: '2026-08-02', resetsAt: 1, updatedAt: 1 },
    })
    await signIn()
    await renderShare()

    expect(await screen.findByLabelText('이름')).toHaveValue('김새가')
    // No pick step: the OS already chose the photo.
    expect(screen.queryByRole('button', { name: '카드 사진 선택' })).not.toBeInTheDocument()
    await waitFor(() => expect(clearSharedCards).toHaveBeenCalled())
  })

  it('offers the picker when opened from the home-screen shortcut with nothing shared', async () => {
    await signIn()
    await renderShare()

    expect(await screen.findByRole('button', { name: '카드 사진 선택' })).toBeInTheDocument()
    const { extractCard } = await import('../../lib/api')
    expect(extractCard).not.toHaveBeenCalled()
  })

  it('refuses to register for a read-only pastor account', async () => {
    const { readSharedCards } = await import('../../lib/sharedCards')
    ;(readSharedCards as ReturnType<typeof vi.fn>).mockResolvedValue([sharedPhoto()])
    await signIn('pastor')
    await renderShare()

    expect(
      await screen.findByText('목사님 계정은 읽기 전용이라 새가족을 등록할 수 없습니다.'),
    ).toBeInTheDocument()
    const { extractCard } = await import('../../lib/api')
    expect(extractCard).not.toHaveBeenCalled()
  })
})
