import type { Member } from '../../lib/api'
import { EDU_STAGES, eduStage, type EduStage } from './eduSchedule'
import {
  birthYearOf,
  careerOf,
  composition,
  faithStageOf,
  genderOf,
  majorFieldOf,
  schoolOf,
  NO_SCHOOL_NAME,
  SCHOOL_NAMES,
  type MajorField,
  type School,
} from './eduDongsanTraits'

// 새가족 교육 동산 — **교육 시간에 어느 조로 앉는가**. 실제 동산 편성(`members.subgroup`)과는
// 다른 칸(`members.new_member_dongsan`)이라 출석부·통계·엑셀·시트 연동 어디에도 들어가지
// 않고, 학기 종료 롤오버도 이 값을 보지 않는다. 매주 다시 배정하는 것이 전제다.
//
// **부서를 넘지 않는다**: 대학부는 대학부끼리, 청년부는 청년부끼리 나눈다. 교육을 부서별로
// 하기 때문이고, 그래서 조 이름에도 부서가 붙는다 — "1동산"만 적으면 두 부서의 1동산이 같은
// 이름을 갖게 되어 명단을 읽는 사람이 어느 쪽인지 알 수 없다.
export interface EduAssignment {
  memberId: string
  dongsan: string // "" = 배정 해제
}

// 조 이름에 **부서와 교육 단계**가 함께 들어간다 (`대학부 미수강` · `청년부 2주차만`).
// 조를 가르는 것이 단계이므로 번호보다 단계 이름이 그 조를 가리키는 말이다 — 명단을 받는
// 사람이 "1동산이 어느 쪽이었지"를 되묻지 않는다. 한 단계를 둘 이상으로 쪼갤 때만 번호가
// 붙는다 (`대학부 미수강 2`). 학교로도 가른 주에는 그 이름이 사이에 들어간다
// (`대학부 CMU 미수강`) — 이름에 적힌 순서가 곧 가른 순서다.
export const EDU_STAGE_NAMES: Record<EduStage, string> = {
  none: '미수강',
  week1: '1주차만',
  week2: '2주차만',
  both: '수강 완료',
}

// `school`은 **세 가지 뜻**을 갖는다: null이면 학교로 가르지 않은 것(이름에 안 들어간다),
// 'cmu'/'pitt'이면 그 학교, ''이면 학교를 읽어낼 수 없는 사람들의 조다. 빈 칸도 자기 이름을
// 가져야 한다 — 이름이 없으면 그 조가 무엇으로 묶인 조인지 명단만 보고는 알 수 없다.
export function eduDongsanLabel(group: string, stage: EduStage, n = 1, of = 1, school: School | null = null): string {
  const parts = [group]
  if (school !== null) parts.push(school ? SCHOOL_NAMES[school] : NO_SCHOOL_NAME)
  parts.push(EDU_STAGE_NAMES[stage])
  const name = parts.filter(Boolean).join(' ')
  return of > 1 ? `${name} ${n}` : name
}

// 부서별 묶음 (부서 이름순, 부서가 빈 사람은 자기들끼리 한 묶음).
export function membersByGroup(members: Member[]): { group: string; members: Member[] }[] {
  const byGroup = new Map<string, Member[]>()
  for (const m of members) {
    const g = m.group_name || ''
    const list = byGroup.get(g) ?? []
    list.push(m)
    byGroup.set(g, list)
  }
  return [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => ({ group, members: list }))
}

// 한 부서 n명을 count개로 나눴을 때의 인원 — 앞쪽 조부터 한 명씩 더 간다 (차이는 언제나 1명
// 이하). 아래 assignEduDongsan의 나눗셈과 **같은 셈**이라 미리보기와 결과가 어긋나지 않는다.
export function bucketSizes(total: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count))
  return Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0))
}

// 부서 안에서 다시 **교육 단계**로 가른 묶음 — 이 한 묶음이 조 하나다.
export interface EduBucket {
  group: string
  school: School | null // null = 학교로 가르지 않았다, '' = 학교 미기재
  stage: EduStage
  members: Member[]
}

