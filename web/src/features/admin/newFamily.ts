import type { Member } from '../../lib/api'

export type Season = 'spring' | 'summer' | 'fall'

export interface SemesterBounds {
  year: number
  season: Season
  start: string // ISO date, inclusive
  end: string // ISO date, inclusive
}

// Semester bounds for the term containing `dateStr` (matches legacy): Spring Jan 1–May 9 ·
// Summer May 10–Aug 14 · Fall Aug 15–Dec 31.
export function semesterBounds(dateStr: string): SemesterBounds {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (m < 5 || (m === 5 && d < 10)) return { year: y, season: 'spring', start: `${y}-01-01`, end: `${y}-05-09` }
  if (m < 8 || (m === 8 && d < 15)) return { year: y, season: 'summer', start: `${y}-05-10`, end: `${y}-08-14` }
  return { year: y, season: 'fall', start: `${y}-08-15`, end: `${y}-12-31` }
}

// Semester key like "2026-spring" for the term containing `dateStr`.
export function semesterKey(dateStr: string): string {
  const { year, season } = semesterBounds(dateStr)
  return `${year}-${season}`
}

// Sundays (worship dates) of the semester containing `today`, from the semester start
// through `through` (inclusive). `through` defaults to `today` (future Sundays excluded);
// pass a later date to include upcoming Sundays — e.g. the export's fixed term columns,
// which show every worship date through the term end and fill in as they pass. ISO ascending.
export function semesterSundays(today: string, through: string = today): string[] {
  const { start } = semesterBounds(today)
  const DAY = 86_400_000
  const toUTC = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  // Advance from the semester start to the first Sunday on/after it.
  let t = toUTC(start)
  const dow = new Date(t).getUTCDay()
  if (dow !== 0) t += (7 - dow) * DAY
  const endT = toUTC(through)
  const out: string[] = []
  for (; t <= endT; t += 7 * DAY) {
    const dt = new Date(t)
    out.push(
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`,
    )
  }
  return out
}

// 새가족 currently in scope: flagged is_new_member and either registered in the current
// semester or missing a registration date (kept visible). Newest registration first.
export function currentNewFamily(members: Member[], today: string): Member[] {
  const cur = semesterKey(today)
  return members
    .filter((m) => m.is_new_member && (!m.registration_date || semesterKey(m.registration_date) === cur))
    .sort(
      (a, b) =>
        (b.registration_date || '').localeCompare(a.registration_date || '') || a.name.localeCompare(b.name),
    )
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
