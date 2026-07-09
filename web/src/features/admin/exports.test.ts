import { describe, it, expect } from 'vitest'
import {
  exportFilename,
  gridSheet,
  buildAttendanceModel,
  exportSundays,
  semesterLabel,
  blockColors,
  cssColor,
  formatGridDate,
  logRows,
  kakaoSummary,
  reportHtml,
  formatHeaderDate,
  filterLabel,
  NEW_FAMILY_HEADER,
  newFamilyRow,
  newFamilySheets,
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

describe('blockColors / cssColor', () => {
  it('cycles 4 families and converts ARGB to CSS hex', () => {
    expect(blockColors(0).medium).toBe('FFB6D7A8') // green
    expect(blockColors(1).medium).toBe('FF9FC5E8') // blue
    expect(blockColors(2).medium).toBe('FFFFE599') // yellow
    expect(blockColors(3).medium).toBe('FFEA9999') // red
    expect(blockColors(4)).toEqual(blockColors(0)) // wraps
    expect(cssColor('FFB6D7A8')).toBe('#B6D7A8')
  })
})

describe('buildAttendanceModel', () => {
  const labels = { unassigned: '동산 미지정', newFamily: '새가족' }
  const members = [member('1', 'A'), member('2', 'B'), member('3', 'C', '청년부', '중호동산')]
  const log = [
    entry('A', '2026-05-31', 1),
    entry('A', '2026-06-07', 2),
    entry('B', '2026-06-07', 3),
    entry('C', '2026-06-07', 4, { subgroup: '중호동산' }),
  ]
  const dates = ['2026-05-31', '2026-06-07']
  const today = '2026-06-07'

  it('groups by 동산 in roster order and labels dates MM/DD/YYYY', () => {
    const m = buildAttendanceModel(members, log, dates, today, labels)
    expect(m.dateLabels).toEqual(['05/31/2026', '06/07/2026'])
    expect(m.sections.map((s) => s.subgroup)).toEqual(['건영동산', '중호동산'])
  })
  it('counts per-member present + per-date section totals over the given dates only', () => {
    const s1 = buildAttendanceModel(members, log, dates, today, labels).sections[0]
    expect(s1.rows.map((r) => [r.member.name, r.total])).toEqual([['A', 2], ['B', 1]])
    expect(s1.totals).toEqual([1, 2]) // 5/31: A; 6/7: A + B
    // narrowing the window drops the 5/31 attendance from the totals
    const narrow = buildAttendanceModel(members, log, ['2026-06-07'], today, labels).sections[0]
    expect(narrow.rows.map((r) => r.total)).toEqual([1, 1])
  })
  it('buckets members without a 동산 under the unassigned label, last', () => {
    const ms = [member('1', 'A'), member('9', 'Z', '청년부', '')]
    const m = buildAttendanceModel(ms, [], ['2026-06-07'], today, labels)
    expect(m.sections.map((s) => s.subgroup)).toEqual(['건영동산', '동산 미지정'])
  })
  it('ignores attendance on dates before a member 등록일자', () => {
    // B registered 2026-06-01: a (stray) 05-31 attendance does not count toward their total.
    const ms = [member('1', 'A'), { ...member('2', 'B'), registration_date: '2026-06-01' }]
    const lg = [entry('B', '2026-05-31', 1), entry('B', '2026-06-07', 2)]
    const rows = buildAttendanceModel(ms, lg, dates, today, labels).sections[0].rows
    expect(rows.map((r) => [r.member.name, r.total])).toEqual([['A', 0], ['B', 1]])
  })
  it('marks a 동산 date with no check-ins blank (attendance not taken yet), totals included', () => {
    // 건영동산 has data on both dates; 중호동산 only on 6/7 → its 5/31 column stays blank.
    const s2 = buildAttendanceModel(members, log, dates, today, labels).sections[1]
    expect(s2.rows[0].marks.map((c) => c.kind)).toEqual(['blank', 'present'])
    expect(s2.totals).toEqual(['', 1])
  })
  it('renders a stored status mark as one note span from status_start (through future dates)', () => {
    // B 한국 귀국 from 6/7: the note opens at 6/7 and spans the remaining columns — the
    // future 6/14 included, as in the master sheet — with no X after it.
    const ms = [member('1', 'A'), { ...member('2', 'B'), status_note: '한국 귀국', status_start: '2026-06-07' }]
    const rows = buildAttendanceModel(ms, log, [...dates, '2026-06-14'], today, labels).sections[0].rows
    expect(rows[1].marks).toEqual([{ kind: 'absent' }, { kind: 'note', note: '한국 귀국', span: 2 }, { kind: 'inNote' }])
    expect(rows[1].total).toBe(0) // the 6/7 O is inside the marked-out span → not counted
  })
  it('closes a status mark at status_end and derives a 새가족 span before 등록일자', () => {
    // 돌아옴 covers 5/31 only; B is back — and checked in — for 6/7.
    const away = { ...member('2', 'B'), status_note: '돌아옴', status_start: '2026-05-01', status_end: '2026-05-31' }
    const awayRow = buildAttendanceModel([member('1', 'A'), away], log, dates, today, labels).sections[0].rows[1]
    expect(awayRow.marks).toEqual([{ kind: 'note', note: '돌아옴', span: 1 }, { kind: 'present' }])
    // A new member registered 6/1: the pre-등록일자 5/31 cell reads 새가족 instead of blank.
    const nf = { ...member('2', 'B'), is_new_member: true, registration_date: '2026-06-01' }
    const nfRow = buildAttendanceModel([member('1', 'A'), nf], log, dates, today, labels).sections[0].rows[1]
    expect(nfRow.marks).toEqual([{ kind: 'note', note: '새가족', span: 1 }, { kind: 'present' }])
    expect(nfRow.total).toBe(1)
  })
})

describe('formatGridDate', () => {
  it('formats ISO as MM/DD/YYYY', () => {
    expect(formatGridDate('2026-06-07')).toBe('06/07/2026')
    expect(formatGridDate('2026-12-25')).toBe('12/25/2026')
  })
})

describe('exportSundays', () => {
  // 2026 여름: fixed columns from the 06/07 동산 start through the 08/02 term end — the May
  // Sundays and the later 08/09 Sunday are dropped, and upcoming Sundays are included so they
  // fill in as they pass. The set no longer depends on where `today` lands within the term.
  const summer = [
    '2026-06-07', '2026-06-14', '2026-06-21', '2026-06-28',
    '2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26', '2026-08-02',
  ]
  it('spans the 2026 여름 term from the 06/07 동산 start to the 08/02 end, upcoming Sundays included', () => {
    expect(exportSundays('2026-07-05')).toEqual(summer)
    expect(exportSundays('2026-06-07')).toEqual(summer)
    expect(exportSundays('2026-06-21')).toEqual(summer)
  })
  it('falls back to the semester Sundays through today outside the 2026 여름 term', () => {
    const fall = '2026-09-06'
    expect(exportSundays(fall)).toEqual(semesterSundays(fall))
    expect(exportSundays('2026-01-10')).toEqual(['2026-01-04'])
  })
})

describe('gridSheet', () => {
  // 2026 여름동산: columns run from the 06/07 동산 formation date to the 08/02 term end. For a
  // 07/05 run the past Sundays (06/07–07/05) carry O/X; the upcoming ones (07/12–08/02) are blank.
  const today = '2026-07-05'
  const dates = exportSundays(today)
  const members = [member('1', 'A'), member('2', 'B')]
  const log = [entry('A', '2026-06-28', 1), entry('A', today, 2), entry('B', today, 3)]

  it('has a single date-header row (no 예배 sub-row), with the member rows directly below', () => {
    const { aoa } = gridSheet(members, log, 'ko', today)
    expect(aoa[0]).toEqual(['', '이름', '예배 총 출석', ...dates.map(formatGridDate)])
    expect(aoa[1].slice(0, 3)).toEqual(['건영동산', 'A', 2]) // first member row, no 예배 row between
  })
  it('marks O present / X absent on Sundays with data, blanks no-data + upcoming ones', () => {
    const { aoa } = gridSheet(members, log, 'ko', today)
    const aRow = aoa[1]
    expect(aRow.slice(0, 3)).toEqual(['건영동산', 'A', 2]) // A attended 2 of the shown Sundays
    // 06/07–06/21 have no check-ins at all → attendance wasn't taken → blank, not X.
    expect(aRow.slice(3, 6)).toEqual(['', '', ''])
    expect(aRow.slice(6, 8)).toEqual(['O', 'O']) // 06/28 + 07/05 present
    expect(aRow.slice(8)).toEqual(['', '', '', '']) // 07/12–08/02 upcoming → blank
    // B: col A blank, absent 06/28 (that date has data), present 07/05
    expect(aoa[2].slice(0, 3)).toEqual(['', 'B', 1])
    expect(aoa[2].slice(3)).toEqual(['', '', '', 'X', 'O', '', '', '', ''])
  })
  it('leaves pre-등록일자 and upcoming dates blank instead of X', () => {
    const ms = [member('1', 'A'), { ...member('2', 'B'), registration_date: today }]
    const { aoa } = gridSheet(ms, log, 'ko', today)
    // B registered on 07/05: earlier cells blank (pre-reg), 07/05 = O, later Sundays blank (upcoming).
    expect(aoa[2].slice(3)).toEqual(['', '', '', '', 'O', '', '', '', ''])
  })
  it('adds a blank spacer, a 총 출석 row counting present per date (no-data/upcoming blank), and a KEY legend', () => {
    const { aoa } = gridSheet(members, log, 'ko', today)
    expect(aoa[3]).toEqual([])
    expect(aoa[4][0]).toBe('총 출석')
    expect(aoa[4].slice(3, 6)).toEqual(['', '', '']) // no check-ins on 06/07–06/21 → blank totals
    expect(aoa[4].slice(6, 8)).toEqual([1, 2]) // 06/28: A; 07/05: A + B
    expect(aoa[4].slice(8)).toEqual(['', '', '', '']) // upcoming Sundays blank in the totals too
    expect(aoa.slice(-4)).toEqual([['KEY'], ['O', '출석'], ['X', '결석'], ['', '기타']])
  })
  it('merges only the 총 출석 label across A:B (no header merges without the 예배 sub-row)', () => {
    const { merges } = gridSheet(members, log, 'ko', today)
    // 1 header + 2 members + spacer → 총 출석 at row 4
    expect(merges).toEqual([{ s: { r: 4, c: 0 }, e: { r: 4, c: 1 } }])
  })
  it('emits one blank-separated block per 동산', () => {
    const ms = [member('1', 'A', '청년부', '건영동산'), member('2', 'C', '청년부', '중호동산')]
    const lg = [entry('A', today, 1), entry('C', today, 2, { subgroup: '중호동산' })]
    const { aoa } = gridSheet(ms, lg, 'ko', today)
    expect(aoa[1][0]).toBe('건영동산') // section 1 member (directly under the header)
    expect(aoa[3][0]).toBe('총 출석') // section 1 totals (1 header + 1 member + spacer)
    expect(aoa[4]).toEqual([]) // blank separator between blocks
    expect(aoa[5]).toEqual(['', '이름', '예배 총 출석', ...dates.map(formatGridDate)]) // section 2 header
    expect(aoa[6][0]).toBe('중호동산') // section 2 member
  })
  it('uses English labels in en mode', () => {
    const { aoa } = gridSheet(members, log, 'en', today)
    expect(aoa[0].slice(0, 3)).toEqual(['', 'Name', 'Worship Total'])
    expect(aoa.slice(-4)).toEqual([['KEY'], ['O', 'Present'], ['X', 'Absent'], ['', 'Other']])
  })
  it('paints the header fills: 이름 light, 예배총출석 pink, dates medium, KEY teal + grey 기타', () => {
    const { fills } = gridSheet(members, log, 'ko', today)
    const at = (r: number, c: number) => fills.find((f) => f.r === r && f.c === c)?.rgb
    expect(at(0, 0)).toBe('FFD9EAD3') // 이름 label, green light
    expect(at(0, 2)).toBe('FFEAD1DC') // 예배 총 출석, pink
    expect(at(0, 3)).toBe('FFB6D7A8') // first date, green medium
    expect(at(1, 0)).toBe('FFB6D7A8') // 동산 name cell (first member row, now directly under header)
    expect(fills.some((f) => f.rgb === 'FF76A5AF')).toBe(true) // KEY teal
    expect(fills.some((f) => f.rgb === 'FFCCCCCC')).toBe(true) // 기타 grey swatch
  })
  it('renders a status mark as one grey cell merged across the covered dates', () => {
    // C 한국 귀국 from 06/28 with no end → the note spans 06/28 through the 08/02 term end.
    const ms = [...members, { ...member('3', 'C'), status_note: '한국 귀국', status_start: '2026-06-28' }]
    const { aoa, merges, fills } = gridSheet(ms, log, 'ko', today)
    const cRow = aoa[3]
    expect(cRow.slice(1, 3)).toEqual(['C', 0])
    expect(cRow[6]).toBe('한국 귀국') // note sits in the 06/28 cell…
    expect(cRow.slice(7)).toEqual(['', '', '', '', '']) // …and the covered cells after it are empty
    expect(merges).toContainEqual({ s: { r: 3, c: 6 }, e: { r: 3, c: 11 } }) // merged 06/28→08/02
    // every covered cell is greyed
    for (let c = 6; c <= 11; c++) expect(fills).toContainEqual({ r: 3, c, rgb: 'FFCCCCCC' })
  })
  it('cycles the palette per 동산 block (block 1 = blue)', () => {
    const ms = [member('1', 'A', '청년부', '건영동산'), member('2', 'C', '청년부', '중호동산')]
    const lg = [entry('A', today, 1), entry('C', today, 2, { subgroup: '중호동산' })]
    const { fills } = gridSheet(ms, lg, 'ko', today)
    const at = (r: number, c: number) => fills.find((f) => f.r === r && f.c === c)?.rgb
    // block 1 header begins at row 5 (1 header + 1 member + spacer + totals + blank separator)
    expect(at(5, 0)).toBe('FFCFE2F3') // blue light
    expect(at(5, 3)).toBe('FF9FC5E8') // blue medium
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
  // 2026 여름동산 export starts at 06/07; a 07/05 run shows 06/07–07/05.
  const today = '2026-07-05'
  const members = [member('1', 'A'), member('2', 'B')]
  const log = [entry('A', '2026-06-07', 1), entry('A', today, 2), entry('B', today, 3)]

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
  it('labels the semester and uses its term Sundays as date columns', () => {
    const html = reportHtml(members, log, { group: '', subgroup: '', today, lang: 'ko' })
    expect(html).toContain('2026 여름 학기')
    for (const d of exportSundays(today)) expect(html).toContain(formatGridDate(d))
    // the dropped May Sundays must not appear
    expect(html).not.toContain(formatGridDate('2026-05-31'))
  })
  it('color-codes 동산 blocks (green, then blue) plus pink total + teal KEY', () => {
    const ms = [member('1', 'A', '청년부', '건영동산'), member('2', 'C', '청년부', '중호동산')]
    const lg = [entry('A', today, 1), entry('C', today, 2, { subgroup: '중호동산' })]
    const html = reportHtml(ms, lg, { group: '', subgroup: '', today, lang: 'ko' })
    expect(html).toContain('background:#B6D7A8') // block 0 green medium
    expect(html).toContain('background:#9FC5E8') // block 1 blue medium
    expect(html).toContain('background:#EAD1DC') // 예배 총 출석 pink
    expect(html).toContain('background:#76A5AF') // KEY teal chip
  })
  it('renders status marks as grey colspan cells and lists 기타 in the KEY', () => {
    const ms = [member('1', 'A'), { ...member('2', 'B'), status_note: '이주(방문자)', status_start: today }]
    const html = reportHtml(ms, log, { group: '', subgroup: '', today, lang: 'ko' })
    expect(html).toContain('<td class="etc" colspan="5">이주(방문자)</td>') // 07/05 → the 08/02 term end
    expect(html).toContain('기타') // KEY legend entry
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

describe('newFamilyRow', () => {
  it('maps the 12 template columns from a fully-filled member', () => {
    const m: Member = {
      ...member('1', '김철수', '대학부', '1동산'),
      gender: '남',
      registration_date: '2026-07-05',
      birth_date: '2004-03-15',
      phone: '(412) 555-1234',
      school_or_work: '대학생 · Pitt 컴퓨터공학',
      baptism_status: '세례',
      pastoral_visit_requested: true,
      notes: '카톡 안 함',
    }
    expect(newFamilyRow(m)).toEqual([
      '김철수',
      new Date(2026, 6, 5),
      '남',
      new Date(2004, 2, 15),
      '(412) 555-1234',
      '',
      'Pitt 컴퓨터공학', // 소속 category prefix stripped
      '세례',
      '',
      'O', // subgroup set → 동산 참여
      'O', // pastoral_visit_requested
      '카톡 안 함', // notes (메모), not faith_duration
    ])
  })
  it('blanks/defaults for a bare-minimum member', () => {
    const row = newFamilyRow(member('2', '이영희', '청년부', ''))
    expect(row[1]).toBe('') // no registration_date
    expect(row[3]).toBe('') // no birth_date
    expect(row[5]).toBe('') // 이메일 — not collected
    expect(row[8]).toBe('') // 주소/동네 — not collected
    expect(row[9]).toBe('X') // no subgroup
    expect(row[10]).toBe('X') // pastoral_visit_requested falsy
    expect(row[11]).toBe('') // notes empty
  })
})

describe('newFamilySheets', () => {
  it('has the template header, in column order', () => {
    expect(NEW_FAMILY_HEADER).toEqual([
      '이름', '등록일', '성별', '생년월일', '전화번호', '이메일',
      '학교/직장, 학과', '세례', '주소/동네', '동산 참여', '목사님 심방', '노트',
    ])
  })
  it('splits members into one sheet per 부서, first-seen order', () => {
    const ms = [member('1', 'A', '청년부'), member('2', 'B', '대학부'), member('3', 'C', '청년부')]
    const sheets = newFamilySheets(ms)
    expect(sheets.map((s) => s.name)).toEqual(['청년부', '대학부'])
    expect(sheets[0].aoa[0]).toEqual(NEW_FAMILY_HEADER)
    expect(sheets[0].aoa.map((r) => r[0])).toEqual(['이름', 'A', 'C'])
    expect(sheets[1].aoa.map((r) => r[0])).toEqual(['이름', 'B'])
  })
  it('falls back to a placeholder sheet name for a blank group_name', () => {
    expect(newFamilySheets([member('1', 'A', '')])[0].name).toBe('미지정')
  })
})