// 학교로 가를 때의 순서 — CMU · Pitt · 학교 미기재. 빈 칸이 맨 뒤인 것은 그것이 학교가
// 아니라 '아직 모른다'이기 때문이다.
const SCHOOL_LANES: School[] = ['cmu', 'pitt', '']

// 배정의 뼈대. 부서를 넘지 않고(대학부는 대학부끼리), 그 안에서 교육 단계를 넘지 않는다
// (미수강인 사람과 2주차를 이미 들은 사람이 한 조에 섞이지 않는다). 순서는 부서 이름 →
// (학교) → 단계 순(미수강 → 1주차만 → 2주차만 → 수강 완료)으로 고정한다 — 매주 같은
// 자리에서 읽히도록.
//
// `bySchool`이면 부서와 단계 사이에 **학교**가 한 겹 더 들어간다 (CMU · Pitt · 학교 미기재).
// 학교가 이 시스템의 칸이 아니라 `school_or_work`에 손으로 적힌 말에서 읽어낸 값이라
// (`schoolOf`) 못 읽은 사람이 늘 있고, 그 사람들은 자기들끼리 한 조가 된다 — 빈 칸 때문에
// 배정에서 빠지지 않는다는 규칙은 여기서도 같다.
export function eduBuckets(members: Member[], bySchool = false): EduBucket[] {
  const out: EduBucket[] = []
  for (const { group, members: list } of membersByGroup(members)) {
    const lanes: { school: School | null; list: Member[] }[] = bySchool
      ? SCHOOL_LANES.map((school) => ({ school, list: list.filter((m) => schoolOf(m) === school) }))
      : [{ school: null, list }]
    for (const lane of lanes) {
      for (const stage of EDU_STAGES) {
        const inStage = lane.list.filter((m) => eduStage(m) === stage)
        if (inStage.length) out.push({ group, school: lane.school, stage, members: inStage })
      }
    }
  }
  return out
}

export interface EduDongsanPlanRow {
  group: string
  school: School | null
  stage: EduStage
  total: number
  sizes: number[]
  rule: GroupRule | null // 이 부서에 걸리는 기준 (없으면 무작위)
  missing: { key: Criterion; n: number }[] // 그 기준으로 셀 수 없는 사람 수
}

// 배정 버튼을 누르기 전에 보여줄 미리보기 — 무작위가 섞는 것은 누가 어느 조에 가느냐뿐이고
// 조마다 몇 명인지는 여기서 이미 정해진다. 어떤 기준으로 나뉘는지도 같이 적어 준다.
export function eduDongsanPlan(members: Member[], count = 1, bySchool = false): EduDongsanPlanRow[] {
  return eduBuckets(members, bySchool).map(({ group, school, stage, members: list }) => ({
    group,
    school,
    stage,
    total: list.length,
    sizes: bucketSizes(list.length, count),
    rule: ruleForGroup(group, bySchool),
    missing: missingTraits(list, ruleForGroup(group, bySchool)),
  }))
}

// Fisher–Yates. `rand`를 밖에서 넣을 수 있는 것은 테스트가 결과를 고정하기 위해서다.
function shuffled<T>(list: T[], rand: () => number): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 정해진 인원대로 앞에서부터 잘라 담는다 — 섞은 목록에 쓰므로 자르는 자리는 무작위다.
function deal(list: Member[], sizes: number[]): Member[][] {
  const out: Member[][] = []
  let at = 0
  for (const size of sizes) {
    out.push(list.slice(at, at + size))
    at += size
  }
  return out
}

