import { describe, it, expect } from 'vitest'
import { isSpouseRelation, normalizeGender, spouseName, spousePayload, spouseRows } from './adultSpouse'
import { blankAdultCard, blankFamilyMember, type AdultFamilyMember } from './adultCard'

const row = (extra: Partial<AdultFamilyMember> = {}): AdultFamilyMember => ({
  ...blankFamilyMember(),
  ...extra,
})

describe('관계 칸이 배우자를 가리키는가', () => {
  it('한글로 적힌 배우자를 읽는다', () => {
    for (const r of ['배우자', '남편', '아내', '부인', '와이프', '처', '배우자(妻)'])
      expect(isSpouseRelation(r)).toBe(true)
  })

  it('영어로 적힌 배우자를 대소문자와 무관하게 읽는다', () => {
    for (const r of ['HUSBAND', 'Wife', 'spouse', ' Husband '])
      expect(isSpouseRelation(r)).toBe(true)
  })

  it('자녀·인척은 배우자가 아니다', () => {
    // '처남'·'처제'는 '처'를 품고 있지만 배우자가 아니다 — 여기서 갈리지 않으면
    // 있지도 않은 부부가 명단에 생긴다.
    for (const r of ['자녀', '아들', '딸', '본인', '모', '처남', '처제', '처형', 'son', ''])
      expect(isSpouseRelation(r)).toBe(false)
  })
})

describe('배우자 줄 고르기', () => {
  it('이름이 있는 배우자 줄만 고른다', () => {
    const rows = spouseRows([
      row({ nameKo: '김영희', relation: '배우자' }),
      row({ nameKo: '김유은', relation: '자녀' }),
      row({ relation: '남편' }), // 이름이 없는 줄 = 종이의 빈 칸
      row({ nameEn: 'Grace Kim', relation: 'WIFE' }),
    ])
    expect(rows.map(spouseName)).toEqual(['김영희', 'Grace Kim'])
  })

  it('한글 이름이 없으면 영문 이름을 쓴다', () => {
    expect(spouseName(row({ nameEn: 'John Kim' }))).toBe('John Kim')
    expect(spouseName(row({ nameKo: '김철수', nameEn: 'Chulsoo Kim' }))).toBe('김철수')
  })
})

describe('성별 표기', () => {
  it("카드가 영문으로 적어 온 성별을 이 칸의 말로 옮긴다", () => {
    for (const v of ['M', 'm', 'Male', 'MALE']) expect(normalizeGender(v)).toBe('남')
    for (const v of ['F', 'f', 'Female', ' FEMALE ']) expect(normalizeGender(v)).toBe('여')
  })

  it('이미 한글로 적힌 값과 모르는 값은 그대로 둔다', () => {
    expect(normalizeGender('남')).toBe('남')
    expect(normalizeGender('여')).toBe('여')
    expect(normalizeGender('')).toBe('')
    expect(normalizeGender('미상')).toBe('미상')
  })
})

describe('배우자 등록 몸통', () => {
  const card = {
    ...blankAdultCard('2026-09-06'),
    name: '김철수',
    nameEn: 'Chulsoo Kim',
    gender: '남',
    birthDate: '1970-03-02',
    baptismStatus: '세례',
    memberNo: 'A-1201',
    schoolOrWork: 'CMU',
    phone: '412-555-0100',
    phoneHome: '412-555-0199',
    email: 'kim@example.com',
    address: '5000 Forbes Ave',
    city: 'Pittsburgh',
    state: 'PA',
    zipCode: '15213',
    attendReason: 'moved',
    registrationChoice: 'register',
    visitDate: '2026-09-06',
    registrationDate: '2026-09-06',
    family: [row({ nameKo: '이영희', nameEn: 'Younghee Lee', relation: '배우자', gender: '여', birthDate: '1972-11-05', baptism: '입교' })],
  }

  it('사람의 것은 그 줄에서 온다', () => {
    const p = spousePayload(card, card.family[0], 'a1b2')
    expect(p.name).toBe('이영희')
    expect(p.nameEn).toBe('Younghee Lee')
    expect(p.gender).toBe('여')
    expect(p.birthDate).toBe('1972-11-05')
    expect(p.baptismStatus).toBe('입교')
    expect(p.group).toBe('장년부')
    expect(p.householdId).toBe('a1b2')
  })

  it('세대의 것은 카드에서 그대로 온다', () => {
    const p = spousePayload(card, card.family[0])
    expect(p.address).toBe('5000 Forbes Ave')
    expect(p.city).toBe('Pittsburgh')
    expect(p.state).toBe('PA')
    expect(p.zipCode).toBe('15213')
    expect(p.phone).toBe('412-555-0100')
    expect(p.phoneHome).toBe('412-555-0199')
    expect(p.attendReason).toBe('moved')
    expect(p.registrationChoice).toBe('register')
    expect(p.visitDate).toBe('2026-09-06')
    expect(p.registrationDate).toBe('2026-09-06')
    expect(p.family).toHaveLength(1)
  })

  it("동행가족 표의 'M'/'F'는 명단의 말로 옮겨 담는다", () => {
    // 종이에 영문 이름을 쓴 카드는 성별도 영문으로 읽혀 온다 — 그대로 넣으면 출석부
    // 엑셀도 멤버 편집 창도 읽지 못하는 값이 명단에 앉는다.
    const p = spousePayload(card, row({ nameKo: '이영희', relation: 'WIFE', gender: 'F' }))
    expect(p.gender).toBe('여')
  })

  it('교우 등록번호와 직장·학교는 본인의 것이라 옮기지 않는다', () => {
    const p = spousePayload(card, card.family[0])
    expect(p.memberNo).toBeUndefined()
    expect(p.schoolOrWork).toBeUndefined()
  })

  it('이메일도 옮기지 않는다 — 두 사람이 같은 값을 들 수 없다', () => {
    // adult.members의 members_lower_idx가 lower(email)에 걸린 유니크 인덱스다. 카드의
    // 이메일을 배우자에게도 실으면 두 번째 등록이 통째로 실패해서, 본인만 들어가고
    // 배우자 한 사람이 조용히 빠진다. 빈 문자열도 그 인덱스에 들어가므로 ''도 안 된다.
    expect(spousePayload(card, card.family[0]).email).toBeUndefined()
    expect(spousePayload({ ...card, email: '' }, card.family[0]).email).toBeUndefined()
  })

  it('날짜가 되지 못한 생년월일은 적힌 그대로 남는다', () => {
    const p = spousePayload(card, row({ nameKo: '이영희', relation: '아내', birthDate: '1972' }))
    expect(p.birthDate).toBeNull()
    expect(p.birthDateRaw).toBe('1972')
  })
})
