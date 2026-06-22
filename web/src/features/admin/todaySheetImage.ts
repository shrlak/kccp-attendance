import {
  TODAY_SHEET_COLUMNS,
  TODAY_SHEET_GROUPS,
  TODAY_SHEET_ROWS,
  todayGroupRoster,
  todaySheetFilename,
  todaySheetSlots,
} from './todaySheet'
import { formatHeaderDate, type Lang } from './exports'
import type { LogEntry } from '../../lib/api'

// ── Today's check-in sheet → PNG/JPG ─────────────────────────────────────────
// The DOM side of the sheet export: render a 부서's numbered roll sheet onto a
// canvas and save it as an image. The pure model lives in todaySheet.ts.

export type ImageFormat = 'png' | 'jpg'

// Per-부서 accent, matching the analytics/kiosk palette (대학부 gold, 청년부 blue);
// anything else falls back to the brand terracotta.
const GROUP_ACCENT: Record<string, string> = { 대학부: '#E0A800', 청년부: '#3B82F6' }
const DEFAULT_ACCENT = '#D9603D'

// Logical-pixel layout; the canvas is rendered at SCALE× for a crisp raster.
const SCALE = 2
const MARGIN = 40
const TITLE_H = 52
const GAP = 22
const HEADER_H = 36
const ROW_H = 44
const NUM_W = 48
const NAME_W = 188
const COL_W = NUM_W + NAME_W
const GRID_W = COL_W * TODAY_SHEET_COLUMNS
const GRID_H = HEADER_H + ROW_H * TODAY_SHEET_ROWS
const W = MARGIN * 2 + GRID_W
const H = MARGIN + TITLE_H + GAP + GRID_H + MARGIN

function labels(lang: Lang) {
  return lang === 'ko'
    ? { num: '번호', name: '이름', title: '출석부', count: (n: number) => `총 ${n}명 출석` }
    : { num: 'No.', name: 'Name', title: 'Attendance', count: (n: number) => `${n} present` }
}

// Make sure the Jua/Gowun Dodum web fonts are loaded so the canvas rasterizes them
// (instead of a system fallback). Best-effort — drawing still succeeds on failure.
export async function ensureSheetFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await Promise.all([
      document.fonts.load('700 34px "Jua"'),
      document.fonts.load('400 18px "Gowun Dodum"'),
      document.fonts.load('700 16px "Gowun Dodum"'),
    ])
    await document.fonts.ready
  } catch {
    // ignore — fall back to system fonts
  }
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

// "#E0A800" + alpha → "rgba(r, g, b, a)" for the light number-cell tint.
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Trim `text` with an ellipsis so it fits within `maxW` px at the current font.
function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

// Draw one 부서's 60-slot sheet onto a fresh canvas and return it.
export function renderTodaySheet(group: string, names: string[], date: string, lang: Lang): HTMLCanvasElement {
  const L = labels(lang)
  const accent = GROUP_ACCENT[group] ?? DEFAULT_ACCENT
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'middle'

  // Background
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  // Title (left) + date · count (right)
  ctx.fillStyle = accent
  ctx.font = '700 32px "Jua", sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`${group} ${L.title}`, MARGIN, MARGIN + TITLE_H / 2)
  ctx.fillStyle = '#6b7280'
  ctx.font = '400 17px "Gowun Dodum", sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(`${formatHeaderDate(date, lang)} · ${L.count(names.length)}`, W - MARGIN, MARGIN + TITLE_H / 2)

  const gridTop = MARGIN + TITLE_H + GAP
  const gridLeft = MARGIN
  const slots = todaySheetSlots(names)

  // Cell fills + text
  for (let c = 0; c < TODAY_SHEET_COLUMNS; c++) {
    const x = gridLeft + c * COL_W
    // Column header band
    ctx.fillStyle = accent
    ctx.fillRect(x, gridTop, COL_W, HEADER_H)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.font = '700 15px "Gowun Dodum", sans-serif'
    ctx.fillText(L.num, x + NUM_W / 2, gridTop + HEADER_H / 2)
    ctx.fillText(L.name, x + NUM_W + NAME_W / 2, gridTop + HEADER_H / 2)

    for (let r = 0; r < TODAY_SHEET_ROWS; r++) {
      const slot = slots[c * TODAY_SHEET_ROWS + r]
      const y = gridTop + HEADER_H + r * ROW_H
      // Number cell — light accent tint
      ctx.fillStyle = tint(accent, 0.1)
      ctx.fillRect(x, y, NUM_W, ROW_H)
      ctx.fillStyle = '#374151'
      ctx.textAlign = 'center'
      ctx.font = '700 15px "Gowun Dodum", sans-serif'
      ctx.fillText(String(slot.num), x + NUM_W / 2, y + ROW_H / 2)
      // Name cell
      if (slot.name) {
        ctx.fillStyle = '#1f2937'
        ctx.textAlign = 'left'
        ctx.font = '400 18px "Gowun Dodum", sans-serif'
        ctx.fillText(truncate(ctx, slot.name, NAME_W - 22), x + NUM_W + 12, y + ROW_H / 2)
      }
    }
  }

  // Grid lines (drawn on top of the fills)
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1
  for (let r = 0; r <= TODAY_SHEET_ROWS; r++) {
    const y = gridTop + HEADER_H + r * ROW_H
    line(ctx, gridLeft, y, gridLeft + GRID_W, y)
  }
  line(ctx, gridLeft, gridTop, gridLeft + GRID_W, gridTop) // top of header
  for (let c = 0; c < TODAY_SHEET_COLUMNS; c++) {
    const x = gridLeft + c * COL_W
    line(ctx, x, gridTop, x, gridTop + GRID_H) // column left edge
    line(ctx, x + NUM_W, gridTop, x + NUM_W, gridTop + GRID_H) // 번호/이름 divider
  }
  line(ctx, gridLeft + GRID_W, gridTop, gridLeft + GRID_W, gridTop + GRID_H) // right edge

  return canvas
}

// Save a canvas to disk as a PNG/JPG download.
async function downloadCanvas(canvas: HTMLCanvasElement, filename: string, format: ImageFormat): Promise<void> {
  const type = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, format === 'jpg' ? 0.95 : undefined),
  )
  if (!blob) throw new Error('canvas.toBlob returned null')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Build and download the 대학부 + 청년부 sheets (two image files) for `today`.
export async function exportTodaySheets(log: LogEntry[], today: string, lang: Lang, format: ImageFormat): Promise<void> {
  await ensureSheetFonts()
  for (const group of TODAY_SHEET_GROUPS) {
    const names = todayGroupRoster(log, today, group)
    const canvas = renderTodaySheet(group, names, today, lang)
    await downloadCanvas(canvas, todaySheetFilename(group, today, format), format)
    // A short gap so the browser accepts the second (back-to-back) download.
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