// ── 부서마다의 배정 기준 ────────────────────────────────────────────────────────────
// 기준은 두 방향뿐이다. **흩는 힘**(spread)은 그 값이 조마다 반반이 되게 하고, **모으는
// 힘**(cluster)은 값이 비슷한 사람을 같은 조로 끌어당긴다. 부서마다 어느 기준을 어느
// 방향으로 쓸지가 아래 표이고, 그 부서의 사람에게만 걸린다.
//
// - **대학부**: 성비 5:5(흩기) · Pitt/CMU 반반(흩기) · 비슷한 전공끼리(모으기)
// - **청년부**: 성비 5:5(흩기) · 나머지는 모두 **모으기** — 비슷한 나이 · 같은 처지
//   (대학원생/직장인) · 같은 학교 · 비슷한 전공 · 비슷한 신앙 연차
//
// 기준이 없는 부서(EM 등)는 무작위 그대로다 — 표에 한 줄을 더하면 그 부서에도 붙는다.
export type Criterion = 'gender' | 'school' | 'major' | 'age' | 'career' | 'faith'

interface Term {
  key: Criterion
  weight: number
}

export interface GroupRule {
  spread: Term[] // 조마다 반반이 되도록 (|이쪽 − 저쪽|을 줄인다)
  cluster: Term[] // 비슷한 사람이 같은 조가 되도록 (닮은 짝의 비율을 올린다)
}

// **무게가 곧 우선순위다.** 흩는 힘은 사람 수(0·1·2…)로 세고, 모으는 힘은 **닮은 짝의
// 비율**(0~1)로 센다 — 그래서 모으는 힘 하나가 낼 수 있는 최대값이 그 무게 자체이고,
// 아래로 갈수록 절반씩 줄여 두면 **위 기준을 뒤집을 수 없다** (아래 것을 다 합쳐도 위
// 하나보다 작다). 성비를 100으로 크게 떼어 놓은 것도 같은 이유다: 모으는 힘을 전부 더해도
// (32+16+4+4+2=58) 성비 한 명의 어긋남(100)을 이기지 못한다.
//
// 짝의 **비율**로 세는 이유는 빈칸 때문이다. 짝 수를 그냥 세면 조가 커질수록 모으는 힘이
// 제곱으로 자라 성비를 눌러 버리고, 반대로 값이 적힌 사람이 둘뿐인 조에서는 그 둘이 붙어도
// 힘이 거의 안 생긴다. 그래서 **값을 아는 짝 중에서 몇 쌍이 닮았는가**로 센다.
const RULES: Record<string, GroupRule> = {
  대학부: {
    spread: [
      { key: 'gender', weight: 100 },
      { key: 'school', weight: 10 },
    ],
    cluster: [{ key: 'major', weight: 4 }],
  },
  청년부: {
    spread: [{ key: 'gender', weight: 100 }],
    cluster: [
      { key: 'age', weight: 32 },
      { key: 'career', weight: 16 },
      { key: 'school', weight: 4 },
      { key: 'major', weight: 4 },
      { key: 'faith', weight: 2 },
    ],
  },
}

// 학교로 조를 이미 갈랐으면 조 안의 학교는 하나뿐이라 그 기준은 고를 것이 없어진다 —
// 대학부의 'Pitt/CMU 반반'도, 청년부의 '같은 학교끼리'도 그 주에는 뜻이 없으므로 빼고 센다
// (남겨 두면 화면이 '학교 정보 없음 n명'을 그 기준의 빈칸으로 계속 적어 준다).
export function ruleForGroup(group: string, bySchool = false): GroupRule | null {
  const rule = RULES[group] ?? null
  if (!rule || !bySchool) return rule
  const withoutSchool = (terms: Term[]) => terms.filter((x) => x.key !== 'school')
  return { spread: withoutSchool(rule.spread), cluster: withoutSchool(rule.cluster) }
}

// 나이가 "비슷하다"고 보는 폭. 태어난 해가 이만큼 안에 들면 한 짝으로 센다 — 청년부는
// 대학원생부터 직장인까지 나이 폭이 넓어서, 딱 같은 해만 세면 거의 아무 짝도 안 생긴다.
const AGE_TOLERANCE = 2

// 그 기준으로 이 사람을 셀 수 있는가, 셀 수 있다면 무슨 값인가. null이면 그 기준에서만
// 빠진다 (배정에서 빠지는 것이 아니다).
function valueOf(m: Member, key: Criterion): string | number | null {
  switch (key) {
    case 'gender': return genderOf(m) || null
    case 'school': return schoolOf(m) || null
    case 'major': return majorFieldOf(m) || null
    case 'career': return careerOf(m) || null
    case 'age': return birthYearOf(m)
    case 'faith': {
      const stage = faithStageOf(m)
      return stage >= 0 ? stage : null
    }
  }
}

