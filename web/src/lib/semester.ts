export const SEMESTER_SEASONS = ['spring', 'summer', 'fall'] as const

export type SemesterSeason = (typeof SEMESTER_SEASONS)[number]

// Month/day values repeat each calendar year. Keeping the year out of persisted config
// means an administrator can update the church's annual term boundaries without the app
// becoming tied to one specific year.
export interface SemesterDateRange {
  start: string // MM-DD, inclusive
  end: string // MM-DD, inclusive
}

export type SemesterDates = Record<SemesterSeason, SemesterDateRange>

// Legacy boundaries used until a super-admin saves a custom schedule.
export const DEFAULT_SEMESTER_DATES: SemesterDates = {
  spring: { start: '01-01', end: '05-09' },
  summer: { start: '05-10', end: '08-14' },
  fall: { start: '08-15', end: '12-31' },
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
// may have breaks between them but may never overlap or appear out of order.
export function isValidSemesterDates(value: unknown): value is SemesterDates {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ranges = value as Partial<Record<SemesterSeason, Partial<SemesterDateRange>>>
  const nums = SEMESTER_SEASONS.map((season) => {
    const range = ranges[season]
    const start = typeof range?.start === 'string' ? monthDayNumber(range.start) : null
    const end = typeof range?.end === 'string' ? monthDayNumber(range.end) : null
    return start !== null && end !== null ? { start, end } : null
  })
  if (nums.some((range) => range === null)) return false
  const [spring, summer, fall] = nums as { start: number; end: number }[]
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

