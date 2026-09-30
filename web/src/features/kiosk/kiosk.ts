import type { Member, LogEntry } from '../../lib/api'
import { groupsOfPartition, type Partition } from '../../lib/partition'
import { hiddenFromKiosk } from '../../lib/status'

// The 부서 (departments) shown as multi-column blocks in the kiosk grid; everything else
// falls into a separate "other" section below. 대학·청년부 has two (side by side);
// 장년부 has one, which then gets the whole width.
export const KIOSK_DEPTS = ['대학부', '청년부'] as const
export type KioskDept = string

// The blocks this 부's kiosk draws, in order.
export function kioskDepts(partition: Partition = 'youth'): string[] {
  return groupsOfPartition(partition)
}

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

export interface KioskBlocks {
  // One entry per department, in this 부's kioskDepts() order, each list 가나다 순.
  // `total` is the department's member count for the header.
  depts: { key: KioskDept; total: number; members: Member[] }[]
  // Members outside this 부's departments, in a flat section below the department grids.
  others: Member[]
}

// 가나다 순은 기기의 언어 설정을 따르지 않는다 — 영어로 설정된 태블릿에서는 기본 정렬이
// 영문 이름을 한글보다 앞에 세우므로, 같은 명단이 기기마다 다른 순서로 나온다. 'ko'로
// 고정하면 어디서든 한글 이름이 가나다 순으로 먼저, 영문 이름이 그 뒤에 온다.
const koreanOrder = new Intl.Collator('ko')
const byName = (a: Member, b: Member) => koreanOrder.compare(a.name, b.name)

// Bucket non-visitor members into the department blocks + the "other" overflow, each
// bucket sorted 가나다 순 regardless of the roster's incoming order.
//
// 목록을 열로 미리 나누지 않는다. 예전에는 4열(부서만 보기는 8열)로 round-robin 나눠 두고
// 열마다 세로로 쌓았는데, 그 순서는 **화면의 열 수가 나눈 수와 같을 때만** 가나다였다 —
// 폰 세로 화면처럼 격자가 2열로 접히면 첫 줄이 1·2번째, 둘째 줄이 5·6번째 이름이 되어
// 3·4번째는 한참 아래로 밀려났다. 이제 격자 한 칸이 이름 하나이고 줄 단위로 채워지므로
// (CSS grid의 기본 흐름) 열이 몇 개든 왼쪽→오른쪽, 위→아래로 읽는 순서가 곧 가나다다.
export function kioskBlocks(members: Member[], partition: Partition = 'youth'): KioskBlocks {
  const depts = kioskDepts(partition)
  const visible = members.filter((m) => !isVisitor(m))
  const buckets: Record<string, Member[]> = {}
  for (const d of depts) buckets[d] = []
  const others: Member[] = []
  for (const m of visible) {
    if (buckets[m.group_name]) buckets[m.group_name].push(m)
    else others.push(m)
  }
  return {
    depts: depts.map((key) => {
      const sorted = [...buckets[key]].sort(byName)
      return { key, total: sorted.length, members: sorted }
    }),
    others: others.sort(byName),
  }
}
