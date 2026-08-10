import type { AdminRoleRow, AdminRole, DbBackupEntry, LoginLocation, LoginLogEntry } from '../../lib/api'

// 'staff' is a synthetic break-glass role, never stored as an admin row, so its rank only
// satisfies the exhaustive Record type; it won't actually appear in the admins list.
const RANK: Record<AdminRole, number> = { super_admin: 0, pastor: 1, leader: 2, welcoming: 3, staff: 4 }

// Admin grants ordered by role seniority, then by name.
export function sortAdminRoles(rows: AdminRoleRow[]): AdminRoleRow[] {
  return [...rows].sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name))
}

// A leader grant must carry a 부서 (group); other roles are global. Drives the add form.
export function roleNeedsScope(role: AdminRole): boolean {
  return role === 'leader'
}

// One display line for a login's IP-derived place — "City, Region, Country" with empty
// parts dropped; '' when nothing resolved (private IP, or the lookup hasn't run yet).
export function formatLoginLocation(loc: LoginLocation | null | undefined): string {
  if (!loc) return ''
  return [loc.city, loc.region, loc.country].filter(Boolean).join(', ')
}

// Best available location for a login entry: the precise device GPS (street-level address,
// or raw coordinates until reverse-geocoded) when the admin allowed location at sign-in,
// otherwise the approximate city-level IP estimate. `precise` distinguishes the two so the
// UI can label + map them accordingly; `lat`/`lon` drive the map link.
export interface LoginLocationDisplay {
  text: string
  lat: number | null
  lon: number | null
  accuracy: number | null
  precise: boolean
}
export function loginLocationDisplay(e: Pick<LoginLogEntry, 'location' | 'gps'>): LoginLocationDisplay {
  if (e.gps) {
    return {
      text: e.gps.address || `${e.gps.lat.toFixed(5)}, ${e.gps.lon.toFixed(5)}`,
      lat: e.gps.lat,
      lon: e.gps.lon,
      accuracy: e.gps.accuracy,
      precise: true,
    }
  }
  return { text: formatLoginLocation(e.location), lat: e.location?.lat ?? null, lon: e.location?.lon ?? null, accuracy: null, precise: false }
}

// ── 로그인 기록을 주소별로 가른다 ─────────────────────────────────────────────────────
//
// 한 줄로 쭉 이어진 목록에서는 "이 주소에서 몇 번 들어왔나"를 눈으로 세야 한다. 그런데 이
// 기록을 보는 이유는 대개 **장소**다 — 낯선 곳에서 들어온 로그인이 있는가. 그래서 주소를
// 묶음의 제목으로 올리고, 그 아래에 그 주소에서 있었던 로그인을 시간순으로 둔다.
//
// 정확(GPS 주소)과 대략(IP 도시 추정)은 **따로 묶는다.** 같은 도시라도 "5000 Fifth Ave"와
// "Pittsburgh, Pennsylvania, US"는 다른 주장이다 — 하나로 합치면 정확한 주소가 도시 하나로
// 뭉개지거나, 도시 추정이 실제 주소인 것처럼 읽힌다.
export interface LoginLocationGroup {
  /** 묶음의 정체성 — 정확/대략 + 주소 문자열. React key로도 쓴다. */
  key: string
  /** 화면에 걸리는 주소. 아무것도 풀리지 않은 로그인들의 묶음에서는 ''. */
  text: string
  precise: boolean
  lat: number | null
  lon: number | null
  /** 이 주소에서 있었던 로그인 — 새 것부터. */
  entries: LoginLogEntry[]
  /** 이 주소에서 가장 최근 로그인 시각 — 묶음끼리의 순서를 정한다. */
  latestTs: number
}

export function groupLoginsByLocation(entries: LoginLogEntry[]): LoginLocationGroup[] {
  const groups = new Map<string, LoginLocationGroup>()
  for (const e of entries) {
    const loc = loginLocationDisplay(e)
    // 좌표만 있고 주소가 아직 안 풀린 것들은 좌표 문자열이 곧 이름이라 자연히 갈린다.
    // 아무것도 없는 것들(사설 IP 등)은 '위치 없음' 하나로 모인다.
    const key = loc.text ? `${loc.precise ? 'gps' : 'ip'}:${loc.text}` : 'none'
    const found = groups.get(key)
    if (found) {
      found.entries.push(e)
      if (e.ts > found.latestTs) found.latestTs = e.ts
      continue
    }
    groups.set(key, {
      key,
      text: loc.text,
      precise: loc.text ? loc.precise : false,
      lat: loc.lat,
      lon: loc.lon,
      entries: [e],
      latestTs: e.ts,
    })
  }
  // 최근에 쓰인 주소가 위로. 위치 없는 묶음은 언제나 맨 아래 — 볼 것이 없는 묶음이다.
  return [...groups.values()].sort((a, b) => {
    if (!a.text !== !b.text) return a.text ? -1 : 1
    return b.latestTs - a.latestTs
  })
}

// Flatten an audit entry's details (string, {info}, or arbitrary object) to one line.
export function auditDetail(details: unknown): string {
  if (details == null) return ''
  if (typeof details === 'string') return details
  if (typeof details === 'object' && 'info' in (details as Record<string, unknown>)) {
    return String((details as Record<string, unknown>).info)
  }
  return JSON.stringify(details)
}

// Human-readable file size, e.g. 1234 -> "1.2 KB". Decimal (1000-based), matching
// scripts/backup/prune-retention.py's GB math so the two size displays agree.
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let i = 0
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}

// Prefer the server-computed encrypted payload size, but derive it for legacy dated
// entries returned during the one-time transition to the stable current.* object names.
export function backupTotalSize(backup: DbBackupEntry): number | undefined {
  if (backup.totalSize != null) return backup.totalSize
  if (backup.sqlSize == null && backup.schemaSize == null) return undefined
  return (backup.sqlSize ?? 0) + (backup.schemaSize ?? 0)
}

// Percent of the backup-storage allowance used, clamped to [0, 100] for the bar width.
export function storagePercent(usedBytes: number, limitBytes: number): number {
  if (!(limitBytes > 0)) return 0
  return Math.min(100, Math.max(0, (usedBytes / limitBytes) * 100))
}

// Label next to the bar: tiny-but-nonzero usage reads "<0.1%" instead of a misleading
// "0.0%" (a few hundred KB of encrypted dump against a 10 GB allowance rounds to zero).
export function formatStoragePercent(usedBytes: number, limitBytes: number): string {
  const pct = storagePercent(usedBytes, limitBytes)
  if (usedBytes > 0 && pct < 0.1) return '<0.1%'
  return `${pct.toFixed(1)}%`
}

// Backup times are operational Pittsburgh times regardless of the browser's location.
export function formatBackupTimestamp(updatedAt: string | undefined, locale = 'ko'): string {
  if (!updatedAt) return ''
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale, {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}
