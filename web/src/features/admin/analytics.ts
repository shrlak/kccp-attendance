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

// ── 새가족 (new family) ────────────────────────────────────────────────────
// 새가족만 따로 세는 자리. 입력은 다른 집계와 똑같이 이미 부서/동산으로 좁혀진 members + log
// 이고, 새가족의 정의는 `members.is_new_member` 하나다 — 새가족 탭의 `visibleNewFamily`는
// "지금 새가족팀이 챙길 사람"이라 교육을 마치면 목록에서 빠지지만, **추이는 지나간 사실**이라
// 그때 등록한 사람은 그 달에 계속 남아 있어야 한다 (빠지면 지난달 숫자가 이번 주에 바뀐다).

export const newFamilyMembers = (members: Member[]): Member[] => members.filter((m) => m.is_new_member)

// 로그 한 줄이 새가족의 것인가. `memberId`가 있으면 그것이 열쇠고(동명이인이 갈린다), 없는
// 옛 줄·손님 줄만 이름으로 되짚는다 — 이 파일의 다른 집계도 사람을 이름으로 센다.
function newFamilyMatcher(members: Member[]): (e: LogEntry) => boolean {
  const nf = newFamilyMembers(members)
  const ids = new Set(nf.map((m) => m.id))
  const names = new Set(nf.map((m) => m.name))
  return (e) => (e.memberId ? ids.has(e.memberId) : names.has(e.name))
}

// "2026-01"부터 "2026-04"까지처럼 두 달 사이를 빠짐없이 잇는다.
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    if (++m > 12) {
      m = 1
      y++
    }
  }
  return out
}

export interface NewFamilyRegPoint {
  month: string // "2026-06"
  count: number // 그 달에 등록한 새가족 수
}

// 월별 새가족 등록 수, 오래된 달 → 최근 달. **한 명도 없던 달도 0으로 채운다** — 건너뛰면
// x축이 붙어 버려 "그 달에도 왔다"로 읽히고, 추이는 빈 달이 보여야 추이다. 등록일이 없는
// 새가족은 놓을 자리가 없어 빠진다 (숫자 타일의 `undated`가 그 사람들을 따로 센다).
export function newFamilyRegistrations(members: Member[]): NewFamilyRegPoint[] {
  const byMonth = new Map<string, number>()
  for (const m of newFamilyMembers(members)) {
    if (!m.registration_date) continue
    const key = m.registration_date.slice(0, 7)
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1)
  }
  const keys = [...byMonth.keys()].sort()
  if (keys.length === 0) return []
  return monthsBetween(keys[0], keys[keys.length - 1]).map((month) => ({ month, count: byMonth.get(month) ?? 0 }))
}

export interface NewFamilyTrendPoint {
  date: string
  count: number // 그 주일에 출석한 새가족 (이름 기준 중복 제거)
  total: number // 그 주일 전체 출석 인원
}

// 주일마다 출석한 새가족 수. 전체 출석도 같이 들고 오는 이유는 **비중은 새가족 숫자만으로는
// 나오지 않기** 때문이다 — 20명 중 5명과 200명 중 5명은 다른 사실이다.
export function newFamilyTrend(members: Member[], log: LogEntry[]): NewFamilyTrendPoint[] {
  const isNewFamily = newFamilyMatcher(members)
  return distinctDates(log).map((date) => {
    const onDate = log.filter((e) => e.date === date)
    return {
      date,
      count: new Set(onDate.filter(isNewFamily).map((e) => e.name)).size,
      total: new Set(onDate.map((e) => e.name)).size,
    }
  })
}

export interface NewFamilyMonthRow {
  month: string // "2026-06"
  registered: number // 그 달에 등록한 새가족
  attendees: number // 그 달에 한 번이라도 출석한 새가족
  share: number // 그 달 전체 출석 인원 대비 새가족 비중 (%, 반올림)
}

// 월별 새가족 요약, 최근 달 먼저. 등록만 있고 출석이 없는 달, 출석만 있고 등록이 없는 달이
// 둘 다 있으므로 두 쪽의 달을 합집합으로 놓는다.
export function newFamilyMonthly(members: Member[], log: LogEntry[]): NewFamilyMonthRow[] {
  const nf = newFamilyMembers(members)
  const isNewFamily = newFamilyMatcher(members)
  const months = new Set<string>()
  for (const m of nf) if (m.registration_date) months.add(m.registration_date.slice(0, 7))
  for (const e of log) months.add(e.date.slice(0, 7))
  return [...months]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => {
      const rows = log.filter((e) => e.date.slice(0, 7) === month)
      const attendees = new Set(rows.filter(isNewFamily).map((e) => e.name)).size
      const all = new Set(rows.map((e) => e.name)).size
      return {
        month,
        registered: nf.filter((m) => m.registration_date?.slice(0, 7) === month).length,
        attendees,
        share: all === 0 ? 0 : Math.round((attendees / all) * 100),
      }
    })
}

export interface NewFamilyTotals {
  total: number // 범위 안의 새가족 전체
  undated: number // 등록일이 없어 추이에 놓지 못한 사람
  thisTerm: number // 이번 학기(장년부는 반기)에 등록
  recent: number // 최근 몇 주일 안에 한 번이라도 출석한 새가족
  recentWeeks: number // 실제로 세어진 주일 수 — 기록이 RECENT_WEEKS보다 적을 수 있다
  eduDone: number // 새가족 교육 1·2주차를 다 이수 (대학·청년부에서만 뜻이 있다)
}

// "요즘도 오고 있나"를 재는 창. 한 주 빠졌다고 발길이 끊긴 것은 아니므로 한 주일이 아니라
// 최근 네 주일을 본다.
export const RECENT_WEEKS = 4

// 숫자 타일이 읽는 값. 학기 경계는 화면이 넘겨준다 — 부마다 한 해를 나누는 방식이 다르고
// (lib/partition.ts) 그 판단은 이 파일이 아니라 newFamily.ts semesterBounds의 것이다.
export function newFamilyTotals(
  members: Member[],
  log: LogEntry[],
  term: { start: string; end: string },
): NewFamilyTotals {
  const nf = newFamilyMembers(members)
  const isNewFamily = newFamilyMatcher(members)
  const recentDates = new Set(distinctDates(log).slice(-RECENT_WEEKS))
  const recentRows = log.filter((e) => recentDates.has(e.date) && isNewFamily(e))
  return {
    total: nf.length,
    undated: nf.filter((m) => !m.registration_date).length,
    thisTerm: nf.filter((m) => m.registration_date && m.registration_date >= term.start && m.registration_date <= term.end)
      .length,
    recent: new Set(recentRows.map((e) => e.name)).size,
    recentWeeks: recentDates.size,
    eduDone: nf.filter((m) => m.new_member_edu_week1 && m.new_member_edu_week2).length,
  }
}
