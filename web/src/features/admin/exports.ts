import type { Member, LogEntry } from '../../lib/api'
import { buildGrid } from './sheet'
import { semesterBounds, semesterSundays } from './newFamily'

// ── Pure export helpers ──────────────────────────────────────────────────────
// Everything here is side-effect free so it can be unit-tested. The thin DOM bits
// (clipboard write, window.open, XLSX.writeFile) stay in the component.

export type Lang = 'ko' | 'en'

// Filename for the Excel export: kccp-attendance-{group?}-{YYYY-MM-DD}.xlsx.
// The optional group label is slugged of whitespace; an empty group is omitted.
export function exportFilename(group: string, date: string): string {
  const g = group.trim().replace(/\s+/g, '')
  return `kccp-attendance-${g ? `${g}-` : ''}${date}.xlsx`
}

// "Notes" column for the Full Log sheet — the legacy concatenation of flag labels.
function logNotes(e: LogEntry, lang: Lang): string {
  const L =
    lang === 'ko'
      ? { first: '첫출석', manual: '수동', guest: '방문자' }
      : { first: 'First visit', manual: 'Manual', guest: 'Guest' }
  const parts: string[] = []
  if (e.firstVisit) parts.push(L.first)
  if (e.memberRole === 'manual') parts.push(L.manual)
  if (e.memberRole === 'visitor' || e.memberRole === 'guest') parts.push(L.guest)
  return parts.join(' ')
}

