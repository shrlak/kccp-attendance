import { describe, it, expect } from 'vitest'
import {
  exportFilename,
  gridRows,
  logRows,
  kakaoSummary,
  reportHtml,
  formatHeaderDate,
  filterLabel,
  attendanceRate,
  rateColor,
} from './exports'
import type { Member, LogEntry } from '../../lib/api'

const member = (id: string, name: string, group = '청년부', subgroup = '건영동산'): Member => ({
  id, name, group_name: group, subgroup, member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})
const entry = (name: string, date: string, ts: number, extra: Partial<LogEntry> = {}): LogEntry => ({
  name, group: '청년부', subgroup: '건영동산', date, time: '01:15:23 PM', ts, ...extra,
})

describe('exportFilename', () => {
  it('includes the group label when present', () => {
    expect(exportFilename('청년부', '2026-06-07')).toBe('kccp-attendance-청년부-2026-06-07.xlsx')
  })
  it('omits the group label when empty', () => {
    expect(exportFilename('', '2026-06-07')).toBe('kccp-attendance-2026-06-07.xlsx')
  })
  it('strips whitespace from the group label', () => {
    expect(exportFilename(' Adult Ministry ', '2026-06-07')).toBe('kccp-attendance-AdultMinistry-2026-06-07.xlsx')
  })
})

describe('formatHeaderDate', () => {
  it('formats English long form with weekday', () => {
    expect(formatHeaderDate('2026-06-07', 'en')).toBe('Sunday, June 7, 2026')
  })
  it('formats Korean form with weekday', () => {
    expect(formatHeaderDate('2026-06-07', 'ko')).toBe('2026년 6월 7일 (일)')
  })
})

describe('filterLabel', () => {
  it('returns All/전체 for an empty filter', () => {
    expect(filterLabel('', '', 'en')).toBe('All')
    expect(filterLabel('', '', 'ko')).toBe('전체')
  })
  it('joins group and subgroup', () => {
    expect(filterLabel('청년부', '건영동산', 'en')).toBe('청년부 · 건영동산')
  })
})

describe('attendanceRate / rateColor', () => {
  it('rounds the rate and guards divide-by-zero', () => {
    expect(attendanceRate(3, 4)).toBe(75)
    expect(attendanceRate(0, 0)).toBe(0)
    expect(attendanceRate(1, 3)).toBe(33)
  })
  it('buckets colors at 80 / 60 thresholds', () => {
    expect(rateColor(80)).toBe('#16a34a')
    expect(rateColor(79)).toBe('#d97706')
    expect(rateColor(60)).toBe('#d97706')
    expect(rateColor(59)).toBe('#dc2626')
  })
})

describe('gridRows', () => {
  const members = [member('1', 'A'), member('2', 'B')]
  const log = [entry('A', '2026-05-31', 1, { time: '01:00:00 PM' }), entry('A', '2026-06-07', 2), entry('B', '2026-06-07', 3)]

  it('has a header row with Name/Group/동산/Total then dates', () => {
    const rows = gridRows(members, log, 'en')
    expect(rows[0]).toEqual(['Name', 'Group', '동산', 'Total', '2026-05-31', '2026-06-07'])
  })
  it('places the check-in time string in present cells and Total count', () => {
    const rows = gridRows(members, log, 'en')
    // row for A: name, group, subgroup, total=2, 5/31 time, 6/7 time
    expect(rows[1]).toEqual(['A', '청년부', '건영동산', 2, '01:00:00 PM', '01:15:23 PM'])
    // row for B: absent 5/31 → '', present 6/7
    expect(rows[2]).toEqual(['B', '청년부', '건영동산', 1, '', '01:15:23 PM'])
  })
})

