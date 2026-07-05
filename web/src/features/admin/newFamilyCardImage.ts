import type { Member } from '../../lib/api'
import {
  ensureSheetFonts,
  canvasToBlob,
  downloadBlob,
  combineVertical,
  copyCanvasToClipboard,
} from './todaySheetImage'

// ── 새가족 등록 카드 → JPG download + clipboard (Korean) ─────────────────────
// Renders each 새가족 as the same sectioned card the kiosk registration dialog
// uses (인적 사항 / 신앙 / 등록 정보, same fields in the same order), then ships
// each person's card as its OWN JPG plus all of a day's registrations stacked
// into ONE JPG. Drawing mirrors the dialog: bordered fieldset sections with the
// caption sitting on the border, 3-up field grid, label above a boxed value.
// Always Korean, like the 출석표 export.

const ACCENT = '#D9603D' // brand terracotta (matches the dialog / default sheet accent)

// Labels — fixed Korean, mirroring kiosk.newMember.* in ko.json.
const L = {
  title: '새가족 등록 카드',
  church: '피츠버그 한인중앙교회 · 대학청년부',
  sections: { personal: '인적 사항', faith: '신앙', church: '등록 정보' },
  name: '이름',
  gender: '성별',
  birthDate: '생일',
  phone: '전화',
  kakaoId: '카톡ID',
  school: '학교/직장',
  baptism: '세례 여부',
  faithDuration: '신앙 기간',
  pastoralVisit: '심방 요청',
  group: '부서',
  subgroup: '동산',
  registrationDate: '등록일',
}

interface CardField {
  label: string
  value: string
}
interface CardSection {
  label: string
  fields: CardField[]
}

// The card's sections/fields for one member — same fields, same order as the kiosk
// dialog. Pure + exported for tests; empty values render as blank boxes (like the
// paper card's unfilled lines).
export function cardSections(m: Member): CardSection[] {
  return [
    {
      label: L.sections.personal,
      fields: [
        { label: L.name, value: m.name || '' },
        { label: L.gender, value: m.gender || '' },
        { label: L.birthDate, value: m.birth_date || '' },
        { label: L.phone, value: m.phone || '' },
        { label: L.kakaoId, value: m.kakao_id || '' },
        { label: L.school, value: m.school_or_work || '' },
      ],
    },
    {
      label: L.sections.faith,
      fields: [
        { label: L.baptism, value: m.baptism_status || '' },
        { label: L.faithDuration, value: m.faith_duration || '' },
        { label: L.pastoralVisit, value: m.pastoral_visit_requested ? '🙏 요청' : '' },
      ],
    },
    {
      label: L.sections.church,
      fields: [
        { label: L.group, value: m.group_name || '' },
        { label: L.subgroup, value: m.subgroup || '' },
        { label: L.registrationDate, value: m.registration_date || '' },
      ],
    },
  ]
}

// Logical-pixel layout; rendered at SCALE× for a crisp raster (as todaySheetImage).
const SCALE = 2
const CARD_W = 720
const PAD = 32 // card padding
const HEADER_H = 58
const SEC_GAP = 18 // between sections
const SEC_PAD = 16 // inside a section box
const LEGEND_H = 8 // extra headroom above the first field row for the on-border caption
const COLS = 3
const COL_GAP = 14
const LABEL_H = 20 // field label line
const BOX_H = 42 // value box
const ROW_GAP = 14

const FIELD_W = (CARD_W - PAD * 2 - SEC_PAD * 2 - COL_GAP * (COLS - 1)) / COLS

function sectionHeight(fieldCount: number): number {
  const rows = Math.ceil(fieldCount / COLS)
  return SEC_PAD + LEGEND_H + rows * (LABEL_H + BOX_H) + (rows - 1) * ROW_GAP + SEC_PAD
}

