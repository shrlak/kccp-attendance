import { getDeviceId } from './device'
import type { SemesterDates } from './semester'

const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  'https://loovulhchmmwagtvjnhc.supabase.co/functions/v1/attendance-api'
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'

let adminPassword: string | null = null
let adminToken: string | null = null

export function setAdminPassword(pw: string | null) { adminPassword = pw }
// Set by the auth store after a successful Google sign-in; sent as Authorization: Bearer.
export function setAdminToken(token: string | null) { adminToken = token }

export async function api<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
  // Nearly everything answers well under 12s; slow endpoints (e.g. Gemini card
  // extraction) pass their own budget.
  timeoutMs = 12_000,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const headers: Record<string, string> = { 'X-Device-Id': getDeviceId() }
  if (adminToken) headers['Authorization'] = `Bearer ${adminToken}`
  else if (adminPassword) headers['X-Admin-Password'] = adminPassword
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
  summerMode: boolean
  // 대학부/청년부 accent colors (hex, e.g. "#E0A800") — drives the 오늘 tab's name icons,
  // the kiosk's per-부서 tile backgrounds, and the 멤버 tab's per-부서 card backgrounds.
  // Keyed by group name; falls back to DEFAULT_GROUP_COLORS (./features/admin/groupColors)
  // for any group not present.
  groupColors: Record<string, string>
  // Optional until the semester-dates migration is applied and a super-admin saves a
  // schedule. Consumers retain the legacy boundaries when this is null/absent.
  semesterDates?: SemesterDates | null
}

export const getConfig = () => api<AppConfig>('GET', '/api/config')

// ── Admin (hardened: Google JWT, or a shared team password from any device) ───
// Three break-glass passwords route a password-only login on an unroled device to a role:
// the super password → 'super_admin' (full panel), the leader password → 'leader' (리더
// dashboard), the welcoming password → 'welcoming' (새가족팀 dashboard). All get full-roster
// visibility; the server synthesizes them (see auth.ts verifyAdmin). 'staff' is the legacy
// combined break-glass role, kept for back-compat.
export type AdminRole = 'super_admin' | 'leader' | 'pastor' | 'welcoming' | 'staff'

export interface AdminIdentity {
  role: AdminRole
  group: string
  subgroup: string
  ministry: string
  // True only for the designated login-log viewer (김호연), signed in attributably —
  // linked device or Google email, never a bare shared password. Server-decided
  // (auth.ts canViewLoginLog); gates the login-history section in the Admins tab.
  canViewLoginLog?: boolean
}

// Precise sign-in coordinates from the browser's Geolocation API, attached to the login
// record so the login-history viewer sees a street-level location. null unless the admin
// allowed the permission prompt.
export interface LoginCoords { lat: number; lon: number; accuracy: number | null }

// Ask the browser for the device's current position, best-effort: resolves the coordinates
// if the admin allows the prompt, or null on denial / no support / timeout — the caller then
// signs in without GPS and the server falls back to the city-level IP estimate.
//
// CRITICAL: this must never block sign-in. getCurrentPosition can hang indefinitely — its
// `timeout` option only bounds position *acquisition*, not the wait for the permission
// prompt, so a user who dismisses (rather than answers) the prompt, or a browser that
// silently withholds the callbacks, leaves it pending forever. Since verify() awaits this,
// an unbounded hang would freeze the login on "verifying". So we wrap it in our own
// wall-clock guard that always resolves (null) after GUARD_MS regardless of the API.
const GEO_GUARD_MS = 9000
export function getLoginPosition(): Promise<LoginCoords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    let settled = false
    const done = (v: LoginCoords | null) => {
      if (settled) return
      settled = true
      clearTimeout(guard)
      resolve(v)
    }
    const guard = setTimeout(() => done(null), GEO_GUARD_MS)
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => done({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null }),
        () => done(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 300_000 },
      )
    } catch {
      done(null)
    }
  })
}

function geoHeaders(coords?: LoginCoords | null): Record<string, string> {
  if (!coords) return {}
  const h: Record<string, string> = { 'X-Geo-Lat': String(coords.lat), 'X-Geo-Lon': String(coords.lon) }
  if (coords.accuracy != null) h['X-Geo-Acc'] = String(coords.accuracy)
  return h
}

// Verify a shared team password (break-glass): works from any device. A device linked to a
// roled member keeps that scope; any other device is granted the role the password maps to
// — 'super_admin', 'leader', or 'welcoming', full roster (see auth.ts verifyAdmin). When
// coords are supplied (admin allowed the location prompt) they ride along for the log.
export const adminVerify = (password: string, coords?: LoginCoords | null) =>
  api<AdminIdentity>('POST', '/api/admin/verify', undefined, { 'X-Admin-Password': password, ...geoHeaders(coords) })

