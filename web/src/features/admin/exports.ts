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

// A solid cell fill (0-based row/col), rgb as ARGB hex (e.g. "FFB6D7A8").
export interface CellFill {
  r: number
  c: number
  rgb: string
}

export interface SheetData {
  aoa: (string | number)[][]
  merges: CellMerge[]
  fills: CellFill[]
}

// One member row inside an attendance block: their attended dates (by name) and the count
// of *shown* dates they attended (예배 총 출석).
export interface AttendanceMemberRow {
  member: Member
  present: Set<string>
  total: number
}

// Dates before a member's 등록일자 don't apply to them — not an absence, not part of
// their counts. Members without a registration date are scored on every date.
export function beforeRegistration(m: Member, date: string): boolean {
  return !!m.registration_date && date < m.registration_date
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
    const total = dates.reduce((n, d) => n + (!beforeRegistration(m, d) && present.has(d) ? 1 : 0), 0)
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

// Per-동산 header palette, matching the legacy sheet: blocks cycle green -> blue -> yellow ->
// red, each a light shade (이름 labels) + a medium shade (date headers, 동산 name, 총 출석). The
// 예배 총 출석 header is a constant pink; the KEY legend a teal. Colors are ARGB hex.
export interface BlockColors {
  light: string
  medium: string
}
const COLOR_FAMILIES: BlockColors[] = [
  { light: 'FFD9EAD3', medium: 'FFB6D7A8' }, // green
  { light: 'FFCFE2F3', medium: 'FF9FC5E8' }, // blue
  { light: 'FFFFF2CC', medium: 'FFFFE599' }, // yellow
  { light: 'FFF4CCCC', medium: 'FFEA9999' }, // red
]
export const HEADER_TOTAL_FILL = 'FFEAD1DC' // 예배 총 출석 column header
export const KEY_FILL = 'FF76A5AF' // KEY legend label

// The color family for the nth 동산 block (cycles through the palette).
export function blockColors(index: number): BlockColors {
  return COLOR_FAMILIES[index % COLOR_FAMILIES.length]
}

// ARGB hex ("FFB6D7A8") -> CSS hex ("#B6D7A8"), dropping the alpha byte.
export function cssColor(argb: string): string {
  return `#${argb.slice(2)}`
}

// Sheet 1 - "Attendance". Reproduces the church's legacy spreadsheet: members are split
// into 동산 (subgroup) blocks; each block has a two-row header (date row + 예배 label row),
// O = present / X = absent cells, a per-member 예배 총 출석 count and a 총 출석 totals row.
// A KEY legend (O 출석 / X 결석) closes the sheet. Date columns are the current semester's
// Sundays through `today` (the original's 동산모임 column is dropped - the system only records
// 예배 worship check-ins). Returns the array-of-rows, the header/totals cell-merges and the
// per-동산 header fills (ARGB).
export function gridSheet(members: Member[], log: LogEntry[], lang: Lang, today: string): SheetData {
  const L =
    lang === 'ko'
      ? { name: '이름', memberTotal: '예배 총 출석', worship: '예배', total: '총 출석', key: 'KEY', present: '출석', absent: '결석', unassigned: '동산 미지정' }
      : { name: 'Name', memberTotal: 'Worship Total', worship: 'Worship', total: 'Total', key: 'KEY', present: 'Present', absent: 'Absent', unassigned: 'Unassigned' }

  const model = buildAttendanceModel(members, log, semesterSundays(today), L.unassigned)
  const nDates = model.dates.length

  const aoa: (string | number)[][] = []
  const merges: CellMerge[] = []
  const fills: CellFill[] = []

  model.sections.forEach((section, si) => {
    if (si > 0) aoa.push([]) // blank row between 동산 blocks
    const { light, medium } = blockColors(si)

    const top = aoa.length
    aoa.push(['', L.name, L.memberTotal, ...model.dateLabels]) // header row 1: labels + dates
    aoa.push(['', '', '', ...model.dates.map(() => L.worship)]) // header row 2: 예배 per date
    // The empty corner / 이름 / 예배 총 출석 each span both header rows.
    for (let c = 0; c < 3; c++) merges.push({ s: { r: top, c }, e: { r: top + 1, c } })
    // Color the header band: 이름 labels light, 예배 총 출석 pink, date columns medium.
    for (const r of [top, top + 1]) {
      fills.push({ r, c: 0, rgb: light }, { r, c: 1, rgb: light }, { r, c: 2, rgb: HEADER_TOTAL_FILL })
      for (let c = 3; c < 3 + nDates; c++) fills.push({ r, c, rgb: medium })
    }

    // Member rows - 동산 name sits in column A of the first member (as in the sample).
    const firstMemberRow = aoa.length
    section.rows.forEach((r, i) => {
      aoa.push([
        i === 0 ? section.subgroup : '',
        r.member.name,
        r.total,
        // Pre-등록일자 dates are blank — the member wasn't registered yet, so no O/X.
        ...model.dates.map((d) => (beforeRegistration(r.member, d) ? '' : r.present.has(d) ? 'O' : 'X')),
      ])
    })
    if (section.rows.length) fills.push({ r: firstMemberRow, c: 0, rgb: medium }) // 동산 name cell

    aoa.push([]) // blank spacer before the totals row
    const totalsAt = aoa.length
    aoa.push([L.total, '', '', ...section.totals]) // 총 출석: present count per date
    merges.push({ s: { r: totalsAt, c: 0 }, e: { r: totalsAt, c: 1 } }) // 총 출석 label spans A:B
    fills.push({ r: totalsAt, c: 0, rgb: medium }, { r: totalsAt, c: 1, rgb: medium })
  })

  // KEY legend: O = 출석, X = 결석.
  const keyRow = aoa.length + 2
  aoa.push([], [], [L.key], ['O', L.present], ['X', L.absent])
  fills.push({ r: keyRow, c: 0, rgb: KEY_FILL })

  return { aoa, merges, fills }
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
// one color-coded table per 동산 (two-row header: date row + 예배 row), O = present / X = absent
// cells, a per-member 예배 총 출석 count and a 총 출석 totals row, then a KEY legend. Date columns
// are the current semester's Sundays through `today`; per-동산 colors match the legacy sheet.
// Self-contained (inline CSS), client-rendered; opens the print / Save-as-PDF dialog on load.
export function reportHtml(members: Member[], log: LogEntry[], opts: ReportOpts): string {
  const { lang } = opts
  const L =
    lang === 'ko'
      ? { title: 'KCCP 출석부', name: '이름', memberTotal: '예배 총 출석', worship: '예배', total: '총 출석', key: 'KEY', present: '출석', absent: '결석', unassigned: '동산 미지정', save: 'PDF로 저장', empty: '출석 기록이 없습니다' }
      : { title: 'KCCP Attendance', name: 'Name', memberTotal: 'Worship Total', worship: 'Worship', total: 'Total', key: 'KEY', present: 'Present', absent: 'Absent', unassigned: 'Unassigned', save: 'Save as PDF', empty: 'No attendance records' }

  const model = buildAttendanceModel(members, log, semesterSundays(opts.today), L.unassigned)
  const pink = cssColor(HEADER_TOTAL_FILL)

  const blocks = model.sections
    .map((s, si) => {
      const { light: lightArgb, medium: mediumArgb } = blockColors(si)
      const light = cssColor(lightArgb)
      const medium = cssColor(mediumArgb)
      const dateHead = model.dateLabels.map((d) => `<th style="background:${medium}">${escapeHtml(d)}</th>`).join('')
      const worshipHead = model.dates.map(() => `<th style="background:${medium}">${escapeHtml(L.worship)}</th>`).join('')
      const rows = s.rows
        .map((r) => {
          const cells = model.dates
            .map((d) =>
              beforeRegistration(r.member, d)
                ? '<td></td>'
                : r.present.has(d)
                  ? '<td class="o">O</td>'
                  : '<td class="x">X</td>',
            )
            .join('')
          return `<tr><td class="name">${escapeHtml(r.member.name)}</td><td class="num">${r.total}</td>${cells}</tr>`
        })
        .join('')
      const totals = s.totals.map((t) => `<td class="num">${t}</td>`).join('')
      return `<section class="block">
  <h2 style="background:${medium}">${escapeHtml(s.subgroup)}</h2>
  <table>
    <thead>
      <tr><th class="name" rowspan="2" style="background:${light}">${escapeHtml(L.name)}</th><th class="num" rowspan="2" style="background:${pink}">${escapeHtml(L.memberTotal)}</th>${dateHead}</tr>
      <tr>${worshipHead}</tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td class="total" colspan="2" style="background:${medium}">${escapeHtml(L.total)}</td>${totals}</tr></tfoot>
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
  h2 { display: inline-block; font-size: 13px; font-weight: 700; margin: 0 0 6px; padding: 3px 12px; border-radius: 4px; color: #1f2937; }
  table { border-collapse: collapse; font-size: 11px; width: 100%; }
  th, td { border: 1px solid #b7b7b7; padding: 3px 6px; text-align: center; white-space: nowrap; }
  thead th { font-weight: 700; }
  td.name { text-align: left; }
  td.num, th.num { font-weight: 700; }
  td.o { color: #16a34a; font-weight: 700; }
  td.x { color: #dc2626; }
  td.total { text-align: left; font-weight: 700; }
  tfoot td.num { background: #fff; }
  tr { break-inside: avoid; }
  .key { margin-top: 8px; font-size: 12px; color: #374151; display: flex; gap: 16px; align-items: center; }
  .key .kchip { color: #fff; padding: 2px 10px; border-radius: 3px; }
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
  <div class="key"><b class="kchip" style="background:${cssColor(KEY_FILL)}">${escapeHtml(L.key)}</b><span><b>O</b> ${escapeHtml(L.present)}</span><span><b>X</b> ${escapeHtml(L.absent)}</span></div>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print() }, 350) })</script>
</body>
</html>`
}
