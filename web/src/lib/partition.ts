// ── 부(部, partition): 대학·청년부 / 장년부 ────────────────────────────────────────────
//
// 한 시스템이 두 부서의 출석을 받는다. 둘은 서로의 사람을 보지 못한다 — 서버가 /api/roster
// 부터 걸러서 내려주므로 화면 코드는 "내 부의 명단"만 받아 쓰면 되지만, **부서 목록을 손으로
// 적어 둔 곳**은 여전히 부에 따라 달라져야 한다: 키오스크의 부서 블록, 오늘 시트, 멤버
// 편집 다이얼로그의 부서 선택, 설정 탭의 색 편집, 동산 편집기가 깔아 두는 부서 줄 …
//
// 그 목록을 여기 한 군데 모아 둔다. 새 화면은 하드코딩된 ['대학부','청년부'] 대신
// groupsOfPartition(partition)을 쓰면 두 부서 모두에서 자동으로 맞게 돈다.
//
// 로그인한 부는 서버가 정한다 (auth.ts의 비밀번호 → partition). 화면은 usePartition()으로
// 읽는다 — 로그인 전이거나 알 수 없으면 대학·청년부로 본다 (기존 동작 그대로).

export type Partition = 'youth' | 'adult'

export const ADULT_GROUP = '장년부'

// 대학·청년부의 두 부서. 여름학기에는 합동으로 묶이지만 부서 자체는 그대로다.
export const YOUTH_GROUPS = ['대학부', '청년부'] as const

// 이 부에서 사람을 배치할 수 있는 부서들. 화면에 부서 선택/블록/색 칸을 몇 개 그릴지가 곧 이것.
export function groupsOfPartition(partition: Partition): string[] {
  return partition === 'adult' ? [ADULT_GROUP] : [...YOUTH_GROUPS]
}

// 어떤 부서가 어느 부의 것인가. 부서가 비어 있는 행(방문자·예전 기록)은 대학·청년부 쪽 —
// 지금까지 그 행들이 보이던 자리 그대로다. 서버 auth.ts partitionOfGroup()과 같은 규칙.
export function partitionOfGroup(group: string | null | undefined): Partition {
  return (group || '') === ADULT_GROUP ? 'adult' : 'youth'
}

// 여름 합동은 대학부·청년부를 하나로 묶는 장치라 장년부에는 없다. 서버도 장년부에는 여름
// 모드를 언제나 꺼서 내려주지만, 화면이 캐시된 설정으로 먼저 그릴 때를 위해 여기서도 막는다.
export function summerAppliesTo(partition: Partition): boolean {
  return partition === 'youth'
}
