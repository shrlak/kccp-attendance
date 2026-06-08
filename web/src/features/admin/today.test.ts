import { describe, it, expect } from 'vitest'
import { todaysCheckins, weeklyComparison, presentNamesToday, checkinCandidates } from './today'
import type { LogEntry, Member } from '../../lib/api'

const e = (name: string, date: string, ts: number, firstVisit = false): LogEntry => ({
  name, group: '', subgroup: '', date, time: '', ts, firstVisit,
})
const member = (id: string, name: string): Member => ({
  id, name, group_name: '', subgroup: '', member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})

const log: LogEntry[] = [
  e('A', '2026-06-07', 3),
  e('B', '2026-06-07', 1),
  e('A', '2026-05-31', 0),
  e('C', '2026-05-31', 0),
]

describe('today helpers', () => {
  it('todaysCheckins filters by date, newest first', () => {
    expect(todaysCheckins(log, '2026-06-07').map((x) => x.name)).toEqual(['A', 'B'])
  })
  it('todaysCheckins is empty when none match', () => {
    expect(todaysCheckins(log, '2026-06-14')).toEqual([])
  })
  it('weeklyComparison: today vs the most recent prior date', () => {
    expect(weeklyComparison(log, '2026-06-07')).toEqual({ thisWeek: 2, lastWeek: 2, delta: 0 })
  })
  it('weeklyComparison: no prior date → lastWeek 0', () => {
    expect(weeklyComparison(log, '2026-05-31')).toEqual({ thisWeek: 2, lastWeek: 0, delta: 2 })
  })
})

describe('manual check-in helpers', () => {
  it('presentNamesToday collects distinct names present on the date', () => {
    const s = presentNamesToday(log, '2026-06-07')
    expect([...s].sort()).toEqual(['A', 'B'])
    expect(s.has('C')).toBe(false)
  })
  it('checkinCandidates filters by query and sorts by name', () => {
    const members = [member('1', 'Chan'), member('2', 'Anna'), member('3', 'Bob')]
    expect(checkinCandidates(members, '').map((m) => m.name)).toEqual(['Anna', 'Bob', 'Chan'])
    expect(checkinCandidates(members, 'an').map((m) => m.name)).toEqual(['Anna', 'Chan'])
  })
})
