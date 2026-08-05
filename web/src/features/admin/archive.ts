import type { Member, LogEntry } from '../../lib/api'
import {
  DEFAULT_SEMESTER_DATES,
  dateForYear,
  addIsoDays,
  type SemesterDates,
} from '../../lib/semester'
import type { Season } from './newFamily'
import { sundaysBetween } from './newFamily'
import {
  attendanceSheet,
  formatGridDate,
  logRows,
  periodGroupBy,
  sheetLabels,
  type Lang,
  type SheetData,
} from './exports'

// ── 지난 학기 / 연도 출석부 (archive exports) ─────────────────────────────────
// Once a 학기 (or the gap between two 학기) is over, its sheet stops changing — it becomes a
// record. The 출석부 tab lists every finished stretch here and hands it back as a downloadable
// Excel workbook: one term per sheet, plus a full log. Years are the same thing at a coarser
// grain — a 학년도 (2026–27, fall→fall) and a calendar year (2026) each collect the terms and
// gaps they contain into one workbook.
//
// Everything below is pure so it can be unit-tested; the XLSX.writeFile side lives in
// ArchiveSection.tsx, exactly as with gridSheet/ExportMenu.
//
// Caveat worth knowing: archives are scored against the *current* roster, because that's all
// the data there is — a member's 동산 is a single current field and reassignment rewrites the
// denormalized log rows too, so a past term's blocks reflect today's 동산 편성, not the one
// that term ran under. Members who registered after a period ends are left out of it entirely.

export type PeriodKind = 'semester' | 'transition'

// One stretch of the calendar: a configured 학기, or the gap between two of them.
export interface Period {
  kind: PeriodKind
  key: string // '2026-summer' | 'gap-2026-08-09'
  start: string // ISO, inclusive
  end: string // ISO, inclusive
  year: number
  season?: Season // semesters only
}

// Every period of calendar year `year`, chronological and gap-free: the wraparound gap that
// opened when last year's 가을학기 ended, 봄학기, its trailing gap, 여름학기, its trailing gap,
// 가을학기. The gap *after* 가을학기 belongs to the next year's list (it opens this December
// but is the run-up to next 봄학기), so consecutive years tile without overlapping.
export function periodsInYear(year: number, semesterDates?: SemesterDates | null): Period[] {
  const dates = semesterDates ?? DEFAULT_SEMESTER_DATES
  // Calendar order (봄 → 여름 → 가을), not the settings editor's academic display order.
  const seasons: Season[] = ['spring', 'summer', 'fall']
  const out: Period[] = []
  let prevEnd = dateForYear(year - 1, dates.fall.end)
  for (const season of seasons) {
    const start = dateForYear(year, dates[season].start)
    const end = dateForYear(year, dates[season].end)
    const gapStart = addIsoDays(prevEnd, 1)
    const gapEnd = addIsoDays(start, -1)
    // Back-to-back terms (the defaults) leave no gap at all — then there's no period to add.
    if (gapStart <= gapEnd) {
      out.push({ kind: 'transition', key: `gap-${gapStart}`, start: gapStart, end: gapEnd, year })
    }
    out.push({ kind: 'semester', key: `${year}-${season}`, start, end, year, season })
    prevEnd = end
  }
  return out
}

// Every period overlapping [from, to], chronological. Spans as many calendar years as the
// range covers (+1, so a range ending inside a year-crossing gap still picks that gap up).
export function periodsBetween(from: string, to: string, semesterDates?: SemesterDates | null): Period[] {
  const firstYear = Number(from.slice(0, 4))
  const lastYear = Number(to.slice(0, 4))
  const out: Period[] = []
  for (let y = firstYear; y <= lastYear + 1; y++) out.push(...periodsInYear(y, semesterDates))
  return out.filter((p) => p.end >= from && p.start <= to).sort((a, b) => a.start.localeCompare(b.start))
}

// A period narrowed to [start, end] — a year's workbook shows only the slice of each term
// that falls inside that year.
export function clipPeriod(p: Period, start: string, end: string): Period {
  return { ...p, start: p.start > start ? p.start : start, end: p.end < end ? p.end : end }
}

// The 학년도 (US academic year) a date belongs to: the year whose 가을학기 opened it. Runs
// 가을 → 다음 가을 직전, so every date belongs to exactly one 학년도 (gaps included).
export function academicYearOf(date: string, semesterDates?: SemesterDates | null): number {
  const dates = semesterDates ?? DEFAULT_SEMESTER_DATES
  const year = Number(date.slice(0, 4))
  return date >= dateForYear(year, dates.fall.start) ? year : year - 1
}

