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