// Verify via Google JWT (token already set via setAdminToken before calling this).
export const adminVerifyGoogle = (coords?: LoginCoords | null) =>
  api<AdminIdentity>('POST', '/api/admin/verify', undefined, geoHeaders(coords))

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
  // 새가족 교육 동산: a temporary 동산 assignment used only during newcomer education,
  // separate from the member's eventual regular 동산 (subgroup above).
  new_member_dongsan?: string
  pastoral_visit_requested?: boolean | null
  // 새가족 등록 카드 fields (stored on members; /api/roster returns them via select *).
  baptism_status?: string
  school_or_work?: string
  faith_duration?: string
  is_staff?: boolean
  // 상태 표기 (master-sheet grey marks: 한국 귀국 / 이주 / 돌아옴 …). The 출석부 renders the
  // note as a grey cell spanning status_start → status_end (null = the term's last Sunday).
  status_note?: string
  status_start?: string | null
  status_end?: string | null
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

// One retired term's 동산 편성, frozen by the server the day the term ended (the live
// assignment is cleared at that point). Keyed by member id → 동산.
export interface TermDongsan {
  endedAt: string
  subgroups: Record<string, string>
}

export interface RosterResponse {
  role: AdminRole
  members: Member[]
  log: LogEntry[]
  // 학기 종료 시 얼려둔 동산 편성, 학기 키("2026-summer")별 — 지난 학기 출석부가 그 학기의
  // 동산 블록을 유지하는 근거. Scoped to the members this admin can see.
  dongsanHistory?: Record<string, TermDongsan>
  // True for super-admins and leaders who are NOT a 동산지기/부동산지기 — they may bulk
  // reassign members' 동산 (feature-gated client-side; enforced server-side too).
  canBulkSubgroup?: boolean
  // True for super-admins (clear directly) + leader/welcoming non-동산지기 (request a clear).
  canClearAttendance?: boolean
}

// The role-scoped roster (super/pastor → all; leader → their 동산).
export const getRoster = () => api<RosterResponse>('GET', '/api/roster')

// Bulk-set the 동산 (subgroup) of many members at once; subgroup "" removes them from any
// 동산. super-admin or a non-동산지기 leader; out-of-scope members dropped + audited
// server-side. Returns how many were actually updated.
export const bulkSetSubgroup = (memberIds: string[], subgroup: string) =>
  api<{ status: string; updated: number }>('POST', '/api/admin/members/bulk-subgroup', { memberIds, subgroup })

// ── Clear all attendance (super clears directly; others request → super approves) ─────
export interface ClearRequest {
  requestedBy: string
  requestedByName: string
  requestedAt: number
}

// Wipe all attendance. super-admin → { status:'cleared' }; an allowed non-super admin →
// { status:'pending' } (held for a super-admin to approve). Audited server-side.
export const clearAttendance = () =>
  api<{ status: 'cleared' | 'pending' }>('POST', '/api/admin/attendance/clear')

// Pending clear-all requests (super-admin only).
export const getClearPending = () =>
  api<{ pending: ClearRequest[] }>('GET', '/api/admin/attendance/clear-pending').then((r) => r.pending)

// Approve a pending clear → wipes all attendance + empties the queue (super-admin only).
export const approveClear = () => api<{ status: string }>('POST', '/api/admin/attendance/clear-approve')

// Dismiss/reject pending clear requests (super-admin only).
export const rejectClear = () => api<{ status: string }>('POST', '/api/admin/attendance/clear-reject')

// 여름 모드 is not here: it is derived from semesterDates server-side (여름학기 기간이면 on),
// so there is nothing to set.
export interface SettingsPatch {
  groupColors?: Record<string, string>
  semesterDates?: SemesterDates
}

// Update any subset of the app-wide settings (super-admin). Only the provided
// fields change.
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

// 새가족 교육 동산 names, keyed by group — a SEPARATE list from getDongsanNames, used only
// for a newcomer's temporary education-track 동산 (Member.new_member_dongsan). Same shape
// and summer-mode 합동 behavior as the regular 동산 names.
export const getNewMemberDongsanNames = () =>
  api<{ names: DongsanNames }>('GET', '/api/admin/new-member-dongsan-names').then((r) => r.names)

export const updateNewMemberDongsanNames = (names: DongsanNames) =>
  api<{ status: string }>('POST', '/api/admin/new-member-dongsan-names', { names })