// "2026-06-07" -> "06/07/2026" (MM/DD/YYYY) - the date-column format of the legacy sheet.
export function formatGridDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${m}/${d}/${y}`
}

// A cell-merge range in SheetJS form ({s}tart/{e}nd, 0-based row/col). Mirrors XLSX.Range
// so it can be assigned straight to a worksheet's `!merges`.
export interface CellMerge {
  s: { r: number; c: number }
  e: { r: number; c: number }
}

export interface SheetData {
  aoa: (string | number)[][]
  merges: CellMerge[]
}

// One member row inside an attendance block: their attended dates (by name) and the count
// of *shown* dates they attended (예배 총 출석).
export interface AttendanceMemberRow {
  member: Member
  present: Set<string>
  total: number
}

export interface AttendanceSection {
  subgroup: string
  rows: AttendanceMemberRow[]
  totals: number[] // present count per shown date
}

export interface AttendanceModel {
  dates: string[]
  dateLabels: string[]
  sections: AttendanceSection[]
}

// Shared spine of the Excel sheet and the PDF report: the roster split into 동산 blocks and
// scored against an explicit list of `dates` (the current semester's Sundays). Members without
// a 동산 bucket last, under `unassigned`. Roster order is preserved.
export function buildAttendanceModel(
  members: Member[],
  log: LogEntry[],
  dates: string[],
  unassigned: string,
): AttendanceModel {
  // name -> every date that name attended (the denormalized log carries the name).
  const attended = new Map<string, Set<string>>()
  for (const e of log) {
    let set = attended.get(e.name)
    if (!set) {
      set = new Set<string>()
      attended.set(e.name, set)
    }
    set.add(e.date)
  }

  const order: string[] = []
  const byKey = new Map<string, AttendanceMemberRow[]>()
  for (const m of members) {
    const present = attended.get(m.name) ?? new Set<string>()
    const total = dates.reduce((n, d) => n + (present.has(d) ? 1 : 0), 0)
    const key = m.subgroup || unassigned
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = []
      byKey.set(key, bucket)
      order.push(key)
    }
    bucket.push({ member: m, present, total })
  }

  const sections = order.map((subgroup) => {
    const rows = byKey.get(subgroup)!
    const totals = dates.map((d) => rows.reduce((n, r) => n + (r.present.has(d) ? 1 : 0), 0))
    return { subgroup, rows, totals }
  })
  return { dates, dateLabels: dates.map(formatGridDate), sections }
}

// Human label for the semester containing `today`, e.g. "2026 여름 학기" / "Summer 2026".
export function semesterLabel(today: string, lang: Lang): string {
  const { year, season } = semesterBounds(today)
  if (lang === 'ko') {
    const ko = season === 'spring' ? '봄' : season === 'summer' ? '여름' : '가을'
    return `${year} ${ko} 학기`
  }
  const en = season === 'spring' ? 'Spring' : season === 'summer' ? 'Summer' : 'Fall'
  return `${en} ${year}`
}

// Sheet 1 - "Attendance". Reproduces the church's legacy spreadsheet: members are split
// into 동산 (subgroup) blocks; each block has a two-row header (date row + 예배 label row),
// O = present / X = absent cells, a per-member 예배 총 출석 count and a 총 출석 totals row.
// A KEY legend (O 출석 / X 결석) closes the sheet. Date columns are the current semester's
// Sundays through `today` (the original's 동산모임 column is dropped - the system only records
// 예배 worship check-ins). Returns the array-of-rows plus the header/totals cell-merges.
export function gridSheet(members: Member[], log: LogEntry[], lang: Lang, today: string): SheetData {
  const L =
    lang === 'ko'
      ? { name: '이름', memberTotal: '예배 총 출석', worship: '예배', total: '총 출석', key: 'KEY', present: '출석', absent: '결석', unassigned: '동산 미지정' }
      : { name: 'Name', memberTotal: 'Worship Total', worship: 'Worship', total: 'Total', key: 'KEY', present: 'Present', absent: 'Absent', unassigned: 'Unassigned' }

  const model = buildAttendanceModel(members, log, semesterSundays(today), L.unassigned)

  const aoa: (string | number)[][] = []
  const merges: CellMerge[] = []

  let firstSection = true
  for (const section of model.sections) {
    if (!firstSection) aoa.push([]) // blank row between 동산 blocks
    firstSection = false

    const top = aoa.length
    aoa.push(['', L.name, L.memberTotal, ...model.dateLabels]) // header row 1: labels + dates
    aoa.push(['', '', '', ...model.dates.map(() => L.worship)]) // header row 2: 예배 per date
    // The empty corner / 이름 / 예배 총 출석 each span both header rows.
    for (let c = 0; c < 3; c++) merges.push({ s: { r: top, c }, e: { r: top + 1, c } })

    // Member rows - 동산 name sits in column A of the first member (as in the sample).
    section.rows.forEach((r, i) => {
      aoa.push([
        i === 0 ? section.subgroup : '',
        r.member.name,
        r.total,
        ...model.dates.map((d) => (r.present.has(d) ? 'O' : 'X')),
      ])
    })

    aoa.push([]) // blank spacer before the totals row
    const totalsAt = aoa.length
    aoa.push([L.total, '', '', ...section.totals]) // 총 출석: present count per date
    merges.push({ s: { r: totalsAt, c: 0 }, e: { r: totalsAt, c: 1 } }) // 총 출석 label spans A:B
  }

  // KEY legend: O = 출석, X = 결석.
  aoa.push([], [], [L.key], ['O', L.present], ['X', L.absent])

  return { aoa, merges }
}

// Sheet 2 — "Full Log" as an array-of-rows (header first), newest first. Columns:
// Name, Group, 동산, Date, Time, Total, Notes.
export function logRows(members: Member[], log: LogEntry[], lang: Lang): (string | number)[][] {
  const head =
    lang === 'ko'
      ? ['이름', '부서', '동산', '날짜', '시간', '합계', '비고']
      : ['Name', 'Group', '동산', 'Date', 'Time', 'Total', 'Notes']

  // Per-member total = distinct attendance dates (matches the grid Total column).
  const totals = new Map<string, number>()
  for (const r of buildGrid(members, log).rows) totals.set(r.member.name, r.total)

  const rows: (string | number)[][] = [head]
  for (const e of [...log].sort((a, b) => b.ts - a.ts)) {
    rows.push([e.name, e.group, e.subgroup, e.date, e.time, totals.get(e.name) ?? 0, logNotes(e, lang)])
  }
  return rows
}

const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Human-readable header date. ISO "2026-06-07" → "Sunday, June 7, 2026" (en) or
// "2026년 6월 7일 (일)" (ko). Parsed as a plain calendar date (no timezone shift).
export function formatHeaderDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10))
  // Day-of-week via UTC to avoid local-timezone drift on the date boundary.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (lang === 'ko') return `${y}년 ${m}월 ${d}일 (${WEEKDAYS_KO[dow]})`
  return `${WEEKDAYS_EN[dow]}, ${MONTHS_EN[m - 1]} ${d}, ${y}`
}

// The 부서/동산 filter label shown in the Kakao/print header. Empty filter → "전체"/"All".
export function filterLabel(group: string, subgroup: string, lang: Lang): string {
  const parts = [group, subgroup].filter(Boolean)
  if (parts.length === 0) return lang === 'ko' ? '전체' : 'All'
  return parts.join(' · ')
}

export interface KakaoOpts {
  group: string
  subgroup: string
  announcement?: string
  lang: Lang
}

// Build the plain-text KakaoTalk attendance summary for `today`, respecting the active
// language and the current 부서/동산 filter. `members`/`log` are already scoped/filtered.
export function kakaoSummary(members: Member[], log: LogEntry[], today: string, opts: KakaoOpts): string {
  const { lang } = opts
  const L =
    lang === 'ko'
      ? { header: '📋 KCCP 출석 현황', count: (n: number) => `총 ${n}명 출석`, present: '✅ 출석:', visitor: '👥 방문 / 기타:', visitorTag: '방문자' }
      : { header: '📋 KCCP Attendance', count: (n: number) => `${n} present`, present: '✅ Present:', visitor: '👥 Visitors / Other:', visitorTag: 'visitor' }

  const todays = log.filter((e) => e.date === today)
  const memberNames = new Set(members.map((m) => m.name))

  // Regulars vs. visitors/others: an entry whose name isn't in the scoped member
  // roster, or is flagged visitor/guest, lands in the second list.
  const seenPresent = new Set<string>()
  const present: string[] = []
  const seenVisitor = new Set<string>()
  const visitors: string[] = []
  for (const e of [...todays].sort((a, b) => a.ts - b.ts)) {
    const isVisitor = e.memberRole === 'visitor' || e.memberRole === 'guest' || !memberNames.has(e.name)
    if (isVisitor) {
      if (seenVisitor.has(e.name)) continue
      seenVisitor.add(e.name)
      visitors.push(e.name)
    } else {
      if (seenPresent.has(e.name)) continue
      seenPresent.add(e.name)
      present.push(e.name)
    }
  }

  const lines: string[] = []
  lines.push(L.header)
  lines.push(`📅 ${formatHeaderDate(today, lang)} (${filterLabel(opts.group, opts.subgroup, lang)})`)
  lines.push(L.count(present.length))
  lines.push('')
  lines.push(L.present)
  if (present.length === 0) lines.push('—')
  else present.forEach((n, i) => lines.push(`${i + 1}. ${n}`))

  if (visitors.length > 0) {
    lines.push('')
    lines.push(L.visitor)
    visitors.forEach((n, i) => lines.push(`${i + 1}. ${n} (${L.visitorTag})`))
  }

  const ann = (opts.announcement ?? '').trim()
  if (ann) {
    lines.push('')
    lines.push(`📢 ${ann}`)
  }

  return lines.join('\n')
}

export interface ReportOpts {
  group: string
  subgroup: string
  today: string
  lang: Lang
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Full standalone HTML document for the PDF report. Mirrors the Excel "Attendance" sheet:
// one table per 동산 (two-row header: date row + 예배 row), O = present / X = absent cells,
// a per-member 예배 총 출석 count and a 총 출석 totals row, then a KEY legend. Date columns are
// the current semester's Sundays through `today`. Self-contained (inline CSS), client-rendered;
// opens the browser print dialog (Save as PDF) on load. Landscape page for wide grids.
export function reportHtml(members: Member[], log: LogEntry[], opts: ReportOpts): string {
  const { lang } = opts
  const L =
    lang === 'ko'
      ? { title: 'KCCP 출석부', name: '이름', memberTotal: '예배 총 출석', worship: '예배', total: '총 출석', key: 'KEY', present: '출석', absent: '결석', unassigned: '동산 미지정', save: 'PDF로 저장', empty: '출석 기록이 없습니다' }
      : { title: 'KCCP Attendance', name: 'Name', memberTotal: 'Worship Total', worship: 'Worship', total: 'Total', key: 'KEY', present: 'Present', absent: 'Absent', unassigned: 'Unassigned', save: 'Save as PDF', empty: 'No attendance records' }

  const model = buildAttendanceModel(members, log, semesterSundays(opts.today), L.unassigned)

  const dateHead = model.dateLabels.map((d) => `<th>${escapeHtml(d)}</th>`).join('')
  const worshipHead = model.dates.map(() => `<th>${escapeHtml(L.worship)}</th>`).join('')

  const blocks = model.sections
    .map((s) => {
      const rows = s.rows
        .map((r) => {
          const cells = model.dates
            .map((d) => (r.present.has(d) ? '<td class="o">O</td>' : '<td class="x">X</td>'))
            .join('')
          return `<tr><td class="name">${escapeHtml(r.member.name)}</td><td class="num">${r.total}</td>${cells}</tr>`
        })
        .join('')
      const totals = s.totals.map((t) => `<td class="num">${t}</td>`).join('')
      return `<section class="block">
  <h2>${escapeHtml(s.subgroup)}</h2>
  <table>
    <thead>
      <tr><th class="name" rowspan="2">${escapeHtml(L.name)}</th><th class="num" rowspan="2">${escapeHtml(L.memberTotal)}</th>${dateHead}</tr>
      <tr>${worshipHead}</tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="total" colspan="2">${escapeHtml(L.total)}</td>${totals}</tr></tfoot>
  </table>
