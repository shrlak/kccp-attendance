import type { Member } from '../../lib/api'
import {
  addIsoDays,
  calendarOf,
  termRange,
  type CalendarLike,
} from '../../lib/semester'
import { ADULT_HALF_DATES, seasonsOf, type Partition, type Season } from '../../lib/partition'
import { hasHidingMark } from '../../lib/status'

// Season의 주인은 lib/partition.ts다 (부마다 한 해를 몇 토막으로 나누는지가 거기 있으므로).
// 여기서는 이름만 이어 준다 — 이 모듈에서 Season을 가져다 쓰던 곳들이 그대로 돌도록.
export type { Season }

export interface SemesterBounds {
  year: number
  season: Season
  start: string // ISO date, inclusive
  end: string // ISO date, inclusive
}

// Semester bounds for the term containing `dateStr`. The 2년치 학기 목록 wins when it lists
// that year's term; otherwise the recurring month/day template is projected into the year
// (see lib/semester.ts termRange). During a configured break between terms, the most
// recently started term remains the label, but membership/date columns are still clamped to
// its explicit end.
//
// 장년부에는 학기가 없다: 한 해가 상반기(1–6월)·하반기(7–12월) 둘로만 나뉘고, 그 경계는
// 저장된 학기 일정이 아니라 고정값이다 (partition.ts ADULT_HALF_DATES). 그래서 이 부에는
// 학기 사이의 빈틈이 없고 — 두 토막이 한 해를 빈 곳 없이 덮는다 — transitionBounds도
// 언제나 null이다.
export function semesterBounds(
  dateStr: string,
  semesterDates?: CalendarLike,
  partition: Partition = 'youth',
): SemesterBounds {
  const year = Number(dateStr.slice(0, 4))
  const ranges = seasonsOf(partition).map((season) => ({
    year,
    season,
    ...termRangeFor(year, season, semesterDates, partition),
  }))
  // 달력 순서로 놓고 뒤에서부터 — 시작일이 이 날짜를 넘지 않는 마지막 토막이 그 날의 토막이다.
  for (let i = ranges.length - 1; i > 0; i--) if (dateStr >= ranges[i].start) return ranges[i]
  return ranges[0]
}

// 한 토막의 경계. 대학·청년부는 저장된 학기 일정(2년치 목록 + 반복 템플릿)에서, 장년부는
// 고정된 상·하반기 값에서 온다.
export function termRangeFor(
  year: number,
  season: Season,
  semesterDates: CalendarLike,
  partition: Partition = 'youth',
): { start: string; end: string } {
  if (partition === 'adult') {
    const half = ADULT_HALF_DATES[season === 'fall' ? 'fall' : 'spring']
    return { start: `${year}-${half.start}`, end: `${year}-${half.end}` }
  }
  return termRange(year, season, calendarOf(semesterDates))
}

// Semester key like "2026-spring" for the term containing `dateStr`.
export function semesterKey(dateStr: string, semesterDates?: CalendarLike, partition: Partition = 'youth'): string {
  const { year, season } = semesterBounds(dateStr, semesterDates, partition)
  return `${year}-${season}`
}

