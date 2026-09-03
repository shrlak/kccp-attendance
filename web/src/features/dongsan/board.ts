import type { DongsanBoard, DongsanBoardMember } from '../../lib/api'
import { hasHidingMark } from '../../lib/status'

// 동산 리더 링크 표의 순수한 부분 — 누가 어느 블록의 몇째 줄에 앉는가. 화면(DongsanBoardScreen)
// 은 여기서 나온 것을 그리기만 한다.

export type BoardRole = '동산지기' | '부동산지기' | null

export interface BoardRow {
  member: DongsanBoardMember
  role: BoardRole
}

export interface BoardBlock {
  subgroup: string
  /** 이 동산의 동산지기 (없으면 빈 문자열). */
  leader: string
  /** 이 동산의 부동산지기들 (없으면 빈 배열). */
  subLeaders: string[]
  rows: BoardRow[]
}

/**
 * 표에 놓을 줄 — 동산으로 묶고, 그 안에서 **동산지기 → 부동산지기 → 나머지** 순으로 앉힌다.
 *
 * 관리자 출석부(features/admin/dongsan.ts `orderByDongsanRole`)가 하는 것과 같은 자리 잡기다.
 * 지기가 블록 맨 위에 있어야 그 동산을 누가 맡고 있는지가 표를 열자마자 보이고, 적는 사람이
 * 가장 먼저 찾는 줄이기도 하다. 블록 안에서만 자리를 바꾸므로 동산을 건너가는 일은 없고,
 * 지기가 아닌 사람들끼리의 순서(서버가 이름순으로 보낸 그대로)는 그대로 남는다.
 *
 * 두 가지가 여기서 함께 걸러진다:
 *  · 귀국·이주처럼 명단에서 빠진 사람 (lib/status.ts — 앱 전체가 쓰는 그 규칙 그대로)
 *  · **동산이 없는 사람** (서버도 이미 빼고 보내지만, 규칙이 화면 쪽에도 적혀 있어야 옛
 *    응답이나 테스트 값이 '동산 미지정' 블록을 되살리지 않는다)
 *
 * 지기 이름은 config에 **이름으로** 적혀 있어 이름으로 짚는다 (앱의 다른 곳도 다 그렇다).
 * 편성표에만 있고 명단에는 없는 지기는 여기서 줄을 얻지 못하므로, 화면이 블록 머리에 이름을
 * 따로 적어 준다.
 */
export function boardBlocks(data: Pick<DongsanBoard, 'members' | 'leaders'>): BoardBlock[] {
  const out: BoardBlock[] = []
  const at = new Map<string, BoardBlock>()
  for (const m of data.members) {
    const subgroup = (m.subgroup || '').trim()
    if (!subgroup || hasHidingMark(statusOf(m))) continue
    let block = at.get(subgroup)
    if (!block) {
      const entry = data.leaders?.[subgroup]
      block = { subgroup, leader: entry?.leader || '', subLeaders: entry?.subLeaders ?? [], rows: [] }
      at.set(subgroup, block)
      out.push(block)
    }
    block.rows.push({ member: m, role: roleIn(block, m.name) })
  }
  for (const block of out) {
    const rank = (r: BoardRow) => (r.role === '동산지기' ? 0 : r.role === '부동산지기' ? 1 : 2)
    block.rows = [0, 1, 2].flatMap((n) => block.rows.filter((r) => rank(r) === n))
  }
  return out
}

function roleIn(block: BoardBlock, name: string): BoardRole {
  if (!name) return null
  if (block.leader === name) return '동산지기'
  return block.subLeaders.includes(name) ? '부동산지기' : null
}

// 서버는 표에 있는 그대로 — 비어 있으면 null — 을 실어 보내고, status.ts는 Member의 모양
// (비어 있으면 없는 칸)을 읽는다. 그 한 칸 차이를 여기서 맞춘다. 표기를 읽는 규칙 자체는
// 여전히 status.ts 하나뿐이고, 여기서 하는 일은 모양을 맞춰 넘기는 것뿐이다.
function statusOf(m: DongsanBoardMember) {
  return {
    status_note: m.status_note ?? undefined,
    status_start: m.status_start ?? null,
    status_end: m.status_end ?? null,
    status_marks: m.status_marks ?? undefined,
  }
}

/**
 * 표에서 지금이 어느 주일인가 — 오늘이거나, 오늘이 지난 주일 중 가장 최근의 것.
 *
 * 학기 한 장이 통째로 놓이므로 열이 열다섯 개를 넘고 그중 대부분이 아직 오지 않은 주일이다.
 * 그 칸을 표시해 두지 않으면 적는 사람이 매번 날짜를 세어 가며 자기 열을 찾는다 (그러다 옆
 * 칸에 적는다). 학기가 아직 시작하지 않았으면 첫 주일을, 다 지났으면 마지막 주일을 짚는다.
 */
export function currentColumn(dates: string[], today: string): string {
  if (!dates.length) return ''
  const past = dates.filter((d) => d <= today)
  return past.length ? past[past.length - 1] : dates[0]
}
