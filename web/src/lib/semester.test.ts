import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEMESTER_DATES,
  dateForYear,
  isValidSemesterDates,
  monthDayFromDate,
  type SemesterDates,
} from './semester'

describe('semester date configuration', () => {
  it('accepts the ordered default schedule and projects recurring dates into a year', () => {
    expect(isValidSemesterDates(DEFAULT_SEMESTER_DATES)).toBe(true)
    expect(dateForYear(2027, DEFAULT_SEMESTER_DATES.summer.start)).toBe('2027-05-10')
    expect(monthDayFromDate('2027-08-22')).toBe('08-22')
  })

  it('rejects invalid dates, backwards ranges, and overlapping terms', () => {
    expect(isValidSemesterDates({ ...DEFAULT_SEMESTER_DATES, spring: { start: '02-30', end: '05-09' } })).toBe(false)
    expect(isValidSemesterDates({ ...DEFAULT_SEMESTER_DATES, summer: { start: '08-01', end: '07-01' } })).toBe(false)
    const overlap: SemesterDates = {
      ...DEFAULT_SEMESTER_DATES,
      summer: { start: '05-01', end: '08-14' },
    }
    expect(isValidSemesterDates(overlap)).toBe(false)
  })
})
