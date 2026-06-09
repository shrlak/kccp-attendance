import type { Member } from '../../lib/api'

export type Season = 'spring' | 'summer' | 'fall'

// Semester bounds (matches legacy): Spring Jan 1–May 9 · Summer May 10–Aug 14 ·
// Fall Aug 15–Dec 31. Returns a key like "2026-spring".
export function semesterKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  let season: Season
  if (m < 5 || (m === 5 && d < 10)) season = 'spring'
  else if (m < 8 || (m === 8 && d < 15)) season = 'summer'
  else season = 'fall'
  return `${y}-${season}`
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
