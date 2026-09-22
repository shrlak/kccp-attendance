import type { Member } from '../../lib/api'
import {
  ensureSheetFonts,
  canvasToBlob,
  downloadBlob,
  combineVertical,
  copyCanvasToClipboard,
} from './todaySheetImage'
import { cardModel, type CardCell, type CardCheckOption } from './newFamilyCard'

// ── 새가족 등록 카드 → JPG download + clipboard (Korean) ─────────────────────
// Renders each 새가족 as a faithful copy of the paper registration card: a centered
// grey title bar (< KCCP 빛주사랑 대학청년부 - 새가족 등록 카드 >) over a solid-bordered
// table of [grey label | value | grey label | value] rows, with the member's data
// filled in — gender circled in the 이름 cell, the matching 소속/세례/신앙생활 checkbox
// ticked, the 목회자 연락 동의 줄 (문장 뒤의 네모) ticked when confirmed — a label-less
// cell spanning the last row's right half — dates as MM / DD / YYYY (blanks when missing). Each
// person ships as their own JPG; the clipboard gets all selected cards stacked into one
// merged image. The card's content comes from the pure `cardModel` in ./newFamilyCard
// (shared with the kiosk entry form); this module only draws it.

// Re-exported so the card's model + the 소속 storage convention stay importable from
// the module that consumes them for export (tests use these too).
export { cardModel, formatCardDate, joinAffiliation, splitAffiliation } from './newFamilyCard'

// Logical-pixel layout; rendered at SCALE× for a crisp raster (as todaySheetImage).
// Column proportions follow the scanned card: equal grey label columns, with the
// right value column wider than the left (≈ 16% | 31% | 16% | 37%).
const SCALE = 2
const CARD_W = 860
const MARGIN = 24 // white margin around the printed table
const TABLE_W = CARD_W - MARGIN * 2
const LABEL_W = 130 // grey label columns
const VALUE1_W = 250 // left value column (이름 / 생년월일 / 소속 / 학교 / 등록일)
const VALUE2_W = TABLE_W - LABEL_W * 2 - VALUE1_W // right value column, wider (as printed)
const TITLE_H = 54
const MIN_ROW_H = 48
const PAD_X = 12 // value-cell horizontal padding
const PAD_Y = 12 // value-cell vertical padding around stacked checkbox lines
const LINE_H = 26 // one checkbox line
const TEXT_LINE_H = 22 // one wrapped plain-text line (학교/전공 or 직장, …)
const BOX = 13 // checkbox square
const FLOW_GAP = 14 // 한 줄에 나란히 흐르는 옵션 사이 (flow)

const INK = '#111111'
const LABEL_GREY = '#d9d9d9'
const TITLE_GREY = '#efefef'

const TITLE_FONT = '700 22px "Jua", sans-serif'
const VALUE_FONT = '400 16px "Gowun Dodum", sans-serif'
const OPTION_FONT = '400 14px "Gowun Dodum", sans-serif'
const CAPTION_FONT = '400 10.5px "Gowun Dodum", sans-serif'

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

// Word-wrap `text` to fit `maxW` at the current ctx.font — greedy, breaking on
// whitespace where possible and falling back to a mid-word break for a single token
// wider than the whole cell (long school/program names with no spaces). Matches the
// 학교/전공 or 직장 field on the printed card, which wraps instead of truncating.
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  if (!text) return ['']
  const words = text.split(/(\s+)/).filter((w) => w !== '')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line + word
    if (ctx.measureText(test).width <= maxW || !line) {
      // A lone word already wider than the cell: break it character by character.
      if (!line && ctx.measureText(test).width > maxW && word.trim().length > 1) {
        let chunk = ''
        for (const ch of word) {
          if (ctx.measureText(chunk + ch).width > maxW && chunk) {
            lines.push(chunk)
            chunk = ch
          } else {
            chunk += ch
          }
        }
        line = chunk
      } else {
        line = test
      }
    } else {
      lines.push(line.trimEnd())
      line = word.trimStart()
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines.length ? lines : ['']
}

// Width of one checkbox option (box + label + optional English caption).
function checkWidth(ctx: CanvasRenderingContext2D, opt: CardCheckOption): number {
  ctx.font = OPTION_FONT
  let w = BOX + 6 + ctx.measureText(opt.label).width
  if (opt.caption) {
    ctx.font = CAPTION_FONT
    w += 5 + ctx.measureText(opt.caption).width
  }
  return w
}

