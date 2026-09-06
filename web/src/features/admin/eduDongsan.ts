import type { Member } from '../../lib/api'

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
}

// 배정 버튼을 누르기 전에 보여줄 미리보기 — 무작위가 섞는 것은 누가 어느 조에 가느냐뿐이고
// 조마다 몇 명인지는 여기서 이미 정해진다.
export function eduDongsanPlan(members: Member[], count: number): EduDongsanPlanRow[] {
  return membersByGroup(members).map(({ group, members: list }) => ({
    group,
    total: list.length,
    sizes: bucketSizes(list.length, count),
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

// 고른 사람들을 부서 안에서 섞어 count개의 조로 돌려 담는다. 섞은 뒤 차례로 1·2·…·n·1·2…
// 로 넣으므로 조마다의 인원은 bucketSizes와 같아지고, 누가 어디로 가는지만 매번 달라진다.
//
// 규칙(누구를 같은 조로 묶고 누구를 갈라놓을지)은 아직 정해지지 않았다 — 그것이 정해지면
// 섞는 자리(shuffled)만 그 규칙으로 갈아 끼우면 되고, 나머지(부서 분리·조 인원·라벨·저장)는
// 그대로다.
export function assignEduDongsan(
  members: Member[],
  count: number,
  rand: () => number = Math.random,
): EduAssignment[] {
  const n = Math.max(1, Math.floor(count))
  const out: EduAssignment[] = []
  for (const { group, members: list } of membersByGroup(members)) {
    shuffled(list, rand).forEach((m, i) => {
      out.push({ memberId: m.id, dongsan: eduDongsanLabel(group, (i % n) + 1) })
    })
  }
  return out
}

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
