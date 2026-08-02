import { describe, it, expect } from 'vitest'
import {
  semesterKey,
  semesterBounds,
  semesterSundays,
  transitionBounds,
  transitionSundays,
  visibleNewFamily,
  groupByDate,
  newFamilyBySemester,
  monthlyRegistrations,
  registeredOnDate,
  isActiveNewFamily,
  matchesEduFilter,
  worshipSunday,
  newFamilyWeek,
} from './newFamily'
import type { Member } from '../../lib/api'
import type { SemesterDates } from '../../lib/semester'

const m = (id: string, isNew: boolean, reg: string | null): Member => ({
  id, name: id, group_name: '', subgroup: '', member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: isNew, notes: '', registration_date: reg,
})

describe('semesterKey', () => {
  it('maps dates to spring / summer / fall by the legacy bounds', () => {
    expect(semesterKey('2026-01-01')).toBe('2026-spring')
    expect(semesterKey('2026-05-09')).toBe('2026-spring')
    expect(semesterKey('2026-05-10')).toBe('2026-summer')
    expect(semesterKey('2026-08-14')).toBe('2026-summer')
    expect(semesterKey('2026-08-15')).toBe('2026-fall')
    expect(semesterKey('2026-12-31')).toBe('2026-fall')
  })
})

describe('semesterBounds', () => {
  it('returns the term + inclusive start/end for the date', () => {
    expect(semesterBounds('2026-03-01')).toEqual({ year: 2026, season: 'spring', start: '2026-01-01', end: '2026-05-09' })
    expect(semesterBounds('2026-06-07')).toEqual({ year: 2026, season: 'summer', start: '2026-05-10', end: '2026-08-14' })
    expect(semesterBounds('2026-09-01')).toEqual({ year: 2026, season: 'fall', start: '2026-08-15', end: '2026-12-31' })
  })
  it('uses a saved recurring schedule for the requested year', () => {
    const custom: SemesterDates = {
      spring: { start: '01-12', end: '05-02' },
      summer: { start: '05-24', end: '08-02' },
      fall: { start: '08-23', end: '12-13' },
    }
    expect(semesterBounds('2027-06-01', custom)).toEqual({
      year: 2027,
      season: 'summer',
      start: '2027-05-24',
      end: '2027-08-02',
    })
  })
})

describe('semesterSundays', () => {
  it('lists the semester Sundays from the start through today (inclusive)', () => {
    expect(semesterSundays('2026-06-07')).toEqual(['2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31', '2026-06-07'])
  })
  it('excludes future Sundays', () => {
    expect(semesterSundays('2026-05-31')).toEqual(['2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31'])
  })
  it('stops at the last Sunday on/before a mid-week today', () => {
    expect(semesterSundays('2026-06-03')).toEqual(['2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31'])
  })
  it('starts at the first Sunday on/after the semester start (spring 2026 → Jan 4)', () => {
    expect(semesterSundays('2026-01-10')).toEqual(['2026-01-04'])
  })
})

describe('transitionBounds', () => {
  const custom: SemesterDates = {
    spring: { start: '01-12', end: '04-30' },
    summer: { start: '06-01', end: '07-31' },
    fall: { start: '09-01', end: '12-15' },
  }
  it('is null inside a configured term', () => {
    expect(transitionBounds('2026-03-01', custom)).toBeNull()
    expect(transitionBounds('2026-06-15', custom)).toBeNull()
    expect(transitionBounds('2026-10-01', custom)).toBeNull()
  })
  it('is null under the default back-to-back semester dates (no admin-configured gap yet)', () => {
    expect(transitionBounds('2026-05-09')).toBeNull()
    expect(transitionBounds('2026-05-10')).toBeNull()
    expect(transitionBounds('2027-01-01')).toBeNull()
  })
  it('covers the spring -> summer gap', () => {
    expect(transitionBounds('2026-05-15', custom)).toEqual({ start: '2026-05-01', end: '2026-05-31' })
  })
  it('covers the summer -> fall gap', () => {
    expect(transitionBounds('2026-08-15', custom)).toEqual({ start: '2026-08-01', end: '2026-08-31' })
  })
  it('covers the fall -> next spring wraparound gap, on both sides of the new year', () => {
    expect(transitionBounds('2026-12-25', custom)).toEqual({ start: '2026-12-16', end: '2027-01-11' })
    expect(transitionBounds('2027-01-05', custom)).toEqual({ start: '2026-12-16', end: '2027-01-11' })
  })
})