interface PlacedCheck {
  opt: CardCheckOption
  line: number
  w: number
}

// The printed card stacks every ☐ 옵션 on its own line (소속·세례·신앙생활 columns).
// `flow` 옵션만 한 줄에 나란히 흐르고, 칸 폭을 넘치면 다음 줄로 넘어간다 — 반 칸에 앉는
// '향후 피츠버그에 머물 기간'이 그것이다.
function layoutChecks(
  ctx: CanvasRenderingContext2D,
  content: Extract<CardCell['content'], { kind: 'checks' }>,
  innerW: number,
): { placed: PlacedCheck[]; lines: number; x: number[] } {
  if (!content.flow) {
    return { placed: content.options.map((opt, i) => ({ opt, line: i, w: checkWidth(ctx, opt) })), lines: content.options.length, x: [] }
  }
  const placed: PlacedCheck[] = []
  const x: number[] = []
  let line = 0
  let cursor = 0
  for (const opt of content.options) {
    const w = checkWidth(ctx, opt)
    if (cursor > 0 && cursor + w > innerW) {
      line += 1
      cursor = 0
    }
    placed.push({ opt, line, w })
    x.push(cursor)
    cursor += w + FLOW_GAP
  }
  return { placed, lines: line + 1, x }
}

// Height one value cell needs: one line per checkbox option, or as many wrapped lines
// as a long text value (학교/전공 or 직장, …) needs to fit `width`.
function cellHeight(ctx: CanvasRenderingContext2D, cell: CardCell, width: number): number {
  if (cell.content.kind === 'checks') {
    const { lines } = layoutChecks(ctx, cell.content, width - PAD_X * 2)
    return Math.max(MIN_ROW_H, PAD_Y * 2 + lines * LINE_H)
  }
  if (cell.content.kind === 'consent') {
    ctx.font = OPTION_FONT
    const lines = wrapLines(ctx, cell.content.text, consentTextW(width))
    return Math.max(MIN_ROW_H, PAD_Y * 2 + lines.length * LINE_H)
  }
  if (cell.content.kind === 'text' && cell.content.text) {
    ctx.font = VALUE_FONT
    const lines = wrapLines(ctx, cell.content.text, width - PAD_X * 2)
    return Math.max(MIN_ROW_H, PAD_Y * 2 + lines.length * TEXT_LINE_H)
  }
  return MIN_ROW_H
}

// Grey label cell: fill + bold centered text. Long labels wrap onto two centered
// lines at the first space (the printed 소속 (학교/직장) / 학교/전공 or 직장 style);
// single-word overflow shrinks instead.
function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, h: number) {
  ctx.fillStyle = LABEL_GREY
  ctx.fillRect(x, y, LABEL_W, h)
  ctx.fillStyle = INK
  const maxW = LABEL_W - 10
  const fontAt = (size: number) => `700 ${size}px "Gowun Dodum", sans-serif`
  ctx.font = fontAt(15)
  ctx.textAlign = 'center'
  const cx = x + LABEL_W / 2
  const words = text.split(' ')
  if (ctx.measureText(text).width > maxW && words.length > 1) {
    // 가운데에 가장 가까운 빈칸에서 가른다 — 첫 빈칸에서 자르면 '향후 / 피츠버그에 있을
    // 기간'처럼 한쪽 줄만 길어져 글자가 잘게 줄어든다.
    const at = words.reduce<{ i: number; d: number }>(
      (best, _word, i) => {
        if (i === 0) return best
        const head = words.slice(0, i).join(' ').length
        const d = Math.abs(head - (text.length - head))
        return d < best.d ? { i, d } : best
      },
      { i: 1, d: Infinity },
    ).i
    const lines = [words.slice(0, at).join(' '), words.slice(at).join(' ')]
    let size = 15
    while (size > 11 && lines.some((l) => ctx.measureText(l).width > maxW)) {
      size -= 1
      ctx.font = fontAt(size)
    }
    ctx.fillText(lines[0], cx, y + h / 2 - 9)
    ctx.fillText(lines[1], cx, y + h / 2 + 10)
  } else {
    let size = 15
    while (size > 11 && ctx.measureText(text).width > maxW) {
      size -= 1
      ctx.font = fontAt(size)
    }
    ctx.fillText(text, cx, y + h / 2 + 1)
  }
  ctx.textAlign = 'left'
}

