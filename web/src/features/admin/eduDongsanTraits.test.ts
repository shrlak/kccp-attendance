import { describe, it, expect } from 'vitest'
import { genderOf, schoolOf, majorFieldOf, composition } from './eduDongsanTraits'
import type { Member } from '../../lib/api'

const at = (school_or_work: string) => ({ school_or_work })

// 아래 문자열들은 운영 명단의 '학교/직장 학과' 칸에 **실제로** 들어 있는 모양들이다 (사람
// 이름은 없다). 이 칸은 종이 카드를 손으로 옮겨 적는 자유 기입란이라, 파서가 형식을 기대하면
// 대부분을 못 읽는다.
describe('eduDongsanTraits — 학교 읽기', () => {
  it('CMU는 여러 이름으로 적힌다', () => {
    for (const v of ['대학생 · CMU Math', 'CMU - stat ml', '대학생 · Carnegie Mellon (International Relations)', '대학생 · Architecture CMU', '대학생 · 카네기멜론'])
      expect(schoolOf(at(v))).toBe('cmu')
  })

  it('Pitt도 마찬가지다', () => {
    for (const v of ['Pitt - Pre Pharm', '대학생 · UPitt nursing', '대학생 · University of Pittsburgh - Bio (Pre-Med)', '대학생 · university of Pitt', '대학생 · 피츠버그 대학교 화학공학과'])
      expect(schoolOf(at(v))).toBe('pitt')
  })

  it('학교가 없으면 모름 — 배정에서 빠지는 것이 아니라 균형 계산에서만 빠진다', () => {
    expect(schoolOf(at(''))).toBe('')
    expect(schoolOf(at('ballet'))).toBe('')
    expect(schoolOf(at('대학생 · sociology'))).toBe('')
  })

  it('두 학교가 같이 적히면 먼저 나오는 쪽 — 자기 학교를 앞에 적는다', () => {
    expect(schoolOf(at('서울대/CMU 비지팅'))).toBe('cmu')
    expect(schoolOf(at('Pitt에서 CMU 수업'))).toBe('pitt')
  })
})

describe('eduDongsanTraits — 전공 계열 읽기', () => {
  const cases: [string, string][] = [
    ['대학생 · Pitt Bio (Pre-Dental)', 'health'],
    ['Pitt - biological science (premed)', 'health'],
    ['대학생 · Pitt Pre-Pharm', 'health'],
    ['대학생 · UPitt nursing', 'health'],
    ['대학생 · UPitt -neuroscience', 'health'],
    ['대학생 · Public Health UPitt', 'health'],
    ['대학생 · University of pittsburgh pre-physical therapy', 'health'],
    ['CMU - stat ml', 'math'],
    ['대학생 · CMU Math + AI', 'math'],
    ['대학생 · Carnegie Mellon Statistics and Machine Learning', 'math'],
    ['CMU - Tepper', 'business'],
    ['대학생 · CMU - Design', 'arts'],
    ['대학생 · CMU Music', 'arts'],
    ['ballet', 'arts'],
    ['대학생 · Architecture CMU', 'arts'],
    ['대학생 · Pitt - Psychology', 'social'],
    ['Other · Pitt - social work', 'social'],
    ['대학생 · sociology', 'social'],
    ['대학생 · CMU MCS CHEM', 'science'],
    ['대학생 · UNIVERSITY OF PITTSBURGH CIVIL ENGINEERING', 'engineering'],
    ['대학생 · CMU 기계공학', 'engineering'],
  ]
  it.each(cases)('%s → %s', (text, field) => {
    expect(majorFieldOf(at(text))).toBe(field)
  })

  it('화학공학은 화학이 아니라 공학이다 — 좁은 규칙이 먼저 걸려야 한다', () => {
    expect(majorFieldOf(at('대학생 · 피츠버그 대학교 화학공학과'))).toBe('engineering')
    expect(majorFieldOf(at('chemical engineering'))).toBe('engineering')
    expect(majorFieldOf(at('CMU chemistry'))).toBe('science')
  })

  it("'biological science'는 과학이 아니라 생명·의료다", () => {
    expect(majorFieldOf(at('Pittsburgh biological science (pre-pharm)'))).toBe('health')
  })

  it('못 읽으면 빈 값 — 그 사람은 전공 기준에서만 빠진다', () => {
    expect(majorFieldOf(at(''))).toBe('')
    expect(majorFieldOf(at('대학생 · Carnegie mellon 한국에서 왔음'))).toBe('')
  })
})

describe('eduDongsanTraits — 성별', () => {
  it('한글도 영문 카드의 M/F도 읽는다', () => {
    expect(genderOf({ gender: '남' })).toBe('남')
    expect(genderOf({ gender: '여' })).toBe('여')
    expect(genderOf({ gender: 'M' })).toBe('남')
    expect(genderOf({ gender: 'Female' })).toBe('여')
    expect(genderOf({ gender: '' })).toBe('')
  })
})

describe('eduDongsanTraits — 조의 구성', () => {
  it('적혀 있는 것만 센다 (빈칸은 어느 쪽으로도 세지 않는다)', () => {
    const people = [
      { gender: '남', school_or_work: '대학생 · CMU Math' },
      { gender: '여', school_or_work: '대학생 · Pitt Bio (Pre-Med)' },
      { gender: '', school_or_work: '' },
    ] as Member[]
    expect(composition(people)).toEqual({
      male: 1,
      female: 1,
      cmu: 1,
      pitt: 1,
      fields: [
        { field: 'health', n: 1 },
        { field: 'math', n: 1 },
      ],
    })
  })
})
