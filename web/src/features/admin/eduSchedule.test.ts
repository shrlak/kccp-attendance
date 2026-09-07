import { describe, it, expect } from 'vitest'
import { eduSessions, eduSessionOn, nextEduSession, focusEduSession, needsEduWeek, eduUnfinished } from './eduSchedule'

// 교육은 세 주일이 한 바퀴다: 1주차 · 2주차 · 쉬는 주일. 그래서 "격주"로도 "매주"로도
// 날짜를 맞힐 수 없고, 이 표가 유일한 답이다.
describe('eduSchedule — 1주차 · 2주차 · 쉼이 도는 일정', () => {
  it('2026 가을은 9/6 1주차로 시작해 9/13 2주차, 9/20은 쉬고 9/27에 다시 1주차다', () => {
    expect(eduSessionOn('2026-09-06')?.week).toBe(1)
    expect(eduSessionOn('2026-09-13')?.week).toBe(2)
    expect(eduSessionOn('2026-09-20')).toBeNull()
    expect(eduSessionOn('2026-09-27')?.week).toBe(1)
    expect(eduSessionOn('2026-10-04')?.week).toBe(2)
    expect(eduSessionOn('2026-10-11')).toBeNull()
  })

  it('12월 27일까지 이어지고 그 뒤로는 없다', () => {
    const all = eduSessions()
    expect(all[all.length - 1]).toEqual({ date: '2026-12-27', week: 2 })
    expect(nextEduSession('2026-12-28')).toBeNull()
    expect(focusEduSession('2027-01-03')).toBeNull()
  })

  it('여는 날은 모두 주일이고, 쉬는 주일마다 한 바퀴가 닫힌다', () => {
    const all = eduSessions()
    for (const s of all) expect(new Date(`${s.date}T00:00:00Z`).getUTCDay()).toBe(0)
    // 17번의 주일 중 쉬는 주일 5번(9/20 · 10/11 · 11/1 · 11/22 · 12/13)을 뺀 12번.
    expect(all).toHaveLength(12)
    expect(all.filter((s) => s.week === 1)).toHaveLength(6)
    expect(all.filter((s) => s.week === 2)).toHaveLength(6)
  })

  it('주중에는 다음에 열리는 교육을, 주일 당일에는 그 날 것을 가리킨다', () => {
    expect(focusEduSession('2026-09-06')).toEqual({ date: '2026-09-06', week: 1 })
    // 월요일 — 지나간 주일로 돌아가지 않는다 (명단을 여는 이유가 다음 주일 준비이므로).
    expect(focusEduSession('2026-09-07')).toEqual({ date: '2026-09-13', week: 2 })
    // 쉬는 주일 — 그 날은 열지 않으므로 다음 주일을 가리킨다.
    expect(focusEduSession('2026-09-20')).toEqual({ date: '2026-09-27', week: 1 })
  })
})

// 그 주차가 비어 있는 사람이 그 자리에 있어야 할 사람이다 — 미수강도, 다른 한 주차만
// 들은 사람도 함께 걸린다 (한 바퀴가 1주차부터 시작하지 않으므로 2주차만 들은 사람이 실제로
// 생긴다: 2주차 주일에 처음 온 새가족이 그렇다).
describe('needsEduWeek', () => {
  const m = (w1: boolean, w2: boolean) => ({ new_member_edu_week1: w1, new_member_edu_week2: w2 })

  it('1주차 주일에는 미수강과 2주차만 들은 사람이 대상이다', () => {
    expect(needsEduWeek(m(false, false), 1)).toBe(true)
    expect(needsEduWeek(m(false, true), 1)).toBe(true)
    expect(needsEduWeek(m(true, false), 1)).toBe(false)
    expect(needsEduWeek(m(true, true), 1)).toBe(false)
  })

  it('2주차 주일에는 미수강과 1주차만 들은 사람이 대상이다', () => {
    expect(needsEduWeek(m(false, false), 2)).toBe(true)
    expect(needsEduWeek(m(true, false), 2)).toBe(true)
    expect(needsEduWeek(m(false, true), 2)).toBe(false)
    expect(needsEduWeek(m(true, true), 2)).toBe(false)
  })
})

// 위 블록에 오르는 사람은 **한 주차라도 비어 있는 사람 전부**다. 1주차 주일에는 그 주차가
// 빈 사람에 '1주차만 들은 사람'이, 2주차 주일에는 '2주차만 들은 사람'이 더해지므로, 어느
// 주일이든 남는 것은 같다 — 교육을 아직 안 끝낸 사람.
describe('eduUnfinished', () => {
  const m = (w1: boolean, w2: boolean) => ({ new_member_edu_week1: w1, new_member_edu_week2: w2 })

  it('두 주를 다 마친 사람만 빠진다', () => {
    expect(eduUnfinished(m(false, false))).toBe(true)
    expect(eduUnfinished(m(true, false))).toBe(true)
    expect(eduUnfinished(m(false, true))).toBe(true)
    expect(eduUnfinished(m(true, true))).toBe(false)
  })

  it('어느 주일이든 같은 사람들이다 — 그 안의 순서만 주차가 정한다', () => {
    const people = [m(false, false), m(true, false), m(false, true), m(true, true)]
    expect(people.filter(eduUnfinished)).toHaveLength(3)
    // 1주차 주일에는 1주차가 빈 둘이 앞, 2주차 주일에는 2주차가 빈 둘이 앞.
    expect(people.filter(eduUnfinished).filter((p) => needsEduWeek(p, 1))).toHaveLength(2)
    expect(people.filter(eduUnfinished).filter((p) => needsEduWeek(p, 2))).toHaveLength(2)
  })
})
