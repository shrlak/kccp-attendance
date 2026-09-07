import type { Member } from '../../lib/api'

// 배정 기준이 읽는 세 가지 — 성별 · 학교 · 전공 계열. 셋 다 **이미 있는 칸에서 읽기만** 하고
// 아무것도 고쳐 쓰지 않는다 (`members.gender`와 `members.school_or_work`).
//
// 학교와 전공은 한 칸에 같이 들어 있다. 그 칸은 종이 카드의 '학교/직장 학과'를 사람이 손으로
// 옮겨 적는 자유 기입란이라 모양이 제각각이다 — 운영 명단에 실제로 있는 것들:
//   "대학생 · CMU Math"  "CMU - stat ml"  "Pitt Bio (Pre-Dental)"  "대학생 · UPitt nursing"
//   "대학생 · University of Pittsburgh - Bio (Pre-Med)"  "피츠버그 대학교 화학공학과"  "ballet"
// 그래서 정해진 형식을 기대하지 않고 **낱말을 찾는다**. 못 읽으면 '모름'이고, 모름은 균형
// 계산에서 빠질 뿐 사람이 배정에서 빠지지는 않는다 (빈칸 때문에 사람을 잃지 않는다는 이
// 시스템의 규칙은 여기서도 같다 — 대학부 65명 중 23명은 이 칸이 비어 있다).

export type Gender = '남' | '여' | ''
export type School = 'cmu' | 'pitt' | ''
export type MajorField = 'engineering' | 'health' | 'math' | 'business' | 'arts' | 'social' | 'science' | ''

export function genderOf(m: Pick<Member, 'gender'>): Gender {
  const v = (m.gender || '').trim()
  if (!v) return ''
  // 카드가 영문이면 성별도 M/F로 읽혀 온다 (장년부 카드의 normalizeGender와 같은 이유).
  if (v.startsWith('남') || /^m/i.test(v)) return '남'
  if (v.startsWith('여') || /^f/i.test(v)) return '여'
  return ''
}

const SCHOOL_PATTERNS: { school: School; re: RegExp }[] = [
  { school: 'cmu', re: /cmu|carnegie|카네기/i },
  // 'Pittsburgh' · 'UPitt' · 'university of Pitt' 모두 'pitt'을 품는다.
  { school: 'pitt', re: /pitt|피츠버그/i },
]

// 두 학교가 한 줄에 같이 적힌 경우(“서울대/CMU 비지팅”)에는 **먼저 나오는 쪽**을 그 사람의
// 학교로 본다 — 자기 학교를 앞에 적기 때문이다.
export function schoolOf(m: Pick<Member, 'school_or_work'>): School {
  const text = (m.school_or_work || '').trim()
  if (!text) return ''
  let best: School = ''
  let at = Infinity
  for (const { school, re } of SCHOOL_PATTERNS) {
    const i = text.search(re)
    if (i >= 0 && i < at) {
      at = i
      best = school
    }
  }
  return best
}

// **순서가 규칙이다.** 위에서부터 먼저 걸리는 계열이 그 사람의 계열이므로, 겹치는 낱말은
// 더 좁은 쪽이 위에 있어야 한다: '화학공학'은 화학(자연과학)이 아니라 공학이고, 'biological
// science'는 과학이 아니라 생명·의료다.
const MAJOR_PATTERNS: { field: MajorField; re: RegExp }[] = [
  { field: 'engineering', re: /engineer|공학|기계|전자공|electrical|mechanical|civil|robotic|\bece\b/i },
  { field: 'health', re: /bio|생물|생명|pre-?\s?med|premed|medic|의예|의학|dent|치의|pharm|약학|nurs|간호|neuro|신경|public health|보건|physical therapy|물리치료|health|의료/i },
  { field: 'math', re: /math|수학|stat|통계|machine learning|\bml\b|\bai\b|comput|컴퓨터|\bcs\b|software|소프트웨어|data|데이터|cyber|보안|정보/i },
  { field: 'business', re: /business|tepper|\bmba\b|econ|경제|경영|finance|금융|market|마케팅|account|회계/i },
  { field: 'arts', re: /design|디자인|music|음악|\barts?\b|ballet|발레|drama|연극|architect|건축|film|영화|미술|\bux\b/i },
  { field: 'social', re: /psych|심리|social|sociol|사회|international relations|politic|정치|history|역사|english|영문|philos|철학|educat|교육|communicat|언론|\blaw\b|법학/i },
  { field: 'science', re: /chem|화학|physic|물리|geolog|지질|astro|천문|environment|환경|science|과학/i },
]

export function majorFieldOf(m: Pick<Member, 'school_or_work'>): MajorField {
  const text = (m.school_or_work || '').trim()
  if (!text) return ''
  for (const { field, re } of MAJOR_PATTERNS) if (re.test(text)) return field
  return ''
}

