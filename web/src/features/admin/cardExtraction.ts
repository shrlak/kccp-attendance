import {
  AFFILIATION_CATEGORIES,
  BAPTISM_OPTIONS,
  FAITH_OPTIONS,
  blankCardForm,
  type CardFormValue,
} from './newFamilyCard'
import { formatPhoneNumber } from '../../lib/phone'

// ── 카드 사진 인식 결과 정규화 ─────────────────────────────────────────────────
// Turns the raw JSON the extraction endpoint returns (Gemini's reading of a
// handwritten 등록 카드 — untrusted: fields may be null, misformatted, or outside
// the card's vocabulary) into a complete CardFormValue ready for the review form.
// Pure and side-effect free so every rule is unit-testable (cardExtraction.test.ts).

const GENDER_OPTIONS = ['남', '여'] as const

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function clampEnum(v: unknown, options: readonly string[]): string {
  const s = str(v)
  return options.includes(s) ? s : ''
}

// Handwritten dates arrive in whatever shape was on the card: ISO (the prompt asks
// for it), the card's printed MM / DD / YYYY order, dots, or 2-digit years. Returns
// ISO YYYY-MM-DD or '' when unparseable/impossible — never a guess.
// 2-digit-year pivot: birth years land in 19xx when 20xx would be in the future
// (born '98 → 1998, born '04 → 2004); registration dates are always 20xx.
export function normalizeCardDate(
  v: unknown,
  kind: 'birth' | 'registration',
  nowYear = new Date().getFullYear(),
): string {
  const s = str(v)
  if (!s) return ''
  const groups = s.match(/\d+/g)
  if (!groups || groups.length !== 3) return ''
  // A leading 4-digit group is ISO order (YYYY-MM-DD); otherwise the card's MM/DD/YYYY.
  const [y, mo, d] = groups[0].length === 4 ? groups : [groups[2], groups[0], groups[1]]
  let year: number
  if (y.length === 4) year = Number(y)
  else if (y.length === 2) {
    const yy = Number(y)
    year = kind === 'registration' ? 2000 + yy : 2000 + yy > nowYear ? 1900 + yy : 2000 + yy
  } else return ''
  const month = Number(mo)
  const day = Number(d)
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return ''
  // Round-trip through Date to reject impossible days like 02/30.
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Format recognizable US/Korean mobile numbers; anything else passes through as
// written so the admin sees what the card says instead of a silently mangled value.
export function normalizePhone(v: unknown): string {
  return formatPhoneNumber(str(v))
}

// Raw extraction payload → a complete CardFormValue. Unknown/null fields become the
// blank-card defaults; enums are clamped to the card's canonical vocabulary; 등록일
// falls back to `today` (same stamp the kiosk uses for a fresh card).
export function normalizeExtractedCard(raw: unknown, today: string): CardFormValue {
  const base = blankCardForm(today)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const r = raw as Record<string, unknown>
  return {
    ...base,
    name: str(r.name),
    gender: clampEnum(r.gender, GENDER_OPTIONS),
    phone: normalizePhone(r.phone),
    kakaoId: str(r.kakaoId),
    birthDate: normalizeCardDate(r.birthDate, 'birth'),
    affiliationCategory: clampEnum(r.affiliationCategory, AFFILIATION_CATEGORIES),
    affiliationDetail: str(r.affiliationDetail),
    baptismStatus: clampEnum(r.baptismStatus, BAPTISM_OPTIONS),
    faithDuration: clampEnum(r.faithDuration, FAITH_OPTIONS),
    registrationDate: normalizeCardDate(r.registrationDate, 'registration') || today,
    // Only a definite true/false reading counts — anything else (null, missing, garbage)
    // stays blank, same as a freshly opened card.
    pastoralVisitRequested: r.pastoralVisitRequested === true ? true : r.pastoralVisitRequested === false ? false : null,
  }
}

// Did the model actually read something off this card? 등록일 is excluded because it
// falls back to `today` for every card, blank ones included.
function hasContent(c: CardFormValue): boolean {
  return Boolean(
    c.name || c.gender || c.phone || c.kakaoId || c.birthDate || c.affiliationCategory ||
      c.affiliationDetail || c.baptismStatus || c.faithDuration,
  ) || c.pastoralVisitRequested !== null
}

// One photo can show several cards, so extraction returns a list. Empty-looking
// entries (a stray background object the model volunteered) are dropped; a payload
// with nothing readable at all still yields one blank card, so an unreadable photo
// lands on an empty review form to fill in by hand instead of an error.
export function normalizeExtractedCards(raw: unknown, today: string): CardFormValue[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  const cards = list.map((r) => normalizeExtractedCard(r, today)).filter(hasContent)
  return cards.length > 0 ? cards : [blankCardForm(today)]
}
