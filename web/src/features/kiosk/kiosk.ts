import type { Member, LogEntry } from '../../lib/api'

// The two 부서 (departments) shown as paired 3-column blocks in the kiosk grid;
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

export interface KioskColumns {
  // One entry per department, in KIOSK_DEPTS order. `thirds` is always length 3
  // (the three columns); `total` is the department's member count for the header.
  depts: { key: KioskDept; total: number; thirds: Member[][] }[]
  // Non-대학부/청년부 members, rendered in a flat section below the 6-column grid.
  others: Member[]
}

// Split a department's members into three vertical columns the way the legacy kiosk
// does: first column ceil(n/3), then ceil(remaining/2), then the rest. This keeps the
// columns balanced and left-heavy for any n (e.g. n=7 → [3,2,2], n=4 → [2,1,1]).
export function splitThirds<T>(list: T[]): [T[], T[], T[]] {
  const t1 = Math.ceil(list.length / 3)
  const t2 = Math.ceil((list.length - t1) / 2)
  return [list.slice(0, t1), list.slice(t1, t1 + t2), list.slice(t1 + t2)]
}

// Bucket non-visitor members into the 6-column dept layout + the "other" overflow.
// Members keep their incoming order within each bucket (the roster is pre-sorted).
export function kioskColumns(members: Member[]): KioskColumns {
  const visible = members.filter((m) => !isVisitor(m))
  const buckets: Record<KioskDept, Member[]> = { 대학부: [], 청년부: [] }
  const others: Member[] = []
  for (const m of visible) {
    if (m.group_name === '대학부' || m.group_name === '청년부') buckets[m.group_name].push(m)
    else others.push(m)
  }
  return {
    depts: KIOSK_DEPTS.map((key) => ({
      key,
      total: buckets[key].length,
      thirds: splitThirds(buckets[key]),
    })),
    others,
  }
}