// 청년부의 기준 셋이 더 읽는 칸들. 대학부와 같은 규칙이다 — **읽기만 하고 아무것도 고쳐
// 쓰지 않으며, 못 읽으면 '모름'이라 그 기준에서만 빠진다** (배정에서는 빠지지 않는다).

// 나이는 **태어난 해**로 센다 (생일이 지났는지는 조를 나누는 데 뜻이 없다). 청년부 103명
// 중 59명만 이 칸이 차 있다.
export function birthYearOf(m: Pick<Member, 'birth_date'>): number | null {
  const y = Number((m.birth_date || '').slice(0, 4))
  // 1900 이전/미래 값은 잘못 적힌 것이다 (엑셀에서 옮겨 오다 1899-12-30이 되는 일이 있다).
  return y >= 1900 && y <= 2100 ? y : null
}

// 대학원생인가 직장인인가 — `school_or_work`의 **' · ' 앞머리**가 그 칸이다
// ("대학원생 · CMU Cybersecurity" · "직장인 · 발레댄서"). 앞머리가 없거나 'Other'면 모름:
// 'Other'는 카드의 '기타'라 학생인지 직장인인지를 말해 주지 않는다.
export type Career = 'grad' | 'work' | 'college' | ''

export function careerOf(m: Pick<Member, 'school_or_work'>): Career {
  const head = (m.school_or_work || '').split(' · ')[0].trim()
  if (/대학원|grad/i.test(head)) return 'grad'
  if (/직장|회사|worker|employ/i.test(head)) return 'work'
  if (/대학생|undergrad|student/i.test(head)) return 'college'
  return ''
}

// 신앙기간은 **순서가 있는 칸**이다 (짧은 쪽부터 0 … 4). 카드의 선택지는 다섯이지만 손으로
// 적은 값도 섞여 들어오므로("3년"), 'N년'으로 적힌 것은 그 수로 칸을 찾아 준다. 숫자만 있는
// 값('27')과 'No'는 무엇을 뜻하는지 알 수 없어 모름으로 둔다 — 지어내지 않는다.
export const FAITH_STAGES = ['1년 미만', '1-3년', '3-5년', '5년 이상', '모태신앙'] as const
export type FaithStage = number // 0..4, -1 없음

export function faithStageOf(m: Pick<Member, 'faith_duration'>): FaithStage {
  const v = (m.faith_duration || '').trim()
  if (!v) return -1
  if (/모태/.test(v)) return 4
  if (/미만/.test(v)) return 0
  if (/1\s*-\s*3/.test(v)) return 1
  if (/3\s*-\s*5/.test(v)) return 2
  if (/이상/.test(v)) return 3
  const years = /^(\d+(?:\.\d+)?)\s*년/.exec(v)
  if (years) {
    const n = Number(years[1])
    return n < 1 ? 0 : n < 3 ? 1 : n < 5 ? 2 : 3
  }
  return -1
}

export interface Composition {
  male: number
  female: number
  cmu: number
  pitt: number
  fields: { field: MajorField; n: number }[] // 많은 계열부터. '모름'은 빠진다.
  careers: { career: Career; n: number }[] // 대학원생 · 직장인 …
  faith: { stage: FaithStage; n: number }[] // 신앙기간, 짧은 쪽부터
  birthYears: { min: number; max: number } | null // 적힌 사람이 없으면 null
}

// 한 조가 어떻게 섞였는지 — 배정 결과를 눈으로 검산하는 자리에 그대로 나간다.
export function composition(members: Member[]): Composition {
  const counts = new Map<MajorField, number>()
  const careerCounts = new Map<Career, number>()
  const faithCounts = new Map<FaithStage, number>()
  const years: number[] = []
  let male = 0
  let female = 0
  let cmu = 0
  let pitt = 0
  for (const m of members) {
    const g = genderOf(m)
    if (g === '남') male++
    else if (g === '여') female++
    const s = schoolOf(m)
    if (s === 'cmu') cmu++
    else if (s === 'pitt') pitt++
    const f = majorFieldOf(m)
    if (f) counts.set(f, (counts.get(f) || 0) + 1)
    const c = careerOf(m)
    if (c) careerCounts.set(c, (careerCounts.get(c) || 0) + 1)
    const st = faithStageOf(m)
    if (st >= 0) faithCounts.set(st, (faithCounts.get(st) || 0) + 1)
    const y = birthYearOf(m)
    if (y) years.push(y)
  }
  const fields = [...counts.entries()]
    .map(([field, n]) => ({ field, n }))
    .sort((a, b) => b.n - a.n || a.field.localeCompare(b.field))
  const careers = [...careerCounts.entries()]
    .map(([career, n]) => ({ career, n }))
    .sort((a, b) => b.n - a.n || a.career.localeCompare(b.career))
  const faith = [...faithCounts.entries()]
    .map(([stage, n]) => ({ stage, n }))
    .sort((a, b) => a.stage - b.stage)
  return {
    male,
    female,
    cmu,
    pitt,
    fields,
    careers,
    faith,
    birthYears: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null,
  }
}
