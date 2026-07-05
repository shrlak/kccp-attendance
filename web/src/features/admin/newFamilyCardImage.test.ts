import { describe, it, expect } from 'vitest'
import { cardSections, cardFilenames } from './newFamilyCardImage'
import type { Member } from '../../lib/api'

const member = (extra: Partial<Member> = {}): Member => ({
  id: 'm1',
  name: '새신자',
  group_name: '대학부',
  subgroup: '동산1',
  member_role: '',
  gender: '여',
  phone: '412-555-0101',
  birth_date: '2004-03-01',
  kakao_id: 'saeshinja',
  is_new_member: true,
  notes: '',
  registration_date: '2026-07-05',
  baptism_status: '유아세례',
  school_or_work: 'Pitt',
  faith_duration: '10년',
  pastoral_visit_requested: true,
  ...extra,
})

describe('cardSections (새가족 등록 카드 model)', () => {
  it('mirrors the kiosk dialog: 인적 사항 / 신앙 / 등록 정보 with the same fields in order', () => {
    const secs = cardSections(member())
    expect(secs.map((s) => s.label)).toEqual(['인적 사항', '신앙', '등록 정보'])
    expect(secs[0].fields.map((f) => f.label)).toEqual(['이름', '성별', '생일', '전화', '카톡ID', '학교/직장'])
    expect(secs[1].fields.map((f) => f.label)).toEqual(['세례 여부', '신앙 기간', '심방 요청'])
    expect(secs[2].fields.map((f) => f.label)).toEqual(['부서', '동산', '등록일'])
  })

  it('fills the values from the member row (snake_case roster fields)', () => {
    const secs = cardSections(member())
    const byLabel = Object.fromEntries(secs.flatMap((s) => s.fields.map((f) => [f.label, f.value])))
    expect(byLabel['이름']).toBe('새신자')
    expect(byLabel['학교/직장']).toBe('Pitt')
    expect(byLabel['세례 여부']).toBe('유아세례')
    expect(byLabel['신앙 기간']).toBe('10년')
    expect(byLabel['심방 요청']).toBe('🙏 요청')
    expect(byLabel['등록일']).toBe('2026-07-05')
  })

  it('renders blanks (not placeholders) for missing values, like the paper card', () => {
    const secs = cardSections(
      member({ gender: '', phone: '', kakao_id: '', birth_date: null, baptism_status: '', school_or_work: '', faith_duration: '', pastoral_visit_requested: false, subgroup: '' }),
    )
    const values = secs.flatMap((s) => s.fields.map((f) => f.value))
    expect(values.filter(Boolean)).toEqual(['새신자', '대학부', '2026-07-05'])
  })
})

describe('cardFilenames (per-person JPG names)', () => {
  const named = (name: string) => ({ name })

  it('names each file 새가족등록카드-날짜-이름.jpg', () => {
    expect(cardFilenames([named('새신자'), named('김민준')], '2026-07-05')).toEqual([
      '새가족등록카드-2026-07-05-새신자.jpg',
      '새가족등록카드-2026-07-05-김민준.jpg',
    ])
  })

  it('suffixes duplicate names so downloads never overwrite each other', () => {
    expect(cardFilenames([named('김민준'), named('김민준'), named('김민준')], '2026-07-05')).toEqual([
      '새가족등록카드-2026-07-05-김민준.jpg',
      '새가족등록카드-2026-07-05-김민준-2.jpg',
      '새가족등록카드-2026-07-05-김민준-3.jpg',
    ])
  })

  it('sanitizes filesystem-hostile characters and falls back to the position for empty names', () => {
    expect(cardFilenames([named('a/b:c?'), named('')], '2026-07-05')).toEqual([
      '새가족등록카드-2026-07-05-abc.jpg',
      '새가족등록카드-2026-07-05-2.jpg',
    ])
  })
})
