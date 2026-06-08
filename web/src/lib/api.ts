import { getDeviceId } from './device'

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  'https://loovulhchmmwagtvjnhc.supabase.co/functions/v1/attendance-api'
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

export async function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12_000)
  const headers: Record<string, string> = { 'X-Device-Id': getDeviceId() }
  if (body) headers['Content-Type'] = 'application/json'
  try {
    const resp = await fetch(API_BASE + path, {
      method,
      headers,
      signal: ctrl.signal,
      body: body ? JSON.stringify(body) : undefined,
    })
    clearTimeout(timer)
    // The edge function returns JSON for both success and error responses, and uses
    // 200 for business statuses (e.g. "already", "time-restricted"). Only a non-2xx
    // status is a real failure — surface it so TanStack Query marks the query errored.
    const data = await resp.json().catch(() => null)
    if (!resp.ok) {
      const msg =
        data && typeof data === 'object' && 'error' in data
          ? String((data as { error: unknown }).error)
          : `HTTP ${resp.status}`
      throw new Error(msg)
    }
    if (data === null) throw new Error(`HTTP ${resp.status} — non-JSON response`)
    return data as T
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

// Phase-0 response shapes (from the attendance-api edge function)
export interface AppConfig {
  announcement: string
  checkinDays: number[]
  checkinStartMin: number
  checkinEndMin: number
  requireApproval: boolean
  summerMode: boolean
  demoMode: boolean
  individualCheckinEnabled: boolean
}

export const getConfig = () => api<AppConfig>('GET', '/api/config')

// ── Public check-in (anonymous, device-id based) ──────────────────────────
// These endpoints take the device id in the body (the edge function reads
// body.deviceId for /api/checkin & /api/self-register), in addition to the
// X-Device-Id header the api() wrapper always sends.

export interface CheckinResponse {
  status: 'ok' | 'already' | 'time-restricted' | 'location-restricted' | 'location-required'
  time?: string
  name?: string
  group?: string
  subgroup?: string
  isRegistered?: boolean
  totalAttendance?: number
  firstVisit?: boolean
  message?: string
  sub?: string
  distance?: number
}

export const postCheckin = (lat: number | null, lng: number | null) =>
  api<CheckinResponse>('POST', '/api/checkin', { deviceId: getDeviceId(), lat, lng })

export interface SelfRegisterResponse {
  status: 'ok' | 'pending' | 'already-registered'
  name?: string
  combined?: boolean
}

export const selfRegister = (name: string, group: string, subgroup = '') =>
  api<SelfRegisterResponse>('POST', '/api/self-register', { deviceId: getDeviceId(), name, group, subgroup })
