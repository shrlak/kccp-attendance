import { describe, it, expect } from 'vitest'
import {
  exportFilename,
  gridSheet,
  buildAttendanceModel,
  semesterLabel,
  formatGridDate,
  logRows,
  kakaoSummary,
  reportHtml,
  formatHeaderDate,
  filterLabel,
} from './exports'
import { semesterSundays } from './newFamily'
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

describe('semesterLabel', () => {
  it('names the term containing the date', () => {
    expect(semesterLabel('2026-06-07', 'ko')).toBe('2026 여름 학기')
    expect(semesterLabel('2026-06-07', 'en')).toBe('Summer 2026')
    expect(semesterLabel('2026-02-01', 'ko')).toBe('2026 봄 학기')
    expect(semesterLabel('2026-09-01', 'en')).toBe('Fall 2026')
  })
})

describe('buildAttendanceModel', () => {
  const members = [member('1', 'A'), member('2', 'B'), member('3', 'C', '청년부', '중호동산')]
  const log = [
    entry('A', '2026-05-31', 1),
    entry('A', '2026-06-07', 2),
    entry('B', '2026-06-07', 3),
    entry('C', '2026-06-07', 4, { subgroup: '중호동산' }),
  ]
  const dates = ['2026-05-31', '2026-06-07']

  it('groups by 동산 in roster order and labels dates MM/DD/YYYY', () => {
    const m = buildAttendanceModel(members, log, dates, '동산 미지정')
    expect(m.dateLabels).toEqual(['05/31/2026', '06/07/2026'])
    expect(m.sections.map((s) => s.subgroup)).toEqual(['건영동산', '중호동산'])
  })
  it('counts per-member present + per-date section totals over the given dates only', () => {
    const s1 = buildAttendanceModel(members, log, dates, '동산 미지정').sections[0]
    expect(s1.rows.map((r) => [r.member.name, r.total])).toEqual([['A', 2], ['B', 1]])
    expect(s1.totals).toEqual([1, 2]) // 5/31: A; 6/7: A + B
    // narrowing the window drops the 5/31 attendance from the totals
    const narrow = buildAttendanceModel(members, log, ['2026-06-07'], '동산 미지정').sections[0]
    expect(narrow.rows.map((r) => r.total)).toEqual([1, 1])
  })
  it('buckets members without a 동산 under the unassigned label, last', () => {
    const ms = [member('1', 'A'), member('9', 'Z', '청년부', '')]
    const m = buildAttendanceModel(ms, [], ['2026-06-07'], '동산 미지정')
    expect(m.sections.map((s) => s.subgroup)).toEqual(['건영동산', '동산 미지정'])
  })
})

describe('formatGridDate', () => {
  it('formats ISO as MM/DD/YYYY', () => {
    expect(formatGridDate('2026-06-07')).toBe('06/07/2026')
    expect(formatGridDate('2026-12-25')).toBe('12/25/2026')
  })
})

