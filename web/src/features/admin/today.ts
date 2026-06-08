import type { LogEntry, Member } from '../../lib/api'

// Today's check-ins, newest first.
export function todaysCheckins(log: LogEntry[], today: string): LogEntry[] {
  return log.filter((e) => e.date === today).sort((a, b) => b.ts - a.ts)
}

// Names already present today — used to mark/disable them in the manual check-in picker.
export function presentNamesToday(log: LogEntry[], today: string): Set<string> {
  return new Set(log.filter((e) => e.date === today).map((e) => e.name))
}

// Members for the manual check-in picker: name-matches the query, sorted by name.
export function checkinCandidates(members: Member[], query: string): Member[] {
  const q = query.trim().toLowerCase()
  return members
    .filter((m) => !q || m.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface WeekDelta {
  thisWeek: number
  lastWeek: number
  delta: number
}

// Distinct attendees today vs. the most recent prior check-in date (e.g. last Sunday).
export function weeklyComparison(log: LogEntry[], today: string): WeekDelta {
  const countOn = (d: string) => new Set(log.filter((e) => e.date === d).map((e) => e.name)).size
  const priorDates = [...new Set(log.map((e) => e.date))].filter((d) => d < today).sort()
  const thisWeek = countOn(today)
  const lastWeek = priorDates.length ? countOn(priorDates[priorDates.length - 1]) : 0
  return { thisWeek, lastWeek, delta: thisWeek - lastWeek }
}