describe('transitionSundays', () => {
  it('lists Sundays within the gap through `through`, clamped to the gap end', () => {
    const bounds = { start: '2026-05-01', end: '2026-05-31' }
    expect(transitionSundays(bounds, '2026-05-20')).toEqual(['2026-05-03', '2026-05-10', '2026-05-17'])
    expect(transitionSundays(bounds, '2026-06-30')).toEqual(['2026-05-03', '2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31'])
  })
})

// Education state on top of the base member factory — an earlier term's 새가족 only stays
// listed while both weeks aren't done.
const edu = (base: Member, week1: boolean, week2: boolean): Member => ({
  ...base, new_member_edu_week1: week1, new_member_edu_week2: week2,
})

describe('visibleNewFamily', () => {
  const members = [
    m('cur', true, '2026-06-01'), // summer 2026 — this term
    m('noreg', true, null), // no reg date — kept visible
    m('notNew', false, '2026-06-02'), // not flagged — excluded
    edu(m('oldUnfinished', true, '2026-02-01'), true, false), // spring, 1주차만 — carried over
    edu(m('oldDone', true, '2026-02-02'), true, true), // spring, 교육 완료 — dropped
    m('oldNoEdu', true, '2026-02-03'), // spring, 아무것도 안 들음 — carried over
  ]
  it('keeps this term, undated members, and earlier terms still short of both education weeks', () => {
    expect(visibleNewFamily(members, '2026-06-08').map((x) => x.id).sort())
      .toEqual(['cur', 'noreg', 'oldNoEdu', 'oldUnfinished'])
  })
  it('drops an earlier term member once the 새가족 표시 comes off, education or not', () => {
    const dropped = { ...edu(m('gone', true, '2026-02-01'), false, false), is_new_member: false }
    expect(visibleNewFamily([dropped], '2026-06-08')).toEqual([])
  })
  it('keeps this term regardless of education progress', () => {
    const done = edu(m('curDone', true, '2026-06-01'), true, true)
    expect(visibleNewFamily([done], '2026-06-08').map((x) => x.id)).toEqual(['curDone'])
  })
  it('uses both configured start and end dates for the current-term window', () => {
    const custom: SemesterDates = {
      spring: { start: '01-01', end: '04-30' },
      summer: { start: '06-01', end: '07-31' },
      fall: { start: '09-01', end: '12-31' },
    }
    const candidates = [
      edu(m('before', true, '2026-05-31'), true, true),
      m('inside', true, '2026-06-01'),
      edu(m('after', true, '2026-08-01'), true, true),
    ]
    expect(visibleNewFamily(candidates, '2026-07-01', custom).map((x) => x.id)).toEqual(['inside'])
  })
})

describe('groupByDate', () => {
  it('splits an ordered list into runs of the same 등록일, undated trailing', () => {
    const list = [m('a1', true, '2026-06-07'), m('a2', true, '2026-06-07'), m('b1', true, '2026-05-31'), m('none', true, null)]
    const groups = groupByDate(list)
    expect(groups.map((g) => g.date)).toEqual(['2026-06-07', '2026-05-31', null])
    expect(groups[0].members.map((x) => x.id)).toEqual(['a1', 'a2'])
    expect(groups[2].members.map((x) => x.id)).toEqual(['none'])
  })
  it('returns no groups for an empty list', () => {
    expect(groupByDate([])).toEqual([])
  })
})

