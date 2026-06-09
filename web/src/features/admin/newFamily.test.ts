import { describe, it, expect } from 'vitest'
import { semesterKey, currentNewFamily, monthlyRegistrations } from './newFamily'
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

describe('monthlyRegistrations', () => {
  it('groups every dated member by month, newest first', () => {
    const members = [m('a', false, '2026-06-07'), m('b', true, '2026-05-31'), m('c', false, '2026-06-01'), m('d', false, null)]
    const groups = monthlyRegistrations(members)
    expect(groups.map((g) => g.month)).toEqual(['2026-06', '2026-05'])
    expect(groups[0].members.map((x) => x.id)).toEqual(['a', 'c']) // within month, newest first
    expect(groups[1].members.map((x) => x.id)).toEqual(['b'])
  })
})
