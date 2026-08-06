import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SEMESTER_DATES,
  WINDOW_TERMS,
  buildSchedule,
  calendarOf,
  currentOrNextTerm,
  isValidSchedule,
  nextSeason,
  rollSchedule,
  sameSchedule,
  scheduleToDates,
  termRange,
  upcomingTerms,
  type SemesterDates,
  type SemesterSchedule,
} from './semester'

// 운영 중인 학기 일정 (템플릿). 학기 사이에 실제 공백이 있다.
const dates: SemesterDates = {
  spring: { start: '01-01', end: '05-09' },
  summer: { start: '06-07', end: '08-02' },
  fall: { start: '09-06', end: '12-13' },
}

describe('calendarOf', () => {
  it('accepts a bare template, the pair, or nothing at all', () => {
    expect(calendarOf(dates)).toEqual({ dates, schedule: [] })
    expect(calendarOf({ dates, schedule: [] })).toEqual({ dates, schedule: [] })
    expect(calendarOf(null)).toEqual({ dates: DEFAULT_SEMESTER_DATES, schedule: [] })
  })
})

describe('termRange', () => {
  const schedule: SemesterSchedule = [
    { year: 2026, season: 'fall', start: '2026-09-06', end: '2026-12-20' }, // 손으로 늘린 학기
  ]
  it('takes the listed term when the schedule has that year, else the template', () => {
    const cal = calendarOf({ dates, schedule })
    expect(termRange(2026, 'fall', cal)).toEqual({ start: '2026-09-06', end: '2026-12-20' })
    // 목록에 없는 해는 매년 반복되는 템플릿을 그대로 쓴다.
    expect(termRange(2027, 'fall', cal)).toEqual({ start: '2027-09-06', end: '2027-12-13' })
    expect(termRange(2026, 'summer', cal)).toEqual({ start: '2026-06-07', end: '2026-08-02' })
  })
})

describe('nextSeason / currentOrNextTerm', () => {
  it('walks 봄 → 여름 → 가을 → 다음 해 봄', () => {
    expect(nextSeason(2026, 'spring')).toEqual({ year: 2026, season: 'summer' })
    expect(nextSeason(2026, 'summer')).toEqual({ year: 2026, season: 'fall' })
    expect(nextSeason(2026, 'fall')).toEqual({ year: 2027, season: 'spring' })
  })
  it('starts the window at the running term, or the next one during a gap', () => {
    const cal = calendarOf(dates)
    expect(currentOrNextTerm('2026-07-01', cal)).toEqual({ year: 2026, season: 'summer' }) // 진행 중
    expect(currentOrNextTerm('2026-08-05', cal)).toEqual({ year: 2026, season: 'fall' }) // 전환 기간 → 다음 학기
    expect(currentOrNextTerm('2026-12-20', cal)).toEqual({ year: 2027, season: 'spring' })
  })
})

describe('buildSchedule', () => {
  it('lays out two years of terms (6) starting from the current or next one', () => {
    const terms = buildSchedule('2026-08-05', calendarOf(dates))
    expect(terms.length).toBe(WINDOW_TERMS)
    expect(terms.map((t) => `${t.year}-${t.season}`)).toEqual([
      '2026-fall', '2027-spring', '2027-summer', '2027-fall', '2028-spring', '2028-summer',
    ])
    expect(terms[0]).toEqual({ year: 2026, season: 'fall', start: '2026-09-06', end: '2026-12-13' })
    expect(terms[5]).toEqual({ year: 2028, season: 'summer', start: '2028-06-07', end: '2028-08-02' })
  })
  it('keeps the dates already saved for a listed term', () => {
    const schedule: SemesterSchedule = [{ year: 2026, season: 'fall', start: '2026-09-13', end: '2026-12-20' }]
    const terms = buildSchedule('2026-08-05', calendarOf({ dates, schedule }))
    expect(terms[0]).toEqual({ year: 2026, season: 'fall', start: '2026-09-13', end: '2026-12-20' })
  })
  it('appends new terms following the newest same-season pattern, not the template', () => {
    const schedule: SemesterSchedule = [{ year: 2026, season: 'fall', start: '2026-09-13', end: '2026-12-20' }]
    const terms = buildSchedule('2026-08-05', calendarOf({ dates, schedule }))
    expect(terms.find((t) => t.year === 2027 && t.season === 'fall')).toEqual({
      year: 2027, season: 'fall', start: '2027-09-13', end: '2027-12-20',
    })
  })
})

