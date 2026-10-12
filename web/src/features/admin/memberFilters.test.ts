import { describe, it, expect, beforeEach } from 'vitest'
import type { Member } from '../../lib/api'
import { readFilterDims, writeFilterDims, toggleDim, availableFilterDims, DEFAULT_FILTER_DIMS } from './memberFilters'

const m = (id: string, extra: Partial<Member> = {}): Member => ({
  id, name: id, group_name: '대학부', subgroup: '', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: false, notes: '', ...extra,
})

beforeEach(() => localStorage.clear())

describe('memberFilters — 고른 필터 저장', () => {
  it('저장된 것이 없거나 읽을 수 없으면 예전 칩 줄(부서 · 동산 · 학생/직장 · 학교)이다', () => {
    expect(readFilterDims()).toEqual([...DEFAULT_FILTER_DIMS])
    localStorage.setItem('kccp-member-filters', '{oops')
    expect(readFilterDims()).toEqual([...DEFAULT_FILTER_DIMS])
  })

  it('모두 끈 선택도 그대로 남고, 모르는 값은 버린다', () => {
    writeFilterDims([])
    expect(readFilterDims()).toEqual([])
    localStorage.setItem('kccp-member-filters', JSON.stringify(['baptism', 'nope', 'group']))
    expect(readFilterDims()).toEqual(['group', 'baptism'])
  })

  it('켠 순서와 무관하게 칩 줄의 차례는 고정이다', () => {
    expect(toggleDim(['baptism'], 'group')).toEqual(['group', 'baptism'])
    expect(toggleDim(['group', 'baptism'], 'group')).toEqual(['baptism'])
  })
})

describe('memberFilters — 고를 수 있는 필터', () => {
  it('대학·청년부: 갈릴 것이 있는 축만', () => {
    const list = [
      m('a', { subgroup: '1동산', gender: '남', school_or_work: '대학생 · CMU' }),
      m('b', { subgroup: '2동산', gender: '여', school_or_work: '대학생 · Pitt' }),
      m('c', { group_name: '청년부', school_or_work: '대학원생 · CMU', baptism_status: '세례' }),
      m('d', { group_name: '청년부', school_or_work: '직장인 · 회사' }),
    ]
    expect(availableFilterDims(list)).toEqual(['group', 'subgroup', 'career', 'school', 'gender', 'affiliation', 'baptism'])
  })

  it('장년부: 부서도 학교도 하나뿐이라 빠지고, 묻지 않는 카드 칸도 빠진다', () => {
    const list = [
      m('a', { group_name: '장년부', subgroup: '1셀', baptism_status: '집사', gender: '여' }),
      m('b', { group_name: '장년부', subgroup: '2셀', baptism_status: '권사' }),
    ]
    expect(availableFilterDims(list)).toEqual(['subgroup', 'gender', 'baptism'])
  })
})
