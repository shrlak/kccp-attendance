import type { AdminRoleRow, AdminRole } from '../../lib/api'

const RANK: Record<AdminRole, number> = { super_admin: 0, pastor: 1, leader: 2, welcoming: 3 }

// Admin grants ordered by role seniority, then by name.
export function sortAdminRoles(rows: AdminRoleRow[]): AdminRoleRow[] {
  return [...rows].sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name))
}

// A leader grant must carry a 부서 (group); other roles are global. Drives the add form.
export function roleNeedsScope(role: AdminRole): boolean {
  return role === 'leader'
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
