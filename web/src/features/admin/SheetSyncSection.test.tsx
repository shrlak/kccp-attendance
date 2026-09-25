import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { i18n } from '../../lib/i18n'
import { SheetSyncSection } from './SheetSyncSection'

beforeAll(async () => { await i18n.init() })

function stub(exportToken: string, extra: Record<string, unknown> = {}) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({
      sources: [], token: '', lastRun: null, exportToken,
      exportUrl: 'https://example.test/functions/v1/attendance-api/api/sheet/export',
      exportTargets: [], lastPush: null, serviceAccountEmail: null,
      ...extra,
    }), { status: 200 })),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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

describe('출석부 → 시트, 링크만 붙여넣기', () => {
  it('서버에 구글 계정이 없으면 그렇다고 말하고 연결 버튼이 눌리지 않는다', async () => {
    stub('')
    renderIt()
    expect(await screen.findByText(/서버에 구글 계정이 아직 연결되지 않아/)).toBeInTheDocument()
    expect(screen.getByText('시트 연결').closest('button')).toBeDisabled()
  })

  it('링크를 붙여넣고 연결하면 그 링크로 add-export-target을 보낸다', async () => {
    const fetchMock = stub('', { serviceAccountEmail: 'sa@kccp.iam.gserviceaccount.com' })
    renderIt()
    expect(await screen.findByText('sa@kccp.iam.gserviceaccount.com')).toBeInTheDocument()
    const link = 'https://docs.google.com/spreadsheets/d/abc123/edit'
    fireEvent.change(screen.getByLabelText('출석을 받을 구글 시트 링크'), { target: { value: link } })
    fireEvent.click(screen.getByText('시트 연결'))
    await waitFor(() => {
      const bodies = fetchMock.mock.calls.map((c) => String((c[1] as RequestInit | undefined)?.body ?? ''))
      expect(bodies.some((b) => b.includes('"add-export-target"') && b.includes(link))).toBe(true)
    })
  })

  it('지난번에 못 쓴 시트는 그 이유를 줄에 적는다', async () => {
    stub('', {
      serviceAccountEmail: 'sa@kccp.iam.gserviceaccount.com',
      exportTargets: [{ id: 'abc', title: '대청부 출석' }],
      lastPush: { at: Date.now(), by: 'auto', outcomes: [{ id: 'abc', title: '대청부 출석', tabs: [], error: '이 시트에 쓸 권한이 없습니다' }] },
    })
    renderIt()
    expect(await screen.findByText('이 시트에 쓸 권한이 없습니다')).toBeInTheDocument()
  })
})
