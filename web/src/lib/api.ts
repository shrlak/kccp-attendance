import { getDeviceId } from './device'

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  'https://loovulhchmmwagtvjnhc.supabase.co/functions/v1/attendance-api'
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

let adminPassword: string | null = null
// Set by the admin auth store after a successful verify; attached to every admin request
// alongside the X-Device-Id header (admin = personal device + master password).
export function setAdminPassword(pw: string | null) {
  adminPassword = pw
}

export async function api<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12_000)
  const headers: Record<string, string> = { 'X-Device-Id': getDeviceId() }
  if (adminPassword) headers['X-Admin-Password'] = adminPassword
  if (extraHeaders) Object.assign(headers, extraHeaders)
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

// ── Admin (hardened: personal device + master password) ───────────────────
export type AdminRole = 'super_admin' | 'leader' | 'pastor' | 'welcoming'

export interface AdminIdentity {
  role: AdminRole
  group: string
  subgroup: string
  ministry: string
}

// Verify the master password against this device's role. The password is sent as a
// one-off header here (before the store has persisted it).
export const adminVerify = (password: string) =>
  api<AdminIdentity>('POST', '/api/admin/verify', undefined, { 'X-Admin-Password': password })

export interface Member {
  id: string
  name: string
  group_name: string
  subgroup: string
  member_role: string
  phone: string
  birth_date: string | null
  kakao_id: string
  is_new_member: boolean
}

export interface RosterResponse {
  role: AdminRole
  members: Member[]
  log: unknown[]
}

// The role-scoped roster (super/pastor → all; leader → their 동산).
export const getRoster = () => api<RosterResponse>('GET', '/api/roster')

// Update the adjustable check-in window (super-admin). The master password rides the
// X-Admin-Password header set by the auth store.
export const updateCheckinWindow = (checkinDays: number[], checkinStartMin: number, checkinEndMin: number) =>
  api<{ status: string }>('POST', '/api/admin/settings', { checkinDays, checkinStartMin, checkinEndMin })
