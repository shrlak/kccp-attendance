import type { Member } from '../../lib/api'
import { composition, genderOf, majorFieldOf, schoolOf, type MajorField } from './eduDongsanTraits'

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

export function eduDongsanLabel(group: string, n: number): string {
  return group ? `${group} ${n}동산` : `${n}동산`
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

export interface EduDongsanPlanRow {
  group: string
  total: number
  sizes: number[]
  rule: GroupRule // 이 부서에 걸리는 기준 (대학부만 balanced)
  missing: { gender: number; school: number; major: number } // 기준을 셀 수 없는 사람 수
}

// 배정 버튼을 누르기 전에 보여줄 미리보기 — 무작위가 섞는 것은 누가 어느 조에 가느냐뿐이고
// 조마다 몇 명인지는 여기서 이미 정해진다. 어떤 기준으로 나뉘는지도 같이 적어 준다.
export function eduDongsanPlan(members: Member[], count: number): EduDongsanPlanRow[] {
  return membersByGroup(members).map(({ group, members: list }) => ({
    group,
    total: list.length,
    sizes: bucketSizes(list.length, count),
    rule: ruleForGroup(group),
    missing: missingTraits(list),
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
// **대학부에만 기준이 있다**: 성비를 5:5에 가깝게 · Pitt과 CMU를 반반으로 · 전공이 비슷한
// 사람을 같은 조로. 청년부는 아직 기준을 받지 않았으므로 무작위 그대로다 (그 부의 기준이
// 정해지면 이 표에 한 줄을 더한다 — 나머지 코드는 손대지 않는다).
export type GroupRule = 'balanced' | 'random'

const GROUP_RULES: Record<string, GroupRule> = { 대학부: 'balanced' }

export function ruleForGroup(group: string): GroupRule {
  return GROUP_RULES[group] ?? 'random'
}

// 세 기준의 무게. **순서가 곧 우선순위다** — 성비가 먼저이고, 그것이 같은 답들 중에서 학교가,
// 그것마저 같은 답들 중에서 전공이 고른다. 전공을 가장 가볍게 두는 이유는 그 기준만 방향이
// 반대이기 때문이다: 성비와 학교는 **흩는** 힘이고 전공은 **모으는** 힘이라, 무게를 비슷하게
// 주면 전공이 같은 사람들을 한 조에 몰면서 성비가 무너진다.
const W_GENDER = 100
const W_SCHOOL = 10
const W_MAJOR = 1

// 한 조의 나쁨. 남녀 차이와 학교 차이는 작을수록 좋고(0이면 반반), 같은 계열 짝은 많을수록
// 좋다(그래서 뺀다). |남−여|를 줄이는 것이 곧 "5:5에 최대한 가깝게"다 — 인원이 홀수이거나
// 고른 사람들의 성비 자체가 기울어 있으면 그 기울기를 조마다 고르게 나눠 가진다.
function groupCost(group: Member[]): number {
  const { male, female, cmu, pitt, fields } = composition(group)
  let sameFieldPairs = 0
  for (const { n } of fields) sameFieldPairs += (n * (n - 1)) / 2
  return W_GENDER * Math.abs(male - female) + W_SCHOOL * Math.abs(cmu - pitt) - W_MAJOR * sameFieldPairs
}

const ATTEMPTS = 8 // 무작위로 다시 시작하는 횟수 — 언덕 하나에 갇히지 않기 위해
const MAX_PASSES = 6 // 한 시작에서 맞바꾸기를 훑는 횟수의 상한

// 무작위로 자리를 잡은 뒤, **두 사람을 맞바꿔서 더 나아지면 바꾼다**를 나아질 것이 없을
// 때까지 되풀이한다. 맞바꾸기는 조의 인원을 건드리지 않으므로 미리보기(bucketSizes)는 그대로
// 맞는다. 시작 자리가 무작위라 매주 다른 답이 나오고, 기준을 똑같이 잘 만족하는 답이 여럿일
// 때 그중 어느 것이 될지는 그 주의 운이다.
function balancedGroups(list: Member[], sizes: number[], rand: () => number): Member[][] {
  let best: Member[][] | null = null
  let bestCost = Infinity
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const groups = deal(shuffled(list, rand), sizes)
    let cost = groups.reduce((sum, g) => sum + groupCost(g), 0)
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      let improved = false
      for (let a = 0; a < groups.length; a++) {
        for (let b = a + 1; b < groups.length; b++) {
          for (let i = 0; i < groups[a].length; i++) {
            for (let j = 0; j < groups[b].length; j++) {
              // 맞바꾸기가 바꾸는 것은 두 조뿐이라, 그 둘만 다시 센다.
              const before = groupCost(groups[a]) + groupCost(groups[b])
              ;[groups[a][i], groups[b][j]] = [groups[b][j], groups[a][i]]
              const after = groupCost(groups[a]) + groupCost(groups[b])
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

// 고른 사람들을 부서 안에서 조로 나눈다. 조마다의 인원은 언제나 bucketSizes이고, 누가 어디로
// 가느냐는 그 부서의 기준(ruleForGroup)이 정한다 — 대학부는 성비·학교·전공을 맞추고, 기준이
// 없는 부서는 섞어서 자른다.
export function assignEduDongsan(
  members: Member[],
  count: number,
  rand: () => number = Math.random,
): EduAssignment[] {
  const n = Math.max(1, Math.floor(count))
  const out: EduAssignment[] = []
  for (const { group, members: list } of membersByGroup(members)) {
    const sizes = bucketSizes(list.length, n)
    const groups =
      ruleForGroup(group) === 'balanced'
        ? balancedGroups(list, sizes, rand)
        : deal(shuffled(list, rand), sizes)
    groups.forEach((g, i) => {
      for (const m of g) out.push({ memberId: m.id, dongsan: eduDongsanLabel(group, i + 1) })
    })
  }
  return out
}

// 균형 계산에서 빠지는 사람 수 — 성별이나 학교가 적혀 있지 않으면 그 기준으로는 셀 수 없다.
// 배정에서 빠지는 것은 아니지만 화면에 적어 준다 (안 적으면 "왜 성비가 안 맞지"가 된다).
export function missingTraits(members: Member[]): { gender: number; school: number; major: number } {
  let gender = 0
  let school = 0
  let major = 0
  for (const m of members) {
    if (!genderOf(m)) gender++
    if (!schoolOf(m)) school++
    if (!majorFieldOf(m)) major++
  }
  return { gender, school, major }
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
