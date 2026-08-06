import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { i18n } from '../../lib/i18n'
import { AdminSettings } from './AdminSettings'

beforeAll(async () => { await i18n.init() })

// 운영 중인 학기 일정 (여름학기 06-07 ~ 08-08). summerMode는 서버가 이 일정에서 계산해 준다.
const semesterDates = {
  spring: { start: '01-01', end: '05-09' },
  summer: { start: '06-07', end: '08-08' },
  fall: { start: '09-06', end: '12-13' },
}

function stubConfig(summerMode: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ summerMode, semesterDates, groupColors: {}, limit: 250, used: 0, remaining: 250 }), { status: 200 }),
    ),
  )
}

beforeEach(() => { queryClient.clear() })
afterEach(() => { vi.unstubAllGlobals() })

function renderSettings() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminSettings />
    </QueryClientProvider>,
  )
}

describe('AdminSettings 여름 모드', () => {
  it('보여주기만 하고 끄고 켜는 스위치는 없다 (학기 일정에서 자동 계산)', async () => {
    stubConfig(true)
    renderSettings()

    // 저장된 일정이 도착해야 안내 문구/배지가 실제 값으로 채워진다.
    await screen.findByText(/여름학기\(06\.07–08\.08\)/)
    // 자동 상태 배지 — 여름학기 안이라 켜짐.
    expect(screen.getByText('자동 · 켜짐')).toBeInTheDocument()
    // 토글은 사라졌다: 여름 모드를 조작할 스위치가 없어야 한다.
    expect(screen.queryByRole('switch', { name: '여름 모드' })).not.toBeInTheDocument()
  })

  it('여름학기가 아니면 꺼짐으로 표시된다', async () => {
    stubConfig(false)
    renderSettings()

    await screen.findByText(/여름학기\(06\.07–08\.08\)/)
    expect(screen.getByText('자동 · 꺼짐')).toBeInTheDocument()
    expect(screen.queryByText('자동 · 켜짐')).not.toBeInTheDocument()
  })
})
