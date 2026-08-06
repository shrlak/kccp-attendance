// Ordered to match the US academic year — fall term first, then spring, then summer.
// This drives the display order in the settings editor. Note it is *display* order only:
// the date-range validation and the date→season bucketing (newFamily.ts) work off the
// calendar dates, which still run spring → summer → fall within a calendar year.
export const SEMESTER_SEASONS = ['fall', 'spring', 'summer'] as const

export type SemesterSeason = (typeof SEMESTER_SEASONS)[number]

// Month/day values repeat each calendar year. Keeping the year out of persisted config
// means an administrator can update the church's annual term boundaries without the app
// becoming tied to one specific year.
export interface SemesterDateRange {
  start: string // MM-DD, inclusive
  end: string // MM-DD, inclusive
}

export type SemesterDates = Record<SemesterSeason, SemesterDateRange>

// Default boundaries used until a super-admin saves a custom schedule. Keyed in the
// US academic-year order (fall → spring → summer); the month/day values still tile a
// calendar year spring → summer → fall.
export const DEFAULT_SEMESTER_DATES: SemesterDates = {
  fall: { start: '08-15', end: '12-31' },
  spring: { start: '01-01', end: '05-09' },
  summer: { start: '05-10', end: '08-14' },
}

const MONTH_DAY_RE = /^\d{2}-\d{2}$/

function monthDayNumber(value: string): number | null {
  if (!MONTH_DAY_RE.test(value)) return null
  const [month, day] = value.split('-').map(Number)
  // 2001 is intentionally non-leap so every saved value works in every year.
  const date = new Date(Date.UTC(2001, month - 1, day))
  if (date.getUTCFullYear() !== 2001 || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return month * 100 + day
}

// All six values must be real recurring dates, each range must run forward, and terms
// may have breaks between them but may never overlap or appear out of order. The order
// check is by *calendar date* (spring → summer → fall within a year), independent of the
// SEMESTER_SEASONS display order, so seasons are looked up by name rather than position.
export function isValidSemesterDates(value: unknown): value is SemesterDates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ranges = value as Partial<Record<SemesterSeason, Partial<SemesterDateRange>>>
  const parsed = {} as Record<SemesterSeason, { start: number; end: number }>
  for (const season of SEMESTER_SEASONS) {
    const range = ranges[season]
    const start = typeof range?.start === 'string' ? monthDayNumber(range.start) : null
    const end = typeof range?.end === 'string' ? monthDayNumber(range.end) : null
    if (start === null || end === null) return false
    parsed[season] = { start, end }
  }
  const { spring, summer, fall } = parsed
  return (
    spring.start <= spring.end &&
    spring.end < summer.start &&
    summer.start <= summer.end &&
    summer.end < fall.start &&
    fall.start <= fall.end
  )
}

// ── 2년치 학기 일정 (rolling schedule) ───────────────────────────────────────
// The MM-DD map above is the *template*: one recurring pattern projected into every year.
// On top of it sits a list of concrete terms with real dates, so 2026 가을학기 and 2027
// 가을학기 can differ. The 설정 탭 edits the next two years' worth of them (WINDOW_TERMS);
// as each term ends it drops out of that window and a fresh one is appended at the back
// (rollSchedule), so the editor always shows two years ahead. Finished terms stay in the
// array — the 지난 학기 출석부 needs the dates the term actually ran on — and only the
// oldest ones past PAST_TERMS age out. Any year/season the list doesn't cover falls back
// to the template, so nothing depends on the list being complete.

export interface SemesterTerm {
  year: number
  season: SemesterSeason
  start: string // ISO YYYY-MM-DD, inclusive
  end: string // ISO YYYY-MM-DD, inclusive
}

export type SemesterSchedule = SemesterTerm[]

// How many current+upcoming terms the 설정 탭 holds — 2 academic years (가을·봄·여름 × 2).
export const WINDOW_TERMS = 6
// How many finished terms to keep for the archives before the oldest ones age out.
export const PAST_TERMS = 12

// The term calendar in the form every date helper reads: the recurring template plus the
// explicit list. Helpers accept either a bare template (as before) or the pair.
export interface TermCalendar {
  dates: SemesterDates
  schedule: SemesterSchedule
}

export type CalendarLike = SemesterDates | TermCalendar | null | undefined

export function calendarOf(input: CalendarLike): TermCalendar {
  if (!input) return { dates: DEFAULT_SEMESTER_DATES, schedule: [] }
  if ('dates' in input && input.dates) {
    const cal = input as TermCalendar
    return { dates: cal.dates ?? DEFAULT_SEMESTER_DATES, schedule: cal.schedule ?? [] }
  }
  return { dates: input as SemesterDates, schedule: [] }
}

// The ISO bounds of one season in one calendar year: the explicit entry when the schedule
// has one, else the recurring template projected into that year.
export function termRange(year: number, season: SemesterSeason, cal: TermCalendar): { start: string; end: string } {
  const listed = cal.schedule.find((t) => t.year === year && t.season === season)
  if (listed) return { start: listed.start, end: listed.end }
  return { start: dateForYear(year, cal.dates[season].start), end: dateForYear(year, cal.dates[season].end) }
}

// Calendar order within a year (봄 → 여름 → 가을), as opposed to SEMESTER_SEASONS' academic
// display order — the sequence the rolling window walks.
const SEASON_ORDER: SemesterSeason[] = ['spring', 'summer', 'fall']

// The term right after `term` in calendar order: 봄 → 여름 → 가을 → 다음 해 봄.
export function nextSeason(year: number, season: SemesterSeason): { year: number; season: SemesterSeason } {
  const i = SEASON_ORDER.indexOf(season)
  return i === SEASON_ORDER.length - 1
    ? { year: year + 1, season: SEASON_ORDER[0] }
    : { year, season: SEASON_ORDER[i + 1] }
}

