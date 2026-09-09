import { describe, it, expect } from 'vitest'
import { groupsOf, subgroupsOf, schoolsOf, filterMembers, filterLog } from './filters'
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

// ── 학교로 좁히기 ─────────────────────────────────────────────────────────────────────
// 대학·청년부는 CMU와 Pitt이 섞여 있고, 그 값은 이미 '학교/직장 학과' 칸에 적혀 있다.
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
  it('명단에 실제로 있는 묶음만 CMU → Pitt → 학교 미기재 순으로', () => {
    expect(schoolsOf(schooled)).toEqual(['cmu', 'pitt', 'none'])
  })
  it('아무도 학교를 적지 않은 부(장년부)에서는 고를 것이 없다 — 칩 줄이 사라진다', () => {
    expect(schoolsOf([s('a', '장년부', ''), s('b', '장년부', '직장인 · 회사원')])).toEqual(['none'])
  })
})

describe('filterMembers — 학교', () => {
  it('학교로 좁힌다', () => {
    expect(filterMembers(schooled, { group: '', subgroup: '', school: 'cmu' }).map((x) => x.id)).toEqual(['c1', 'c2'])
    expect(filterMembers(schooled, { group: '', subgroup: '', school: 'pitt' }).map((x) => x.id)).toEqual(['p1', 'p2'])
  })
  it('학교를 읽어낼 수 없는 사람도 자기 묶음이 있다 — 세 칩을 더하면 전체가 된다', () => {
    expect(filterMembers(schooled, { group: '', subgroup: '', school: 'none' }).map((x) => x.id)).toEqual(['x1'])
  })
  it('부서와 곱해진다 (대학부 × CMU)', () => {
    expect(filterMembers(schooled, { group: '대학부', subgroup: '', school: 'cmu' }).map((x) => x.id)).toEqual(['c1'])
  })
})

describe('filterLog — 학교', () => {
  const withId = (memberId: string, name: string): LogEntry => ({ ...e('대학부', '', '2026-09-06'), memberId, name })
  const log: LogEntry[] = [
    withId('c1', '김씨엠'),
    withId('p1', '김핏'),
    { ...e('대학부', '', '2026-09-06'), name: 'p2' }, // memberId 없는 옛 줄 — 이름으로 되짚는다
    { ...e('대학부', '', '2026-09-06'), name: '손님' }, // 멤버가 아닌 줄
  ]
  it('출석 줄에는 학교가 없으므로 명단으로 되짚는다 — 열쇠는 memberId', () => {
    expect(filterLog(log, { group: '', subgroup: '', school: 'cmu' }, schooled).map((x) => x.name)).toEqual(['김씨엠'])
  })
  it('memberId가 없는 옛 줄만 이름으로 찾는다', () => {
    expect(filterLog(log, { group: '', subgroup: '', school: 'pitt' }, schooled).map((x) => x.name)).toEqual(['김핏', 'p2'])
  })
  it('학교 칩이 꺼져 있으면 명단을 보지 않는다 — 손님 줄도 그대로 남는다', () => {
    expect(filterLog(log, { group: '', subgroup: '' })).toHaveLength(4)
  })
})
