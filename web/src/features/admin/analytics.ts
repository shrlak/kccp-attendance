import type { Member, LogEntry } from '../../lib/api'
import { groupsOf } from './filters'
import { onBreak } from '../../lib/status'
import { matchesEduFilter, worshipSunday, type EduFilter } from './newFamily'

// ── Pure, immutable aggregation helpers for the Analytics tab ──────────────
// All functions take the already-scoped/filtered roster (members + log) and never
// mutate their inputs. The log carries denormalized name/group/subgroup, so unique
// attendees are counted by name (matching buildGrid / computeStats).

const distinctDates = (log: LogEntry[]): string[] => [...new Set(log.map((e) => e.date))].sort()

// ── 그래프의 가로축 한 칸 ──────────────────────────────────────────────────
// 통계 탭 맨 위의 주별/월별 토글이 이 값 하나로 네 그래프(출석 추이 · 부서별 비교 ·
// 새가족 등록 · 새가족 출석)를 함께 옮긴다. **주별이 원래의 그림이다** — 출석은 주일마다
// 찍히므로 한 칸이 곧 그 주일이고, 월별은 그 칸들을 달로 묶어 긴 흐름을 보는 자리다.
// 하나뿐인 토글로 넷을 다 옮기는 이유는, 같은 화면의 그래프가 서로 다른 축을 쓰면 위아래를
// 견주는 순간 틀리기 때문이다.
export type Granularity = 'week' | 'month'

// 출석 한 줄이 놓이는 칸. 로그의 날짜는 이미 예배가 있던 날이라 주별에서는 그 날짜가 그대로
// 칸이 된다 (없던 주일은 칸도 없다 — 예배가 없던 주에 0을 그리면 아무도 안 온 것으로 읽힌다).
const bucketOf = (date: string, gran: Granularity): string => (gran === 'month' ? date.slice(0, 7) : date)
const distinctBuckets = (log: LogEntry[], gran: Granularity): string[] =>
  [...new Set(log.map((e) => bucketOf(e.date, gran)))].sort()
const uniqueNamesIn = (log: LogEntry[], bucket: string, gran: Granularity): Set<string> =>
  new Set(log.filter((e) => bucketOf(e.date, gran) === bucket).map((e) => e.name))

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
  date: string // 칸의 열쇠 — 주별이면 그 주일("2026-06-07"), 월별이면 그 달("2026-06")
  count: number // distinct attendees in that bucket
}

// 4.1 — unique attendees per bucket, ascending. 주별은 기록이 있는 주일마다 한 점이고,
// 월별은 그 달에 **한 번이라도** 온 사람 수다 (주일마다의 평균이 아니라 아래 월별 요약 표의
// '출석 인원'과 같은 수 — 같은 화면의 두 곳이 다른 것을 세면 어느 쪽이 맞나 싶어진다).
export function trendSeries(log: LogEntry[], gran: Granularity = 'week'): TrendPoint[] {
  return distinctBuckets(log, gran).map((date) => ({ date, count: uniqueNamesIn(log, date, gran).size }))
}

export interface GroupSeries {
  dates: string[] // 칸의 열쇠들 (trendSeries와 같은 자름 — 주일 또는 달)
  groups: string[] // 부서 present among members, in the preferred order
  counts: Record<string, number[]> // group → per-bucket distinct attendee counts (aligned to dates)
}

