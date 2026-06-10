import { describe, it, expect } from 'vitest'
import {
  exportFilename,
  gridSheet,
  formatGridDate,
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

describe('formatGridDate', () => {
  it('formats ISO as MM/DD/YYYY', () => {
    expect(formatGridDate('2026-06-07')).toBe('06/07/2026')
    expect(formatGridDate('2026-12-25')).toBe('12/25/2026')
  })
})

describe('gridSheet', () => {
  const members = [member('1', 'A'), member('2', 'B')]
  const log = [entry('A', '2026-05-31', 1), entry('A', '2026-06-07', 2), entry('B', '2026-06-07', 3)]

  it('builds a two-row 동산 header: labels + MM/DD/YYYY dates, then 예배 under each date', () => {
    const { aoa } = gridSheet(members, log, 'ko')
    expect(aoa[0]).toEqual(['', '이름', '예배 총 출석', '05/31/2026', '06/07/2026'])
    expect(aoa[1]).toEqual(['', '', '', '예배', '예배'])
  })
  it('marks O present / X absent with the 동산 name on the first member row and a worship total', () => {
    const { aoa } = gridSheet(members, log, 'ko')
    // A present both dates → 동산 label in col A, total 2
    expect(aoa[2]).toEqual(['건영동산', 'A', 2, 'O', 'O'])
    // B absent 5/31, present 6/7 → col A blank, total 1
    expect(aoa[3]).toEqual(['', 'B', 1, 'X', 'O'])
  })
  it('adds a blank spacer then a 총 출석 row counting present per date, and a KEY legend', () => {
    const { aoa } = gridSheet(members, log, 'ko')
    expect(aoa[4]).toEqual([])
    expect(aoa[5]).toEqual(['총 출석', '', '', 1, 2]) // 5/31: A only; 6/7: A + B
    expect(aoa.slice(-3)).toEqual([['KEY'], ['O', '출석'], ['X', '결석']])
  })
  it('merges the three left header cells down and the 총 출석 label across A:B', () => {
    const { merges } = gridSheet(members, log, 'ko')
    expect(merges).toEqual([
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } },
    ])
  })
  it('emits one blank-separated block per 동산', () => {
    const ms = [member('1', 'A', '청년부', '건영동산'), member('2', 'C', '청년부', '중호동산')]
    const lg = [entry('A', '2026-06-07', 1), entry('C', '2026-06-07', 2, { subgroup: '중호동산' })]
    const { aoa } = gridSheet(ms, lg, 'ko')
    expect(aoa[2]).toEqual(['건영동산', 'A', 1, 'O']) // section 1 member
    expect(aoa[4]).toEqual(['총 출석', '', '', 1]) // section 1 totals
    expect(aoa[5]).toEqual([]) // blank separator
    expect(aoa[8]).toEqual(['중호동산', 'C', 1, 'O']) // section 2 member
  })
  it('uses English labels in en mode', () => {
    const { aoa } = gridSheet(members, log, 'en')
    expect(aoa[0]).toEqual(['', 'Name', 'Worship Total', '05/31/2026', '06/07/2026'])
    expect(aoa[1]).toEqual(['', '', '', 'Worship', 'Worship'])
    expect(aoa.slice(-3)).toEqual([['KEY'], ['O', 'Present'], ['X', 'Absent']])
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
