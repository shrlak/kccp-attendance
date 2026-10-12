import type { Member } from '../../lib/api'
import { groupChipsOf, subgroupSectionsOf, countSubgroups, careersOf, schoolsOf } from './filters'
import { sortKeysFor, CARD_KEYS, INFO_KEYS, type SortKey } from './memberSort'

// 멤버 탭에서 **어느 필터를 위에 내걸지 고른다** (`MemberFilterPicker`). 칩 줄이 가를 수 있는
// 축은 아홉이다 — 명단의 자리(부서 · 동산 · 학생/직장 · 학교)와 종이 등록 카드의 보기(성별 ·
// 소속 · 세례여부 · 신앙생활 · 머물 기간). 아홉을 다 늘어놓으면 폰에서 칩 줄이 화면을 덮고,
// 정작 이번에 가르고 싶은 한두 줄을 찾으려고 나머지를 지나가야 한다. 그래서 **고른 필터만**
// 칩 줄에 서고, 그 줄에는 그 필터의 보기만 나온다.
//
// 카드 밖의 **그 밖의 정보**(새가족 · 새가족 교육 · 출생연도 · 등록 연도 · 목사님 심방 · 연락처)도
// 같은 자리에서 고른다 — 카드의 보기와 똑같이 서로 곱해지는 독립된 축이다 (memberSort.ts).
// 줄마다 칩은 **여러 개를 함께** 고를 수 있다 (filters.ts `pickChip`).
//
// 고른 것은 **이 기기에 남는다** (localStorage) — 사람마다 늘 보는 축이 정해져 있어서 (새가족
// 팀은 세례여부, 동산 편성하는 사람은 동산) 탭을 열 때마다 다시 고르게 하면 이 장치가 짐이
// 된다. 기기에만 남는 편의라 저장이 막힌 브라우저에서도 기본값으로 그대로 돈다.

// 카드의 보기와 그 밖의 정보 — 둘 다 정렬로도 고를 수 있는 칸이고(SortKey), 칩 줄에서는 같은
// 규칙(서로 곱해지는 독립된 축)으로 선다. 이름은 예전 그대로 CardDim이다.
export type CardDim = Exclude<SortKey, ''>
export type FilterDim = 'group' | 'subgroup' | 'career' | 'school' | CardDim

// 칩 줄에 서는 차례 = 고르는 창에 늘어놓는 차례. 명단의 자리가 위(좁혀 가는 사슬), 카드의
// 보기와 그 밖의 정보가 아래(서로 곱해지는 독립된 축)다.
export const ROSTER_DIMS = ['group', 'subgroup', 'career', 'school'] as const satisfies readonly FilterDim[]
export const CARD_ONLY_DIMS: readonly CardDim[] = CARD_KEYS
export const INFO_DIMS: readonly CardDim[] = INFO_KEYS
export const CARD_DIMS: readonly CardDim[] = [...CARD_ONLY_DIMS, ...INFO_DIMS]
export const FILTER_DIMS: readonly FilterDim[] = [...ROSTER_DIMS, ...CARD_DIMS]

// 처음 여는 사람에게는 **이 장치가 생기기 전의 칩 줄 그대로**를 보여준다 — 부서 · 동산 ·
// 학생/직장 · 학교. 카드의 보기는 원하는 사람이 켠다.
export const DEFAULT_FILTER_DIMS: readonly FilterDim[] = ROSTER_DIMS

const KEY = 'kccp-member-filters'

const isDim = (v: unknown): v is FilterDim => typeof v === 'string' && (FILTER_DIMS as readonly string[]).includes(v)

// 저장된 선택. 없거나 읽을 수 없으면 기본값 — 모두 끈 것('[]')은 그대로 존중한다 (칩 줄 없이
// 이름 검색만 쓰는 사람도 있다).
export function readFilterDims(): FilterDim[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw == null) return [...DEFAULT_FILTER_DIMS]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_FILTER_DIMS]
    return FILTER_DIMS.filter((d) => parsed.some((p) => isDim(p) && p === d))
  } catch {
    return [...DEFAULT_FILTER_DIMS]
  }
}

export function writeFilterDims(dims: readonly FilterDim[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(FILTER_DIMS.filter((d) => dims.includes(d))))
  } catch {
    /* 저장이 막힌 브라우저 — 이번 화면에서만 산다 */
  }
}

// 켜고 끄기. 차례는 언제나 FILTER_DIMS의 것이다 (켠 순서가 칩 줄의 순서를 바꾸지 않는다 —
// 자리가 움직이면 매번 찾게 된다).
export function toggleDim(dims: readonly FilterDim[], dim: FilterDim): FilterDim[] {
  const on = dims.includes(dim)
  return FILTER_DIMS.filter((d) => (d === dim ? !on : dims.includes(d)))
}

// 이 명단에서 **고를 것이 있는** 필터만 고르는 창에 낸다 — 칩 줄의 "고를 것이 없으면 줄이
// 없다"와 같은 규칙이다. 장년부에는 부서도 학교도 하나뿐이라 그 둘이 빠지고, 카드의 보기는
// 그 칸을 읽어낼 수 있는 사람이 있는 것만 남는다 (`sortKeysFor`).
export function availableFilterDims(members: Member[]): FilterDim[] {
  const out = new Set<FilterDim>()
  if (groupChipsOf(members).length > 1) out.add('group')
  const unassigned = members.some((m) => !m.subgroup) ? 1 : 0
  if (countSubgroups(subgroupSectionsOf(members, '')) + unassigned > 1) out.add('subgroup')
  // 학생/직장은 청년부의 가름이다 (`careerAxis`) — 청년부 사람들 사이에서 갈릴 때만.
  if (careersOf(members.filter((m) => m.group_name === '청년부')).length > 1) out.add('career')
  const schools = schoolsOf(members)
  if (schools.length > 1 && schools.some((s) => s !== 'none')) out.add('school')
  for (const k of sortKeysFor(members)) out.add(k)
  return FILTER_DIMS.filter((d) => out.has(d))
}

export function isCardDim(dim: FilterDim): dim is CardDim {
  return (CARD_DIMS as readonly string[]).includes(dim)
}