// 두 값이 닮았는가. 나이만 폭을 두고 보고(±2년), 나머지는 같아야 닮은 것이다.
function alike(key: Criterion, a: string | number, b: string | number): boolean {
  if (key === 'age') return Math.abs((a as number) - (b as number)) <= AGE_TOLERANCE
  return a === b
}

// 값을 아는 짝 중 닮은 짝의 비율 (0~1). 값을 아는 사람이 둘도 안 되면 0 — 셀 것이 없다.
function alikeRatio(group: Member[], key: Criterion): number {
  const values = group.map((m) => valueOf(m, key)).filter((v): v is string | number => v !== null)
  if (values.length < 2) return 0
  let pairs = 0
  let same = 0
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      pairs++
      if (alike(key, values[i], values[j])) same++
    }
  }
  return same / pairs
}

// 흩는 힘이 보는 어긋남 — 그 기준의 두 값이 조 안에서 얼마나 기울었는가 (0이면 반반).
function deviation(group: Member[], key: Criterion): number {
  const { male, female, cmu, pitt } = composition(group)
  if (key === 'gender') return Math.abs(male - female)
  if (key === 'school') return Math.abs(cmu - pitt)
  return 0
}

// 한 조의 나쁨. 흩을 것은 기울수록 나쁘고(더한다), 모을 것은 닮을수록 좋다(뺀다).
// |남−여|를 줄이는 것이 곧 "5:5에 최대한 가깝게"다 — 인원이 홀수이거나 고른 사람들의 성비
// 자체가 기울어 있으면 그 기울기를 조마다 고르게 나눠 가진다.
function groupCost(group: Member[], rule: GroupRule): number {
  let cost = 0
  for (const { key, weight } of rule.spread) cost += weight * deviation(group, key)
  for (const { key, weight } of rule.cluster) cost -= weight * alikeRatio(group, key)
  return cost
}

const ATTEMPTS = 8 // 무작위로 다시 시작하는 횟수 — 언덕 하나에 갇히지 않기 위해
const MAX_PASSES = 6 // 한 시작에서 맞바꾸기를 훑는 횟수의 상한

// 무작위로 자리를 잡은 뒤, **두 사람을 맞바꿔서 더 나아지면 바꾼다**를 나아질 것이 없을
// 때까지 되풀이한다. 맞바꾸기는 조의 인원을 건드리지 않으므로 미리보기(bucketSizes)는 그대로
// 맞는다. 시작 자리가 무작위라 매주 다른 답이 나오고, 기준을 똑같이 잘 만족하는 답이 여럿일
// 때 그중 어느 것이 될지는 그 주의 운이다.
function balancedGroups(list: Member[], sizes: number[], rand: () => number, rule: GroupRule): Member[][] {
  let best: Member[][] | null = null
  let bestCost = Infinity
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const groups = deal(shuffled(list, rand), sizes)
    let cost = groups.reduce((sum, g) => sum + groupCost(g, rule), 0)
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let improved = false
      for (let a = 0; a < groups.length; a++) {
        for (let b = a + 1; b < groups.length; b++) {
          for (let i = 0; i < groups[a].length; i++) {
            for (let j = 0; j < groups[b].length; j++) {
              // 맞바꾸기가 바꾸는 것은 두 조뿐이라, 그 둘만 다시 센다.
              const before = groupCost(groups[a], rule) + groupCost(groups[b], rule)
              ;[groups[a][i], groups[b][j]] = [groups[b][j], groups[a][i]]
              const after = groupCost(groups[a], rule) + groupCost(groups[b], rule)
              if (after < before) {
                cost += after - before
                improved = true
              } else {
                ;[groups[a][i], groups[b][j]] = [groups[b][j], groups[a][i]]
              }
            }
          }
        }
      }
      if (!improved) break
    }
    if (cost < bestCost) {
      bestCost = cost
      best = groups
    }
  }
  return best ?? deal(list, sizes)
}

