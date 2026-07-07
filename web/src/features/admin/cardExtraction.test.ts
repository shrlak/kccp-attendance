import { describe, it, expect } from 'vitest'
import { normalizeCardDate, normalizePhone, normalizeExtractedCard } from './cardExtraction'
import { blankCardForm } from './newFamilyCard'

const TODAY = '2026-07-06'

describe('normalizeCardDate', () => {
  it('accepts ISO dates as-is', () => {
    expect(normalizeCardDate('2004-03-15', 'birth', 2026)).toBe('2004-03-15')
  })
  it("parses the card's MM/DD/YYYY order, with dots/spaces too", () => {
    expect(normalizeCardDate('03/15/2004', 'birth', 2026)).toBe('2004-03-15')
    expect(normalizeCardDate('03 / 15 / 2004', 'birth', 2026)).toBe('2004-03-15')
    expect(normalizeCardDate('03.15.2004', 'birth', 2026)).toBe('2004-03-15')
    expect(normalizeCardDate('3/5/2004', 'birth', 2026)).toBe('2004-03-05')
  })
  it('pivots 2-digit birth years: future 20xx → 19xx', () => {
    expect(normalizeCardDate('3/15/04', 'birth', 2026)).toBe('2004-03-15') // 2004 ≤ 2026
    expect(normalizeCardDate('3/15/98', 'birth', 2026)).toBe('1998-03-15') // 2098 > 2026
    expect(normalizeCardDate('3/15/26', 'birth', 2026)).toBe('2026-03-15') // boundary: not future
  })
  it('reads 2-digit registration years as 20xx', () => {
    expect(normalizeCardDate('7/6/26', 'registration', 2026)).toBe('2026-07-06')
    expect(normalizeCardDate('12/31/98', 'registration', 2026)).toBe('2098-12-31')
  })
  it('rejects garbage, wrong group counts, and impossible dates', () => {
    expect(normalizeCardDate('', 'birth')).toBe('')
    expect(normalizeCardDate(null, 'birth')).toBe('')
    expect(normalizeCardDate(42, 'birth')).toBe('')
    expect(normalizeCardDate('없음', 'birth')).toBe('')
    expect(normalizeCardDate('03/2004', 'birth')).toBe('')
    expect(normalizeCardDate('1/2/3/4', 'birth')).toBe('')
    expect(normalizeCardDate('13/01/2004', 'birth')).toBe('') // month 13
    expect(normalizeCardDate('02/30/2004', 'birth')).toBe('') // Feb 30
    expect(normalizeCardDate('03/15/1850', 'birth')).toBe('') // implausible year
    expect(normalizeCardDate('3/15/004', 'birth')).toBe('') // 3-digit year
  })
})

describe('normalizePhone', () => {
  it('formats 10-digit US numbers', () => {
    expect(normalizePhone('4125551234')).toBe('412-555-1234')
    expect(normalizePhone('(412) 555-1234')).toBe('412-555-1234')
  })
  it('formats 11-digit 010 Korean mobiles', () => {
    expect(normalizePhone('01012345678')).toBe('010-1234-5678')
    expect(normalizePhone('010 1234 5678')).toBe('010-1234-5678')
  })
  it('passes anything else through as written', () => {
    expect(normalizePhone('  +82 10 1234 5678 ')).toBe('+82 10 1234 5678')
    expect(normalizePhone('연락처 없음')).toBe('연락처 없음')
    expect(normalizePhone(null)).toBe('')
    expect(normalizePhone(12345)).toBe('')
  })
})

describe('normalizeExtractedCard', () => {
  it('normalizes a full well-formed extraction', () => {
    const card = normalizeExtractedCard(
      {
        name: ' 김철수 ',
        gender: '남',
        phone: '4125551234',
        kakaoId: 'chulsoo',
        birthDate: '03/15/2004',
        affiliationCategory: '대학생',
        affiliationDetail: 'Pitt 컴퓨터공학',
        baptismStatus: '세례',
        faithDuration: '1-3년',
        registrationDate: '2026-07-05',
        pastoralVisitRequested: true,
      },
      TODAY,
    )
    expect(card).toEqual({
      name: '김철수',
      gender: '남',
      phone: '412-555-1234',
      kakaoId: 'chulsoo',
      birthDate: '2004-03-15',
      affiliationCategory: '대학생',
      affiliationDetail: 'Pitt 컴퓨터공학',
      baptismStatus: '세례',
      faithDuration: '1-3년',
      registrationDate: '2026-07-05',
      pastoralVisitRequested: true,
    })
  })
  it('clamps out-of-vocabulary enums to blank', () => {
    const card = normalizeExtractedCard(
      { gender: 'M', affiliationCategory: '학생', baptismStatus: '세례받음', faithDuration: '오래' },
      TODAY,
    )
    expect(card.gender).toBe('')
    expect(card.affiliationCategory).toBe('')
    expect(card.baptismStatus).toBe('')
    expect(card.faithDuration).toBe('')
  })
  it('keeps valid enum values, trimming whitespace', () => {
    const card = normalizeExtractedCard(
      { gender: ' 여 ', affiliationCategory: 'Other', baptismStatus: '해당없음', faithDuration: '모태신앙' },
      TODAY,
    )
    expect(card.gender).toBe('여')
    expect(card.affiliationCategory).toBe('Other')
    expect(card.baptismStatus).toBe('해당없음')
    expect(card.faithDuration).toBe('모태신앙')
  })
  it('falls back to today for a missing/invalid 등록일 and false for null 심방', () => {
    const card = normalizeExtractedCard({ registrationDate: null, pastoralVisitRequested: null }, TODAY)
    expect(card.registrationDate).toBe(TODAY)
    expect(card.pastoralVisitRequested).toBe(false)
  })
  it('all-null payload ≙ blank card; non-object payloads too', () => {
    const nulls = Object.fromEntries(
      ['name', 'gender', 'phone', 'kakaoId', 'birthDate', 'affiliationCategory', 'affiliationDetail', 'baptismStatus', 'faithDuration', 'registrationDate', 'pastoralVisitRequested'].map((k) => [k, null]),
    )
    expect(normalizeExtractedCard(nulls, TODAY)).toEqual(blankCardForm(TODAY))
    expect(normalizeExtractedCard(null, TODAY)).toEqual(blankCardForm(TODAY))
    expect(normalizeExtractedCard('x', TODAY)).toEqual(blankCardForm(TODAY))
    expect(normalizeExtractedCard([1], TODAY)).toEqual(blankCardForm(TODAY))
  })
})
