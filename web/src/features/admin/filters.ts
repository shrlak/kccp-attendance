import type { Member, LogEntry } from '../../lib/api'
import { ADULT_GROUP } from '../../lib/partition'
import { careerOf, schoolOf, SCHOOL_ORDER, type School } from './eduDongsanTraits'

// 학교로 좁히는 칸 — **명단을 그 자리에서 갈라 보는 두 탭이 쓴다**: 멤버 탭과 새가족 탭
// (`TraitFilter`가 두 탭에 같은 줄을 그린다). 대학·청년부는 CMU · Pitt · Duquesne이 섞여
// 있고 그 값은 이미 `members.school_or_work`에 적혀 있다 (`schoolOf`가 읽는다).
// '' = 전체, 'none' = 그 칸에서 학교를 읽어낼 수 없는 사람(= 화면의 '기타') — 빈 묶음도
// 하나의 칩이라야 칩들의 인원을 더한 값이 전체가 된다 (안 그러면 사라진 사람을 찾게 된다).
//
// 부서·동산 필터(Filter)에는 넣지 않는다: 출석부·오늘이 세는 것은 그 주일에 누가 왔는가이고
// 학교는 그 질문의 칸이 아니다 (출석 줄에는 학교가 없다). 통계 탭은 좁히는 대신 **세는
// 쪽**으로 학교를 읽는다 — `analytics.ts` schoolSummary의 학교별 요약 표.
export type SchoolChip = Exclude<School, ''> | 'none'
export type SchoolFilter = '' | SchoolChip

// 처지로 좁히는 칸 — 청년부에서만 쓴다 (아래 `careerAxis`). 'other'는 대학원생도 직장인도
// 아닌 사람 (그 칸이 비었거나 '기타'로 적힌 사람) — 학교 칩의 빈 묶음과 같은 이유로 하나의
// 칩이라야 칩들의 인원을 더한 값이 전체가 된다.
export type CareerChip = 'grad' | 'work' | 'other'
export type CareerFilter = '' | CareerChip
const CAREER_ORDER = ['grad', 'work', 'other'] as const

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

// 멤버 탭의 부서 칩 — '' = 전체, NO_GROUP = 부서가 비어 있는 사람. 학교 칩과 같은 규칙으로
// 빈 칸도 하나의 묶음이라야 칩들의 인원을 더한 값이 전체가 된다 (안 그러면 부서 없는 사람이
// 어느 칩에서도 안 보인다). 부서 이름은 한글이라 이 자리표와 겹치지 않는다.
export const NO_GROUP = 'none'

// 칩으로 내걸 부서 — 명단에 실제로 있는 것만, 부서 없는 사람이 있을 때만 자리표를 뒤에 붙인다.
// 고를 것이 하나뿐인 부(장년부)에서는 길이가 1이 되어 칩 줄 자체가 뜨지 않는다.
export function groupChipsOf(members: Member[]): string[] {
  const chips = groupsOf(members)
  return members.some((m) => !m.group_name) ? [...chips, NO_GROUP] : chips
}

export function matchesGroup(m: Pick<Member, 'group_name'>, group: string): boolean {
  if (!group) return true
  if (group === NO_GROUP) return !m.group_name
  return m.group_name === group
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
  return [...SCHOOL_ORDER, 'none' as const].filter((s) => seen.has(s))
}

export function matchesSchool(m: Pick<Member, 'school_or_work'>, school: SchoolFilter): boolean {
  if (!school) return true
  return (schoolOf(m) || 'none') === school
}

// 대학원생/직장인 — `careerOf`가 읽는 값 중 이 화면이 가르는 것은 둘뿐이고, 나머지(대학생 ·
// 모름)는 '기타'로 모인다. 청년부에 대학생이 적혀 있는 일이 있는데 그 사람도 어느 칩에는
// 있어야 하기 때문이다.
export function careerChipOf(m: Pick<Member, 'school_or_work'>): CareerChip {
  const c = careerOf(m)
  return c === 'grad' || c === 'work' ? c : 'other'
}

export function careersOf(members: Member[]): CareerChip[] {
  const seen = new Set(members.map(careerChipOf))
  return CAREER_ORDER.filter((c) => seen.has(c))
}

export function matchesCareer(m: Pick<Member, 'school_or_work'>, career: CareerFilter): boolean {
  if (!career) return true
  return careerChipOf(m) === career
}

// **부서마다 명단을 가르는 축이 다르다** — 멤버 탭·새가족 탭의 칩 줄이 그 축을 따른다:
//   대학부 · 그 밖 — 학교로 (CMU · Pitt · Duquesne · 기타). 다 학부생이라 학교가 곧 자리다.
//   청년부 — 처지로 (대학원생 · 직장인 · 기타), 그리고 **대학원생만** 다시 학교로. 직장인에게
//     학교는 지금 어디에 있는지를 말해 주지 않으므로 그 줄을 내걸면 고를 뜻이 없다.
export function careerAxis(group: string): boolean {
  return group === '청년부'
}

export function schoolAxis(group: string, career: CareerFilter): boolean {
  return careerAxis(group) ? career === 'grad' : true
}

export function filterMembers(members: Member[], f: Filter): Member[] {
  return members.filter((m) => (!f.group || m.group_name === f.group) && (!f.subgroup || m.subgroup === f.subgroup))
}

export function filterLog(log: LogEntry[], f: Filter): LogEntry[] {
  return log.filter((e) => (!f.group || e.group === f.group) && (!f.subgroup || e.subgroup === f.subgroup))
}