// 고른 사람들을 **부서 × 교육 단계**로 갈라 조를 만든다. `count`는 한 단계를 몇 조로 나눌지이고
// **기본값은 1 — 단계 하나가 곧 조 하나다** (미수강인 사람들이 한 조, 2주차만 들은 사람들이
// 다른 한 조). 2 이상으로 올리면 그 단계 안에서 다시 쪼개지고, 그때 비로소 그 부서의 기준
// (ruleForGroup — 성비·나이·학교·전공·신앙)이 누가 어느 쪽으로 갈지를 정한다. 조가 하나뿐인
// 동안에는 고를 것이 없으므로 기준이 아무것도 바꾸지 않는다.
export function assignEduDongsan(
  members: Member[],
  count = 1,
  rand: () => number = Math.random,
  bySchool = false,
): EduAssignment[] {
  const n = Math.max(1, Math.floor(count))
  const out: EduAssignment[] = []
  for (const { group, school, stage, members: list } of eduBuckets(members, bySchool)) {
    const sizes = bucketSizes(list.length, n).filter((size) => size > 0)
    const rule = ruleForGroup(group, bySchool)
    const groups = rule ? balancedGroups(list, sizes, rand, rule) : deal(shuffled(list, rand), sizes)
    groups.forEach((g, i) => {
      for (const m of g) {
        out.push({ memberId: m.id, dongsan: eduDongsanLabel(group, stage, i + 1, groups.length, school) })
      }
    })
  }
  return out
}

// 그 기준으로 셀 수 없는 사람 수 — 칸이 비어 있으면 그 기준에서만 빠진다 (배정에서 빠지는
// 것은 아니다). 화면에 적어 주지 않으면 "왜 성비가 안 맞지"가 된다. 그 부서의 기준이 실제로
// 보는 칸만 센다 — 청년부 화면에 대학부만 쓰는 칸의 빈칸 수가 뜨면 읽는 사람이 헤맨다.
export function missingTraits(members: Member[], rule: GroupRule | null): { key: Criterion; n: number }[] {
  if (!rule) return []
  return [...rule.spread, ...rule.cluster]
    .map(({ key }) => ({ key, n: members.filter((m) => valueOf(m, key) === null).length }))
    .filter((row) => row.n > 0)
}

export type { MajorField }

// 고른 사람들의 배정을 지우는 요청 (서버는 ""를 해제로 읽는다).
export function clearEduDongsan(members: Member[]): EduAssignment[] {
  return members.map((m) => ({ memberId: m.id, dongsan: '' }))
}

export interface EduDongsanGroup {
  name: string
  members: Member[]
}

// 배정된 사람들을 조별로 묶어 돌려준다 — 배정 결과를 한자리에서 읽는 자리. 카드에 붙은
// 배지만으로는 "1동산이 누구누구인지"를 알려면 화면을 훑어야 한다.
export function groupByEduDongsan(members: Member[]): EduDongsanGroup[] {
  const byName = new Map<string, Member[]>()
  for (const m of members) {
    const name = (m.new_member_dongsan || '').trim()
    if (!name) continue
    const list = byName.get(name) ?? []
    list.push(m)
    byName.set(name, list)
  }
  return [...byName.entries()]
    .map(([name, list]) => ({ name, members: [...list].sort((a, b) => a.name.localeCompare(b.name)) }))
    // 이름 안의 숫자로 정렬한다 — 글자만으로 세우면 10동산이 2동산 앞에 온다.
    .sort((a, b) => {
      const pa = splitLabel(a.name)
      const pb = splitLabel(b.name)
      return pa.prefix.localeCompare(pb.prefix) || pa.n - pb.n || a.name.localeCompare(b.name)
    })
}

function splitLabel(name: string): { prefix: string; n: number } {
  const m = /^(.*?)(\d+)\D*$/.exec(name)
  return m ? { prefix: m[1].trim(), n: Number(m[2]) } : { prefix: name, n: 0 }
}
