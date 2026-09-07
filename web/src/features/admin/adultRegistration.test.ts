import { describe, it, expect } from 'vitest'
import { adultPayload } from './adultRegistration'
import { blankAdultCard } from './adultCard'

// 이메일 칸이 비면 그 칸을 **보내지 않는다**. adult.members의 members_lower_idx가 lower(email)에
// 걸린 유니크 인덱스이고 빈 문자열도 그 인덱스에 들어가므로, ''를 보내면 이메일 없는 두 번째
// 사람의 등록이 통째로 거절된다 ("Could not create member"). 종이 카드의 이메일 칸은 자주
// 비어 있어서, 그대로 두면 장년부 등록이 사실상 한 번밖에 되지 않는다.
describe('adultPayload — 장년부 카드 → 등록 몸통', () => {
  it('이메일이 비면 그 칸을 아예 싣지 않는다 (NULL로 남아야 유니크 인덱스 밖이다)', () => {
    const payload = adultPayload({ ...blankAdultCard('2026-09-06'), name: '김장년' })
    expect('email' in payload).toBe(false)
    expect(payload).toMatchObject({ name: '김장년', group: '장년부' })
  })

  it('공백만 적힌 이메일도 빈 칸으로 본다', () => {
    const payload = adultPayload({ ...blankAdultCard('2026-09-06'), name: '김장년', email: '   ' })
    expect('email' in payload).toBe(false)
  })

  it('적힌 이메일은 다듬어서 그대로 싣는다', () => {
    const payload = adultPayload({ ...blankAdultCard('2026-09-06'), name: '김장년', email: '  a@b.com ' })
    expect(payload.email).toBe('a@b.com')
  })
})
