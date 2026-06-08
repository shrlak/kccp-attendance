import type { LogEntry } from '../../lib/api'

// Today's check-ins, newest first.
export function todaysCheckins(log: LogEntry[], today: string): LogEntry[] {
  return log.filter((e) => e.date === today).sort((a, b) => b.ts - a.ts)
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
