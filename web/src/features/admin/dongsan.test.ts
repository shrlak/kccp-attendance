import { describe, it, expect } from 'vitest'
import {
  renameAt,
  addDongsan,
  removeAt,
  cleanNames,
  getDongsanRole,
  leaderEntry,
  summerDongsanList,
  membersInDongsan,
  withLeader,
  toggleSubLeader,
  isOfficer,
} from './dongsan'
import type { DongsanNames, DongsanLeaders, Member } from '../../lib/api'

const base: DongsanNames = {
  대학부: ['동산1', '동산2'],
  청년부: ['건영동산'],
}

describe('dongsan name-map helpers (immutable)', () => {
  it('renameAt replaces one entry without mutating the input', () => {
    const next = renameAt(base, '대학부', 1, '새동산')
    expect(next.대학부).toEqual(['동산1', '새동산'])
    expect(next.청년부).toBe(base.청년부) // untouched group keeps identity
    expect(base.대학부).toEqual(['동산1', '동산2']) // original unchanged
    expect(next).not.toBe(base)
    expect(next.대학부).not.toBe(base.대학부)
  })

  it('renameAt is a no-op for out-of-range / unknown', () => {
    expect(renameAt(base, '대학부', 9, 'x')).toBe(base)
    expect(renameAt(base, '대학부', -1, 'x')).toBe(base)
    expect(renameAt(base, '없는부서', 0, 'x')).toBe(base)
  })

  it('addDongsan appends an empty slot', () => {
    const next = addDongsan(base, '청년부')
    expect(next.청년부).toEqual(['건영동산', ''])
    expect(base.청년부).toEqual(['건영동산'])
  })

  it('addDongsan creates the group when absent', () => {
    const next = addDongsan(base, 'EM')
    expect(next.EM).toEqual([''])
  })

  it('removeAt drops one entry immutably', () => {
    const next = removeAt(base, '대학부', 0)
    expect(next.대학부).toEqual(['동산2'])
    expect(base.대학부).toEqual(['동산1', '동산2'])
  })

  it('removeAt is a no-op for out-of-range / unknown', () => {
    expect(removeAt(base, '대학부', 9)).toBe(base)
    expect(removeAt(base, '없는부서', 0)).toBe(base)
  })

  it('cleanNames trims and drops blanks', () => {
    const messy: DongsanNames = { 대학부: ['  동산1 ', '', '   ', '동산2'] }
    expect(cleanNames(messy)).toEqual({ 대학부: ['동산1', '동산2'] })
  })
})

const leaders: DongsanLeaders = {
  청년부: {
    건영동산: { leader: '최건영', subLeaders: ['권상운'] },
    호연동산: { leader: '', subLeaders: ['신주원'] },
  },
  대학부: {
    호연동산: { leader: '김호연', subLeaders: [] },
  },
  합동: {
    호연동산: { leader: '김호연', subLeaders: ['신주원'] },
  },
}

describe('getDongsanRole (display badge lookup)', () => {
  it('returns 동산지기 for the leader of their 동산', () => {
    expect(getDongsanRole('최건영', '청년부', '건영동산', leaders, false)).toBe('동산지기')
    expect(getDongsanRole('김호연', '대학부', '호연동산', leaders, false)).toBe('동산지기')
  })

  it('returns 부동산지기 for a sub-leader', () => {
    expect(getDongsanRole('권상운', '청년부', '건영동산', leaders, false)).toBe('부동산지기')
  })

  it('returns null for an ordinary member, missing 동산, or absent leaders', () => {
    expect(getDongsanRole('아무개', '청년부', '건영동산', leaders, false)).toBeNull()
    expect(getDongsanRole('최건영', '청년부', '없는동산', leaders, false)).toBeNull()
    expect(getDongsanRole('최건영', '', '건영동산', leaders, false)).toBeNull()
    expect(getDongsanRole('최건영', '청년부', '', leaders, false)).toBeNull()
    expect(getDongsanRole('최건영', '청년부', '건영동산', undefined, false)).toBeNull()
  })

  it('uses the 합동 key in summer mode when present', () => {
    expect(getDongsanRole('김호연', '대학부', '호연동산', leaders, true)).toBe('동산지기')
    expect(getDongsanRole('신주원', '청년부', '호연동산', leaders, true)).toBe('부동산지기')
    // present 합동 entry that doesn't match → null (does NOT fall through to group lookup)
    expect(getDongsanRole('최건영', '청년부', '호연동산', leaders, true)).toBeNull()
  })

  it('falls through to the per-group lookup in summer mode when no 합동 entry exists', () => {
    expect(getDongsanRole('최건영', '청년부', '건영동산', leaders, true)).toBe('동산지기')
  })
})

