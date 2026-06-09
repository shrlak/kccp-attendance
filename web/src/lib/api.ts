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
  gender: string
  phone: string
  birth_date: string | null
  kakao_id: string
  is_new_member: boolean
  notes: string
  registration_date?: string | null
  new_member_edu_week1?: boolean
  new_member_edu_week2?: boolean
  pastoral_visit_requested?: boolean
}

export interface LogEntry {
  id?: number
  memberId?: string | null
  name: string
  group: string
  subgroup: string
  date: string
  time: string
  ts: number
  firstVisit?: boolean
  memberRole?: string
}

export interface RosterResponse {
  role: AdminRole
  members: Member[]
  log: LogEntry[]
}

// The role-scoped roster (super/pastor → all; leader → their 동산).
export const getRoster = () => api<RosterResponse>('GET', '/api/roster')

// Update the adjustable check-in window (super-admin). The master password rides the
// X-Admin-Password header set by the auth store.
export const updateCheckinWindow = (checkinDays: number[], checkinStartMin: number, checkinEndMin: number) =>
  api<{ status: string }>('POST', '/api/admin/settings', { checkinDays, checkinStartMin, checkinEndMin })

export interface SettingsPatch {
  announcement?: string
  summerMode?: boolean
  demoMode?: boolean
  individualCheckinEnabled?: boolean
  requireApproval?: boolean
}

// Update any subset of the app-wide settings (super-admin). Same endpoint as the
// check-in window; only the provided fields change.
export const updateSettings = (patch: SettingsPatch) =>
  api<{ status: string }>('POST', '/api/admin/settings', patch)

// 동산 (dongsan) names, keyed by group: { "대학부": [...], "청년부": [...] } (super-admin).
export type DongsanNames = Record<string, string[]>

// Read the 동산-names map (super-admin); falls back to seeded defaults server-side.
export const getDongsanNames = () =>
  api<{ names: DongsanNames }>('GET', '/api/admin/dongsan-names').then((r) => r.names)

// Replace the whole 동산-names map (super-admin). Audited as a config-change server-side.
export const updateDongsanNames = (names: DongsanNames) =>
  api<{ status: string }>('POST', '/api/admin/dongsan-names', { names })

// ── Admins tab (super-admin) ──────────────────────────────────────────────
export interface AdminRoleRow {
  memberId: string
  name: string
  role: AdminRole
  group: string
  subgroup: string
  ministry: string
}

// All admin role grants (super-admin only).
export const getAdminRoles = () => api<{ roles: AdminRoleRow[] }>('GET', '/api/admin/roles')

export interface RoleAssignment {
  memberId: string
  role: AdminRole
  group?: string
  subgroup?: string
  ministry?: string
}

// Assign/replace a member's admin role (super-admin only).
export const setAdminRole = (a: RoleAssignment) => api<{ status: string }>('POST', '/api/admin/role/set', a)

// Revoke a member's admin role (super-admin only; refuses the last super admin).
export const removeAdminRole = (memberId: string) =>
  api<{ status: string }>('POST', '/api/admin/role/remove', { memberId })

export interface AuditEntry {
  ts: number
  action: string
  adminName: string
  details: unknown
}

// Recent admin actions, newest first (super-admin only).
export const getAuditLog = (limit = 100) =>
  api<{ log: AuditEntry[] }>('GET', `/api/admin/audit?limit=${limit}`)

export interface PendingReg {
  deviceId: string
  name: string
  group: string
  subgroup: string
  requestedAt: number
}

// Pending self-registrations awaiting approval (any verified admin).
export const getPending = () => api<{ pending: PendingReg[] }>('GET', '/api/admin/pending')

// Approve a pending registration → creates/links the member + device. Pastor read-only.
export const approvePending = (deviceId: string) =>
  api<{ status: string }>('POST', '/api/admin/pending/approve', { deviceId })

// Reject (delete) a pending registration. Pastor read-only.
export const rejectPending = (deviceId: string) =>
  api<{ status: string }>('POST', '/api/admin/pending/reject', { deviceId })

export interface MemberEdit {
  name?: string
  group?: string
  subgroup?: string
  memberRole?: string
  isNewMember?: boolean
  gender?: string
  phone?: string
  kakaoId?: string
  birthDate?: string | null
  notes?: string
  registrationDate?: string | null
  newMemberEduWeek1?: boolean
  newMemberEduWeek2?: boolean
}

// Edit a member (scoped server-side: leaders only their 동산; pastor read-only).
export const updateMember = (memberId: string, fields: MemberEdit) =>
  api<{ status: string }>('PUT', '/api/admin/member', { memberId, ...fields })

// Merge one member into another: the source's devices + attendance move to the target,
// then the source member is deleted. Scoped + audited server-side (pastor read-only).
export const mergeMembers = (fromId: string, toId: string) =>
  api<{ status: string }>('POST', '/api/admin/merge', { fromId, toId })

export interface MemberCheckinResponse {
  status: 'ok' | 'already'
  time?: string
  name?: string
  firstVisit?: boolean
}

// Manually mark a member present for today (bypasses day/time/location). Scoped +
// audited server-side; pastor read-only. Returns 'already' if they're in for today.
export const memberCheckin = (memberId: string) =>
  api<MemberCheckinResponse>('POST', '/api/admin/member-checkin', { memberId })

// Add a manual attendance entry for a member on any date (back-fill). Scoped + audited;
// pastor read-only. Returns 'already' if an entry exists for that member+date.
export const addMemberAttendance = (memberId: string, date: string) =>
  api<{ status: 'ok' | 'already' }>('POST', '/api/admin/log/add', { memberId, date })

// Remove a single attendance entry by its row id. Scoped + audited; pastor read-only.
export const removeAttendance = (logId: number) =>
  api<{ status: string }>('POST', '/api/admin/log/remove', { logId })

// Add an entry for many members on a chosen date. Out-of-scope members are dropped and
// already-present ones skipped server-side; returns how many were actually added.
export const addBulkAttendance = (memberIds: string[], date: string) =>
  api<{ status: string; added: number }>('POST', '/api/admin/log/add-bulk', { memberIds, date })

// ── Backup / Restore (super-admin) ────────────────────────────────────────
// Full v2 JSON snapshot of all data (devices, log, config, events, audit, pending).
// Returned as a plain object so the caller can serialize and download it.
export const getBackup = () => api<Record<string, unknown>>('GET', '/api/admin/backup')

// Destructive restore from a previously downloaded v2 snapshot. Replaces all data
// server-side and writes a `restore` audit entry.
export const postRestore = (data: unknown) =>
  api<{ status: string }>('POST', '/api/admin/restore', data)

export interface DeviceRegister {
  deviceId: string
  name: string
  group: string
  subgroup: string
}

// Register a device (Devices tab): find-or-create the member by name, then upsert a
// device row linked to it. Scoped + audited server-side; pastor read-only.
export const registerDevice = (fields: DeviceRegister) =>
  api<{ status: string }>('POST', '/api/admin/device/register', fields)

// Link a device id to an existing member, inheriting that member's name/group/동산.
// Scoped + audited server-side; pastor read-only.
export const linkDevice = (deviceId: string, memberId: string) =>
  api<{ status: string }>('POST', '/api/admin/device/link', { deviceId, memberId })