export function academicYearBounds(year: number, semesterDates?: SemesterDates | null): { start: string; end: string } {
  const dates = semesterDates ?? DEFAULT_SEMESTER_DATES
  return {
    start: dateForYear(year, dates.fall.start),
    end: addIsoDays(dateForYear(year + 1, dates.fall.start), -1),
  }
}

export interface RangeStats {
  records: number // attendance rows inside the range
  sundays: number // distinct worship dates that actually have attendance
}

export function rangeStats(log: LogEntry[], start: string, end: string): RangeStats {
  const days = new Set<string>()
  let records = 0
  for (const e of log) {
    if (e.date < start || e.date > end) continue
    records++
    days.add(e.date)
  }
  return { records, sundays: days.size }
}

export type ArchiveKind = PeriodKind | 'academicYear' | 'calendarYear'

// One downloadable archive: a finished 학기/전환 기간, a finished 학년도, or a finished
// calendar year. `periods` are the sheets its workbook carries (one per term/gap with data).
export interface ArchiveEntry extends RangeStats {
  id: string
  kind: ArchiveKind
  start: string
  end: string
  year: number
  season?: Season
  periods: Period[]
}

// The term/gap sheets a multi-period archive (year) is made of: everything overlapping the
// range, clipped to it, keeping only the ones that carry attendance — an all-blank 학기 from
// before the system was in use isn't worth a sheet.
function periodSheetsIn(
  log: LogEntry[],
  start: string,
  end: string,
  semesterDates?: SemesterDates | null,
): Period[] {
  return periodsBetween(start, end, semesterDates)
    .map((p) => clipPeriod(p, start, end))
    .filter((p) => rangeStats(log, p.start, p.end).records > 0)
}