// ☐ / ☑-style checkbox: a small square, plus a bold ✓ overhanging it when checked.
function drawCheckbox(ctx: CanvasRenderingContext2D, x: number, cy: number, checked: boolean) {
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, cy - BOX / 2 + 0.5, BOX, BOX)
  if (checked) {
    ctx.fillStyle = INK
    ctx.font = '700 16px "Gowun Dodum", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('✓', x + BOX / 2 + 1, cy - 1)
    ctx.textAlign = 'left'
  }
}

// Value cell with a checkbox group (소속 / 세례 여부 / 신앙생활), options stacked one
// per line like the printed card.
function drawChecksCell(
  ctx: CanvasRenderingContext2D,
  content: Extract<CardCell['content'], { kind: 'checks' }>,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const innerW = w - PAD_X * 2
  const { placed, lines, x: flowX } = layoutChecks(ctx, content, innerW)
  const top = y + (h - lines * LINE_H) / 2
  for (const [i, p] of placed.entries()) {
    const cy = top + p.line * LINE_H + LINE_H / 2
    const bx = x + PAD_X + (content.flow ? flowX[i] : 0)
    drawCheckbox(ctx, bx, cy, p.opt.checked)
    ctx.fillStyle = INK
    ctx.font = OPTION_FONT
    const labelW = ctx.measureText(p.opt.label).width
    ctx.fillText(p.opt.label, bx + BOX + 6, cy + 1)
    if (p.opt.caption) {
      ctx.fillStyle = '#444444'
      ctx.font = CAPTION_FONT
      ctx.fillText(p.opt.caption, bx + BOX + 6 + labelW + 5, cy + 2)
    }
  }
  // Free text after the last option (the paper's "Other: ____" blank).
  if (content.extra) {
    const last = placed[placed.length - 1]
    const ex = x + PAD_X + (content.flow ? flowX[placed.length - 1] : 0) + last.w + 6
    const cy = top + last.line * LINE_H + LINE_H / 2
    const room = x + PAD_X + innerW - ex
    if (room > 24) {
      ctx.fillStyle = INK
      ctx.font = OPTION_FONT
      ctx.fillText(truncate(ctx, content.extra, room), ex, cy + 1)
    }
  }
}

// 라벨 없는 오른쪽 칸(동의 줄)은 회색 라벨 자리까지 함께 쓴다 — 재는 자리와 그리는
// 자리가 같은 폭을 보아야 줄 수와 칸 높이가 맞는다.
function rightValueW(cell: CardCell): number {
  return cell.label === undefined ? LABEL_W + VALUE2_W : VALUE2_W
}

// 동의 줄이 문장에 쓸 수 있는 폭 — 칸 안쪽에서 문장 뒤에 올 네모와 그 앞 여백을 뺀 나머지.
function consentTextW(width: number): number {
  return width - PAD_X * 2 - BOX - 6
}

// 동의 한 줄 (목회자 연락): 읽는 문장이 먼저고 **네모가 그 뒤**다 — 옵션 줄(☐ 라벨)과
// 반대인데, 여기서 표시하는 사람은 고르는 것이 아니라 문장을 다 읽고 확인하기 때문이다.
// 문장이 길어 줄바꿈되면 네모는 마지막 줄 끝에 붙는다 (모든 줄이 네모 자리를 비워 두고
// 줄바꿈되므로 — consentTextW — 마지막 줄 끝에 언제나 자리가 있다).
function drawConsentCell(
  ctx: CanvasRenderingContext2D,
  content: Extract<CardCell['content'], { kind: 'consent' }>,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.font = OPTION_FONT
  const textX = x + PAD_X
  const lines = wrapLines(ctx, content.text, consentTextW(w))
  const top = y + (h - lines.length * LINE_H) / 2
  ctx.fillStyle = INK
  lines.forEach((ln, i) => ctx.fillText(ln, textX, top + i * LINE_H + LINE_H / 2 + 1))
  const lastW = ctx.measureText(lines[lines.length - 1]).width
  drawCheckbox(ctx, textX + lastW + 6, top + (lines.length - 1) * LINE_H + LINE_H / 2, content.checked)
}