describe('logRows', () => {
  const members = [member('1', 'A')]
  const log = [
    entry('A', '2026-05-31', 1),
    entry('A', '2026-06-07', 2, { firstVisit: true }),
    entry('Guest', '2026-06-07', 3, { memberRole: 'visitor', group: '', subgroup: '' }),
  ]

  it('is newest-first with a header row', () => {
    const rows = logRows(members, log, 'en')
    expect(rows[0]).toEqual(['Name', 'Group', '동산', 'Date', 'Time', 'Total', 'Notes'])
    expect(rows[1][0]).toBe('Guest') // ts 3 first
    expect(rows[3][0]).toBe('A') // ts 1 last
  })
  it('builds Notes from flags and totals from distinct dates', () => {
    const rows = logRows(members, log, 'en')
    const guestRow = rows[1]
    const firstVisitRow = rows[2]
    expect(guestRow[6]).toBe('Guest') // visitor flag
    expect(firstVisitRow[6]).toBe('First visit')
    expect(firstVisitRow[5]).toBe(2) // A attended two distinct dates
  })
})

describe('kakaoSummary', () => {
  const members = [member('1', '김호연'), member('2', '권상운')]
  const log = [
    entry('김호연', '2026-06-07', 1),
    entry('권상운', '2026-06-07', 2),
    entry('방문자', '2026-06-07', 3, { memberRole: 'visitor', group: '', subgroup: '' }),
    entry('김호연', '2026-05-31', 0), // prior date — excluded from today summary
  ]

  it('builds the bilingual header, count, present and visitor lists', () => {
    const out = kakaoSummary(members, log, '2026-06-07', { group: '', subgroup: '', lang: 'ko' })
    expect(out).toContain('📋 KCCP 출석 현황')
    expect(out).toContain('📅 2026년 6월 7일 (일) (전체)')
    expect(out).toContain('총 2명 출석')
    expect(out).toContain('1. 김호연')
    expect(out).toContain('2. 권상운')
    expect(out).toContain('👥 방문 / 기타:')
    expect(out).toContain('1. 방문자 (방문자)')
  })
  it('appends the announcement when provided', () => {
    const out = kakaoSummary(members, log, '2026-06-07', { group: '', subgroup: '', announcement: '다음 주 수련회', lang: 'ko' })
    expect(out).toContain('📢 다음 주 수련회')
  })
  it('uses the filter label in the header', () => {
    const out = kakaoSummary(members, log, '2026-06-07', { group: '청년부', subgroup: '건영동산', lang: 'en' })
    expect(out).toContain('(청년부 · 건영동산)')
    expect(out).toContain('2 present')
  })
  it('counts only today and dedupes names', () => {
    const dup = [...log, entry('김호연', '2026-06-07', 5)]
    const out = kakaoSummary(members, dup, '2026-06-07', { group: '', subgroup: '', lang: 'ko' })
    expect(out).toContain('총 2명 출석')
    expect((out.match(/김호연/g) ?? []).length).toBe(1)
  })
})

describe('reportHtml', () => {
  const members = [member('1', 'A'), member('2', 'B')]
  const log = [entry('A', '2026-05-31', 1), entry('A', '2026-06-07', 2), entry('B', '2026-06-07', 3)]

  it('is a standalone HTML document with a print button and stats', () => {
    const html = reportHtml(members, log, { group: '', subgroup: '', today: '2026-06-07', lang: 'en' })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('window.print()')
    expect(html).toContain('KCCP Attendance Report')
    expect(html).toContain('Avg rate')
  })
  it('color-codes the per-member rate', () => {
    const html = reportHtml(members, log, { group: '', subgroup: '', today: '2026-06-07', lang: 'en' })
    // A attended 2/2 dates → 100% green; B 1/2 → 50% red
    expect(html).toContain('color:#16a34a">100%')
    expect(html).toContain('color:#dc2626">50%')
  })
  it('escapes member names', () => {
    const html = reportHtml([member('1', '<b>X</b>')], [entry('<b>X</b>', '2026-06-07', 1)], { group: '', subgroup: '', today: '2026-06-07', lang: 'en' })
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;')
    expect(html).not.toContain('<b>X</b>')
  })
})
