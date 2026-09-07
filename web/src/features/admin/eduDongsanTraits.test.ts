import { describe, it, expect } from 'vitest'
import { genderOf, schoolOf, majorFieldOf, composition, birthYearOf, careerOf, faithStageOf } from './eduDongsanTraits'
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
      careers: [{ career: 'college', n: 2 }], // '대학생 · …' 앞머리
      faith: [],
      birthYears: null,
    })
  })
})

// 청년부의 기준 셋이 더 읽는 칸들.
describe('eduDongsanTraits — 나이 · 학생/직장 · 신앙기간', () => {
  it('나이는 태어난 해로 센다 — 잘못 적힌 값은 모름', () => {
    expect(birthYearOf({ birth_date: '1999-04-02' })).toBe(1999)
    expect(birthYearOf({ birth_date: null })).toBeNull()
    expect(birthYearOf({ birth_date: '1899-12-30' })).toBeNull() // 엑셀에서 옮겨 오다 생기는 값
  })

  it("학생인지 직장인인지는 ' · ' 앞머리가 말해 준다", () => {
    expect(careerOf({ school_or_work: '대학원생 · CMU Cybersecurity' })).toBe('grad')
    expect(careerOf({ school_or_work: '직장인 · 발레댄서' })).toBe('work')
    expect(careerOf({ school_or_work: '대학생 · CMU Math' })).toBe('college')
    // 'Other'는 카드의 '기타'라 학생인지 직장인인지를 말해 주지 않는다 — 모름.
    expect(careerOf({ school_or_work: 'Other · UX researcher' })).toBe('')
    expect(careerOf({ school_or_work: 'CMU/MSCV' })).toBe('')
    expect(careerOf({ school_or_work: '' })).toBe('')
  })

  it('신앙기간은 짧은 쪽부터 순서가 있다', () => {
    expect(faithStageOf({ faith_duration: '1년 미만' })).toBe(0)
    expect(faithStageOf({ faith_duration: '1-3년' })).toBe(1)
    expect(faithStageOf({ faith_duration: '3-5년' })).toBe(2)
    expect(faithStageOf({ faith_duration: '5년 이상' })).toBe(3)
    expect(faithStageOf({ faith_duration: '모태신앙' })).toBe(4)
  })

  it("손으로 적은 'N년'은 그 수로 칸을 찾아 주고, 뜻을 알 수 없는 값은 모름이다", () => {
    expect(faithStageOf({ faith_duration: '3년' })).toBe(2) // 3 이상 5 미만
    expect(faithStageOf({ faith_duration: '10년' })).toBe(3)
    expect(faithStageOf({ faith_duration: '27' })).toBe(-1) // 나이인지 연차인지 알 수 없다
    expect(faithStageOf({ faith_duration: 'No' })).toBe(-1)
    expect(faithStageOf({ faith_duration: '' })).toBe(-1)
  })
})
