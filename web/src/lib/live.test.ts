import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'

// One fake Realtime channel per supabase.channel() call, so the refcounting below
// (one shared channel however many views are mounted) is what's under test.
const channels: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }[] = []
const removeChannel = vi.fn()

vi.mock('./supabase', () => ({
  supabase: {
    channel: vi.fn(() => {
      const ch = { on: vi.fn(() => ch), subscribe: vi.fn(() => ch), send: vi.fn() }
      channels.push(ch)
      return ch
    }),
    removeChannel,
  },
}))

// The hook only needs a query client, not a provider tree.
const qc = new QueryClient()
vi.mock('@tanstack/react-query', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => qc,
}))

const { useAttendanceLive, broadcastAttendanceChange, refreshRoster } = await import('./live')

// The broadcast handler the module registered on the live channel.
const fireBroadcast = () => {
  const handler = channels.at(-1)?.on.mock.calls.at(-1)?.[2] as (() => void) | undefined
  handler?.()
}

beforeEach(() => {
  channels.length = 0
  removeChannel.mockClear()
})

describe('useAttendanceLive', () => {
  it('joins one shared channel for several mounted views and leaves on the last unmount', () => {
    const a = renderHook(() => useAttendanceLive())
    const b = renderHook(() => useAttendanceLive())

    // Admin panel + kiosk mounted together still share a single subscription.
    expect(channels).toHaveLength(1)
    expect(channels[0].subscribe).toHaveBeenCalledTimes(1)

    a.unmount()
    expect(removeChannel).not.toHaveBeenCalled() // one view still listening

    b.unmount()
    expect(removeChannel).toHaveBeenCalledTimes(1)
  })

  it("refetches the roster when another device pings, for every mounted view", () => {
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    const a = renderHook(() => useAttendanceLive())
    const b = renderHook(() => useAttendanceLive())

    fireBroadcast()

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['roster'] })

    a.unmount()
    b.unmount()
    invalidate.mockRestore()
  })

  it('stops refetching once a view unmounts', () => {
    const a = renderHook(() => useAttendanceLive())
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()
    a.unmount()

    fireBroadcast()

    expect(invalidate).not.toHaveBeenCalled()
    invalidate.mockRestore()
  })
})

describe('refreshRoster', () => {
  it('refetches here and pings the other devices', async () => {
    const view = renderHook(() => useAttendanceLive())
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue()

    await refreshRoster(qc)

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['roster'] })
    expect(channels[0].send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'broadcast', event: 'attendance-changed' }),
    )
    // The ping carries no PII — receivers just refetch.
    expect(Object.keys(channels[0].send.mock.calls[0][0].payload)).toEqual(['ts'])
    invalidate.mockRestore()
    view.unmount()
  })

  it('is a no-op when no channel is joined (e.g. tests, offline)', () => {
    expect(() => broadcastAttendanceChange()).not.toThrow()
    expect(channels).toHaveLength(0)
  })
})