// 4.2 — one row of per-bucket counts per 부서, for a grouped bar chart. Counts use the
// log's group label so visitors/cross-group entries land in their logged 부서.
export function groupSeries(members: Member[], log: LogEntry[], gran: Granularity = 'week'): GroupSeries {
  const dates = distinctBuckets(log, gran)
  const groups = groupsOf(members)
  const counts: Record<string, number[]> = {}
  for (const g of groups) {
    const gLog = log.filter((e) => e.group === g)
    counts[g] = dates.map((date) => uniqueNamesIn(gLog, date, gran).size)
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
// "지금 새가족팀이 챙길 사람"이라 떠난 사람을 빼고 표시가 해제된 사람도 1년은 데리고 있지만,
// **추이는 지나간 사실**이라 그때 등록한 사람은 그 주에 그대로 있어야 한다 (목록의 사정에 따라
// 사람이 들고 나면 지난주 숫자가 이번 주에 바뀐다).

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

// "2026-08-02"부터 "2026-08-30"까지처럼 두 주일 사이를 빠짐없이 잇는다 (양쪽 다 주일 날짜).
function weeksBetween(from: string, to: string): string[] {
  const DAY = 86_400_000
  const toUTC = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  const out: string[] = []
  for (let t = toUTC(from), end = toUTC(to); t <= end; t += 7 * DAY) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

export interface NewFamilyRegPoint {
  bucket: string // 주별이면 그 주를 여는 주일("2026-06-07"), 월별이면 그 달("2026-06")
  count: number // 그 칸에서 등록한 새가족 수
}

// 칸마다 등록한 새가족 수, 오래된 칸 → 최근 칸. **주별에서 주는 주일에서 열린다**
// (`worshipSunday`, 주일→토요일) — 새가족 카드의 '이번 주일 등록/지난주 등록'과 같은
// 자름이라, 수요일에 옮겨 적은 등록도 그 사람이 실제로 온 주일에 놓인다. 달로 묶으면
// "8월에 5명"까지만 보이고 그 다섯이 한 주일에 몰려 온 것인지 넉 주에 흩어져 온 것인지가
// 사라지지만, 반대로 여러 달에 걸친 흐름은 달 쪽이 한눈에 들어온다 — 그래서 둘 다 둔다.
//
// **한 명도 없던 칸도 0으로 채운다** — 건너뛰면 x축이 붙어 버려 "그때도 왔다"로 읽히고,
// 추이는 빈 칸이 보여야 추이다. `today`를 주면 축이 지금 칸까지 이어진다: 마지막 등록에서
// 축이 끝나 버리면 몇 주(달)째 아무도 안 온 것이 화면에서 사라진다. 등록일이 없는 새가족은
// 놓을 자리가 없어 빠진다 (숫자 타일의 `undated`가 그 사람들을 따로 센다).
export function newFamilyRegistrations(
  members: Member[],
  today?: string,
  gran: Granularity = 'week',
): NewFamilyRegPoint[] {
  // 등록일은 주일이 아닌 날일 수 있으므로(카드를 나중에 옮겨 적는다) 주별에서만 주일로
  // 끌어당긴다. 달로 묶을 때는 적힌 날짜의 달이 곧 그 칸이다.
  const keyOf = (date: string) => (gran === 'month' ? date.slice(0, 7) : worshipSunday(date))
  const byBucket = new Map<string, number>()
  for (const m of newFamilyMembers(members)) {
    if (!m.registration_date) continue
    const key = keyOf(m.registration_date)
    byBucket.set(key, (byBucket.get(key) ?? 0) + 1)
  }
  const keys = [...byBucket.keys()].sort()
  if (keys.length === 0) return []
  const last = keys[keys.length - 1]
  const now = today ? keyOf(today) : last
  const through = now > last ? now : last
  const span = gran === 'month' ? monthsBetween(keys[0], through) : weeksBetween(keys[0], through)
  return span.map((bucket) => ({ bucket, count: byBucket.get(bucket) ?? 0 }))
}

export interface NewFamilyTrendPoint {
  date: string // 칸의 열쇠 — 주일("2026-06-07") 또는 달("2026-06")
  count: number // 그 칸에 출석한 새가족 중 고른 교육 단계에 해당하는 사람
  newFamily: number // 그 칸에 출석한 새가족 전부 — 단계를 골랐을 때의 배경 선
  total: number // 그 칸의 전체 출석 인원
}

// 칸마다(주일 또는 달) 출석한 새가족 수. `edu`로 **새가족 교육 단계별로 갈라 볼 수 있다** (수강 완료 ·
// 1주차만 · 2주차만 · 미수강 — 새가족 교육 탭의 그 네 갈래와 같은 `matchesEduFilter`를 쓴다).
// 갈랐을 때도 새가족 전체(`newFamily`)와 그날 전체 출석(`total`)을 같이 들고 오는 이유는
// **한 갈래의 숫자만으로는 아무것도 알 수 없기** 때문이다 — 미수강 3명은 새가족이 4명일 때와
// 40명일 때가 다른 사실이고, 비중은 그날 전체 출석이 있어야 나온다.
//
// 주의: `new_member_edu_week1/2`는 **날짜 없는 참/거짓**이라, 갈래는 언제나 *지금* 상태다.
// 지난달에 아직 미수강이던 사람도 이번 주에 이수를 찍으면 그 달까지 '수강 완료'로 그려진다 —
// 교육을 마친 사람들이 어떻게 오고 있나를 보는 선이지, 그때 그 사람의 단계가 아니다.
export function newFamilyTrend(
  members: Member[],
  log: LogEntry[],
  edu: EduFilter = 'all',
  gran: Granularity = 'week',
): NewFamilyTrendPoint[] {
  const isNewFamily = newFamilyMatcher(members)
  const inCohort = newFamilyMatcher(members.filter((m) => matchesEduFilter(m, edu)))
  return distinctBuckets(log, gran).map((date) => {
    const onDate = log.filter((e) => bucketOf(e.date, gran) === date)
    const newFamily = onDate.filter(isNewFamily)
    return {
      date,
      // inCohort는 newFamilyMatcher로 만들었으므로 이미 새가족 안쪽이다 — 교육 칸이 비어 있는
      // 일반 멤버가 '미수강'으로 딸려 들어오지 않는다.
      count: new Set(onDate.filter(inCohort).map((e) => e.name)).size,
      newFamily: new Set(newFamily.map((e) => e.name)).size,
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