export function cardHeight(m: Member): number {
  const secs = cardSections(m)
  return PAD + HEADER_H + secs.reduce((h, s) => h + sectionHeight(s.fields.length), 0) + SEC_GAP * (secs.length - 1) + PAD
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

// Draw one member's 등록 카드 onto a fresh canvas and return it.
export function renderNewFamilyCard(m: Member): HTMLCanvasElement {
  const H = cardHeight(m)
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'middle'

  // Card background + outer border
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, CARD_W, H)
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 2
  roundRect(ctx, 1, 1, CARD_W - 2, H - 2, 14)
  ctx.stroke()
  ctx.lineWidth = 1

  // Header: title (accent, display font) + church line right
  ctx.fillStyle = ACCENT
  ctx.font = '700 26px "Jua", sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText(`✝️ ${L.title}`, PAD, PAD + HEADER_H / 2 - 8)
  ctx.fillStyle = '#9ca3af'
  ctx.font = '400 13px "Gowun Dodum", sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(L.church, CARD_W - PAD, PAD + HEADER_H / 2 - 8)
  // Rule under the header
  ctx.strokeStyle = '#e5e7eb'
  ctx.beginPath()
  ctx.moveTo(PAD, PAD + HEADER_H - 10)
  ctx.lineTo(CARD_W - PAD, PAD + HEADER_H - 10)
  ctx.stroke()

  let y = PAD + HEADER_H
  for (const sec of cardSections(m)) {
    const h = sectionHeight(sec.fields.length)
    // Section box with the caption sitting on the border (fieldset/legend look)
    ctx.strokeStyle = '#d1d5db'
    roundRect(ctx, PAD, y, CARD_W - PAD * 2, h, 10)
    ctx.stroke()
    ctx.font = '700 12px "Gowun Dodum", sans-serif'
    const capW = ctx.measureText(sec.label).width
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(PAD + 14, y - 7, capW + 12, 14) // punch a gap in the border
    ctx.fillStyle = '#6b7280'
    ctx.textAlign = 'left'
    ctx.fillText(sec.label, PAD + 20, y + 1)

    // Fields, 3-up
    sec.fields.forEach((f, i) => {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const fx = PAD + SEC_PAD + col * (FIELD_W + COL_GAP)
      const fy = y + SEC_PAD + LEGEND_H + row * (LABEL_H + BOX_H + ROW_GAP)
      ctx.fillStyle = '#6b7280'
      ctx.font = '700 12px "Gowun Dodum", sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(f.label, fx + 2, fy + LABEL_H / 2)
      // Value box (Input look)
      ctx.strokeStyle = '#d1d5db'
      roundRect(ctx, fx, fy + LABEL_H, FIELD_W, BOX_H, 8)
      ctx.stroke()
      if (f.value) {
        ctx.fillStyle = '#1f2937'
        ctx.font = '400 16px "Gowun Dodum", sans-serif'
        ctx.fillText(truncate(ctx, f.value, FIELD_W - 24), fx + 12, fy + LABEL_H + BOX_H / 2 + 1)
      }
    })
    y += h + SEC_GAP
  }

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

// Render every member's card, download each person's card as its own JPG plus all
// of them stacked into a single JPG (새가족등록카드-YYYY-MM-DD.jpg), and copy the
// stacked image to the clipboard. Returns whether the clipboard copy succeeded
// (downloads happen regardless).
export async function exportNewFamilyCards(members: Member[], date: string): Promise<{ copied: boolean }> {
  await ensureSheetFonts()
  const cards = members.map(renderNewFamilyCard)
  const combined = combineVertical(cards, 24 * SCALE)

  // Copy first — closest to the originating click, so the clipboard write keeps its
  // transient user activation before the downloads (and their delays) run.
  const copied = await copyCanvasToClipboard(combined)

  // One JPG per person, then the whole batch as one JPG. A single card IS the batch,
  // so skip the redundant combined download when only one person registered.
  const filenames = cardFilenames(members, date)
  const downloads: [HTMLCanvasElement, string][] = cards.map((c, i) => [c, filenames[i]])
  if (cards.length > 1) downloads.push([combined, `새가족등록카드-${date}.jpg`])
  for (let i = 0; i < downloads.length; i++) {
    const blob = await canvasToBlob(downloads[i][0], 'image/jpeg', 0.95)
    if (blob) downloadBlob(blob, downloads[i][1])
    // A short gap so the browser accepts back-to-back downloads (as the 출석표 export).
    if (i < downloads.length - 1) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return { copied }
}
