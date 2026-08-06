import type { Member, LogEntry } from '../../lib/api'
import { hiddenFromKiosk } from '../../lib/status'

// The two 부서 (departments) shown as paired multi-column blocks in the kiosk grid;
// everything else falls into a separate "other" section below.
export const KIOSK_DEPTS = ['대학부', '청년부'] as const
export type KioskDept = (typeof KIOSK_DEPTS)[number]

// Members anyone-but-visitors: visitors/specials never appear as a tappable tile
// (they're guest-checked-in instead) and are excluded from the attendance count.
function isVisitor(m: { member_role?: string }): boolean {
  return (m.member_role || '') === 'visitor'
}

// Names already present today — used to render a member tile as green/"done".
// Keyed by name to match the kiosk's name-based tiles (members are name-unique here).
export function presentNamesToday(log: LogEntry[], today: string): Set<string> {
  return new Set(log.filter((e) => e.date === today).map((e) => e.name))
}

// Total people checked in today (members + 방문자) — the number shown in the kiosk
// header. Visitors count toward the day's head count just like members.
export function attendanceCount(log: LogEntry[], today: string): number {
  return new Set(log.filter((e) => e.date === today).map((e) => e.name)).size
}

// Client-side name filter for the kiosk search bar (case-insensitive, trimmed).
export function filterByName(members: Member[], query: string): Member[] {
  const q = query.trim().toLowerCase()
  return q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members
}

// Today's log entry backing a member's green tile — used to undo attendance when a
// checked-in tile is tapped again. Prefer the member-id match; fall back to a
// name-only match for rows without one (legacy/guest rows).
export function todayEntryFor(log: LogEntry[], today: string, m: Member): LogEntry | undefined {
  const rows = log.filter((e) => e.date === today)
  return rows.find((e) => e.memberId === m.id) ?? rows.find((e) => !e.memberId && e.name === m.name)
}

// Members marked 이주 / (한국) 귀국 / 방학 are hidden from the kiosk while a mark covers
// today (see lib/status.ts — a member can carry several marks). Other notes (e.g. 돌아옴)
// never hide anyone.
export function hiddenByStatus(m: Member, today: string): boolean {
  return hiddenFromKiosk(m, today)
}

// Columns per department block. Both 부서 side by side → each gets 4; 부서만 보기 hands the
// whole width to one 부서, so it gets 8 and twice as many names fit without scrolling.
export const KIOSK_COLS = 4
export const KIOSK_COLS_DEPT = 8

export interface KioskColumns {
  // One entry per department, in KIOSK_DEPTS order. `columns` is always length `cols`
  // (see kioskColumns); `total` is the department's member count for the header.
  depts: { key: KioskDept; total: number; columns: Member[][] }[]
  // Non-대학부/청년부 members, rendered in a flat section below the department grids.
  others: Member[]
}

// Split a list into `n` columns round-robin (item i → column i % n), so — given an
// already 가나다-sorted `list` — reading the grid left-to-right across a row, then down
// to the next row, follows alphabetical order. Balances column lengths as evenly as
// possible, earlier columns getting any remainder (e.g. n=4, list of 7 → [2,2,2,1]).
export function splitColumns<T>(list: T[], n: number): T[][] {
  const cols: T[][] = Array.from({ length: n }, () => [])
  list.forEach((item, i) => cols[i % n].push(item))
  return cols
}

const byName = (a: Member, b: Member) => a.name.localeCompare(b.name)

// Bucket non-visitor members into the department grids + the "other" overflow, each
// bucket explicitly sorted 가나다 순 (name.localeCompare) so the kiosk grid reads
// alphabetically regardless of the roster's incoming order.
export function kioskColumns(members: Member[], cols: number = KIOSK_COLS): KioskColumns {
  const visible = members.filter((m) => !isVisitor(m))
  const buckets: Record<KioskDept, Member[]> = { 대학부: [], 청년부: [] }
  const others: Member[] = []
  for (const m of visible) {
    if (m.group_name === '대학부' || m.group_name === '청년부') buckets[m.group_name].push(m)
    else others.push(m)
  }
  return {
    depts: KIOSK_DEPTS.map((key) => {
      const sorted = [...buckets[key]].sort(byName)
      return { key, total: sorted.length, columns: splitColumns(sorted, cols) }
    }),
    others: others.sort(byName),
  }
}
