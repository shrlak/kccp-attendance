import { describe, it, expect } from 'vitest'
import {
  sortAdminRoles,
  auditDetail,
  formatLoginLocation,
  loginLocationDisplay,
  groupLoginsByLocation,
  roleNeedsScope,
  formatBytes,
  backupTotalSize,
  formatBackupTimestamp,
  storagePercent,
  formatStoragePercent,
} from './admins'
import type { AdminRoleRow, DbBackupEntry, LoginLogEntry } from '../../lib/api'

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

describe('formatBytes', () => {
  it('stays in bytes under 1000', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
  })
  it('steps up through KB/MB/GB', () => {
    expect(formatBytes(1000)).toBe('1.0 KB')
    expect(formatBytes(123_456)).toBe('123.5 KB')
    expect(formatBytes(1_500_000)).toBe('1.5 MB')
    expect(formatBytes(2_300_000_000)).toBe('2.3 GB')
  })
})

describe('backup metadata', () => {
  const backup: DbBackupEntry = {
    date: '2026-07-19',
    current: true,
    sqlSize: 1_500_000,
    schemaSize: 250_000,
  }

  it('uses the encrypted SQL and schema sizes when the API total is absent', () => {
    expect(backupTotalSize(backup)).toBe(1_750_000)
    expect(backupTotalSize({ ...backup, totalSize: 2_000_000 })).toBe(2_000_000)
  })

  it('formats the completion time in Pittsburgh rather than the browser timezone', () => {
    expect(formatBackupTimestamp('2026-07-19T21:15:00.000Z', 'en-US')).toContain('5:15 PM')
    expect(formatBackupTimestamp(undefined, 'en-US')).toBe('')
    expect(formatBackupTimestamp('not-a-date', 'en-US')).toBe('')
  })
})

describe('backup storage usage', () => {
  it('computes a clamped percent', () => {
    expect(storagePercent(0, 10e9)).toBe(0)
    expect(storagePercent(5e9, 10e9)).toBe(50)
    expect(storagePercent(20e9, 10e9)).toBe(100)
    expect(storagePercent(1, 0)).toBe(0)
  })

  it('labels tiny-but-nonzero usage as <0.1% instead of rounding to zero', () => {
    expect(formatStoragePercent(0, 10e9)).toBe('0.0%')
    expect(formatStoragePercent(700_000, 10e9)).toBe('<0.1%')
    expect(formatStoragePercent(1.5e9, 10e9)).toBe('15.0%')
    expect(formatStoragePercent(10e9, 10e9)).toBe('100.0%')
  })
})