describe('newFamilyBySemester', () => {
  it('separates carried-over terms from the current one, current first then newest term', () => {
    const members = [
      m('b1', true, '2026-05-31'), // summer 2026 (current)
      m('a1', true, '2026-06-07'),
      m('a2', true, '2026-06-07'),
      m('none', true, null), // undated — sits in the current term
      edu(m('spring', true, '2026-02-01'), false, true), // spring 2026 — carried over
      edu(m('lastFall', true, '2025-09-01'), true, false), // fall 2025 — carried over
      edu(m('springDone', true, '2026-02-02'), true, true), // 교육 완료 — gone
      m('notNew', false, '2026-06-07'),
    ]
    const groups = newFamilyBySemester(members, '2026-06-08')

    expect(groups.map((g) => g.key)).toEqual(['2026-summer', '2026-spring', '2025-fall'])
    expect(groups.map((g) => g.current)).toEqual([true, false, false])
    expect(groups[0].total).toBe(4)
    expect(groups[0].dates.map((g) => g.date)).toEqual(['2026-06-07', '2026-05-31', null])
    expect(groups[0].dates[0].members.map((x) => x.id)).toEqual(['a1', 'a2'])
    expect(groups[1].dates[0].members.map((x) => x.id)).toEqual(['spring'])
    expect(groups[2].dates[0].members.map((x) => x.id)).toEqual(['lastFall'])
  })
  it('keeps the current term first even when a registration date lands in a later one', () => {
    const groups = newFamilyBySemester(
      [m('typo', true, '2026-11-30'), m('now', true, '2026-06-01')],
      '2026-06-08',
    )
    expect(groups.map((g) => g.key)).toEqual(['2026-summer', '2026-fall'])
  })
  it('returns no groups when nobody is in scope', () => {
    expect(newFamilyBySemester([edu(m('done', true, '2026-02-01'), true, true)], '2026-06-08')).toEqual([])
  })
})

describe('registeredOnDate (등록 카드 export set)', () => {
  const members = [
    m('b-today', true, '2026-07-05'),
    m('a-today', true, '2026-07-05'),
    m('yesterday', true, '2026-07-04'),
    m('undated', true, null),
    m('not-new', false, '2026-07-05'), // registered today but not flagged 새가족
  ]
  it('keeps only 새가족 registered exactly on the export date, name-ordered', () => {
    expect(registeredOnDate(members, '2026-07-05').map((x) => x.id)).toEqual(['a-today', 'b-today'])
  })
  it('returns empty when nobody registered that day', () => {
    expect(registeredOnDate(members, '2026-07-06')).toEqual([])
  })
})

describe('isActiveNewFamily', () => {
  it('is false for a non-새가족', () => {
    expect(isActiveNewFamily({ is_new_member: false, new_member_edu_week1: false, new_member_edu_week2: false })).toBe(false)
  })
  it('is true for a 새가족 who has not finished both education weeks', () => {
    expect(isActiveNewFamily({ is_new_member: true, new_member_edu_week1: false, new_member_edu_week2: false })).toBe(true)
    expect(isActiveNewFamily({ is_new_member: true, new_member_edu_week1: true, new_member_edu_week2: false })).toBe(true)
    expect(isActiveNewFamily({ is_new_member: true, new_member_edu_week1: undefined, new_member_edu_week2: undefined })).toBe(true)
  })
  it('is false once both weeks are done, even though is_new_member stays true', () => {
    expect(isActiveNewFamily({ is_new_member: true, new_member_edu_week1: true, new_member_edu_week2: true })).toBe(false)
  })
})

