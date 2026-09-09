import type { Member, LogEntry } from '../../lib/api'
import { ADULT_GROUP } from '../../lib/partition'
import { schoolOf } from './eduDongsanTraits'

// 학교로 좁히는 칸 — **멤버 탭에서만 쓴다** (AdminMembers). 대학·청년부는 CMU와 Pitt이
// 섞여 있고 그 값은 이미 `members.school_or_work`에 적혀 있다 (`schoolOf`가 읽는다).
// '' = 전체, 'none' = 그 칸에서 학교를 읽어낼 수 없는 사람 — 빈 칸도 하나의 묶음이라야
// 세 칩의 인원을 더한 값이 전체가 된다 (안 그러면 사라진 사람을 찾게 된다).
//
// 부서·동산 필터(Filter)에는 넣지 않는다: 출석부·통계·오늘이 세는 것은 그 주일에 누가
// 왔는가이고 학교는 그 질문의 칸이 아니다. 명단을 학교로 갈라 보는 자리는 멤버 탭 하나다.
export type SchoolChip = 'cmu' | 'pitt' | 'none'
export type SchoolFilter = '' | SchoolChip

// group ('') = all groups; subgroup ('') = all 동산 within the chosen group.
export interface Filter {
  group: string
  subgroup: string
}

export const NO_FILTER: Filter = { group: '', subgroup: '' }

// Preferred department order; anything else falls to the end, alphabetically. Both 부's
// 부서 are listed — a roster only ever contains one 부's people (the server scopes it), so
// this is just a stable ordering, not a claim that they appear together.
const GROUP_ORDER = ['대학부', '청년부', ADULT_GROUP, 'EM', 'Adult Ministry']
const groupRank = (g: string) => {
  const i = GROUP_ORDER.indexOf(g)
  return i === -1 ? GROUP_ORDER.length : i
}

// Distinct, non-empty groups present among the members, in the preferred order.
export function groupsOf(members: Member[]): string[] {
  const set = new Set(members.map((m) => m.group_name).filter(Boolean))
  return [...set].sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b))
}

// Distinct, non-empty 동산 for a group (or across all groups when group is ''), sorted.
export function subgroupsOf(members: Member[], group: string): string[] {
  const set = new Set(
    members.filter((m) => !group || m.group_name === group).map((m) => m.subgroup).filter(Boolean),
  )
  return [...set].sort((a, b) => a.localeCompare(b))
}

// 학교 칩이 실제로 나올 자리가 있는가 — 그 명단에 있는 묶음만 순서대로 (CMU → Pitt →
// 학교 미기재). 장년부에는 CMU도 Pitt도 없으므로 빈 목록이 되고 칩 줄 자체가 사라진다.
export function schoolsOf(members: Member[]): SchoolChip[] {
  const seen = new Set<SchoolChip>(members.map((m) => schoolOf(m) || 'none'))
  return (['cmu', 'pitt', 'none'] as const).filter((s) => seen.has(s))
}

export function matchesSchool(m: Pick<Member, 'school_or_work'>, school: SchoolFilter): boolean {
  if (!school) return true
  return (schoolOf(m) || 'none') === school
}

export function filterMembers(members: Member[], f: Filter): Member[] {
  return members.filter((m) => (!f.group || m.group_name === f.group) && (!f.subgroup || m.subgroup === f.subgroup))
}

export function filterLog(log: LogEntry[], f: Filter): LogEntry[] {
  return log.filter((e) => (!f.group || e.group === f.group) && (!f.subgroup || e.subgroup === f.subgroup))
}
