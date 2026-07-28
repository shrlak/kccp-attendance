import type { Member } from '../../lib/api'
import {
  DEFAULT_SEMESTER_DATES,
  dateForYear,
  addIsoDays,
  type SemesterDates,
} from '../../lib/semester'
import type { Filter } from './filters'

export type Season = 'spring' | 'summer' | 'fall'

export interface SemesterBounds {
  year: number
  season: Season
  start: string // ISO date, inclusive
  end: string // ISO date, inclusive
}

// Semester bounds for the term containing `dateStr`. Saved month/day ranges are
// projected into that date's year; the legacy boundaries remain the fallback. During a
// configured break between terms, the most recently started term remains the label, but
// membership/date columns are still clamped to its explicit end.
export function semesterBounds(dateStr: string, semesterDates?: SemesterDates | null): SemesterBounds {
  const year = Number(dateStr.slice(0, 4))
  const dates = semesterDates ?? DEFAULT_SEMESTER_DATES
  const spring = {
    year,
    season: 'spring' as const,
    start: dateForYear(year, dates.spring.start),
    end: dateForYear(year, dates.spring.end),
  }
  const summer = {
    year,
    season: 'summer' as const,
    start: dateForYear(year, dates.summer.start),
    end: dateForYear(year, dates.summer.end),
  }
  const fall = {
    year,
    season: 'fall' as const,
    start: dateForYear(year, dates.fall.start),
    end: dateForYear(year, dates.fall.end),
  }
  if (dateStr >= fall.start) return fall
  if (dateStr >= summer.start) return summer
  return spring
}

// Semester key like "2026-spring" for the term containing `dateStr`.
export function semesterKey(dateStr: string, semesterDates?: SemesterDates | null): string {
  const { year, season } = semesterBounds(dateStr, semesterDates)
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
  semesterDates?: SemesterDates | null,
): string[] {
  const { start, end } = semesterBounds(today, semesterDates)
  return sundaysInRange(start, end, through)
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
export function transitionBounds(dateStr: string, semesterDates?: SemesterDates | null): TransitionBounds | null {
  const year = Number(dateStr.slice(0, 4))
  const dates = semesterDates ?? DEFAULT_SEMESTER_DATES
  const springStart = dateForYear(year, dates.spring.start)
  const springEnd = dateForYear(year, dates.spring.end)
  const summerStart = dateForYear(year, dates.summer.start)
  const summerEnd = dateForYear(year, dates.summer.end)
  const fallStart = dateForYear(year, dates.fall.start)
  const fallEnd = dateForYear(year, dates.fall.end)

  // Before this year's spring even starts: the wraparound gap since last year's fall
  // ended (dateStr's own year makes it unconditionally after that fall's end).
  if (dateStr < springStart) return { start: addIsoDays(dateForYear(year - 1, dates.fall.end), 1), end: addIsoDays(springStart, -1) }
  if (dateStr > springEnd && dateStr < summerStart) return { start: addIsoDays(springEnd, 1), end: addIsoDays(summerStart, -1) }
  if (dateStr > summerEnd && dateStr < fallStart) return { start: addIsoDays(summerEnd, 1), end: addIsoDays(fallStart, -1) }
  // After this year's fall ends: the wraparound gap until next year's spring starts.
  if (dateStr > fallEnd) return { start: addIsoDays(fallEnd, 1), end: addIsoDays(dateForYear(year + 1, dates.spring.start), -1) }
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

// Distinct, non-empty 새가족 교육 동산 values for a group (or across all groups when group
// is ''), sorted — mirrors filters.ts's subgroupsOf but keyed on the separate 새가족 교육
// 동산 field (member.new_member_dongsan) instead of the regular subgroup.
export function eduDongsansOf(members: Member[], group: string): string[] {
  const set = new Set(
    members
      .filter((m) => !group || m.group_name === group)
      .map((m) => m.new_member_dongsan)
      .filter((s): s is string => !!s),
  )
  return [...set].sort((a, b) => a.localeCompare(b))
}

// Scope members by 부서 + 새가족 교육 동산 — mirrors filters.ts's filterMembers but keyed
// on new_member_dongsan instead of subgroup, for the 새가족 교육 탭's filter row.
export function filterByEduDongsan(members: Member[], f: Filter): Member[] {
  return members.filter(
    (m) => (!f.group || m.group_name === f.group) && (!f.subgroup || m.new_member_dongsan === f.subgroup),
  )
}

// 새가족 currently in scope: flagged is_new_member and either registered in the current
// semester or missing a registration date (kept visible). Newest registration first.
export function currentNewFamily(
  members: Member[],
  today: string,
  semesterDates?: SemesterDates | null,
): Member[] {
  const { start, end } = semesterBounds(today, semesterDates)
  return members
    .filter((m) => m.is_new_member && (!m.registration_date || (m.registration_date >= start && m.registration_date <= end)))
    .sort(
      (a, b) =>
        (b.registration_date || '').localeCompare(a.registration_date || '') || a.name.localeCompare(b.name),
    )
}

export interface DateGroup {
  date: string | null // ISO registration date; null = missing (kept visible)
  members: Member[]
}

// Current-semester 새가족 split by registration date, newest date first; members missing a
// registration date form a trailing group. Relies on currentNewFamily's ordering.
export function newFamilyByDate(
  members: Member[],
  today: string,
  semesterDates?: SemesterDates | null,
): DateGroup[] {
  const out: DateGroup[] = []
  for (const m of currentNewFamily(members, today, semesterDates)) {
    const date = m.registration_date || null
    const last = out[out.length - 1]
    if (last && last.date === date) last.members.push(m)
    else out.push({ date, members: [m] })
  }
  return out
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

// Every member with a registration_date, grouped by month, newest month first.
export function monthlyRegistrations(members: Member[]): MonthGroup[] {
  const byMonth = new Map<string, Member[]>()
  for (const m of members) {
    if (!m.registration_date) continue
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
