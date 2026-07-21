import type { AdminRoleRow, AdminRole, DbBackupEntry, LoginLocation } from '../../lib/api'

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

// Flatten an audit entry's details (string, {info}, or arbitrary object) to one line.
export function auditDetail(details: unknown): string {
  if (details == null) return ''
  if (typeof details === 'string') return details
  if (typeof details === 'object' && 'info' in (details as Record<string, unknown>)) {
    return String((details as Record<string, unknown>).info)
  }
  return JSON.stringify(details)
}

// Filename for a downloaded backup, e.g. kccp-backup-2026-06-09.json. Defaults to
// today's local date so the file sorts chronologically and is easy to identify.
export function backupFilename(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `kccp-backup-${y}-${m}-${d}.json`
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
