import type { Member } from '../../lib/api'
import { genderOf, faithStageOf, FAITH_STAGES } from './eduDongsanTraits'
import { BAPTISM_OPTIONS, parseBaptism, formatBaptism, splitAffiliation, AFFILIATION_CATEGORIES, splitStay, STAY_OPTIONS } from './newFamilyCard'

// 멤버 탭의 **정렬** — 종이 등록 카드가 보기로 묻는 칸들(성별 · 소속 · 세례여부 · 신앙생활 ·
// 머물 기간)로 명단을 줄 세우고 묶는다. 부서 섹션은 그대로 두고 **그 안에서** 값마다 작은
// 묶음이 선다 (대학부 › 남 12 · 여 10 · 미기재 3). 묶음 머리줄에 인원이 붙으므로 "입교한
// 사람이 몇 명인가"가 이름을 세지 않고 읽힌다.
//
// 정렬을 고르면 그 칸의 값마다 칩이 하나씩 붙어 **그 값으로 좁힐 수도 있다** — 줄 세우는 것은
// 훑어보는 자리이고, 좁히는 것은 "세례 받은 사람만"을 보는 자리다. 둘이 같은 칸을 읽으므로
// 한 장치로 둔다.
//
// **새 칸은 없다.** 다섯 칸 모두 이미 있는 값을 읽기만 한다 — 보기와 순서는 종이 카드의 것
// (`newFamilyCard.ts`)이고, 손으로 적은 값을 읽는 규칙은 새가족 교육 동산 배정이 쓰는 그 함수
// (`eduDongsanTraits.ts`)다. 같은 사람이 탭마다 다른 칸에 서지 않게.

export type SortKey = '' | 'gender' | 'affiliation' | 'baptism' | 'faith' | 'stay'

// 고르는 차례 = 화면에 늘어놓는 차례. ''(이름순)이 기본이고 서버가 내려주는 순서 그대로다.
export const SORT_KEYS: Exclude<SortKey, ''>[] = ['gender', 'affiliation', 'baptism', 'faith', 'stay']

// 값이 비어 있는 사람의 묶음/칩. 빈 칸도 하나의 묶음이라야 묶음들의 인원을 더한 값이 그
// 부서 전체가 된다 (학교 칩의 '기타', 부서 칩의 '부서 미기재'와 같은 규칙). 카드에 적히는
// 값과 겹치지 않도록 밑줄로 감싼 자리표를 쓴다 — 장년부 세례여부는 자유 기입이다.
export const NO_VALUE = '__none__'
// 무언가 적혀 있는데 보기로 읽어낼 수 없는 값 ('27' · 'No' 같은 신앙기간, 'Other' 소속).
// 지어내지 않고 '기타' 한 묶음에 모은다 — 원문은 카드에 그대로 남아 있다(NewFamilyFacts).
export const OTHER_VALUE = '__other__'

// 사람 하나가 그 칸에서 받는 **묶음 하나**. 세례여부는 여러 개를 고를 수 있는 칸이라
// 고른 조합 그대로가 묶음이다 ('유아세례, 입교') — 카드에 적힌 말을 다듬지 않는다.
export function sortBlockOf(m: Member, key: SortKey): string {
  switch (key) {
    case 'gender': {
      const raw = (m.gender || '').trim()
      if (!raw) return NO_VALUE
      return genderOf(m) || OTHER_VALUE
    }
    case 'affiliation': {
      const { category } = splitAffiliation(m.school_or_work || '')
      if (!category) return NO_VALUE
      // 'Other'는 카드의 '기타' 네모이거나 앞머리 없이 학교만 적힌 칸이다 — 어느 쪽이든
      // 대학생/대학원생/직장인 중 어디인지 말해 주지 않는다.
      return category === 'Other' ? OTHER_VALUE : category
    }
    case 'baptism': {
      const list = parseBaptism(m.baptism_status)
      return list.length ? formatBaptism(list) : NO_VALUE
    }
    case 'faith': {
      if (!(m.faith_duration || '').trim()) return NO_VALUE
      const stage = faithStageOf(m)
      return stage >= 0 ? FAITH_STAGES[stage] : OTHER_VALUE
    }
    case 'stay': {
      const { option } = splitStay(m.stay_duration)
      return option || NO_VALUE
    }
    default:
      return ''
  }
}

// 사람 하나가 걸리는 **칩들**. 세례여부만 여럿일 수 있다 — '입교' 칩은 '유아세례, 입교'로
// 적힌 사람도 데려와야 "입교한 사람"이 된다. 나머지 칸은 묶음과 칩이 같다.
export function sortValuesOf(m: Member, key: SortKey): string[] {
  if (key === 'baptism') {
    const list = parseBaptism(m.baptism_status)
    return list.length ? list : [NO_VALUE]
  }
  return [sortBlockOf(m, key)]
}