describe('matchesEduFilter', () => {
  const both = { new_member_edu_week1: true, new_member_edu_week2: true }
  const week1 = { new_member_edu_week1: true, new_member_edu_week2: false }
  const week2 = { new_member_edu_week1: false, new_member_edu_week2: true }
  const none = { new_member_edu_week1: false, new_member_edu_week2: false }

  it("'all' matches everyone", () => {
    for (const c of [both, week1, week2, none]) expect(matchesEduFilter(c, 'all')).toBe(true)
  })
  it('the 4 filters partition the 2x2 truth table exactly (no overlap, full coverage)', () => {
    expect(matchesEduFilter(week1, 'week1')).toBe(true)
    expect(matchesEduFilter(week2, 'week1')).toBe(false)
    expect(matchesEduFilter(both, 'week1')).toBe(false)
    expect(matchesEduFilter(none, 'week1')).toBe(false)

    expect(matchesEduFilter(week2, 'week2')).toBe(true)
    expect(matchesEduFilter(week1, 'week2')).toBe(false)
    expect(matchesEduFilter(both, 'week2')).toBe(false)

    expect(matchesEduFilter(both, 'both')).toBe(true)
    expect(matchesEduFilter(week1, 'both')).toBe(false)
    expect(matchesEduFilter(week2, 'both')).toBe(false)

    expect(matchesEduFilter(none, 'none')).toBe(true)
    expect(matchesEduFilter(week1, 'none')).toBe(false)
    expect(matchesEduFilter(both, 'none')).toBe(false)
  })
})

describe('monthlyRegistrations', () => {
  it('groups every dated member by month, newest first', () => {
    const members = [m('a', false, '2026-06-07'), m('b', true, '2026-05-31'), m('c', false, '2026-06-01'), m('d', false, null)]
    const groups = monthlyRegistrations(members)
    expect(groups.map((g) => g.month)).toEqual(['2026-06', '2026-05'])
    expect(groups[0].members.map((x) => x.id)).toEqual(['a', 'c']) // within month, newest first
    expect(groups[1].members.map((x) => x.id)).toEqual(['b'])
  })
})

describe('worshipSunday', () => {
  it('is the date itself on a Sunday', () => {
    expect(worshipSunday('2026-07-26')).toBe('2026-07-26')
  })
  it('is the most recent Sunday on any other day', () => {
    expect(worshipSunday('2026-07-27')).toBe('2026-07-26') // Monday
    expect(worshipSunday('2026-07-31')).toBe('2026-07-26') // Friday
    expect(worshipSunday('2026-08-01')).toBe('2026-07-26') // Saturday
  })
  it('walks back across a month boundary', () => {
    expect(worshipSunday('2026-08-03')).toBe('2026-08-02')
    expect(worshipSunday('2026-03-02')).toBe('2026-03-01')
  })
})

describe('newFamilyWeek', () => {
  const today = '2026-07-26' // a Sunday
  it('places registrations on the current 주일 in thisWeek', () => {
    expect(newFamilyWeek('2026-07-26', today)).toBe('thisWeek')
  })
  it('places the previous 주일 and its week in lastWeek', () => {
    expect(newFamilyWeek('2026-07-19', today)).toBe('lastWeek')
    expect(newFamilyWeek('2026-07-22', today)).toBe('lastWeek') // mid-week counts with its 주일
    expect(newFamilyWeek('2026-07-25', today)).toBe('lastWeek')
  })
  it('places anything older in earlier', () => {
    expect(newFamilyWeek('2026-07-18', today)).toBe('earlier')
    expect(newFamilyWeek('2026-05-31', today)).toBe('earlier')
  })
  it('keeps the same buckets mid-week (this 주일 = the Sunday just past)', () => {
    expect(newFamilyWeek('2026-07-26', '2026-07-29')).toBe('thisWeek')
    expect(newFamilyWeek('2026-07-19', '2026-07-29')).toBe('lastWeek')
  })
  it('is null without a registration date', () => {
    expect(newFamilyWeek(null, today)).toBeNull()
    expect(newFamilyWeek(undefined, today)).toBeNull()
    expect(newFamilyWeek('', today)).toBeNull()
  })
})
