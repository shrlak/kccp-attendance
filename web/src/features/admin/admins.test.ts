import { describe, it, expect } from 'vitest'
import { sortAdminRoles, auditDetail, roleNeedsScope, backupFilename } from './admins'
import type { AdminRoleRow } from '../../lib/api'

const row = (name: string, role: AdminRoleRow['role']): AdminRoleRow => ({
  memberId: name, name, role, group: '', subgroup: '', ministry: '',
})

describe('sortAdminRoles', () => {
  it('orders by role seniority then name', () => {
    const rows = [row('Zed', 'leader'), row('Amy', 'super_admin'), row('Bob', 'leader'), row('Cara', 'pastor')]
    expect(sortAdminRoles(rows).map((r) => r.name)).toEqual(['Amy', 'Cara', 'Bob', 'Zed'])
  })
  it('does not mutate the input', () => {
    const rows = [row('B', 'leader'), row('A', 'super_admin')]
    sortAdminRoles(rows)
    expect(rows[0].name).toBe('B')
  })
})

describe('roleNeedsScope', () => {
  it('only leader needs a group scope', () => {
    expect(roleNeedsScope('leader')).toBe(true)
    expect(roleNeedsScope('super_admin')).toBe(false)
    expect(roleNeedsScope('pastor')).toBe(false)
    expect(roleNeedsScope('welcoming')).toBe(false)
  })
})

describe('auditDetail', () => {
  it('handles string, {info}, object, and null', () => {
    expect(auditDetail('hi')).toBe('hi')
    expect(auditDetail({ info: '김호연 | 2026-06-07' })).toBe('김호연 | 2026-06-07')
    expect(auditDetail({ a: 1 })).toBe('{"a":1}')
    expect(auditDetail(null)).toBe('')
    expect(auditDetail(undefined)).toBe('')
  })
})

describe('backupFilename', () => {
  it('formats a zero-padded date into the backup filename', () => {
    expect(backupFilename(new Date(2026, 5, 9))).toBe('kccp-backup-2026-06-09.json')
    expect(backupFilename(new Date(2026, 11, 25))).toBe('kccp-backup-2026-12-25.json')
  })
})