export function matchesSortValue(m: Member, key: SortKey, value: string): boolean {
  if (!key || !value) return true
  return sortValuesOf(m, key).includes(value)
}

// 그 칸의 보기 순서 (종이 카드에 인쇄된 순서). 신앙생활만은 카드 순서가 아니라 **짧은 쪽부터**
// 다 — 줄을 세우는 자리라 순서에 뜻이 있어야 한다 (모태신앙이 가장 길다).
function knownOrder(key: SortKey): readonly string[] {
  switch (key) {
    case 'gender':
      return ['남', '여']
    case 'affiliation':
      return AFFILIATION_CATEGORIES.filter((c) => c !== 'Other')
    case 'baptism':
      return BAPTISM_OPTIONS
    case 'faith':
      return FAITH_STAGES
    case 'stay':
      return STAY_OPTIONS
    default:
      return []
  }
}

const collator = new Intl.Collator('ko')

// 칩으로 내걸 값들 — 명단에 실제로 있는 것만, 보기 순서대로. 보기 밖의 값(장년부의 '집사'
// 같은 자유 기입)은 그 뒤에 **많은 것부터** 서고, 기타 · 미기재가 맨 끝이다.
export function sortChipsOf(members: Member[], key: SortKey): string[] {
  if (!key) return []
  const counts = new Map<string, number>()
  for (const m of members) for (const v of sortValuesOf(m, key)) counts.set(v, (counts.get(v) || 0) + 1)
  return rankValues([...counts.keys()], key, counts)
}

function rankValues(values: string[], key: SortKey, counts: Map<string, number>): string[] {
  const known = knownOrder(key)
  const head = known.filter((v) => values.includes(v))
  const extra = values
    .filter((v) => !known.includes(v) && v !== OTHER_VALUE && v !== NO_VALUE)
    .sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || collator.compare(a, b))
  const tail = [OTHER_VALUE, NO_VALUE].filter((v) => values.includes(v))
  return [...head, ...extra, ...tail]
}

export interface SortBlock {
  value: string // 묶음의 열쇠 (NO_VALUE / OTHER_VALUE 포함)
  list: Member[]
}

// 명단을 묶음으로 가른다 — 묶음 안의 차례는 들어온 그대로(이름순)라, 같은 값끼리는 늘 같은
// 자리에 선다. 세례여부의 조합 묶음은 **고른 보기들의 순서로** 선다: 유아세례 → 유아세례,
// 입교 → 유아세례, 세례 → 입교 → 입교, 세례 → 세례 → 해당없음.
export function sortBlocks(members: Member[], key: SortKey): SortBlock[] {
  if (!key) return [{ value: '', list: members }]
  const byValue = new Map<string, Member[]>()
  for (const m of members) {
    const v = sortBlockOf(m, key)
    const list = byValue.get(v)
    if (list) list.push(m)
    else byValue.set(v, [m])
  }
  const values = [...byValue.keys()]
  if (key !== 'baptism') {
    const counts = new Map(values.map((v) => [v, byValue.get(v)!.length]))
    return rankValues(values, key, counts).map((value) => ({ value, list: byValue.get(value)! }))
  }
  // 세례여부: 보기 하나하나의 자리를 칩 순서에서 받아 조합을 사전식으로 세운다.
  const chipRank = new Map(sortChipsOf(members, key).map((v, i) => [v, i]))
  const ranks = (block: string) =>
    block === NO_VALUE ? [Number.MAX_SAFE_INTEGER] : parseBaptism(block).map((v) => chipRank.get(v) ?? Number.MAX_SAFE_INTEGER - 1)
  const cmp = (a: string, b: string) => {
    const ra = ranks(a)
    const rb = ranks(b)
    for (let i = 0; i < Math.min(ra.length, rb.length); i++) if (ra[i] !== rb[i]) return ra[i] - rb[i]
    return ra.length - rb.length || collator.compare(a, b)
  }
  return values.sort(cmp).map((value) => ({ value, list: byValue.get(value)! }))
}

// 고를 수 있는 정렬 — 그 칸을 **읽어낼 수 있는 사람이 한 명이라도 있는** 칸만. 장년부처럼
// 신앙생활 · 머물 기간을 묻지 않는 부에서는 그 보기가 뜨지 않는다 (모두 '미기재' 한 묶음이라
// 아무것도 갈라 주지 않는다 — 칩 줄의 "고를 것이 없으면 줄이 없다"와 같은 규칙).
export function sortKeysFor(members: Member[]): Exclude<SortKey, ''>[] {
  return SORT_KEYS.filter((key) => members.some((m) => {
    const v = sortBlockOf(m, key)
    return v !== NO_VALUE && v !== OTHER_VALUE
  }))
}
