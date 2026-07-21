import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, getLoginPosition } from './api'
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

describe('getLoginPosition', () => {
  afterEach(() => {
    vi.useRealTimers()
    delete (navigator as unknown as { geolocation?: unknown }).geolocation
  })
  const setGeo = (geo: unknown) =>
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true })

  it('resolves null when geolocation is unavailable', async () => {
    setGeo(undefined)
    expect(await getLoginPosition()).toBeNull()
  })

  it('resolves coordinates when the position is granted', async () => {
    setGeo({ getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 40.44, longitude: -79.99, accuracy: 12 } }) })
    expect(await getLoginPosition()).toEqual({ lat: 40.44, lon: -79.99, accuracy: 12 })
  })

  it('resolves null when the position is denied', async () => {
    setGeo({ getCurrentPosition: (_ok: unknown, err: () => void) => err() })
    expect(await getLoginPosition()).toBeNull()
  })

  // The regression: a dismissed/ignored prompt where the browser invokes NEITHER callback
  // must not hang sign-in — the wall-clock guard resolves null so verify() can proceed.
  it('does not hang when getCurrentPosition never calls back (guard resolves null)', async () => {
    vi.useFakeTimers()
    setGeo({ getCurrentPosition: () => { /* never calls either callback */ } })
    const p = getLoginPosition()
    let settled = false
    void p.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(8999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(await p).toBeNull()
  })

  it('resolves null (never throws) when getCurrentPosition throws synchronously', async () => {
    setGeo({ getCurrentPosition: () => { throw new Error('blocked by permissions policy') } })
    expect(await getLoginPosition()).toBeNull()
  })
})
