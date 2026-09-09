import type { Member, LogEntry } from '../../lib/api'
import { ADULT_GROUP } from '../../lib/partition'
import { schoolOf } from './eduDongsanTraits'

// 학교로 좁히는 칸. 대학·청년부는 CMU와 Pitt이 섞여 있어 "우리 학교 사람만" 이 한 번에
// 안 보이는데, 그 값은 이미 `members.school_or_work`에 적혀 있다 (`schoolOf`가 읽는다).
// '' = 전체, 'none' = 그 칸에서 학교를 읽어낼 수 없는 사람 — 빈 칸도 하나의 묶음이라야
// 세 칩의 인원을 더한 값이 전체가 된다 (안 그러면 사라진 사람을 찾게 된다).
export type SchoolFilter = '' | 'cmu' | 'pitt' | 'none'

// group ('') = all groups; subgroup ('') = all 동산 within the chosen group;
// school ('') = every school. 학교는 부서·동산과 곱해진다 (대학부 × CMU).
export interface Filter {
  group: string
  subgroup: string
  school?: SchoolFilter
}

export const NO_FILTER: Filter = { group: '', subgroup: '', school: '' }

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
export function schoolsOf(members: Member[]): SchoolFilter[] {
  const seen = new Set<SchoolFilter>(members.map((m) => schoolOf(m) || 'none'))
  return (['cmu', 'pitt', 'none'] as const).filter((s) => seen.has(s))
}

export function matchesSchool(m: Pick<Member, 'school_or_work'>, school: SchoolFilter): boolean {
  if (!school) return true
  return (schoolOf(m) || 'none') === school
}

export function filterMembers(members: Member[], f: Filter): Member[] {
  return members.filter(
    (m) =>
      (!f.group || m.group_name === f.group) &&
      (!f.subgroup || m.subgroup === f.subgroup) &&
      matchesSchool(m, f.school ?? ''),
  )
}

// 출석 줄에는 학교가 적혀 있지 않다 (그건 사람의 칸이다) — 그래서 학교로 좁힐 때만 명단을
// 받아 그 줄이 누구의 것인지 되짚는다. **열쇠는 memberId**고(동명이인이 갈린다), 그것이 없는
// 옛 줄만 이름으로 찾는다 — 통계 탭이 새가족 줄을 되짚는 방법과 같다. 멤버로 이어지지 않는
// 줄(손님)은 학교를 물을 상대가 없으므로 학교 칩이 켜져 있는 동안에는 빠진다.
export function filterLog(log: LogEntry[], f: Filter, members: Member[] = []): LogEntry[] {
  const byGroup = log.filter((e) => (!f.group || e.group === f.group) && (!f.subgroup || e.subgroup === f.subgroup))
  const school = f.school ?? ''
  if (!school) return byGroup
  const inSchool = members.filter((m) => matchesSchool(m, school))
  const ids = new Set(inSchool.map((m) => m.id))
  const names = new Set(inSchool.map((m) => m.name))
  return byGroup.filter((e) => (e.memberId ? ids.has(e.memberId) : names.has(e.name)))
}
