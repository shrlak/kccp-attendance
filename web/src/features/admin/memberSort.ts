import type { TFunction } from 'i18next'
import type { Member } from '../../lib/api'
import { partitionOfGroup } from '../../lib/partition'
import { genderOf, faithStageOf, FAITH_STAGES } from './eduDongsanTraits'
import { BAPTISM_OPTIONS, parseBaptism, formatBaptism, splitAffiliation, AFFILIATION_CATEGORIES, splitStay, STAY_OPTIONS } from './newFamilyCard'
import { eduStage } from './eduSchedule'

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
//
// 카드 밖의 **그 밖의 정보**도 같은 장치로 줄 세우고 가른다 (`INFO_KEYS`): 새가족 · 새가족
// 교육 · 출생연도 · 등록 연도 · 목사님 심방 · 연락처. 이것도 새 칸이 아니라 이미 있는 칸을
// 읽는다 — 새가족은 `is_new_member`, 교육은 새가족 교육 탭의 `eduStage`, 연락처는 전화와 카톡
// 아이디가 적혀 있는가. 역할(`member_role`)은 넣지 않았다: 권한은 member_roles에 따로 살고
// 그 칸은 거의 비어 있어서(운영 명단 187명 중 1명) 가를 것이 없다.

export type CardKey = 'gender' | 'affiliation' | 'baptism' | 'faith' | 'stay'
export type InfoKey = 'newMember' | 'edu' | 'birthYear' | 'regYear' | 'pastoral' | 'contact'
export type SortKey = '' | CardKey | InfoKey

// 고르는 차례 = 화면에 늘어놓는 차례. ''(이름순)이 기본이고 서버가 내려주는 순서 그대로다.
export const CARD_KEYS: CardKey[] = ['gender', 'affiliation', 'baptism', 'faith', 'stay']
export const INFO_KEYS: InfoKey[] = ['newMember', 'edu', 'birthYear', 'regYear', 'pastoral', 'contact']
export const SORT_KEYS: Exclude<SortKey, ''>[] = [...CARD_KEYS, ...INFO_KEYS]

// 'YYYY-…'의 해. 형식이 아니거나 말이 안 되는 해는 모름이다 (지어내지 않는다).
function yearOf(date: string | null | undefined): number | null {
  const m = /^(\d{4})-/.exec((date || '').trim())
  if (!m) return null
  const y = Number(m[1])
  return y >= 1900 && y <= 2100 ? y : null
}

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
    case 'newMember':
      return m.is_new_member ? 'yes' : 'no'
    case 'edu': {
      // 새가족 교육은 대학·청년부의 두 주 과정이다 — 장년부 사람은 모두 '해당 없음'이라 이 칸이
      // 아예 뜨지 않는다 (sortKeysFor: 값이 하나뿐). 대학·청년부에서도 단계는 새가족 안에서만
      // 뜻이 있다: 교육 칸이 비어 있는 일반 멤버가 '미수강'으로 딸려 들어오면 안 된다. 다만 표시가
      // 내려간 뒤에도 이수 기록은 사실이라, 한 주라도 들은 사람은 그 단계에 선다.
      if (partitionOfGroup(m.group_name) === 'adult') return 'na'
      if (!m.is_new_member && !m.new_member_edu_week1 && !m.new_member_edu_week2) return 'na'
      return eduStage(m)
    }
    case 'birthYear': {
      // 대학·청년부는 해마다(2001년생), 장년부는 십 년마다(1960년대생) — 장년부는 태어난 해가
      // 60년에 걸쳐 있어서 해마다 칩을 세우면 한 줄이 칩 예순 개가 된다. 갈래는 그 사람의
      // 부서에서 정해지므로 명단이 바뀌어도 한 사람의 값은 그대로다.
      const y = yearOf(m.birth_date)
      if (y == null) return NO_VALUE
      return partitionOfGroup(m.group_name) === 'adult' ? `${Math.floor(y / 10) * 10}s` : String(y)
    }
    case 'regYear': {
      const y = yearOf(m.registration_date)
      return y == null ? NO_VALUE : String(y)
    }
    case 'pastoral':
      return m.pastoral_visit_requested ? 'yes' : 'no'
    case 'contact': {
      // 전화는 휴대폰이든 집 전화(장년부 카드)든 — 연락이 닿는가를 묻는 칸이다.
      const phone = !!((m.phone || '').trim() || (m.phone_home || '').trim())
      const kakao = !!(m.kakao_id || '').trim()
      return phone && kakao ? 'both' : phone ? 'phone' : kakao ? 'kakao' : 'none'
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

// 고른 값 중 **하나에라도** 맞으면 남는다 (한 줄 안에서는 '또는' — 입교 또는 세례). 고른 것이
// 없으면 전체.
export function matchesSortValues(m: Member, key: SortKey, values: readonly string[]): boolean {
  if (!key || values.length === 0) return true
  const mine = sortValuesOf(m, key)
  return values.some((v) => mine.includes(v))
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
    case 'newMember':
    case 'pastoral':
      return ['yes', 'no']
    case 'edu':
      // 새가족 교육 탭의 칩과 같은 차례 (수강 완료 · 1주차만 · 2주차만 · 미수강), 해당 없음이 끝.
      return ['both', 'week1', 'week2', 'none', 'na']
    case 'contact':
      return ['both', 'phone', 'kakao', 'none']
    default:
      return []
  }
}

