import type { Member } from '../../lib/api'
import { sundaysBetween } from './newFamily'

// 새가족 교육 일정 — **어느 주일에 몇 주차를 여는가**.
//
// 교육은 두 주 과정인데 매주 열리지도, 격주로 열리지도 않는다: 한 바퀴가 세 주일이다 —
// **1주차 · 2주차 · 쉬는 주일**. 그래서 날짜만 보고 주차를 셈할 수 없고, 시작 주일 하나와
// 이 반복이 함께 있어야 한다. 그것이 아래 EDU_TERMS 한 줄이다.
//
// 이 파일이 정하는 것은 **일정뿐이고, 누가 이수했는지는 아니다.** 이수는 사람마다 붙는
// 체크 두 개(`new_member_edu_week1/2`)로 남고 날짜가 없다 — 그래서 "지난 9월 27일에 누가
// 들었나"는 여기서도 저기서도 답할 수 없다. 이 일정이 답하는 것은 "이번 주일에 여는 것이
// 몇 주차인가", 그리고 그로부터 "그럼 누가 그 자리에 있어야 하나"다.
export type EduWeek = 1 | 2

export interface EduSession {
  date: string // ISO, 언제나 주일
  week: EduWeek
}

interface EduTerm {
  start: string // ISO — 첫 교육이 열리는 주일 (cycle의 첫 칸이 이 날에 놓인다)
  end: string // ISO, 포함 — 이 날까지만 연다
  cycle: (EduWeek | null)[] // 주일 단위로 도는 반복. null = 쉬는 주일
}

// **한 학기가 한 줄이다.** 2026 가을은 9월 6일 1주차로 시작해 12월 27일 2주차로 끝난다 —
// 그 사이 주일들이 [1주차, 2주차, 쉼]을 계속 돌고 마지막 바퀴가 12/27에서 정확히 닫힌다.
// 다음 학기가 정해지면 여기에 한 줄을 더한다. **끝난 학기는 지우지 않는다** — 지우면 지난
// 주일에 무엇을 열었는지 되물을 자리가 사라진다 (이수 체크에는 날짜가 없으므로 그 답을
// 가진 곳이 여기뿐이다).
const EDU_TERMS: EduTerm[] = [
  { start: '2026-09-06', end: '2026-12-27', cycle: [1, 2, null] },
]

// 일정은 상수에서 나오므로 한 번만 펼쳐 둔다 (날짜순 오름차순).
let cached: EduSession[] | null = null

export function eduSessions(): EduSession[] {
  if (cached) return cached
  const out: EduSession[] = []
  for (const term of EDU_TERMS) {
    // 시작일이 주일이 아니어도 sundaysBetween이 그 뒤 첫 주일부터 세므로, 반복의 첫 칸은
    // 언제나 "실제로 교육을 여는 첫 주일"에 놓인다.
    sundaysBetween(term.start, term.end).forEach((date, i) => {
      const week = term.cycle[i % term.cycle.length]
      if (week) out.push({ date, week })
    })
  }
  cached = out.sort((a, b) => a.date.localeCompare(b.date))
  return cached
}

// 그 날짜에 여는 교육 — 쉬는 주일과 주중은 null.
export function eduSessionOn(date: string): EduSession | null {
  return eduSessions().find((s) => s.date === date) ?? null
}

// `from`(포함) 이후 처음 열리는 교육. 일정이 끝난 뒤에는 null.
export function nextEduSession(from: string): EduSession | null {
  return eduSessions().find((s) => s.date >= from) ?? null
}

// 지금 화면이 가리켜야 할 교육: **오늘 열면 오늘 것, 아니면 다음에 열리는 것.** 주중에
// 명단을 여는 이유는 다음 주일을 준비하기 위해서이므로 지나간 주일로 되돌아가지 않고,
// 주일 당일에는 그 날 것을 그대로 가리킨다. 일정이 끝나면 null (12/27 뒤가 그렇다).
export function focusEduSession(today: string): EduSession | null {
  return eduSessionOn(today) ?? nextEduSession(today)
}

// 이 사람이 그 주차를 아직 안 들었는가 — 그 주일에 그 자리에 있어야 할 사람인지의 기준.
// 미수강도, 다른 한 주차만 들은 사람도 함께 걸린다 (둘 다 그 주차가 비어 있으므로).
export function needsEduWeek(
  m: Pick<Member, 'new_member_edu_week1' | 'new_member_edu_week2'>,
  week: EduWeek,
): boolean {
  return !(week === 1 ? m.new_member_edu_week1 : m.new_member_edu_week2)
}
