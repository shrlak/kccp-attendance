import { describe, it, expect } from 'vitest'
import type { Member } from '../../lib/api'
import { sortBlockOf, sortChipsOf, sortBlocks, matchesSortValue, sortKeysFor, NO_VALUE, OTHER_VALUE } from './memberSort'

const m = (id: string, extra: Partial<Member> = {}): Member => ({
  id, name: id, group_name: '대학부', subgroup: '', member_role: '', gender: '', phone: '',
  birth_date: null, kakao_id: '', is_new_member: false, notes: '', ...extra,
})
const names = (blocks: { value: string; list: Member[] }[]) => blocks.map((b) => [b.value, b.list.map((x) => x.id).join(',')])

describe('memberSort — 성별', () => {
  it('남 → 여 → 기타 → 미기재, 영문 카드의 M/F도 남/여로 읽는다', () => {
    const list = [m('a', { gender: '여' }), m('b', { gender: '' }), m('c', { gender: 'M' }), m('d', { gender: '남' }), m('e', { gender: '?' })]
    expect(names(sortBlocks(list, 'gender'))).toEqual([
      ['남', 'c,d'],
      ['여', 'a'],
      [OTHER_VALUE, 'e'],
      [NO_VALUE, 'b'],
    ])
  })
})

describe('memberSort — 세례여부', () => {
  const list = [
    m('세례', { baptism_status: '세례' }),
    m('없음', { baptism_status: '해당없음' }),
    m('빈칸', { baptism_status: '' }),
    m('유아입교', { baptism_status: '유아세례, 입교' }),
    m('입교', { baptism_status: '입교' }),
    m('유아', { baptism_status: '유아세례' }),
    m('입교세례', { baptism_status: '입교, 세례' }),
  ]

  it('묶음은 적힌 조합 그대로, 카드에 인쇄된 보기 순서로 선다', () => {
    expect(sortBlocks(list, 'baptism').map((b) => b.value)).toEqual([
      '유아세례', '유아세례, 입교', '입교', '입교, 세례', '세례', '해당없음', NO_VALUE,
    ])
  })

  it("칩은 보기 하나하나이고, '입교'는 '유아세례, 입교'로 적힌 사람도 데려온다", () => {
    expect(sortChipsOf(list, 'baptism')).toEqual(['유아세례', '입교', '세례', '해당없음', NO_VALUE])
    expect(list.filter((x) => matchesSortValue(x, 'baptism', '입교')).map((x) => x.id)).toEqual(['유아입교', '입교', '입교세례'])
  })

  it('보기 밖의 말(장년부의 직분)은 보기 뒤에 많은 것부터 선다', () => {
    const adult = [m('a', { baptism_status: '권사' }), m('b', { baptism_status: '집사' }), m('c', { baptism_status: '집사' }), m('d', { baptism_status: '세례' })]
    expect(sortChipsOf(adult, 'baptism')).toEqual(['세례', '집사', '권사'])
    expect(sortBlocks(adult, 'baptism').map((b) => b.value)).toEqual(['세례', '집사', '권사'])
  })
})

describe('memberSort — 신앙생활 · 소속 · 머물 기간', () => {
  it('신앙생활은 짧은 쪽부터, 손으로 적은 "3년"은 그 칸을 찾고 읽을 수 없는 값은 기타다', () => {
    expect(sortBlockOf(m('a', { faith_duration: '3년' }), 'faith')).toBe('3-5년')
    expect(sortBlockOf(m('a', { faith_duration: '27' }), 'faith')).toBe(OTHER_VALUE)
    const list = [m('모태', { faith_duration: '모태신앙' }), m('새', { faith_duration: '1년 미만' }), m('오', { faith_duration: '5년 이상' })]
    expect(sortBlocks(list, 'faith').map((b) => b.value)).toEqual(['1년 미만', '5년 이상', '모태신앙'])
  })

  it("소속은 ' · ' 앞머리로 가르고, 앞머리 없이 학교만 적힌 칸은 기타다", () => {
    expect(sortBlockOf(m('a', { school_or_work: '대학원생 · CMU' }), 'affiliation')).toBe('대학원생')
    expect(sortBlockOf(m('a', { school_or_work: 'CMU CS' }), 'affiliation')).toBe(OTHER_VALUE)
    expect(sortBlockOf(m('a', { school_or_work: '' }), 'affiliation')).toBe(NO_VALUE)
  })

  it("머물 기간은 보기 그대로, 직접 적은 말은 '기타'다", () => {
    expect(sortBlockOf(m('a', { stay_duration: '2년' }), 'stay')).toBe('2년')
    expect(sortBlockOf(m('a', { stay_duration: '군대문제' }), 'stay')).toBe('기타')
  })
})

describe('memberSort — 고를 수 있는 정렬', () => {
  it('그 칸을 읽어낼 수 있는 사람이 없는 칸은 내걸지 않는다 (장년부의 신앙생활 · 머물 기간)', () => {
    const adult = [m('a', { group_name: '장년부', baptism_status: '집사', gender: '여', school_or_work: '회사' })]
    expect(sortKeysFor(adult)).toEqual(['gender', 'baptism'])
  })
})