</section>`
    })
    .join('')

  const content = model.sections.length ? blocks : `<p class="empty">${escapeHtml(L.empty)}</p>`

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(exportFilename(opts.group, opts.today).replace(/\.xlsx$/, ''))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; margin: 20px; color: #1f2937; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #6b7280; font-size: 13px; margin-bottom: 18px; }
  .block { margin-bottom: 22px; break-inside: avoid; }
  h2 { font-size: 14px; margin: 0 0 6px; color: #4f46e5; }
  table { border-collapse: collapse; font-size: 11px; width: 100%; }
  th, td { border: 1px solid #d1d5db; padding: 3px 6px; text-align: center; white-space: nowrap; }
  thead th { background: #eef2ff; font-weight: 700; }
  td.name { text-align: left; }
  td.num, th.num { font-weight: 700; }
  td.o { color: #16a34a; font-weight: 700; }
  td.x { color: #dc2626; }
  td.total { text-align: left; font-weight: 700; }
  tfoot td { background: #f9fafb; font-weight: 700; }
  tr { break-inside: avoid; }
  .key { margin-top: 8px; font-size: 12px; color: #374151; display: flex; gap: 16px; align-items: center; }
  .empty { color: #9ca3af; }
  .actions { margin-bottom: 16px; }
  button { font: inherit; padding: 8px 16px; border-radius: 6px; border: none; background: #4f46e5; color: #fff; cursor: pointer; }
  @page { size: landscape; margin: 12mm; }
  @media print { .actions { display: none; } body { margin: 0; } }
</style>
</head>
<body>
  <div class="actions"><button onclick="window.print()">${escapeHtml(L.save)}</button></div>
  <h1>${escapeHtml(L.title)}</h1>
  <div class="sub">${escapeHtml(semesterLabel(opts.today, lang))} · ${escapeHtml(formatHeaderDate(opts.today, lang))} · ${escapeHtml(filterLabel(opts.group, opts.subgroup, lang))}</div>
  ${content}
  <div class="key"><b>${escapeHtml(L.key)}</b><span><b>O</b> ${escapeHtml(L.present)}</span><span><b>X</b> ${escapeHtml(L.absent)}</span></div>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print() }, 350) })</script>
</body>
</html>`
}
