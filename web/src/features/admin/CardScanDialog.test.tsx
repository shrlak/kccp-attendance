import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { i18n } from '../../lib/i18n'
import { ToastProvider } from '../../components/ui/Toast'
import { CardScanDialog } from './CardScanDialog'

vi.mock('../../lib/api', () => ({
  extractCard: vi.fn(),
  kioskNewMember: vi.fn(),
  getCardScanUsage: vi.fn().mockResolvedValue({
    limit: 60,
    remaining: 57,
    day: '2026-07-19',
    resetsAt: 1_774_158_400_000,
    updatedAt: 1_774_072_000_000,
  }),
}))

// Canvas isn't available in jsdom — return a fixed payload per file so the queue
// logic (not the image pipeline) is what's under test.
vi.mock('./cardPhoto', () => ({
  fileToCardImage: vi.fn().mockResolvedValue({ base64: 'img', mediaType: 'image/jpeg' }),
}))

beforeAll(async () => { await i18n.init() })
beforeEach(() => { vi.clearAllMocks() })

function renderDialog(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <CardScanDialog open onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return onClose
}

// One photo → every card read out of it. Registration only needs 이름 + 소속.
const cardsJson = (...names: string[]) => ({
  status: 'ok',
  cards: names.map((name) => ({ name, affiliationCategory: '대학생', affiliationDetail: 'Pitt' })),
  model: 'Gemini 2.5 Flash',
  usage: {
    limit: 60,
    remaining: 56,
    day: '2026-07-19',
    resetsAt: 1_774_158_400_000,
    updatedAt: 1_774_072_001_000,
  },
})
const cardJson = (name: string) => cardsJson(name)

const file = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

describe('CardScanDialog — multi-card batch', () => {
  it('shows only the number of tries remaining today', async () => {
    renderDialog()

    expect(await screen.findByText('오늘 57회 남음')).toBeInTheDocument()
    expect(screen.queryByText(/사용|used/i)).not.toBeInTheDocument()
  })

  it('walks a two-photo batch card by card: extract → review → 등록 → next, closing after the last', async () => {
    const { extractCard, kioskNewMember } = await import('../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cardJson('김새가'))
      .mockResolvedValueOnce(cardJson('이새가'))
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    const onClose = renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), [file('a.jpg'), file('b.jpg')])

    // Photo 1 of 2 under review, with the batch position shown.
    expect(await screen.findByText('사진 1 / 2')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('김새가')

    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    // Registration lands, then the next photo rolls in for review.
    expect(await screen.findByText('사진 2 / 2')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('이새가')
    expect(kioskNewMember).toHaveBeenCalledTimes(1)
    expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ name: '김새가' })

    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    // Last card registered → dialog closes.
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(kioskNewMember).toHaveBeenCalledTimes(2)
    expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls[1][0]).toMatchObject({ name: '이새가' })
  })

  it('건너뛰기 skips the current card without registering and moves to the next', async () => {
    const { extractCard, kioskNewMember } = await import('../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cardJson('김새가'))
      .mockResolvedValueOnce(cardJson('이새가'))
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), [file('a.jpg'), file('b.jpg')])
    await screen.findByText('사진 1 / 2')

    await userEvent.click(screen.getByRole('button', { name: '이 카드 건너뛰기' }))

    expect(await screen.findByText('사진 2 / 2')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('이새가')
    expect(kioskNewMember).not.toHaveBeenCalled()
  })

  it('a card that fails extraction is reported with its position and the batch moves on', async () => {
    const { extractCard } = await import('../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('카드를 읽을 수 없습니다'))
      .mockResolvedValueOnce(cardJson('이새가'))
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), [file('a.jpg'), file('b.jpg')])

    // Failure toast names the position; the next photo still arrives for review.
    expect(await screen.findByText('사진 1 / 2 — 카드를 읽을 수 없습니다')).toBeInTheDocument()
    expect(await screen.findByText('사진 2 / 2')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('이새가')
  })

  it('a single photo keeps the original flow: no position tag, 다시 선택 returns to the picker', async () => {
    const { extractCard } = await import('../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cardJson('김새가'))
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), file('a.jpg'))

    expect(await screen.findByLabelText('이름')).toHaveValue('김새가')
    expect(screen.queryByText(/카드 1 \/ 1|사진 1 \/ 1/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '다시 선택' }))

    expect(await screen.findByLabelText('카드 사진 선택')).toBeInTheDocument()
  })

  it('registers every card found in a single photo, one review at a time', async () => {
    const { extractCard, kioskNewMember } = await import('../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cardsJson('김새가', '이새가', '박새가'))
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    const onClose = renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), file('stack.jpg'))

    // One photo, three cards: the count is announced and the first card is up.
    expect(await screen.findByText('이 사진에서 카드 3개를 인식했습니다')).toBeInTheDocument()
    expect(await screen.findByText('카드 1 / 3')).toBeInTheDocument()
    // No photo tag — there is only one photo in this batch.
    expect(screen.queryByText(/사진 \d+ \/ \d+/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('김새가')

    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByText('카드 2 / 3')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('이새가')

    // Skipping a card leaves it unregistered but keeps the photo's remaining cards.
    await userEvent.click(screen.getByRole('button', { name: '이 카드 건너뛰기' }))

    expect(await screen.findByText('카드 3 / 3')).toBeInTheDocument()
    expect(screen.getByLabelText('이름')).toHaveValue('박새가')

    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    // Last card of the only photo → dialog closes; the photo was read with one API call.
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(extractCard).toHaveBeenCalledTimes(1)
    expect((kioskNewMember as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].name)).toEqual([
      '김새가',
      '박새가',
    ])
  })

  it('carries both positions across a batch where a photo holds several cards', async () => {
    const { extractCard, kioskNewMember } = await import('../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(cardsJson('김새가', '이새가'))
      .mockResolvedValueOnce(cardsJson('박새가'))
    ;(kioskNewMember as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'ok', memberId: 'm1' })
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), [file('a.jpg'), file('b.jpg')])

    expect(await screen.findByText('사진 1 / 2')).toBeInTheDocument()
    expect(await screen.findByText('카드 1 / 2')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('카드 2 / 2')).toBeInTheDocument()

    // Second card of photo 1 registered → photo 2 is extracted, single card, no card tag.
    await userEvent.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('사진 2 / 2')).toBeInTheDocument()
    expect(await screen.findByLabelText('이름')).toHaveValue('박새가')
    expect(screen.queryByText(/카드 \d+ \/ \d+/)).not.toBeInTheDocument()
    expect(extractCard).toHaveBeenCalledTimes(2)
  })

  it('still accepts the older single-card response shape', async () => {
    const { extractCard } = await import('../../lib/api')
    ;(extractCard as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'ok',
      card: { name: '김새가', affiliationCategory: '대학생' },
      usage: cardsJson().usage,
    })
    renderDialog()

    await userEvent.upload(screen.getByLabelText('카드 사진 선택'), file('a.jpg'))

    expect(await screen.findByLabelText('이름')).toHaveValue('김새가')
  })
})
