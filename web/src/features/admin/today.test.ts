import { describe, it, expect } from 'vitest'
import { todaysCheckins, weeklyComparison } from './today'
import type { LogEntry } from '../../lib/api'

const e = (name: string, date: string, ts: number, firstVisit = false): LogEntry => ({
  name, group: '', subgroup: '', date, time: '', ts, firstVisit,
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