describe('isOfficer (임원 display badge)', () => {
  const officers = ['강혜윤', '조인서', '심영은']

  it('matches names in the config-managed officer list', () => {
    expect(isOfficer('강혜윤', officers)).toBe(true)
    expect(isOfficer('심영은', officers)).toBe(true)
    expect(isOfficer('김호연', officers)).toBe(false)
  })

  it('returns false for an empty name or an unloaded list', () => {
    expect(isOfficer('', officers)).toBe(false)
    expect(isOfficer('강혜윤', undefined)).toBe(false)
    expect(isOfficer('강혜윤', [])).toBe(false)
  })
})

describe('동산-leader editor helpers', () => {
  it('leaderEntry returns the stored entry or an empty default', () => {
    expect(leaderEntry(leaders, '청년부', '건영동산')).toEqual({ leader: '최건영', subLeaders: ['권상운'] })
    expect(leaderEntry(leaders, '청년부', '없는동산')).toEqual({ leader: '', subLeaders: [] })
    expect(leaderEntry(leaders, '없는부서', '건영동산')).toEqual({ leader: '', subLeaders: [] })
  })

  it('summerDongsanList de-dupes 동산 names across groups in order', () => {
    const names: DongsanNames = { 대학부: ['건영동산', '호연동산'], 청년부: ['건영동산', '윤서동산'] }
    expect(summerDongsanList(names)).toEqual(['건영동산', '호연동산', '윤서동산'])
  })

  it('withLeader / toggleSubLeader edit immutably', () => {
    const base = { leader: '최건영', subLeaders: ['권상운'] }
    const renamed = withLeader(base, '김대균')
    expect(renamed).toEqual({ leader: '김대균', subLeaders: ['권상운'] })
    expect(base.leader).toBe('최건영')

    const added = toggleSubLeader(base, '김꽃별')
    expect(added.subLeaders).toEqual(['권상운', '김꽃별'])
    const removed = toggleSubLeader(base, '권상운')
    expect(removed.subLeaders).toEqual([])
    expect(base.subLeaders).toEqual(['권상운'])
  })
})

describe('membersInDongsan', () => {
  const members = [
    { id: '1', name: '최건영', group_name: '청년부', subgroup: '건영동산' },
    { id: '2', name: '권상운', group_name: '청년부', subgroup: '건영동산' },
    { id: '3', name: '김서현(대학부)', group_name: '대학부', subgroup: '건영동산' },
    { id: '4', name: '최중호', group_name: '청년부', subgroup: '중호동산' },
  ] as Member[]

  it('filters to one 부서 + 동산, sorted', () => {
    expect(membersInDongsan(members, '청년부', '건영동산')).toEqual(['권상운', '최건영'])
  })

  it('group=null matches the 동산 across all 부서 (summer 합동)', () => {
    expect(membersInDongsan(members, null, '건영동산')).toEqual(['권상운', '김서현(대학부)', '최건영'])
  })

  it('returns [] for an empty 동산', () => {
    expect(membersInDongsan(members, '청년부', '윤서동산')).toEqual([])
  })
})