// 해(출생연도 · 등록 연도)는 보기가 정해져 있지 않다 — 많은 것부터가 아니라 **이른 해부터**
// 선다 (줄을 세우는 자리라 순서에 뜻이 있어야 한다).
const CHRONOLOGICAL: readonly SortKey[] = ['birthYear', 'regYear']

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
    .sort((a, b) =>
      CHRONOLOGICAL.includes(key)
        ? parseInt(a, 10) - parseInt(b, 10)
        : (counts.get(b) || 0) - (counts.get(a) || 0) || collator.compare(a, b),
    )
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

// 고를 수 있는 정렬 — 그 칸을 **읽어낼 수 있는 사람이 한 명이라도 있고, 값이 둘 이상으로
// 갈리는** 칸만. 장년부처럼 신앙생활 · 머물 기간을 묻지 않는 부에서는 그 보기가 뜨지 않는다
// (모두 '미기재' 한 묶음이라 아무것도 갈라 주지 않는다 — 칩 줄의 "고를 것이 없으면 줄이
// 없다"와 같은 규칙). 새가족 교육이 장년부에서, 목사님 심방이 아무도 요청하지 않은 명단에서
// 빠지는 것도 같은 규칙이다 (모두 한 값이다).
export function sortKeysFor(members: Member[]): Exclude<SortKey, ''>[] {
  return SORT_KEYS.filter((key) => {
    const seen = new Set<string>()
    let readable = false
    for (const m of members) {
      for (const v of sortValuesOf(m, key)) {
        seen.add(v)
        if (v !== NO_VALUE && v !== OTHER_VALUE) readable = true
      }
    }
    return readable && seen.size > 1
  })
}

// 칩 · 묶음 머리줄에 적는 말. 카드의 보기는 저장된 말이 곧 보기라 그대로 적고(남 · 입교 ·
// 1년 미만), 그 밖의 정보는 값이 열쇠라(yes · both · 2001) 언어를 따르는 말로 옮긴다.
export function sortValueLabel(t: TFunction, key: SortKey, v: string): string {
  if (v === NO_VALUE) return t('admin.members.sort.none')
  if (v === OTHER_VALUE) return t('admin.members.sort.other')
  switch (key) {
    case 'newMember':
    case 'pastoral':
    case 'contact':
      return t(`admin.members.info.${key}.${v}`)
    case 'edu':
      // 단계의 말은 새가족 교육 탭의 것 그대로다 — 같은 네 갈래를 두 화면이 다르게 부르면
      // "1주차만"이 어디서는 다른 뜻인가 싶어진다.
      return v === 'na' ? t('admin.members.info.edu.na') : t(`admin.newfamily.eduFilter.${v}`)
    case 'birthYear':
      return v.endsWith('s')
        ? t('admin.members.info.birthDecade', { year: v.slice(0, -1) })
        : t('admin.members.info.birthYear', { year: v })
    case 'regYear':
      return t('admin.members.info.regYear', { year: v })
    default:
      return v
  }
}