// Sundays from `start` through `through` (inclusive), clamped to `end` when `through`
// runs past it — the shared walk behind both semesterSundays and transitionSundays.
function sundaysInRange(start: string, end: string, through: string): string[] {
  const DAY = 86_400_000
  const toUTC = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  // Advance from the range start to the first Sunday on/after it.
  let t = toUTC(start)
  const dow = new Date(t).getUTCDay()
  if (dow !== 0) t += (7 - dow) * DAY
  const endT = toUTC(through < end ? through : end)
  const out: string[] = []
  for (; t <= endT; t += 7 * DAY) {
    const dt = new Date(t)
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`,
    )
  }
  return out
}

// Sundays (worship dates) of the semester containing `today`, from the semester start
// through `through` (inclusive). `through` defaults to `today` (future Sundays excluded);
// pass a later date to include upcoming Sundays — e.g. the export's fixed term columns,
// which show every worship date through the term end and fill in as they pass. ISO ascending.
export function semesterSundays(
  today: string,
  through: string = today,
  semesterDates?: CalendarLike,
  partition: Partition = 'youth',
): string[] {
  const { start, end } = semesterBounds(today, semesterDates, partition)
  return sundaysInRange(start, end, through)
}

// Every Sunday in [start, end] (inclusive) — the worship dates of an arbitrary window, used
// by the archive exports where the window is a finished term or gap rather than "today"'s.
export function sundaysBetween(start: string, end: string): string[] {
  return sundaysInRange(start, end, end)
}

export interface TransitionBounds {
  start: string // ISO, inclusive — the day after the previous term ended
  end: string // ISO, inclusive — the day before the next term starts
}

// The gap between two configured 학기 that `dateStr` falls into — 예배 continues every
// Sunday through it even though it isn't part of any term. Null when `dateStr` is inside a
// configured term, including the default boundaries (spring/summer/fall run back-to-back,
// so they never leave a gap) — this only ever fires once an admin saves term dates that
// leave a break between them.
export function transitionBounds(
  dateStr: string,
  semesterDates?: CalendarLike,
  partition: Partition = 'youth',
): TransitionBounds | null {
  // 장년부에는 학기가 없으니 학기 사이도 없다 — 상반기와 하반기가 한 해를 빈 곳 없이 덮는다.
  if (partition === 'adult') return null
  const year = Number(dateStr.slice(0, 4))
  const cal = calendarOf(semesterDates)
  const { start: springStart, end: springEnd } = termRange(year, 'spring', cal)
  const { start: summerStart, end: summerEnd } = termRange(year, 'summer', cal)
  const { start: fallStart, end: fallEnd } = termRange(year, 'fall', cal)

  // Before this year's spring even starts: the wraparound gap since last year's fall
  // ended (dateStr's own year makes it unconditionally after that fall's end).
  if (dateStr < springStart) return { start: addIsoDays(termRange(year - 1, 'fall', cal).end, 1), end: addIsoDays(springStart, -1) }
  if (dateStr > springEnd && dateStr < summerStart) return { start: addIsoDays(springEnd, 1), end: addIsoDays(summerStart, -1) }
  if (dateStr > summerEnd && dateStr < fallStart) return { start: addIsoDays(summerEnd, 1), end: addIsoDays(fallStart, -1) }
  // After this year's fall ends: the wraparound gap until next year's spring starts.
  if (dateStr > fallEnd) return { start: addIsoDays(fallEnd, 1), end: addIsoDays(termRange(year + 1, 'spring', cal).start, -1) }
  return null
}

// Sundays within a transition gap, from its start through `through` (clamped to the
// gap's end) — the 예배 that still happens between configured 학기.
export function transitionSundays(bounds: TransitionBounds, through: string): string[] {
  return sundaysInRange(bounds.start, bounds.end, through)
}

// A 새가족 keeps showing the 새가족 mark (출석표 note, 오늘 tab tag) until they finish
// BOTH weeks of newcomer education — after that they've effectively graduated from
// newcomer status even though is_new_member (their historical registration flag, which
// drives the 멤버/새가족 tabs) stays true. Members-tab badges and the 새가족 tab itself
// are unaffected — they track the full history, not just "still an active newcomer".
export function isActiveNewFamily(m: Pick<Member, 'is_new_member' | 'new_member_edu_week1' | 'new_member_edu_week2'>): boolean {
  return !!m.is_new_member && !(m.new_member_edu_week1 && m.new_member_edu_week2)
}

// How recently a 새가족 registered, measured in worship weeks from `today` — the
// 이번 주일 등록 / 지난주 등록 distinction the 새가족 · 새가족 교육 · 멤버 tabs colour-code:
// 'thisWeek' = registered on/after the current 주일 (the newcomers of this Sunday),
// 'lastWeek' = the week before it, 'earlier' = anything older. Weeks run 주일→토요일, so a
// mid-week registration counts toward the 주일 that opened its week.
export type NewFamilyWeek = 'thisWeek' | 'lastWeek' | 'earlier'

// The 주일 that anchors `dateStr`'s week — the date itself on a Sunday, else the most
// recent Sunday before it. Mid-week views therefore still speak of "this 주일" as the
// Sunday just past, which is the service the 새가족 registered at.
export function worshipSunday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return dow === 0 ? dateStr : addIsoDays(dateStr, -dow)
}

// Which worship week a registration date falls in, relative to `today`. Null when the
// member has no registration date at all (nothing to place them by).
export function newFamilyWeek(
  registrationDate: string | null | undefined,
  today: string,
): NewFamilyWeek | null {
  if (!registrationDate) return null
  const sunday = worshipSunday(today)
  if (registrationDate >= sunday) return 'thisWeek'
  if (registrationDate >= addIsoDays(sunday, -7)) return 'lastWeek'
  return 'earlier'
}

// The 새가족 tab's 4-way education filter: 1주차만 이수 / 2주차만 이수 / 둘 다 이수 /
// 아무것도 안 들음 — an exhaustive, mutually-exclusive partition of the two checkboxes.
export type EduFilter = 'all' | 'week1' | 'week2' | 'both' | 'none'

export function matchesEduFilter(
  m: Pick<Member, 'new_member_edu_week1' | 'new_member_edu_week2'>,
  filter: EduFilter,
): boolean {
  if (filter === 'all') return true
  const w1 = !!m.new_member_edu_week1
  const w2 = !!m.new_member_edu_week2
  if (filter === 'both') return w1 && w2
  if (filter === 'week1') return w1 && !w2
  if (filter === 'week2') return !w1 && w2
  return !w1 && !w2 // 'none'
}

// 2026년 이전에 등록된 기록은 월별 등록 집계에 올리지 않는다. 그 이전 것은 옛 시트에서
// 옮겨온 명단이라 지금 새가족팀이 세는 대상이 아니다. (예전에는 이 선이 새가족 목록에도
// 걸려 있었지만 지금은 아니다 — 아래 visibleNewFamily 머리말 참고.)
const NEW_FAMILY_SINCE = '2026-01-01'

// 새가족 표시가 내려간 뒤에도 목록에 남는 기간. 표시를 해제하는 것은 "이제 새가족이 아니다"
// 라는 판단이지 "더는 안 봐도 된다"가 아니다 — 해제하는 순간 사람이 화면에서 사라지면
// 새가족팀은 방금까지 챙기던 사람을 멤버 탭에서 이름으로 다시 찾아야 한다. 1년은 새가족
// 한 바퀴(등록 → 교육 → 정착)를 다 덮는 길이다.
export const NEW_FAMILY_MEMORY_DAYS = 365

// 새가족 표시가 지금 붙어 있지는 않지만 **1년 안에 붙어 있던** 사람인가. 그 날짜는 서버가
// members.new_member_since에 적어 두고 해제해도 지우지 않는다 (마이그레이션 20260821).
// 날짜가 없는 사람은 그 칸이 생기기 전에 표시가 해제된 사람이라 되살릴 근거가 없다.
export function recentlyNewFamily(
  m: Pick<Member, 'new_member_since'>,
  today: string,
): boolean {
  return !!m.new_member_since && m.new_member_since >= addIsoDays(today, -NEW_FAMILY_MEMORY_DAYS)
}

// 새가족 that belong on the 새가족 · 새가족 교육 탭 — 두 탭이 이 함수 하나를 같이 읽는다
// (그래서 새가족 표시를 붙이면 새가족 교육 탭에도 같은 순간에 나타난다).
//
// **새가족 표시가 붙어 있으면 무조건 남는다.** 학기도, 새가족 교육 이수도, 등록일이 언제인지도
// 목록에서 사람을 내리지 못한다. 예전에는 등록일이 2026년 이전이면 걸러 냈는데(옛 시트에서
// 옮겨온 명단을 올리지 않으려는 선이었다), 그러면 관리자가 그런 사람에게 새가족 표시를 붙여도
// 목록에 나타나지 않아 — 표시는 켜져 있는데 화면 어디에도 없는 상태가 된다. 표시를 붙이는 것이
// 곧 "이 사람을 새가족으로 챙긴다"는 뜻이므로, 그 표시보다 앞서는 규칙을 두지 않는다.
//
// **표시가 내려가도 1년은 남는다** (recentlyNewFamily). 해제는 "이제 새가족이 아니다"라는
// 판단이지 그 사람을 화면에서 지우라는 뜻이 아니다 — 새가족 한 바퀴가 도는 동안은 계속 보이고,
// 그 뒤에 조용히 목록에서 빠진다. 새가족 교육 탭도 같이 따라간다 (이수 기록을 남긴 사람이
// 표시 해제와 동시에 사라지면 누가 이수했는지 확인할 자리가 없어진다 — 학기·이수 규칙을 없앤
// 것과 같은 이유다).
//
// 남는 규칙은 하나다: **떠난 사람은 빠진다.** useRoster의 splitRoster는 "오늘을 덮는" 표기만
// 보고 거르므로, 시작일이 아직 안 온 이주(다음 주에 떠남)나 이미 끝난 기간으로 잘못 적힌 귀국은
// 그 그물을 빠져나간다. 새가족팀 입장에서는 둘 다 이제 시작할 대상이 아니므로, 여기서는 날짜를
// 보지 않고 그런 표기를 하나라도 가졌는지만 본다. Newest registration first.
export function visibleNewFamily(members: Member[], today: string): Member[] {
  return members
    .filter((m) => {
      if (!m.is_new_member && !recentlyNewFamily(m, today)) return false
      if (hasHidingMark(m)) return false
      return true
    })
    .sort(
      (a, b) =>
        (b.registration_date || '').localeCompare(a.registration_date || '') || a.name.localeCompare(b.name),
    )
}

export interface DateGroup {
  date: string | null // ISO registration date; null = missing (kept visible)
  members: Member[]
}

// Split an already-ordered 새가족 list into runs of equal 등록일, preserving that order —
// so a newest-first list yields newest-date-first groups with the undated ones (which sort
// last) trailing.
export function groupByDate(list: Member[]): DateGroup[] {
  const out: DateGroup[] = []
  for (const m of list) {
    const date = m.registration_date || null
    const last = out[out.length - 1]
    if (last && last.date === date) last.members.push(m)
    else out.push({ date, members: [m] })
  }
  return out
}

export interface SemesterGroup {
  key: string // "2026-spring"
  year: number
  season: Season
  start: string // ISO start of the term — the sort key
  current: boolean // the term containing `today`
  total: number
  dates: DateGroup[]
}

// The 새가족 탭's list, separated by the 학기 each member registered in: the current term
// first, then earlier terms (newest first) holding everyone visibleNewFamily carries over —
// 표시가 붙어 있는 사람 전부와, 표시가 내려간 지 1년이 안 된 사람. Undated registrations sit
// in the current term, where they've always been shown.
export function newFamilyBySemester(
  members: Member[],
  today: string,
  semesterDates?: CalendarLike,
  partition: Partition = 'youth',
): SemesterGroup[] {
  const currentKey = semesterKey(today, semesterDates, partition)
  const byKey = new Map<string, Member[]>()
  for (const m of visibleNewFamily(members, today)) {
    const key = m.registration_date ? semesterKey(m.registration_date, semesterDates, partition) : currentKey
    const list = byKey.get(key) ?? []
    list.push(m)
    byKey.set(key, list)
  }
  return [...byKey.entries()]
    .map(([key, list]) => {
      // Bounds of the term itself, not of today — read them off any of its members.
      const anchor = list.find((m) => m.registration_date)?.registration_date ?? today
      const { year, season, start } = semesterBounds(anchor, semesterDates, partition)
      return { key, year, season, start, current: key === currentKey, total: list.length, dates: groupByDate(list) }
    })
    // Current term pinned first (a mistyped future 등록일 must not outrank it), then the
    // carried-over terms newest first.
    .sort((a, b) => Number(b.current) - Number(a.current) || b.start.localeCompare(a.start))
}

// 새가족 registered exactly on `date` — the set the 등록 카드 JPG export ships
// ("export only the 새가족 registered at the date of the export"). Name-ordered.
export function registeredOnDate(members: Member[], date: string): Member[] {
  return members
    .filter((m) => m.is_new_member && m.registration_date === date)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface MonthGroup {
  month: string // "YYYY-MM"
  members: Member[]
}

// Members with a registration_date, grouped by month, newest month first — the 새가족 탭's
// 월별 등록 section. It answers "when did people register", so someone who has since finished
// 새가족 교육 stays; but the two rules that take a person off this tab apply here too, or the
// tab would exclude them from its list and still print their name a screen further down.
export function monthlyRegistrations(members: Member[]): MonthGroup[] {
  const byMonth = new Map<string, Member[]>()
  for (const m of members) {
    if (!m.registration_date) continue
    if (m.registration_date < NEW_FAMILY_SINCE) continue
    if (hasHidingMark(m)) continue
    const key = m.registration_date.slice(0, 7)
    const list = byMonth.get(key) ?? []
    list.push(m)
    byMonth.set(key, list)
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, mem]) => ({
      month,
      members: mem.sort((a, b) => (b.registration_date || '').localeCompare(a.registration_date || '')),
    }))
}
