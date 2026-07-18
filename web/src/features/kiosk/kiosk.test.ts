import { describe, it, expect } from 'vitest'
import {
  presentNamesToday,
  attendanceCount,
  filterByName,
  splitThirds,
  kioskColumns,
  todayEntryFor,
  hiddenByStatus,
} from './kiosk'
import type { LogEntry, Member } from '../../lib/api'

const member = (name: string, group: string, role = '', extra: Partial<Member> = {}): Member => ({
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
  ...extra,
})

const log = (name: string, date: string, role?: string, extra: Partial<LogEntry> = {}): LogEntry => ({
  name,
  group: '',
  subgroup: '',
  date,
  time: '',
  ts: 0,
  memberRole: role,
  ...extra,
})

describe('splitThirds', () => {
  it('splits into balanced columns (same sizes as before)', () => {
    expect(splitThirds([1, 2, 3, 4, 5, 6, 7]).map((c) => c.length)).toEqual([3, 2, 2])
    expect(splitThirds([1, 2, 3, 4]).map((c) => c.length)).toEqual([2, 1, 1])
    expect(splitThirds([1]).map((c) => c.length)).toEqual([1, 0, 0])
  })
  it('always returns three columns, even when empty', () => {
    expect(splitThirds([]).map((c) => c.length)).toEqual([0, 0, 0])
  })
  it('distributes round-robin (item i -> column i % 3), so a sorted input reads left-to-right then down', () => {
    expect(splitThirds([1, 2, 3, 4, 5, 6, 7])).toEqual([[1, 4, 7], [2, 5], [3, 6]])
  })
  it('covers every element exactly once', () => {
    const all = [1, 2, 3, 4, 5]
    expect(splitThirds(all).flat().sort()).toEqual(all)
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

  it('sorts each 부서 bucket 가나다 순 regardless of roster order', () => {
    const unordered = [member('다영', '대학부'), member('가영', '대학부'), member('나영', '대학부')]
    const cols = kioskColumns(unordered)
    expect(cols.depts[0].thirds.flat().map((m) => m.name)).toEqual(['가영', '나영', '다영'])
  })

  it('sorts others 가나다 순 too', () => {
    const unordered = [member('나', 'EM'), member('가', 'EM')]
    expect(kioskColumns(unordered).others.map((m) => m.name)).toEqual(['가', '나'])
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

describe('todayEntryFor (tap-to-undo lookup)', () => {
  const m = member('A', '대학부')
  it("finds today's entry by member id, ignoring other days", () => {
    const entries = [
      log('A', '2026-06-28', undefined, { id: 1, memberId: 'A' }),
      log('A', '2026-07-05', undefined, { id: 2, memberId: 'A' }),
    ]
    expect(todayEntryFor(entries, '2026-07-05', m)?.id).toBe(2)
  })
  it('falls back to a name match only for rows without a member id', () => {
    const entries = [
      log('A', '2026-07-05', undefined, { id: 3, memberId: 'someone-else' }),
      log('A', '2026-07-05', undefined, { id: 4, memberId: null }),
    ]
    expect(todayEntryFor(entries, '2026-07-05', m)?.id).toBe(4)
  })
  it('returns undefined when the member has no entry today', () => {
    const entries = [log('B', '2026-07-05', undefined, { id: 5, memberId: 'B' })]
    expect(todayEntryFor(entries, '2026-07-05', m)).toBeUndefined()
  })
})

describe('hiddenByStatus (이주/한국 귀국 hidden from the kiosk)', () => {
  const today = '2026-07-05'
  it('hides 한국 귀국 and 이주 while the span covers today (open-ended end)', () => {
    expect(hiddenByStatus(member('A', '대학부', '', { status_note: '한국 귀국', status_start: '2026-06-21', status_end: null }), today)).toBe(true)
    expect(hiddenByStatus(member('B', '대학부', '', { status_note: '이주(방문자)', status_start: '2026-06-21', status_end: '2026-07-19' }), today)).toBe(true)
  })
  it('shows them again outside the span', () => {
    expect(hiddenByStatus(member('A', '대학부', '', { status_note: '한국 귀국', status_start: '2026-07-12', status_end: null }), today)).toBe(false)
    expect(hiddenByStatus(member('B', '대학부', '', { status_note: '이주', status_start: '2026-06-01', status_end: '2026-06-28' }), today)).toBe(false)
  })
  it('never hides other notes (돌아옴) or members without a status', () => {
    expect(hiddenByStatus(member('C', '대학부', '', { status_note: '돌아옴', status_start: '2026-06-07', status_end: '2026-07-12' }), today)).toBe(false)
    expect(hiddenByStatus(member('D', '대학부'), today)).toBe(false)
  })
  it('ignores a note without a start date (mirrors the 출석부 rule)', () => {
    expect(hiddenByStatus(member('E', '대학부', '', { status_note: '이주' }), today)).toBe(false)
  })
})
