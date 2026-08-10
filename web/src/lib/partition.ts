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

// ── 하위 단위를 뭐라고 부르는가: 동산 / 셀 ────────────────────────────────────────────
//
// 데이터로는 같은 칸이다 (`members.subgroup`). 부르는 이름만 다르다: 대학·청년부는 **동산**과
// 동산지기·부동산지기, 장년부는 **셀**과 셀장·부셀장. 화면 문구는 i18n의 `_adult` 변형이
// 맡고(usePartitionT), 여기 있는 것은 **번역 파일 밖에서 조립되는 라벨**을 위한 것이다 —
// 엑셀·PDF·출석부 이미지처럼 언어별 문자열 표를 코드에 들고 있는 자리들.
//
// 성격이 다른 두 가지를 굳이 한 군데 모아 둔 이유: 셀/동산이라는 말이 어디에 몇 번 나오는지
// 이 파일만 보면 알 수 있어야, 다음에 또 다른 부서가 붙어도 빠뜨리지 않는다.
export interface UnitTerms {
  /** 단위 그 자체 — "동산" / "셀". */
  unit: string
  /** 그 단위의 장 — "동산지기" / "셀장". */
  leader: string
  /** 부장 — "부동산지기" / "부셀장". */
  subLeader: string
  /** 아직 어디에도 속하지 않은 사람 묶음의 제목 — "동산 미지정" / "셀 미지정". */
  unassigned: string
}

const UNIT_TERMS: Record<Partition, Record<'ko' | 'en', UnitTerms>> = {
  youth: {
    ko: { unit: '동산', leader: '동산지기', subLeader: '부동산지기', unassigned: '동산 미지정' },
    en: { unit: '동산', leader: 'Dongsan leader', subLeader: 'Assistant leader', unassigned: 'Unassigned' },
  },
  adult: {
    ko: { unit: '셀', leader: '셀장', subLeader: '부셀장', unassigned: '셀 미지정' },
    en: { unit: 'Cell', leader: 'Cell leader', subLeader: 'Assistant cell leader', unassigned: 'Unassigned' },
  },
}

export function unitTerms(partition: Partition, lang: 'ko' | 'en' = 'ko'): UnitTerms {
  return UNIT_TERMS[partition][lang === 'en' ? 'en' : 'ko']
}

// 셀 이름은 고정이다: 대학·청년부의 동산은 학기마다 새로 짜지만, 장년부의 셀은 이름도 소속도
// 그대로 두고 셀장·부셀장만 바뀐다. 서버의 롤오버가 이 규칙의 주인이고(index.ts
// RESETS_SUBGROUPS_EACH_TERM), 화면은 "학기가 끝나 편성이 비워졌다"는 안내를 낼지 말지를
// 여기서 정한다.
export function subgroupsResetEachTerm(partition: Partition): boolean {
  return partition === 'youth'
}

// 부셀장은 한 명이다. 대학·청년부의 동산은 부동산지기를 둘까지 두지만 (한 동산이 크고, 학기마다
// 새로 짜므로 나눠 맡는다), 장년부의 셀은 셀장 한 명 · 부셀장 한 명으로 고정이다.
export function subLeaderSlots(partition: Partition): number {
  return partition === 'adult' ? 1 : 2
}

// 봄·여름·가을학기로 한 해를 나누는가. 대학·청년부는 학사 일정을 따라가지만 장년부에는 학기가
// 없다 — 한 해를 상반기(1–6월)·하반기(7–12월) 둘로만 나눈다. 이 값이 갈라 놓는 것은
// 기간의 경계뿐 아니라 **설정 탭의 학기 일정 편집기가 뜨는지**, 그리고 출석부가 학기 사이의
// '전환 기간'이라는 상태를 갖는지까지다 — 장년부에는 학기가 없으니 그 사이도 없다.
export function usesSemesters(partition: Partition): boolean {
  return partition === 'youth'
}

// 출석부의 표/기록 전환. 장년부는 표 하나로만 본다.
export function showsAttendanceLog(partition: Partition): boolean {
  return partition === 'youth'
}
