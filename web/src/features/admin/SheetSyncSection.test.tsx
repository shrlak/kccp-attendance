import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { i18n } from '../../lib/i18n'
import { SheetSyncSection } from './SheetSyncSection'

beforeAll(async () => { await i18n.init() })

function stub(exportToken: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({
        sources: [], token: '', lastRun: null, exportToken,
        exportUrl: 'https://example.test/functions/v1/attendance-api/api/sheet/export',
      }), { status: 200 })),
    ),
  )
}

const writeText = vi.fn().mockResolvedValue(undefined)
beforeEach(() => {
  queryClient.clear()
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => vi.unstubAllGlobals())

const renderIt = () => render(
  <QueryClientProvider client={queryClient}>
    <SheetSyncSection />
  </QueryClientProvider>,
)

describe('출석부 → 시트 내보내기', () => {
  it('키가 없으면 만들 버튼만 있고 스크립트 복사는 없다', async () => {
    stub('')
    renderIt()
    expect(await screen.findByText('내보내기 키 만들기')).toBeInTheDocument()
    expect(screen.queryByText('스크립트 복사 (키 포함)')).toBeNull()
  })

  it('복사한 스크립트에 키와 서버 주소가 채워져 있다', async () => {
    stub('abc123')
    renderIt()
    fireEvent.click(await screen.findByText('스크립트 복사 (키 포함)'))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain("var TOKEN = 'abc123';")
    expect(text).toContain("var ENDPOINT = 'https://example.test/functions/v1/attendance-api/api/sheet/export';")
    expect(text).toContain('function 가져오기()')
  })
})