// ── 동산지기 / 부동산지기 display roles ────────────────────────────────────
// The 동산지기 (leader, 👑) + 부동산지기 (sub-leaders, ⭐) per 동산. This is a display
// badge system distinct from the `leader` admin role (which controls data scope). The
// map is keyed by group (or "합동" in summer mode), then by 동산 name.
export interface DongsanLeaderEntry {
  leader: string
  subLeaders: string[]
}
export type DongsanLeaders = Record<string, Record<string, DongsanLeaderEntry>>

// Read the 동산지기 map (any verified admin — badges show for everyone who can see the
// roster). Falls back to {} server-side.
export const getDongsanLeaders = () =>
  api<{ leaders: DongsanLeaders }>('GET', '/api/admin/dongsan-leaders').then((r) => r.leaders)

// Set one 동산's leader + sub-leaders (super-admin only). In summer mode pass group "합동".
export const setDongsanLeader = (group: string, subgroup: string, leader: string, subLeaders: string[]) =>
  api<{ status: string }>('POST', '/api/admin/dongsan-leaders', { group, subgroup, leader, subLeaders })

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

// Approximate place a login IP resolves to (city-level — an IP can never give a
// GPS-exact position). null while unresolved; empty fields for private/reserved IPs.
export interface LoginLocation {
  city: string
  region: string
  country: string
  lat: number | null
  lon: number | null
  org: string
}

// Precise device-GPS location for a login, present only when the admin allowed the browser
// location prompt at sign-in. `address` is the reverse-geocoded street-level address (''
// until resolved or if the geocoder had nothing); accuracy is the browser's radius in m.
export interface LoginGps {
  lat: number
  lon: number
  accuracy: number | null
  address: string
}

export interface LoginLogEntry {
  ts: number
  role: AdminRole
  // The linked member's name when the sign-in device maps to one; '' for a pure
  // break-glass login (shared password on an unlinked device).
  memberName: string
  deviceId: string
  ip: string
  method: 'password' | 'google'
  // City-level IP estimate — the fallback when GPS wasn't granted.
  location: LoginLocation | null
  // Precise device GPS, when the admin allowed it. Preferred over `location`.
  gps: LoginGps | null
}

// Successful admin sign-ins — which account, when, from which IP/device, and the IP's
// approximate place — newest first. Restricted to the designated viewer (김호연): other
// super-admins get a 403 (see identity.canViewLoginLog). Repeat re-verifies within an
// hour are collapsed server-side.
export const getLoginLog = (limit = 100) =>
  api<{ log: LoginLogEntry[] }>('GET', `/api/admin/login-log?limit=${limit}`)

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
  newMemberDongsan?: string
  // 새가족 등록 카드 fields (the member-update endpoint maps them in its COLS table).
  baptismStatus?: string
  schoolOrWork?: string
  faithDuration?: string
  pastoralVisitRequested?: boolean | null
  statusNote?: string
  statusStart?: string | null
  statusEnd?: string | null
}

// Edit a member (scoped server-side: leaders only their 동산; pastor read-only).
export const updateMember = (memberId: string, fields: MemberEdit) =>
  api<{ status: string }>('PUT', '/api/admin/member', { memberId, ...fields })

// Merge one member into another: the source's devices + attendance move to the target,
// then the source member is deleted. Scoped + audited server-side (pastor read-only).
export const mergeMembers = (fromId: string, toId: string) =>
  api<{ status: string }>('POST', '/api/admin/merge', { fromId, toId })

// Delete a member entirely (their devices + attendance rows go too). Scoped + audited
// server-side; pastor read-only. Irreversible.
export const deleteMember = (memberId: string) =>
  api<{ status: string }>('POST', '/api/admin/member/delete', { memberId })

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

// ── Off-site encrypted DB backup (super-admin) ────────────────────────────
// The full weekly Postgres dump pipeline to Cloudflare R2 (scripts/backup/,
// .github/workflows/backup.yml) — the only backup/restore path in the app.
export interface DbBackupEntry {
  date: string
  current: boolean
  updatedAt?: string
  totalSize?: number
  sqlKey?: string
  sqlSize?: number
  schemaKey?: string
  schemaSize?: number
}

// Bucket-level storage usage returned alongside the backup list so the UI can render a
// limit bar. limitBytes defaults server-side to the R2 free tier (10 GB, decimal).
export interface DbBackupStorage {
  usedBytes: number
  limitBytes: number
}

// Triggers the scheduled GH Actions workflow immediately instead of waiting for Sunday.
export const runDbBackupNow = () => api<{ status: string }>('POST', '/api/admin/db-backup/run')

export const listDbBackups = () =>
  api<{ backups: DbBackupEntry[]; storage?: DbBackupStorage }>('GET', '/api/admin/db-backup/list')