// Everything downloadable as of `today`, newest first: each finished 학기 and 전환 기간 that
// recorded attendance, then each finished 학년도 and calendar year. A period only shows up
// once it is fully over — the term still in progress is what the 내보내기 button already
// exports. Empty stretches (no attendance at all) are skipped.
export function archiveEntries(
  log: LogEntry[],
  today: string,
  semesterDates?: SemesterDates | null,
): ArchiveEntry[] {
  if (log.length === 0) return []
  const first = log.reduce((min, e) => (e.date < min ? e.date : min), log[0].date)
  const entries: ArchiveEntry[] = []

  for (const p of periodsBetween(first, today, semesterDates)) {
    if (p.end >= today) continue
    const stats = rangeStats(log, p.start, p.end)
    if (stats.records === 0) continue
    entries.push({
      id: p.key,
      kind: p.kind,
      start: p.start,
      end: p.end,
      year: p.year,
      season: p.season,
      periods: [p],
      ...stats,
    })
  }

  for (let y = academicYearOf(first, semesterDates); y <= academicYearOf(today, semesterDates); y++) {
    const { start, end } = academicYearBounds(y, semesterDates)
    if (end >= today) continue
    const stats = rangeStats(log, start, end)
    if (stats.records === 0) continue
    entries.push({
      id: `ay-${y}`,
      kind: 'academicYear',
      start,
      end,
      year: y,
      periods: periodSheetsIn(log, start, end, semesterDates),
      ...stats,
    })
  }

  for (let y = Number(first.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) {
    const start = `${y}-01-01`
    const end = `${y}-12-31`
    if (end >= today) continue
    const stats = rangeStats(log, start, end)
    if (stats.records === 0) continue
    entries.push({
      id: `cy-${y}`,
      kind: 'calendarYear',
      start,
      end,
      year: y,
      periods: periodSheetsIn(log, start, end, semesterDates),
      ...stats,
    })
  }

  return entries.sort((a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start))
}

// The 학기/전환 기간 archives (one term each) and the 학년도/역년 archives (whole years) —
// the 출석부 tab lists them as two separate groups.
export function isYearArchive(e: ArchiveEntry): boolean {
  return e.kind === 'academicYear' || e.kind === 'calendarYear'
}

// ── Labels ───────────────────────────────────────────────────────────────────

const SEASON_KO: Record<Season, string> = { spring: '봄', summer: '여름', fall: '가을' }
const SEASON_EN: Record<Season, string> = { spring: 'Spring', summer: 'Summer', fall: 'Fall' }

export function seasonLabel(year: number, season: Season, lang: Lang): string {
  return lang === 'ko' ? `${year} ${SEASON_KO[season]} 학기` : `${SEASON_EN[season]} ${year}`
}

// "06/07/2026 – 08/08/2026" — the same MM/DD/YYYY the sheet's date columns use.
export function rangeLabel(start: string, end: string): string {
  return `${formatGridDate(start)} – ${formatGridDate(end)}`
}

export function periodLabel(p: Period, lang: Lang): string {
  if (p.kind === 'semester' && p.season) return seasonLabel(p.year, p.season, lang)
  return lang === 'ko' ? '학기 사이 (전환 기간)' : 'Between terms'
}

export function archiveLabel(e: ArchiveEntry, lang: Lang): string {
  if (e.kind === 'academicYear') {
    const next = String(e.year + 1).slice(2)
    return lang === 'ko' ? `${e.year}–${next} 학년도` : `${e.year}–${next} Academic Year`
  }
  if (e.kind === 'calendarYear') return lang === 'ko' ? `${e.year}년` : `${e.year}`
  return periodLabel({ kind: e.kind, key: e.id, start: e.start, end: e.end, year: e.year, season: e.season }, lang)
}

// Filename for a downloaded archive, mirroring exportFilename's shape:
// kccp-attendance-{group?}-{2026-summer | transition-2026-08-09 | 2026-2027 | 2026}.xlsx
export function archiveFilename(e: ArchiveEntry, group: string): string {
  const g = group.trim().replace(/\s+/g, '')
  const tag =
    e.kind === 'semester' && e.season
      ? `${e.year}-${e.season}`
      : e.kind === 'transition'
        ? `transition-${e.start}`
        : e.kind === 'academicYear'
          ? `${e.year}-${e.year + 1}`
          : `${e.year}`
  return `kccp-attendance-${g ? `${g}-` : ''}${tag}.xlsx`
}

// Excel worksheet title for one period. Sheet names cap at 31 chars and reject : \ / ? * [ ],
// so the gap's dates use dots — and the whole thing is trimmed to fit.
export function sheetTitle(p: Period, lang: Lang): string {
  const short = (iso: string) => iso.slice(5).replace('-', '.')
  const raw =
    p.kind === 'semester' && p.season
      ? lang === 'ko'
        ? `${p.year} ${SEASON_KO[p.season]}학기`
        : `${SEASON_EN[p.season]} ${p.year}`
      : lang === 'ko'
        ? `학기 사이 ${short(p.start)}-${short(p.end)}`
        : `Between ${short(p.start)}-${short(p.end)}`
  return raw.slice(0, 31)
}

// Excel rejects duplicate sheet names — a year workbook can hold two gaps whose trimmed
// titles collide, so later duplicates get a numeric suffix.
export function uniqueSheetNames(names: string[]): string[] {
  const seen = new Set<string>()
  return names.map((name) => {
    if (!seen.has(name)) {
      seen.add(name)
      return name
    }
    let n = 2
    let next = `${name.slice(0, 28)} ${n}`
    while (seen.has(next)) next = `${name.slice(0, 28)} ${++n}`
    seen.add(next)
    return next
  })
}

// ── Workbook ─────────────────────────────────────────────────────────────────

export interface ArchiveSheet {
  name: string
  data: SheetData
}

export interface ArchiveWorkbook {
  sheets: ArchiveSheet[] // one Attendance-style sheet per term/gap, chronological
  log: (string | number)[][] // the "Full Log" sheet, scoped to the archive's range
}

// Everything a downloaded archive contains. Each period is scored over *its own* worship
// Sundays — the whole set, with dates the church didn't meet (or didn't record) staying
// blank — and grouped by 동산 for a 학기, by 부서 for a gap, exactly as the live sheet does.
export function archiveWorkbook(
  entry: ArchiveEntry,
  members: Member[],
  log: LogEntry[],
  lang: Lang,
): ArchiveWorkbook {
  const { unassigned } = sheetLabels(lang)
  const names = uniqueSheetNames(entry.periods.map((p) => sheetTitle(p, lang)))
  const sheets = entry.periods.map((p, i) => ({
    name: names[i],
    data: attendanceSheet(
      // Someone who registered after the period ended was never part of it.
      members.filter((m) => !m.registration_date || m.registration_date <= p.end),
      log.filter((e) => e.date >= p.start && e.date <= p.end),
      lang,
      sundaysBetween(p.start, p.end),
      // The period is over, so its own end stands in for "today": nothing inside it is
      // upcoming, and every recorded Sunday scores O/X.
      p.end,
      periodGroupBy(p.kind, unassigned),
    ),
  }))
  const scoped = log.filter((e) => e.date >= entry.start && e.date <= entry.end)
  return { sheets, log: logRows(members, scoped, lang) }
}
