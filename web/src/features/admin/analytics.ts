import type { Member, LogEntry } from '../../lib/api'
import { groupsOf } from './filters'
import { onBreak } from '../../lib/status'

// ── Pure, immutable aggregation helpers for the Analytics tab ──────────────
// All functions take the already-scoped/filtered roster (members + log) and never
// mutate their inputs. The log carries denormalized name/group/subgroup, so unique
// attendees are counted by name (matching buildGrid / computeStats).

const distinctDates = (log: LogEntry[]): string[] => [...new Set(log.map((e) => e.date))].sort()
const uniqueNamesOn = (log: LogEntry[], date: string): Set<string> =>
  new Set(log.filter((e) => e.date === date).map((e) => e.name))

// 방학 (school break) 표기가 `date`를 덮는지 — 멤버가 여러 표기를 가질 수 있으므로
// lib/status.ts의 목록 규칙을 그대로 쓴다 (출석부·키오스크와 같은 판정).

// Drops log rows recorded while the member was marked 방학 on that date, so a break
// doesn't get counted toward attendance analytics until the mark is cleared. Rows with
// no memberId (guests/legacy) are never covered.
export function excludeOnBreak(members: Member[], log: LogEntry[]): LogEntry[] {
  const byId = new Map(members.map((m) => [m.id, m]))
  return log.filter((e) => {
    if (!e.memberId) return true
    const m = byId.get(e.memberId)
    return !m || !onBreak(m, e.date)
  })
}

export interface TrendPoint {
  date: string
  count: number // distinct attendees on that date
}

// 4.1 — unique attendees per date, ascending. One point per distinct log date.
export function trendSeries(log: LogEntry[]): TrendPoint[] {
  return distinctDates(log).map((date) => ({ date, count: uniqueNamesOn(log, date).size }))
}

export interface GroupSeries {
  dates: string[]
  groups: string[] // 부서 present among members, in the preferred order
  counts: Record<string, number[]> // group → per-date distinct attendee counts (aligned to dates)
}

// 4.2 — one row of per-date counts per 부서, for a grouped bar chart. Counts use the
// log's group label so visitors/cross-group entries land in their logged 부서.
export function groupSeries(members: Member[], log: LogEntry[]): GroupSeries {
  const dates = distinctDates(log)
  const groups = groupsOf(members)
  const counts: Record<string, number[]> = {}
  for (const g of groups) {
    const gLog = log.filter((e) => e.group === g)
    counts[g] = dates.map((date) => uniqueNamesOn(gLog, date).size)
  }
  return { dates, groups, counts }
}

export interface MonthRow {
  month: string // "2026-06"
  sundays: number // distinct attendance dates that fall in the month
  attendees: number // distinct attendees across the month
  firstVisits: number // first-visit log entries in the month
}

// 4.3a — per-month aggregates, newest month first.
export function monthlySummary(_members: Member[], log: LogEntry[]): MonthRow[] {
  const byMonth = new Map<string, LogEntry[]>()
  for (const e of log) {
    const month = e.date.slice(0, 7)
    const bucket = byMonth.get(month)
    if (bucket) bucket.push(e)
    else byMonth.set(month, [e])
  }
  return [...byMonth.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => {
      const rows = byMonth.get(month)!
      return {
        month,
        sundays: new Set(rows.map((e) => e.date)).size,
        attendees: new Set(rows.map((e) => e.name)).size,
        firstVisits: rows.filter((e) => e.firstVisit).length,
      }
    })
}

export interface SemesterRow {
  key: string // "2026-H1"
  year: number
  half: 1 | 2 // 1 = 상반기 (Jan–Jun), 2 = 하반기 (Jul–Dec)
  sundays: number
  attendees: number
  firstVisits: number
}

// 4.3b — per-semester aggregates (상반기 = Jan–Jun, 하반기 = Jul–Dec), newest first.
// Note: this Jan/Jul split is the *reporting* semester, distinct from the 새가족
// spring/summer/fall season logic.
export function semesterSummary(_members: Member[], log: LogEntry[]): SemesterRow[] {
  const byKey = new Map<string, LogEntry[]>()
  for (const e of log) {
    const year = Number(e.date.slice(0, 4))
    const month = Number(e.date.slice(5, 7))
    const half: 1 | 2 = month <= 6 ? 1 : 2
    const key = `${year}-H${half}`
    const bucket = byKey.get(key)
    if (bucket) bucket.push(e)
    else byKey.set(key, [e])
  }
  return [...byKey.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => {
      const rows = byKey.get(key)!
      const [yearStr, halfStr] = key.split('-H')
      return {
        key,
        year: Number(yearStr),
        half: (Number(halfStr) as 1 | 2),
        sundays: new Set(rows.map((e) => e.date)).size,
        attendees: new Set(rows.map((e) => e.name)).size,
        firstVisits: rows.filter((e) => e.firstVisit).length,
      }
    })
}

export interface RecapRow {
  date: string
  attendance: number // distinct attendees
  firstVisits: number // first-visit entries
}

// 4.4 — the last (up to) 7 recorded dates, newest first, with attendance + first-visit
// counts. Used by the weekly recap table and its copy-to-clipboard text.
export function weeklyRecap(log: LogEntry[]): RecapRow[] {
  const dates = distinctDates(log).slice(-7).reverse()
  return dates.map((date) => {
    const onDate = log.filter((e) => e.date === date)
    return {
      date,
      attendance: new Set(onDate.map((e) => e.name)).size,
      firstVisits: onDate.filter((e) => e.firstVisit).length,
    }
  })
}

// Plain-text recap for the clipboard, e.g.
//   2026-06-07 · 42 · 첫출석 3
export function recapText(rows: RecapRow[]): string {
  return rows.map((r) => `${r.date} · ${r.attendance} · ★${r.firstVisits}`).join('\n')
}