// Short-lived presigned R2 URL — the browser downloads the still-encrypted file directly.
export const getDbBackupDownloadUrl = (key: string) =>
  api<{ url: string }>('GET', `/api/admin/db-backup/download?key=${encodeURIComponent(key)}`)

export interface RestoreDbBackupPayload {
  source: 'online' | 'upload'
  key?: string
  fileBase64?: string
  privateKey: string
  confirm: string
}

// Destructive: decrypts the given backup with a private key supplied fresh in this one
// call (never persisted anywhere) and replaces every table's contents. Requires the
// literal confirmation phrase "RESTORE" as a server-side backstop behind the UI's own
// confirm gate. Generous timeout — decrypt + full-table reload over a cold pooler
// connection can run past the default budget even though this DB is tiny.
export const restoreDbBackup = (payload: RestoreDbBackupPayload) =>
  api<{ status: string; tables: number }>('POST', '/api/admin/db-backup/restore', payload, undefined, 60_000)

// ── Kiosk (runs on a verified admin device) ───────────────────────────────
// Guest (방문자) check-in from the kiosk: records a visitor attendance row for today
// (is_manual + is_guest, member_role "visitor"), bypassing day/time/location. Hardened
// (verifyAdmin) + audited server-side; pastor read-only. Deduped by name+date.
// `group` (대학부/청년부) puts the visitor on that 부서's 오늘 sheet / 출석부 이미지.
export const guestCheckin = (name: string, group: string) =>
  api<{ status: 'ok' | 'already'; time?: string; name?: string }>('POST', '/api/admin/guest-checkin', { name, group })

export interface NewMemberFields {
  name: string
  group: string
  subgroup?: string
  gender?: string
  phone?: string
  kakaoId?: string
  birthDate?: string | null
  baptismStatus?: string
  schoolOrWork?: string
  faithDuration?: string
  // 등록일 (registration date). Optional; server defaults to today when omitted.
  registrationDate?: string | null
  pastoralVisitRequested?: boolean | null
  // Admin card-scan path: create the member + device but skip today's attendance row
  // (e.g. entering a stack of paper cards later in the week). Kiosk never sends this.
  skipCheckin?: boolean
}

// 새가족 (new-family) registration from the kiosk: creates a member with
// is_new_member=true + a NEW-{ts} device, then records today's attendance (first_visit)
// unless skipCheckin. Hardened (verifyAdmin) + audited server-side; pastor read-only.
export const kioskNewMember = (fields: NewMemberFields) =>
  api<{ status: 'ok'; memberId: string; time?: string }>('POST', '/api/admin/kiosk-new-member', fields)

// 새가족 등록 카드 photo extraction: sends a downscaled card photo (base64) to the edge
// function, which has a vision model read the handwriting/checkboxes into raw card JSON —
// normalized client-side (cardExtraction.ts) before showing it for review. Nothing is
// saved server-side. `cards` holds every card found in the photo (a stack photographed
// in one shot yields several); `card` is the first one, kept for older clients. `model`
// names the free model that read it — the server falls back through a chain of them, so
// a single call can take well over the default 12s budget.
export const extractCard = (image: string, mediaType: string) =>
  api<{ status: 'ok'; cards?: Record<string, unknown>[]; card?: Record<string, unknown>; model?: string; usage: CardScanUsage }>('POST', '/api/admin/extract-card', { image, mediaType }, undefined, 60_000)

export interface CardScanUsage {
  limit: number
  remaining: number
  day: string
  resetsAt: number
  updatedAt: number
}

// Live card-recognition API-call allowance for the current Pittsburgh day (any verified
// admin). The server counts every outbound Gemini request, including failed responses;
// only the number remaining is exposed, and the daily limit is super-admin-configurable.
export const getCardScanUsage = () => api<CardScanUsage>('GET', '/api/admin/card-scan-usage')

// ── Share-link card registration (no login) ──────────────────────────────────
// share.html registers 새가족 cards without any sign-in, so it calls the unauthenticated
// twins of the three endpoints above. Server-side they run the same code paths and draw
// on the same shared daily scan quota; the only difference is that no admin role is
// resolved. Anyone holding the link can register a card — that is the intent.
export const extractCardViaShare = (image: string, mediaType: string) =>
  api<{ status: 'ok'; cards?: Record<string, unknown>[]; card?: Record<string, unknown>; model?: string; usage: CardScanUsage }>('POST', '/api/share/extract-card', { image, mediaType }, undefined, 60_000)

export const shareNewMember = (fields: NewMemberFields) =>
  api<{ status: 'ok'; memberId: string; time?: string }>('POST', '/api/share/new-member', fields)

export const getShareCardScanUsage = () => api<CardScanUsage>('GET', '/api/share/card-scan-usage')
