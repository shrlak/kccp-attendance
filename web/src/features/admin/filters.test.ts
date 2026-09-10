import { describe, it, expect } from 'vitest'
import { groupsOf, groupChipsOf, matchesGroup, subgroupsOf, schoolsOf, matchesSchool, careersOf, matchesCareer, careerAxis, schoolAxis, filterMembers, filterLog, NO_GROUP } from './filters'
import type { Member, LogEntry } from '../../lib/api'

const m = (id: string, group: string, subgroup: string): Member => ({
  id, name: id, group_name: group, subgroup, member_role: '', gender: '', phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '',
})
const e = (group: string, subgroup: string, date: string): LogEntry => ({
  name: 'x', group, subgroup, date, time: '', ts: 0,
})

const members = [m('1', '청년부', '건영'), m('2', '대학부', '호연'), m('3', '청년부', '호연'), m('4', '', '')]

describe('groupsOf', () => {
  it('returns distinct groups in preferred department order', () => {
    expect(groupsOf(members)).toEqual(['대학부', '청년부'])
  })
})

// ── 부서 칩 (멤버 탭) ─────────────────────────────────────────────────────────────────
describe('groupChipsOf', () => {
  it('명단에 있는 부서를 순서대로, 부서 없는 사람이 있으면 자리표를 뒤에 붙인다', () => {
    expect(groupChipsOf(members)).toEqual(['대학부', '청년부', NO_GROUP])
  })
  it('모두 부서가 적혀 있으면 자리표는 없다', () => {
    expect(groupChipsOf([m('1', '대학부', ''), m('2', '청년부', '')])).toEqual(['대학부', '청년부'])
  })
  it('부서가 하나뿐인 부(장년부)에서는 고를 것이 없다 — 칩 줄이 사라진다', () => {
    expect(groupChipsOf([m('1', '장년부', ''), m('2', '장년부', '')])).toEqual(['장년부'])
  })
})

describe('matchesGroup', () => {
  it('부서로 가른다', () => {
    expect(members.filter((x) => matchesGroup(x, '청년부')).map((x) => x.id)).toEqual(['1', '3'])
  })
  it('부서가 비어 있는 사람도 자기 묶음이 있다 — 칩을 다 더하면 전체가 된다', () => {
    expect(members.filter((x) => matchesGroup(x, NO_GROUP)).map((x) => x.id)).toEqual(['4'])
  })
  it('빈 값은 전체다', () => {
    expect(members.every((x) => matchesGroup(x, ''))).toBe(true)
  })
})

describe('subgroupsOf', () => {
  it('lists 동산 within a group, sorted', () => {
    expect(subgroupsOf(members, '청년부')).toEqual(['건영', '호연'])
  })
  it('lists 동산 across all groups when group is empty', () => {
    expect(subgroupsOf(members, '')).toEqual(['건영', '호연'])
  })
})

describe('filterMembers', () => {
  it('filters by group then 동산', () => {
    expect(filterMembers(members, { group: '청년부', subgroup: '' }).map((x) => x.id)).toEqual(['1', '3'])
    expect(filterMembers(members, { group: '청년부', subgroup: '호연' }).map((x) => x.id)).toEqual(['3'])
  })
  it('no filter returns all', () => {
    expect(filterMembers(members, { group: '', subgroup: '' })).toHaveLength(4)
  })
})

describe('filterLog', () => {
  const log = [e('청년부', '호연', '2026-06-07'), e('대학부', '호연', '2026-06-07'), e('청년부', '건영', '2026-06-07')]
  it('filters entries by group + 동산', () => {
    expect(filterLog(log, { group: '청년부', subgroup: '' })).toHaveLength(2)
    expect(filterLog(log, { group: '청년부', subgroup: '호연' })).toHaveLength(1)
  })
})