describe('formatLoginLocation', () => {
  const loc = { city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', lat: 40.44, lon: -79.99, org: 'Comcast' }
  it('joins city, region, country', () => {
    expect(formatLoginLocation(loc)).toBe('Pittsburgh, Pennsylvania, United States')
  })
  it('drops empty parts', () => {
    expect(formatLoginLocation({ ...loc, city: '', region: '' })).toBe('United States')
  })
  it('is empty for unresolved or private-IP entries', () => {
    expect(formatLoginLocation(null)).toBe('')
    expect(formatLoginLocation(undefined)).toBe('')
    expect(formatLoginLocation({ city: '', region: '', country: '', lat: null, lon: null, org: '' })).toBe('')
  })
})

describe('loginLocationDisplay', () => {
  const ipLoc = { city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', lat: 40.44, lon: -79.99, org: 'Comcast' }
  it('prefers precise GPS with its reverse-geocoded address', () => {
    const d = loginLocationDisplay({ location: ipLoc, gps: { lat: 40.4502, lon: -79.9348, accuracy: 12, address: '123 Main St, Pittsburgh, PA' } })
    expect(d).toEqual({ text: '123 Main St, Pittsburgh, PA', lat: 40.4502, lon: -79.9348, accuracy: 12, precise: true })
  })
  it('falls back to raw GPS coordinates when the address has not resolved yet', () => {
    const d = loginLocationDisplay({ location: null, gps: { lat: 40.45021, lon: -79.93481, accuracy: 8, address: '' } })
    expect(d.precise).toBe(true)
    expect(d.text).toBe('40.45021, -79.93481')
  })
  it('falls back to the city-level IP estimate when no GPS was granted', () => {
    const d = loginLocationDisplay({ location: ipLoc, gps: null })
    expect(d).toEqual({ text: 'Pittsburgh, Pennsylvania, United States', lat: 40.44, lon: -79.99, accuracy: null, precise: false })
  })
  it('is empty when neither GPS nor IP resolved', () => {
    const d = loginLocationDisplay({ location: null, gps: null })
    expect(d.text).toBe('')
    expect(d.lat).toBeNull()
  })
})

describe('groupLoginsByLocation', () => {
  const ipLoc = { city: 'Pittsburgh', region: 'Pennsylvania', country: 'United States', lat: 40.44, lon: -79.99, org: 'Comcast' }
  const entry = (extra: Partial<LoginLogEntry> = {}): LoginLogEntry => ({
    ts: 1_000, role: 'super_admin', memberName: '김호연', deviceId: 'DEV-1', ip: '1.2.3.4',
    method: 'google', location: null, gps: null, ...extra,
  })
  const home = { lat: 40.4502, lon: -79.9348, accuracy: 12, address: '123 Main St, Pittsburgh, PA' }
  const office = { lat: 40.4433, lon: -79.9436, accuracy: 20, address: '5000 Forbes Ave, Pittsburgh, PA' }

  it('한 주소의 로그인은 한 묶음으로 모인다', () => {
    const groups = groupLoginsByLocation([
      entry({ ts: 3, gps: home }),
      entry({ ts: 2, gps: office }),
      entry({ ts: 1, gps: home }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].text).toBe('123 Main St, Pittsburgh, PA')
    expect(groups[0].entries.map((e) => e.ts)).toEqual([3, 1])
    expect(groups[1].entries.map((e) => e.ts)).toEqual([2])
  })

  it('가장 최근에 쓰인 주소가 위로 온다', () => {
    const groups = groupLoginsByLocation([
      entry({ ts: 5, gps: office }),
      entry({ ts: 9, gps: home }),
    ])
    expect(groups.map((g) => g.text)).toEqual(['123 Main St, Pittsburgh, PA', '5000 Forbes Ave, Pittsburgh, PA'])
    expect(groups[0].latestTs).toBe(9)
  })

  it('정확한 주소와 도시 추정은 섞이지 않는다 — 다른 주장이다', () => {
    const groups = groupLoginsByLocation([
      entry({ ts: 2, gps: home, location: ipLoc }),
      entry({ ts: 1, gps: null, location: ipLoc }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.precise)).toEqual([true, false])
    expect(groups[1].text).toBe('Pittsburgh, Pennsylvania, United States')
  })

  it('위치가 풀리지 않은 로그인은 한 묶음으로 모여 맨 아래에 남는다', () => {
    const groups = groupLoginsByLocation([
      entry({ ts: 9, gps: null, location: null }),   // 제일 최근이지만
      entry({ ts: 1, gps: home }),
    ])
    expect(groups.map((g) => g.text)).toEqual(['123 Main St, Pittsburgh, PA', ''])
    expect(groups[1].entries).toHaveLength(1)
    expect(groups[1].precise).toBe(false)
  })

  it('묶음마다 지도 링크에 쓸 좌표를 들고 있다', () => {
    const [group] = groupLoginsByLocation([entry({ ts: 1, gps: home })])
    expect(group.lat).toBe(40.4502)
    expect(group.lon).toBe(-79.9348)
    expect(group.entries).toHaveLength(1)
  })

  it('빈 목록은 빈 결과다', () => {
    expect(groupLoginsByLocation([])).toEqual([])
  })
})