// The term `date` sits in, or — between two terms — the next one to start. This is where the
// window begins: the term an admin is living in (or about to), never a finished one.
export function currentOrNextTerm(date: string, cal: TermCalendar): { year: number; season: SemesterSeason } {
  const year = Number(date.slice(0, 4))
  for (const y of [year - 1, year, year + 1]) {
    for (const season of SEASON_ORDER) {
      if (date <= termRange(y, season, cal).end) return { year: y, season }
    }
  }
  return { year: year + 1, season: 'spring' }
}

// The rolling window as it should look on `date`: the current (or next) term plus the ones
// after it, WINDOW_TERMS in all. Existing entries keep their saved dates; the terms past the
// end of the list inherit the most recent same-season dates, shifted a year on (so an edited
// pattern carries forward instead of snapping back to the template).
export function buildSchedule(date: string, cal: TermCalendar, count: number = WINDOW_TERMS): SemesterSchedule {
  let { year, season } = currentOrNextTerm(date, cal)
  const out: SemesterSchedule = []
  for (let i = 0; i < count; i++) {
    out.push({ year, season, ...inheritedRange(year, season, cal, out) })
    const next = nextSeason(year, season)
    year = next.year
    season = next.season
  }
  return out
}

// A term's dates when the schedule doesn't list it: the same season's latest known entry
// (from the saved schedule or the window being built) projected into `year`, else the
// template. Keeps a hand-edited 여름학기 pattern from resetting a year later.
function inheritedRange(
  year: number,
  season: SemesterSeason,
  cal: TermCalendar,
  pending: SemesterSchedule,
): { start: string; end: string } {
  const listed = cal.schedule.find((t) => t.year === year && t.season === season)
  if (listed) return { start: listed.start, end: listed.end }
  const sameSeason = [...cal.schedule, ...pending]
    .filter((t) => t.season === season && t.year < year)
    .sort((a, b) => b.year - a.year)[0]
  if (sameSeason) {
    return { start: dateForYear(year, monthDayFromDate(sameSeason.start)), end: dateForYear(year, monthDayFromDate(sameSeason.end)) }
  }
  return { start: dateForYear(year, cal.dates[season].start), end: dateForYear(year, cal.dates[season].end) }
}

// The terms an admin edits: everything in the schedule that hasn't finished yet, capped at
// WINDOW_TERMS. Finished terms stay stored but leave the editor — that is the "학기가 끝나면
// 하나씩 앞으로 민다" half of the rolling window.
export function upcomingTerms(date: string, schedule: SemesterSchedule, count: number = WINDOW_TERMS): SemesterSchedule {
  return schedule
    .filter((t) => t.end >= date)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, count)
}

// The schedule as it should be stored on `date`: finished terms retained (newest PAST_TERMS
// of them) and the window topped back up to WINDOW_TERMS by appending fresh terms at the end.
// Idempotent — calling it on an already-rolled schedule returns an equal list, so the server
// can run it on every request and only write when something actually moved.
export function rollSchedule(date: string, cal: TermCalendar, count: number = WINDOW_TERMS): SemesterSchedule {
  const sorted = [...cal.schedule].sort((a, b) => a.start.localeCompare(b.start))
  const past = sorted.filter((t) => t.end < date).slice(-PAST_TERMS)
  const window = buildSchedule(date, { dates: cal.dates, schedule: sorted }, count)
  return [...past, ...window]
}

export function sameSchedule(a: SemesterSchedule, b: SemesterSchedule): boolean {
  return a.length === b.length && a.every((t, i) => {
    const o = b[i]
    return !!o && t.year === o.year && t.season === o.season && t.start === o.start && t.end === o.end
  })
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// A schedule is storable when every entry is a real forward-running term and the terms are
// in order without overlapping — the same contract the recurring template has.
export function isValidSchedule(value: unknown): value is SemesterSchedule {
  if (!Array.isArray(value) || value.length === 0 || value.length > PAST_TERMS + WINDOW_TERMS) return false
  let prevEnd = ''
  for (const raw of value) {
    const term = raw as Partial<SemesterTerm>
    if (!Number.isInteger(term.year) || !SEMESTER_SEASONS.includes(term.season as SemesterSeason)) return false
    if (typeof term.start !== 'string' || typeof term.end !== 'string') return false
    if (!ISO_DATE_RE.test(term.start) || !ISO_DATE_RE.test(term.end)) return false
    if (monthDayNumber(monthDayFromDate(term.start)) === null || monthDayNumber(monthDayFromDate(term.end)) === null) return false
    if (term.start > term.end) return false
    if (prevEnd && term.start <= prevEnd) return false
    prevEnd = term.end
  }
  return true
}

// The recurring template implied by a schedule: each season's newest entry, as MM-DD. Saved
// alongside the list so years beyond the window (and every older code path) follow the same
// pattern the admin just set.
export function scheduleToDates(schedule: SemesterSchedule, fallback: SemesterDates = DEFAULT_SEMESTER_DATES): SemesterDates {
  const out = { ...fallback }
  for (const season of SEMESTER_SEASONS) {
    const newest = schedule.filter((t) => t.season === season).sort((a, b) => b.year - a.year)[0]
    if (newest) out[season] = { start: monthDayFromDate(newest.start), end: monthDayFromDate(newest.end) }
  }
  return out
}

export function dateForYear(year: number, monthDay: string): string {
  return `${year}-${monthDay}`
}

export function monthDayFromDate(date: string): string {
  return date.slice(5)
}

// Adds `days` (may be negative) to an ISO "YYYY-MM-DD" date, calendar-correct across
// month/year boundaries. Works entirely in UTC to avoid local-timezone drift.
export function addIsoDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

