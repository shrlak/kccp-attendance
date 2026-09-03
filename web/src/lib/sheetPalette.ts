// 출석부의 종이 색 — 교회가 쓰던 스프레드시트에서 그대로 옮겨 온 팔레트 한 벌.
//
// 이 값들은 세 곳이 함께 쓴다: 내보내는 엑셀(exports.ts), 관리자 출석부 탭의 화면 표
// (AdminSheet의 GridView), 그리고 동산 리더 링크의 표(features/dongsan). 셋이 같은 표를
// 서로 다른 자리에서 보여주는 것이므로 색이 갈리면 "같은 출석부"로 읽히지 않는다. 그래서
// 색은 여기 하나에만 적는다.
//
// **이 팔레트는 테마를 따르지 않는다.** 출석부는 종이(흰 바탕)이고, 칸 색은 그 종이의 사실
// 이라 다크 모드에서도 그대로다 — 화면 테마를 따라 색이 바뀌면 엑셀로 내보낸 것과 다른
// 출석부가 된다. 표를 감싸는 화면 쪽(제목·안내·버튼)은 여느 화면처럼 테마를 따른다.

export interface BlockColors {
  light: string
  medium: string
}

// Per-동산 header palette, matching the legacy sheet: blocks cycle green -> blue -> yellow ->
// red, each a light shade (이름 labels) + a medium shade (date headers, 동산 name, 총 출석).
// Colors are ARGB hex (what SheetJS wants); cssColor() drops the alpha byte for the DOM.
const COLOR_FAMILIES: BlockColors[] = [
  { light: 'FFD9EAD3', medium: 'FFB6D7A8' }, // green
  { light: 'FFCFE2F3', medium: 'FF9FC5E8' }, // blue
  { light: 'FFFFF2CC', medium: 'FFFFE599' }, // yellow
  { light: 'FFF4CCCC', medium: 'FFEA9999' }, // red
]
export const HEADER_TOTAL_FILL = 'FFEAD1DC' // 예배 총 출석 column header
export const KEY_FILL = 'FF76A5AF' // KEY legend label
export const NOTE_FILL = 'FFCCCCCC' // grey marked-out status cells (한국 귀국 / 이주 / 새가족 / 기타)

// The color family for the nth 동산 block (cycles through the palette).
export function blockColors(index: number): BlockColors {
  return COLOR_FAMILIES[index % COLOR_FAMILIES.length]
}

// ARGB hex ("FFB6D7A8") -> CSS hex ("#B6D7A8"), dropping the alpha byte.
export function cssColor(argb: string): string {
  return `#${argb.slice(2)}`
}

// 동산지기 / 부동산지기(셀장 / 부셀장)의 이름 칸 — 각 동산 블록 맨 위에 이 색으로 앉는다.
export const LEADER_FILL = '#FFF3C4'
export const SUBLEADER_FILL = '#FFF9E1'

// 표의 잉크: 칸 선, 글자, O(왔다)와 X(안 왔다). 스프레드시트의 그것과 같은 값이다.
export const GRID_LINE = '#b7b7b7'
export const PAPER_INK = '#1f2937'
export const PRESENT_INK = '#16a34a'
export const ABSENT_INK = '#dc2626'