describe('gridSheet', () => {
  // Summer 2026: semester Sundays are 05/10, 05/17, 05/24, 05/31, 06/07 through today.
  const today = '2026-06-07'
  const dates = semesterSundays(today)
  const members = [member('1', 'A'), member('2', 'B')]
  const log = [entry('A', '2026-05-31', 1), entry('A', today, 2), entry('B', today, 3)]

  it('header row 1 = labels + the semester Sundays (MM/DD/YYYY); row 2 = 예배 per date', () => {
    const { aoa } = gridSheet(members, log, 'ko', today)
    expect(aoa[0]).toEqual(['', '이름', '예배 총 출석', ...dates.map(formatGridDate)])
    expect(aoa[1]).toEqual(['', '', '', ...dates.map(() => '예배')])
  })
  it('marks O present / X absent across the semester Sundays with 동산 name + worship total', () => {
    const { aoa } = gridSheet(members, log, 'ko', today)
    const aRow = aoa[2]
    expect(aRow.slice(0, 3)).toEqual(['건영동산', 'A', 2]) // A attended 2 of the shown Sundays
    expect(aRow[3]).toBe('X') // 05/10 absent
    expect(aRow.slice(-2)).toEqual(['O', 'O']) // 05/31 + 06/07 present
    // B: col A blank, present only 06/07
    expect(aoa[3].slice(0, 3)).toEqual(['', 'B', 1])
    expect(aoa[3].slice(-2)).toEqual(['X', 'O'])
  })
  it('adds a blank spacer, a 총 출석 row counting present per date, and a KEY legend', () => {
    const { aoa } = gridSheet(members, log, 'ko', today)
    expect(aoa[4]).toEqual([])
    expect(aoa[5][0]).toBe('총 출석')
    expect(aoa[5].slice(-2)).toEqual([1, 2]) // 05/31: A; 06/07: A + B
    expect(aoa.slice(-3)).toEqual([['KEY'], ['O', '출석'], ['X', '결석']])
  })
  it('merges the three left header cells down and the 총 출석 label across A:B', () => {
    const { merges } = gridSheet(members, log, 'ko', today)
    expect(merges.slice(0, 3)).toEqual([
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
    ])
    expect(merges[3]).toEqual({ s: { r: 5, c: 0 }, e: { r: 5, c: 1 } }) // 2 header + 2 members + spacer
  })
  it('emits one blank-separated block per 동산', () => {
    const ms = [member('1', 'A', '청년부', '건영동산'), member('2', 'C', '청년부', '중호동산')]
    const lg = [entry('A', today, 1), entry('C', today, 2, { subgroup: '중호동산' })]
    const { aoa } = gridSheet(ms, lg, 'ko', today)
    expect(aoa[2][0]).toBe('건영동산') // section 1 member
    expect(aoa[4][0]).toBe('총 출석') // section 1 totals (2 header + 1 member + spacer)
    expect(aoa[5]).toEqual([]) // blank separator between blocks
    expect(aoa[6]).toEqual(['', '이름', '예배 총 출석', ...dates.map(formatGridDate)]) // section 2 header
    expect(aoa[8][0]).toBe('중호동산') // section 2 member
  })
  it('uses English labels in en mode', () => {
    const { aoa } = gridSheet(members, log, 'en', today)
    expect(aoa[0].slice(0, 3)).toEqual(['', 'Name', 'Worship Total'])
    expect(aoa[1][3]).toBe('Worship')
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
  const today = '2026-06-07'
  const members = [member('1', 'A'), member('2', 'B')]
  const log = [entry('A', '2026-05-31', 1), entry('A', today, 2), entry('B', today, 3)]

  it('is a standalone HTML doc that auto-opens the print / Save-as-PDF dialog (landscape)', () => {
    const html = reportHtml(members, log, { group: '', subgroup: '', today, lang: 'en' })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('window.print()')
    expect(html).toContain('@page { size: landscape')
  })
  it('renders the 동산 grid: name, 예배 총 출석, O/X cells, 총 출석 and a KEY legend', () => {
    const html = reportHtml(members, log, { group: '', subgroup: '', today, lang: 'ko' })
    expect(html).toContain('건영동산')
    expect(html).toContain('예배 총 출석')
    expect(html).toContain('<td class="o">O</td>')
    expect(html).toContain('<td class="x">X</td>')
    expect(html).toContain('총 출석')
    expect(html).toContain('출석') // KEY present
    expect(html).toContain('결석') // KEY absent
  })
  it('labels the semester and uses its Sundays as date columns', () => {
    const html = reportHtml(members, log, { group: '', subgroup: '', today, lang: 'ko' })
    expect(html).toContain('2026 여름 학기')
    for (const d of semesterSundays(today)) expect(html).toContain(formatGridDate(d))
  })
  it('escapes member names', () => {
    const html = reportHtml([member('1', '<b>X</b>')], [entry('<b>X</b>', today, 1)], { group: '', subgroup: '', today, lang: 'en' })
    expect(html).toContain('<td class="name">&lt;b&gt;X&lt;/b&gt;</td>')
    expect(html).not.toContain('<td class="name"><b>X</b></td>')
  })
  it('shows an empty message when no members are in scope', () => {
    const html = reportHtml([], [], { group: '', subgroup: '', today, lang: 'en' })
    expect(html).toContain('No attendance records')
  })
})
