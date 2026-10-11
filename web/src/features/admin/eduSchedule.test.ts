import { describe, it, expect } from 'vitest'
import { eduSessions, eduSessionOn, nextEduSession, focusEduSession, needsEduWeek, eduUnfinished } from './eduSchedule'

// 교육은 1주차 · 2주차가 쉬는 주일 없이 번갈아 돈다. 다만 행사로 건너뛴 주일(2026 가을은
// 9/20 전교인체육대회)이 끼거나 실제 순서가 어긋나면(10/11을 2주차로 열었다) 그 뒤가 밀리므로,
// "격주"로 날짜를 맞힐 수 없고 이 표가 유일한 답이다.
describe('eduSchedule — 1주차 · 2주차가 번갈아 도는 일정', () => {
  it('2026 가을은 9/6 1주차 · 9/13 2주차, 9/20은 건너뛰고 9/27부터 다시 1주차 · 2주차다', () => {
    expect(eduSessionOn('2026-09-06')?.week).toBe(1)
    expect(eduSessionOn('2026-09-13')?.week).toBe(2)
    expect(eduSessionOn('2026-09-20')).toBeNull()
    expect(eduSessionOn('2026-09-27')?.week).toBe(1)
    expect(eduSessionOn('2026-10-04')?.week).toBe(2)
    // 10/11은 2주차로 열었다 — 그날부터 2주차 · 1주차로 다시 센다.
    expect(eduSessionOn('2026-10-11')?.week).toBe(2)
    expect(eduSessionOn('2026-10-18')?.week).toBe(1)
    expect(eduSessionOn('2026-10-25')?.week).toBe(2)
    expect(eduSessionOn('2026-11-01')?.week).toBe(1)
    expect(eduSessionOn('2026-12-20')?.week).toBe(2)
  })

  it('12월 27일까지 이어지고 그 뒤로는 없다', () => {
    const all = eduSessions()
    expect(all[all.length - 1]).toEqual({ date: '2026-12-27', week: 1 })
    expect(nextEduSession('2026-12-28')).toBeNull()
    expect(focusEduSession('2027-01-03')).toBeNull()
  })

  it('여는 날은 모두 주일이고, 건너뛴 9/20 말고는 모든 주일에 연다', () => {
    const all = eduSessions()
    for (const s of all) expect(new Date(`${s.date}T00:00:00Z`).getUTCDay()).toBe(0)
    // 9/6 ~ 12/27의 주일 17번 중 9/20 하나를 뺀 16번.
    expect(all).toHaveLength(16)
    expect(all.filter((s) => s.week === 1)).toHaveLength(8)
    expect(all.filter((s) => s.week === 2)).toHaveLength(8)
    // 10/11부터는 2주차 · 1주차가 빠짐없이 번갈아 선다.
    all
      .filter((s) => s.date >= '2026-10-11')
      .forEach((s, i) => expect(s.week).toBe(i % 2 === 0 ? 2 : 1))
  })

  it('주중에는 다음에 열리는 교육을, 주일 당일에는 그 날 것을 가리킨다', () => {
    expect(focusEduSession('2026-09-06')).toEqual({ date: '2026-09-06', week: 1 })
    // 월요일 — 지나간 주일로 돌아가지 않는다 (명단을 여는 이유가 다음 주일 준비이므로).
    expect(focusEduSession('2026-09-07')).toEqual({ date: '2026-09-13', week: 2 })
    // 건너뛴 주일(전교인체육대회) — 그 날은 열지 않으므로 다음 주일을 가리킨다.
    expect(focusEduSession('2026-09-20')).toEqual({ date: '2026-09-27', week: 1 })
    // 토요일 10/10 — 내일 10/11은 2주차다.
    expect(focusEduSession('2026-10-10')).toEqual({ date: '2026-10-11', week: 2 })
    expect(focusEduSession('2026-10-11')).toEqual({ date: '2026-10-11', week: 2 })
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
