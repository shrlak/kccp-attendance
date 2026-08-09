import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, configFor, getLoginPosition, GEO_LOGIN_WAIT_MS } from './api'
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

  // 로그인은 GPS를 오래 기다리지 않는다: 2초 안에 안 잡히면 좌표 없이 진행하고, 서버가
  // IP 기준(대략) 위치로 대신 기록한다. 이게 "로그인이 멈춰 있다"의 원인이었다.
  it('gives up after the caller-supplied deadline — a sign-in never waits 9s for a fix', async () => {
    vi.useFakeTimers()
    setGeo({ getCurrentPosition: () => { /* a cold fix that never lands in time */ } })
    const p = getLoginPosition(GEO_LOGIN_WAIT_MS)
    let settled = false
    void p.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(GEO_LOGIN_WAIT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(await p).toBeNull()
  })

  it('still returns a fix that lands inside the deadline', async () => {
    setGeo({ getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 40.44, longitude: -79.99, accuracy: 8 } }) })
    expect(await getLoginPosition(GEO_LOGIN_WAIT_MS)).toEqual({ lat: 40.44, lon: -79.99, accuracy: 8 })
  })
})

// /api/config는 무인증 경로라 두 부의 설정을 한꺼번에 내려주고, 고르는 일은 클라이언트가 한다
// (useAppConfig). 잘못 고르면 장년부 화면이 대학·청년부 학기 일정으로 출석부를 그리게 된다.
describe('configFor — 로그인한 부의 설정을 고른다', () => {
  const cfg = {
    summerMode: true,
    groupColors: { 대학부: '#E0A800' },
    semesterDates: null,
    semesterSchedule: [{ year: 2026, season: 'fall', start: '2026-08-24', end: '2026-12-13' }],
    adult: {
      summerMode: false,
      groupColors: { 장년부: '#10B981' },
      semesterDates: null,
      semesterSchedule: [{ year: 2026, season: 'fall', start: '2026-09-07', end: '2026-12-20' }],
    },
  } as never

  it('대학·청년부는 최상위 블록을 그대로 쓴다', () => {
    expect(configFor(cfg, 'youth')?.groupColors).toEqual({ 대학부: '#E0A800' })
    expect(configFor(cfg, 'youth')?.summerMode).toBe(true)
  })

  it('장년부는 adult 블록 — 다른 부의 학기 일정이 새어 들어오지 않는다', () => {
    const adult = configFor(cfg, 'adult')
    expect(adult?.groupColors).toEqual({ 장년부: '#10B981' })
    expect(adult?.semesterSchedule?.[0].start).toBe('2026-09-07')
    expect(adult?.summerMode).toBe(false)
  })

  // 엣지 함수를 아직 새로 배포하지 않았거나 캐시된 예전 응답이면 adult 블록이 없다. 그럴 때
  // 대학·청년부 설정으로 되돌아가면 장년부 출석부가 남의 학기로 그려진다 — 빈 값이 낫다.
  it('adult 블록이 없으면 대학·청년부 설정으로 떨어지지 않고 빈 설정을 준다', () => {
    const old = { summerMode: true, groupColors: { 대학부: '#E0A800' } } as never
    expect(configFor(old, 'adult')).toEqual({
      summerMode: false, groupColors: {}, semesterDates: null, semesterSchedule: [],
    })
  })

  it('설정을 아직 못 받았으면 undefined', () => {
    expect(configFor(undefined, 'adult')).toBeUndefined()
  })
})