// ── 학교 (멤버 탭) ────────────────────────────────────────────────────────────────────
// 학교는 부서·동산 필터에 들어가지 않는다 — 명단을 학교로 갈라 보는 자리는 멤버 탭 하나다.
const s = (id: string, group: string, schoolOrWork: string): Member => ({
  ...m(id, group, ''),
  school_or_work: schoolOrWork,
})
const schooled = [
  s('c1', '대학부', '대학생 · CMU Math'),
  s('c2', '청년부', '대학원생 · 씨엠유 기계공학'),
  s('p1', '대학부', '대학생 · UPitt nursing'),
  s('p2', '대학부', '핏대 심리학'),
  s('x1', '청년부', 'ballet'),
]

describe('schoolsOf', () => {
  it('명단에 실제로 있는 묶음만 CMU → Pitt → Duquesne → 기타 순으로', () => {
    expect(schoolsOf(schooled)).toEqual(['cmu', 'pitt', 'none'])
    expect(schoolsOf([...schooled, s('d1', '대학부', '대학생 · Duquesne nursing')])).toEqual([
      'cmu', 'pitt', 'duq', 'none',
    ])
  })
  it('아무도 학교를 적지 않은 부(장년부)에서는 고를 것이 없다 — 칩 줄이 사라진다', () => {
    expect(schoolsOf([s('a', '장년부', ''), s('b', '장년부', '직장인 · 회사원')])).toEqual(['none'])
  })
})

// 처지 — 청년부의 축이다.
describe('careersOf · matchesCareer', () => {
  const young = [
    s('g1', '청년부', '대학원생 · CMU 기계공학'),
    s('w1', '청년부', '직장인 · 발레댄서'),
    s('o1', '청년부', ''),
  ]
  it('대학원생 → 직장인 → 기타 순으로, 명단에 있는 것만', () => {
    expect(careersOf(young)).toEqual(['grad', 'work', 'other'])
    expect(careersOf([young[0], young[1]])).toEqual(['grad', 'work'])
  })
  it('대학원생도 직장인도 아닌 사람은 기타로 모인다 — 칩을 다 더하면 전체가 된다', () => {
    expect(young.filter((x) => matchesCareer(x, 'other')).map((x) => x.id)).toEqual(['o1'])
    expect(young.every((x) => matchesCareer(x, ''))).toBe(true)
  })
})

describe('careerAxis · schoolAxis — 부서마다 다른 축', () => {
  it('대학부는 학교로 바로 간다', () => {
    expect(careerAxis('대학부')).toBe(false)
    expect(schoolAxis('대학부', '')).toBe(true)
  })
  it('청년부는 처지와 학교 두 줄을 함께 내건다 — 직장인일 때만 학교가 내려간다', () => {
    expect(careerAxis('청년부')).toBe(true)
    // 청년부를 고르는 순간 학교 줄이 사라지면 "이 부서는 학교로 못 가른다"로 읽힌다.
    expect(schoolAxis('청년부', '')).toBe(true)
    expect(schoolAxis('청년부', 'grad')).toBe(true)
    expect(schoolAxis('청년부', 'other')).toBe(true)
    // 직장인에게 학교는 지금 어디에 있는지를 말해 주지 않는다.
    expect(schoolAxis('청년부', 'work')).toBe(false)
  })
})

describe('matchesSchool', () => {
  it('학교로 가른다 — 한글로 적힌 이름도 같이', () => {
    expect(schooled.filter((x) => matchesSchool(x, 'cmu')).map((x) => x.id)).toEqual(['c1', 'c2'])
    expect(schooled.filter((x) => matchesSchool(x, 'pitt')).map((x) => x.id)).toEqual(['p1', 'p2'])
  })
  it('학교를 읽어낼 수 없는 사람도 자기 묶음이 있다 — 세 칩을 더하면 전체가 된다', () => {
    expect(schooled.filter((x) => matchesSchool(x, 'none')).map((x) => x.id)).toEqual(['x1'])
  })
  it('빈 값은 전체다', () => {
    expect(schooled.every((x) => matchesSchool(x, ''))).toBe(true)
  })
})
