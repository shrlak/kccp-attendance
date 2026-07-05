import { describe, it, expect } from 'vitest'
import { semesterKey, semesterBounds, semesterSundays, currentNewFamily, newFamilyByDate, monthlyRegistrations, registeredOnDate } from './newFamily'
import type { Member } from '../../lib/api'

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

describe('currentNewFamily', () => {
  const members = [
    m('cur', true, '2026-06-01'), // summer 2026 — in scope when today is summer
    m('old', true, '2026-02-01'), // spring 2026 — out of scope
    m('noreg', true, null), // no reg date — kept visible
    m('notNew', false, '2026-06-02'), // not flagged — excluded
  ]
  it('keeps current-semester new members and undated ones, drops the rest', () => {
    expect(currentNewFamily(members, '2026-06-08').map((x) => x.id).sort()).toEqual(['cur', 'noreg'])
  })
})

describe('newFamilyByDate', () => {
  it('splits current-semester new members by registration date, newest first, undated last', () => {
    const members = [
      m('b1', true, '2026-05-31'),
      m('a1', true, '2026-06-07'),
      m('a2', true, '2026-06-07'),
      m('none', true, null),
      m('old', true, '2026-02-01'), // spring — out of scope
      m('notNew', false, '2026-06-07'), // not flagged — excluded
    ]
    const groups = newFamilyByDate(members, '2026-06-08')
    expect(groups.map((g) => g.date)).toEqual(['2026-06-07', '2026-05-31', null])
    expect(groups[0].members.map((x) => x.id)).toEqual(['a1', 'a2'])
    expect(groups[1].members.map((x) => x.id)).toEqual(['b1'])
    expect(groups[2].members.map((x) => x.id)).toEqual(['none'])
  })
  it('returns no groups when nothing is in scope', () => {
    expect(newFamilyByDate([m('old', true, '2026-02-01')], '2026-06-08')).toEqual([])
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

describe('monthlyRegistrations', () => {
  it('groups every dated member by month, newest first', () => {
    const members = [m('a', false, '2026-06-07'), m('b', true, '2026-05-31'), m('c', false, '2026-06-01'), m('d', false, null)]
    const groups = monthlyRegistrations(members)
    expect(groups.map((g) => g.month)).toEqual(['2026-06', '2026-05'])
    expect(groups[0].members.map((x) => x.id)).toEqual(['a', 'c']) // within month, newest first
    expect(groups[1].members.map((x) => x.id)).toEqual(['b'])
  })
})