// 이름 cell: the name plus "( 남 / 여 )", with the member's gender circled in pen —
// an ellipse around 남 or 여 (nothing circled when the gender is blank/unknown).
function drawNameCell(
  ctx: CanvasRenderingContext2D,
  content: Extract<CardCell['content'], { kind: 'name' }>,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const cy = y + h / 2 + 1
  ctx.font = VALUE_FONT
  ctx.fillStyle = INK
  const genderParts = ['( ', '남', ' / ', '여', ' )'] as const
  const genderW = genderParts.reduce((gw, p) => gw + ctx.measureText(p).width, 0)
  const nameMax = w - PAD_X * 2 - genderW - 14
  const name = truncate(ctx, content.name, Math.max(nameMax, 40))
  ctx.fillText(name, x + PAD_X, cy)
  let gx = x + PAD_X + ctx.measureText(name).width + 14
  for (const part of genderParts) {
    ctx.fillText(part, gx, cy)
    const w = ctx.measureText(part).width
    if (part === content.circled) {
      ctx.strokeStyle = INK
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.ellipse(gx + w / 2, cy - 1, w / 2 + 6, 12, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.lineWidth = 1
    }
    gx += w
  }
}

// Draw one member's 등록 카드 onto a fresh canvas and return it.
export function renderNewFamilyCard(m: Member): HTMLCanvasElement {
  const model = cardModel(m)

  // First pass on a throwaway context: measure how tall each row needs to be
  // (checkbox groups wrap), then size the real canvas exactly.
  const meas = document.createElement('canvas').getContext('2d')
  if (!meas) throw new Error('canvas 2d context unavailable')
  // 왼쪽이 갈리는 줄은 두 칸의 합이 그 반쪽의 높이다 (오른쪽 칸이 그 둘을 함께 덮는다).
  const leftHeights = model.rows.map((r) =>
    r.leftBelow ? cellHeight(meas, r.left, VALUE1_W) + cellHeight(meas, r.leftBelow, VALUE1_W) : cellHeight(meas, r.left, VALUE1_W),
  )
  const rowHeights = model.rows.map((r, i) => Math.max(leftHeights[i], cellHeight(meas, r.right, rightValueW(r.right))))
  // 아래 칸은 자기에게 필요한 만큼만 쓰고 남는 높이는 위 칸이 가져간다 — 오른쪽 다섯 줄
  // 때문에 늘어난 높이가 학교/전공 칸으로 가야 손글씨 자리가 남는다.
  const belowHeights = model.rows.map((r) => (r.leftBelow ? cellHeight(meas, r.leftBelow, VALUE1_W) : 0))
  const tableH = TITLE_H + rowHeights.reduce((a, b) => a + b, 0)
  const H = MARGIN * 2 + tableH

  const canvas = document.createElement('canvas')
  canvas.width = CARD_W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  // Paper background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CARD_W, H)

  const left = MARGIN
  const top = MARGIN

  // Title bar: light grey, centered bold Jua
  ctx.fillStyle = TITLE_GREY
  ctx.fillRect(left, top, TABLE_W, TITLE_H)
  ctx.fillStyle = INK
  ctx.font = TITLE_FONT
  ctx.textAlign = 'center'
  ctx.fillText(model.title, left + TABLE_W / 2, top + TITLE_H / 2 + 2)
  ctx.textAlign = 'left'

  // Rows: [grey label | value | grey label | wider value] — printed column widths.
  const colX = [left, left + LABEL_W, left + LABEL_W + VALUE1_W, left + LABEL_W * 2 + VALUE1_W]
  let y = top + TITLE_H
  model.rows.forEach((row, i) => {
    const h = rowHeights[i]
    // A cell with no label (the 목회자 연락 동의 줄) starts where its grey label would
    // have been and keeps that width — the two cells read as one merged cell.
    const belowH = belowHeights[i]
    const topH = h - belowH
    for (const { cell, lx, vx, vw, cy, ch } of [
      { cell: row.left, lx: colX[0], vx: colX[1], vw: VALUE1_W, cy: y, ch: topH },
      ...(row.leftBelow ? [{ cell: row.leftBelow, lx: colX[0], vx: colX[1], vw: VALUE1_W, cy: y + topH, ch: belowH }] : []),
      row.right.label === undefined
        ? { cell: row.right, lx: null, vx: colX[2], vw: LABEL_W + VALUE2_W, cy: y, ch: h }
        : { cell: row.right, lx: colX[2], vx: colX[3], vw: VALUE2_W, cy: y, ch: h },
    ]) {
      if (lx !== null && cell.label !== undefined) drawLabel(ctx, cell.label, lx, cy, ch)
      const c = cell.content
      if (c.kind === 'text') {
        ctx.fillStyle = INK
        ctx.font = VALUE_FONT
        if (c.text) {
          const lines = wrapLines(ctx, c.text, vw - PAD_X * 2)
          const top2 = cy + (ch - lines.length * TEXT_LINE_H) / 2
          lines.forEach((ln, li) => ctx.fillText(ln, vx + PAD_X, top2 + li * TEXT_LINE_H + TEXT_LINE_H / 2 + 1))
        }
      } else if (c.kind === 'name') {
        drawNameCell(ctx, c, vx, cy, vw, ch)
      } else if (c.kind === 'consent') {
        drawConsentCell(ctx, c, vx, cy, vw, ch)
      } else {
        drawChecksCell(ctx, c, vx, cy, vw, ch)
      }
    }
    y += h
  })

  // Grid lines (solid dark, like the printed table)
  ctx.strokeStyle = INK
  ctx.lineWidth = 1
  ctx.beginPath()
  // Horizontal: under the title, then under each row (the table bottom is the outer border)
  let gy = top + TITLE_H
  ctx.moveTo(left, gy + 0.5)
  ctx.lineTo(left + TABLE_W, gy + 0.5)
  for (let i = 0; i < rowHeights.length - 1; i++) {
    gy += rowHeights[i]
    ctx.moveTo(left, gy + 0.5)
    ctx.lineTo(left + TABLE_W, gy + 0.5)
  }
  // Vertical column separators (below the full-width title bar only), drawn row by row:
  // the row whose right cell carries no label has no separator before its value.
  // 왼쪽이 갈리는 줄에는 그 반쪽에만 가로선을 하나 더 긋는다 (오른쪽 칸은 안 갈린다).
  let vy = top + TITLE_H
  model.rows.forEach((row, i) => {
    for (const cx of row.right.label === undefined ? [colX[1], colX[2]] : [colX[1], colX[2], colX[3]]) {
      ctx.moveTo(cx + 0.5, vy)
      ctx.lineTo(cx + 0.5, vy + rowHeights[i])
    }
    if (row.leftBelow) {
      const sy = vy + rowHeights[i] - belowHeights[i]
      ctx.moveTo(left, sy + 0.5)
      ctx.lineTo(colX[2], sy + 0.5)
    }
    vy += rowHeights[i]
  })
  ctx.stroke()

  // Outer border, heavier
  ctx.lineWidth = 2
  ctx.strokeRect(left, top, TABLE_W, tableH)
  ctx.lineWidth = 1

  return canvas
}

// Per-person filenames: 새가족등록카드-YYYY-MM-DD-이름.jpg. Names are sanitized for
// the filesystem, an empty name falls back to the card's 1-based position, and a
// duplicate name within the batch gets a -2/-3… suffix so no download overwrites
// another. Pure + exported for tests.
export function cardFilenames(members: Pick<Member, 'name'>[], date: string): string[] {
  const seen = new Map<string, number>()
  return members.map((m, i) => {
    const safe = (m.name || '').replace(/[\\/:*?"<>|]/g, '').trim() || String(i + 1)
    const n = (seen.get(safe) ?? 0) + 1
    seen.set(safe, n)
    return `새가족등록카드-${date}-${safe}${n > 1 ? `-${n}` : ''}.jpg`
  })
}

// Render every member's card. Shared by the copy/save actions below so there's one
// render pass regardless of which (or both) the operator picks.
async function buildNewFamilyCards(members: Member[]): Promise<HTMLCanvasElement[]> {
  await ensureSheetFonts()
  return members.map(renderNewFamilyCard)
}

// Copy every card, stacked into a single image, to the clipboard.
export async function copyNewFamilyCards(members: Member[]): Promise<{ copied: boolean }> {
  const cards = await buildNewFamilyCards(members)
  const copied = await copyCanvasToClipboard(combineVertical(cards, 24 * SCALE))
  return { copied }
}

// Download each person's card as its own JPG.
export async function saveNewFamilyCards(members: Member[], date: string): Promise<void> {
  const cards = await buildNewFamilyCards(members)
  const filenames = cardFilenames(members, date)
  for (let i = 0; i < cards.length; i++) {
    const blob = await canvasToBlob(cards[i], 'image/jpeg', 0.95)
    if (blob) downloadBlob(blob, filenames[i])
    // A short gap so the browser accepts back-to-back downloads (as the 출석표 export).
    if (i < cards.length - 1) await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
