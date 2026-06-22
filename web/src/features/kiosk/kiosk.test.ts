import { describe, it, expect } from 'vitest'
import {
  presentNamesToday,
  attendanceCount,
  filterByName,
  splitThirds,
  kioskColumns,
} from './kiosk'
import type { LogEntry, Member } from '../../lib/api'

const member = (name: string, group: string, role = ''): Member => ({
  id: name,
  name,
  group_name: group,
  subgroup: '',
  member_role: role,
  gender: '',
  phone: '',
  birth_date: null,
  kakao_id: '',
  is_new_member: false,
  notes: '',
})

const log = (name: string, date: string, role?: string): LogEntry => ({
  name,
  group: '',
  subgroup: '',
  date,
  time: '',
  ts: 0,
  memberRole: role,
})

describe('splitThirds', () => {
  it('splits into ceil(n/3), ceil(rest/2), rest', () => {
    expect(splitThirds([1, 2, 3, 4, 5, 6, 7]).map((c) => c.length)).toEqual([3, 2, 2])
    expect(splitThirds([1, 2, 3, 4]).map((c) => c.length)).toEqual([2, 1, 1])
    expect(splitThirds([1]).map((c) => c.length)).toEqual([1, 0, 0])
  })
  it('always returns three columns, even when empty', () => {
    expect(splitThirds([]).map((c) => c.length)).toEqual([0, 0, 0])
  })
  it('preserves order and covers every element exactly once', () => {
    const all = [1, 2, 3, 4, 5]
    expect(splitThirds(all).flat()).toEqual(all)
  })
})

describe('kioskColumns', () => {
  const members = [
    member('A', '대학부'),
    member('B', '대학부'),
    member('C', '청년부'),
    member('D', 'EM'),
    member('V', '대학부', 'visitor'),
  ]

  it('buckets 대학부/청년부 into 3 columns each, rest into others', () => {
    const cols = kioskColumns(members)
    expect(cols.depts.map((d) => d.key)).toEqual(['대학부', '청년부'])
    expect(cols.depts[0].total).toBe(2) // A, B (visitor excluded)
    expect(cols.depts[0].thirds).toHaveLength(3)
    expect(cols.depts[0].thirds.flat().map((m) => m.name)).toEqual(['A', 'B'])
    expect(cols.depts[1].total).toBe(1) // C
    expect(cols.others.map((m) => m.name)).toEqual(['D'])
  })

  it('excludes visitors from every bucket', () => {
    const cols = kioskColumns(members)
    const all = [...cols.depts.flatMap((d) => d.thirds.flat()), ...cols.others]
    expect(all.find((m) => m.name === 'V')).toBeUndefined()
  })
})

describe('presentNamesToday', () => {
  it('collects distinct names present on the date', () => {
    const entries = [log('A', '2026-06-07'), log('B', '2026-06-07'), log('A', '2026-05-31')]
    const s = presentNamesToday(entries, '2026-06-07')
    expect([...s].sort()).toEqual(['A', 'B'])
  })
})

describe('attendanceCount', () => {
  it('counts unique people for today, including visitors', () => {
    const entries = [
      log('A', '2026-06-07'),
      log('A', '2026-06-07'), // duplicate name → counted once
      log('B', '2026-06-07'),
      log('G', '2026-06-07', 'visitor'), // visitor → included in the head count
      log('C', '2026-05-31'), // other day → excluded
    ]
    expect(attendanceCount(entries, '2026-06-07')).toBe(3)
  })
})

describe('filterByName', () => {
  const members = [member('Anna', '대학부'), member('Bob', '청년부'), member('Chan', '대학부')]
  it('returns all members for an empty query', () => {
    expect(filterByName(members, '   ')).toHaveLength(3)
  })
  it('filters case-insensitively by substring', () => {
    expect(filterByName(members, 'an').map((m) => m.name)).toEqual(['Anna', 'Chan'])
  })
})
