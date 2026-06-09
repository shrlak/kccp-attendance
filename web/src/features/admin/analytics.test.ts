import { describe, it, expect } from 'vitest'
import {
  trendSeries,
  groupSeries,
  monthlySummary,
  semesterSummary,
  weeklyRecap,
  recapText,
} from './analytics'
import type { Member, LogEntry } from '../../lib/api'

const m = (name: string, group = '청년부', subgroup = '호연'): Member => ({
  id: name, name, group_name: group, subgroup, member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})
const e = (name: string, date: string, group = '청년부', firstVisit = false): LogEntry => ({
  name, group, subgroup: '호연', date, time: '', ts: 0, firstVisit,
})

describe('trendSeries', () => {
  it('counts distinct attendees per date, ascending', () => {
    const log = [e('A', '2026-06-07'), e('B', '2026-06-07'), e('A', '2026-05-31')]
    expect(trendSeries(log)).toEqual([
      { date: '2026-05-31', count: 1 },
      { date: '2026-06-07', count: 2 },
    ])
  })
  it('de-dupes a member counted twice on one date', () => {
    const log = [e('A', '2026-06-07'), e('A', '2026-06-07')]
    expect(trendSeries(log)).toEqual([{ date: '2026-06-07', count: 1 }])
  })
  it('is empty for an empty log', () => {
    expect(trendSeries([])).toEqual([])
  })
})

describe('groupSeries', () => {
  const members = [m('A', '대학부'), m('B', '청년부'), m('C', '청년부')]
  const log = [
    e('A', '2026-06-07', '대학부'),
    e('B', '2026-06-07', '청년부'),
    e('C', '2026-06-07', '청년부'),
    e('A', '2026-05-31', '대학부'),
  ]

  it('produces a per-date count array per 부서 in preferred order', () => {
    const s = groupSeries(members, log)
    expect(s.dates).toEqual(['2026-05-31', '2026-06-07'])
    expect(s.groups).toEqual(['대학부', '청년부'])
    expect(s.counts['대학부']).toEqual([1, 1])
    expect(s.counts['청년부']).toEqual([0, 2])
  })
  it('counts by the log group label', () => {
    const s = groupSeries([m('A', '대학부')], [e('A', '2026-06-07', '대학부')])
    expect(s.counts['대학부']).toEqual([1])
  })
})

describe('monthlySummary', () => {
  const log = [
    e('A', '2026-06-07', '청년부', true),
    e('B', '2026-06-07'),
    e('A', '2026-06-14'),
    e('C', '2026-05-31'),
  ]
  it('aggregates sundays, attendees, and first-visits per month, newest first', () => {
    const rows = monthlySummary([], log)
    expect(rows.map((r) => r.month)).toEqual(['2026-06', '2026-05'])
    expect(rows[0]).toEqual({ month: '2026-06', sundays: 2, attendees: 2, firstVisits: 1 })
    expect(rows[1]).toEqual({ month: '2026-05', sundays: 1, attendees: 1, firstVisits: 0 })
  })
})

describe('semesterSummary', () => {
  const log = [
    e('A', '2026-03-01'), // H1
    e('B', '2026-06-30'), // H1
    e('A', '2026-07-01', '청년부', true), // H2
    e('C', '2025-11-02'), // 2025 H2
  ]
  it('splits at month 6/7 and labels the half, newest first', () => {
    const rows = semesterSummary([], log)
    expect(rows.map((r) => r.key)).toEqual(['2026-H2', '2026-H1', '2025-H2'])
    expect(rows[0]).toMatchObject({ year: 2026, half: 2, sundays: 1, attendees: 1, firstVisits: 1 })
    expect(rows[1]).toMatchObject({ year: 2026, half: 1, sundays: 2, attendees: 2, firstVisits: 0 })
    expect(rows[2]).toMatchObject({ year: 2025, half: 2 })
  })
})

describe('weeklyRecap', () => {
  it('returns the last 7 dates newest-first with counts', () => {
    const log = Array.from({ length: 9 }, (_, i) => e('A', `2026-04-${String(i + 1).padStart(2, '0')}`))
    const rows = weeklyRecap(log)
    expect(rows).toHaveLength(7)
    expect(rows[0].date).toBe('2026-04-09')
    expect(rows[6].date).toBe('2026-04-03')
  })
  it('counts distinct attendance and first-visits per date', () => {
    const log = [e('A', '2026-06-07', '청년부', true), e('B', '2026-06-07'), e('A', '2026-06-07')]
    expect(weeklyRecap(log)).toEqual([{ date: '2026-06-07', attendance: 2, firstVisits: 1 }])
  })
})

describe('recapText', () => {
  it('formats rows as date · attendance · ★firstVisits lines', () => {
    const text = recapText([
      { date: '2026-06-07', attendance: 42, firstVisits: 3 },
      { date: '2026-05-31', attendance: 40, firstVisits: 0 },
    ])
    expect(text).toBe('2026-06-07 · 42 · ★3\n2026-05-31 · 40 · ★0')
  })
})

describe('immutability', () => {
  it('does not mutate the input log', () => {
    const log = [e('A', '2026-06-07'), e('B', '2026-05-31')]
    const snapshot = JSON.stringify(log)
    trendSeries(log)
    groupSeries([m('A')], log)
    monthlySummary([], log)
    semesterSummary([], log)
    weeklyRecap(log)
    expect(JSON.stringify(log)).toBe(snapshot)
  })
})