describe('rollSchedule', () => {
  const seeded = rollSchedule('2026-08-05', calendarOf(dates))

  it('is idempotent on the same day', () => {
    expect(sameSchedule(rollSchedule('2026-08-05', calendarOf({ dates, schedule: seeded })), seeded)).toBe(true)
  })

  it('drops the finished term from the window, appends a new one, and keeps the old', () => {
    const after = rollSchedule('2026-12-14', calendarOf({ dates, schedule: seeded }))
    const window = upcomingTerms('2026-12-14', after)
    expect(window.length).toBe(WINDOW_TERMS)
    // 하나씩 앞으로 밀리고 …
    expect(`${window[0].year}-${window[0].season}`).toBe('2027-spring')
    // … 맨 뒤에 새 학기가 붙는다.
    expect(`${window[5].year}-${window[5].season}`).toBe('2028-fall')
    // 끝난 학기는 (편집 목록에서만 빠지고) 보관된다 — 지난 학기 출석부가 그 날짜를 쓴다.
    expect(after.some((t) => t.year === 2026 && t.season === 'fall')).toBe(true)
  })

  it('keeps rolling term after term, always two years ahead', () => {
    let schedule = seeded
    for (const day of ['2026-12-14', '2027-05-10', '2027-08-03', '2027-12-14']) {
      schedule = rollSchedule(day, calendarOf({ dates, schedule }))
      expect(upcomingTerms(day, schedule).length).toBe(WINDOW_TERMS)
    }
    expect(upcomingTerms('2027-12-14', schedule).map((t) => `${t.year}-${t.season}`)).toEqual([
      '2028-spring', '2028-summer', '2028-fall', '2029-spring', '2029-summer', '2029-fall',
    ])
    // 지난 학기들도 그대로 남아 있다.
    expect(schedule.filter((t) => t.end < '2027-12-14').length).toBeGreaterThanOrEqual(4)
  })
})

describe('isValidSchedule', () => {
  it('accepts a well-formed list', () => {
    expect(isValidSchedule(rollSchedule('2026-08-05', calendarOf(dates)))).toBe(true)
  })
  it('rejects an empty list, a backwards term, or overlapping terms', () => {
    expect(isValidSchedule([])).toBe(false)
    expect(isValidSchedule([{ year: 2026, season: 'fall', start: '2026-09-06', end: '2026-09-01' }])).toBe(false)
    expect(isValidSchedule([
      { year: 2026, season: 'fall', start: '2026-09-06', end: '2026-12-13' },
      { year: 2027, season: 'spring', start: '2026-12-01', end: '2027-05-09' },
    ])).toBe(false)
  })
  it('rejects malformed dates and seasons', () => {
    expect(isValidSchedule([{ year: 2026, season: 'winter', start: '2026-09-06', end: '2026-12-13' }])).toBe(false)
    expect(isValidSchedule([{ year: 2026, season: 'fall', start: '09-06', end: '2026-12-13' }])).toBe(false)
    expect(isValidSchedule([{ year: 2026, season: 'fall', start: '2026-13-40', end: '2026-12-13' }])).toBe(false)
  })
})

describe('scheduleToDates', () => {
  it('derives the recurring template from each season\'s newest entry', () => {
    const schedule: SemesterSchedule = [
      { year: 2026, season: 'fall', start: '2026-09-06', end: '2026-12-13' },
      { year: 2027, season: 'fall', start: '2027-09-13', end: '2027-12-20' },
      { year: 2027, season: 'summer', start: '2027-06-07', end: '2027-08-02' },
    ]
    expect(scheduleToDates(schedule, dates)).toEqual({
      spring: dates.spring, // 목록에 없는 학기는 원래 템플릿 유지
      summer: { start: '06-07', end: '08-02' },
      fall: { start: '09-13', end: '12-20' },
    })
  })
})
