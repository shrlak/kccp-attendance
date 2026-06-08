import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './api'
import { getDeviceId } from './device'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('getDeviceId', () => {
  it('creates a stable id and reuses it', () => {
    const a = getDeviceId()
    expect(a).toBeTruthy()
    expect(getDeviceId()).toBe(a)
  })
})

describe('api', () => {
  it('POSTs JSON to API_BASE + path and returns parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await api('POST', '/api/checkin', { deviceId: 'X', lat: 1, lng: 2 })
    expect(r).toEqual({ status: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/checkin')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ deviceId: 'X', lat: 1, lng: 2 })
  })
  it('sends the X-Device-Id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await api('GET', '/api/data')
    expect(fetchMock.mock.calls[0][1].headers['X-Device-Id']).toBe(getDeviceId())
  })
  it('throws on a non-2xx response, surfacing the server error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403 })))
    await expect(api('GET', '/api/data')).rejects.toThrow('Not authorized')
  })
})
