import type { Member } from './api'

// ── 상태 표기 (status marks) ─────────────────────────────────────────────────
// A member can carry several marks over time — 방학 for the summer, then 한국 귀국 from
// September, and so on — so they live in `members.status_marks` as a list. The legacy
// single `status_note/status_start/status_end` trio is still read as a one-entry list, so
// data written before the migration (and any older client) keeps working.
//
// What the marks drive:
//  · 출석부 — a bounded mark greys out the dates it covers; a *hiding* mark takes the member
//    off the sheet entirely while it covers the whole shown stretch.
//  · 멤버 탭 — a hiding mark moves the member into the 숨긴 멤버 section at the bottom.
//  · 키오스크 — a hiding mark (or 방학) hides the tile while it covers today.
//
// A mark hides when it is **open-ended** — no end date, i.e. nobody knows when (or whether)
// they come back: 졸업, 타교회 정착, 한국 귀국, 이주 … — or when its note says they left even
// though someone put an end date on it (귀국/이주/졸업). A bounded 방학 or 돌아옴 keeps the
// member in place, greyed for those dates.
//  · 통계 — 방학 excludes the member from the attendance-rate denominator.

export interface StatusMark {
  note: string
  start: string | null // ISO, inclusive; null = the mark has no span and never applies
  end: string | null // ISO, inclusive; null = open-ended
}

type MemberStatus = Pick<Member, 'status_note' | 'status_start' | 'status_end' | 'status_marks'>

// Every mark on a member, newest span first. Falls back to the legacy single fields.
export function statusMarks(m: MemberStatus): StatusMark[] {
  const list = Array.isArray(m.status_marks) ? m.status_marks : []
  const marks = list
    .filter((mark): mark is StatusMark => !!mark && typeof mark.note === 'string' && mark.note.trim().length > 0)
    .map((mark) => ({ note: mark.note.trim(), start: mark.start || null, end: mark.end || null }))
  if (marks.length) return marks.sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''))
  if (m.status_note && m.status_note.trim()) {
    return [{ note: m.status_note.trim(), start: m.status_start ?? null, end: m.status_end ?? null }]
  }
  return []
}

// A mark applies from its start through its end (open-ended when end is null). A mark
// without a start date never covers anything — it's an incomplete entry.
export function coversDate(mark: StatusMark, date: string): boolean {
  if (!mark.start) return false
  if (date < mark.start) return false
  return !mark.end || date <= mark.end
}

// The note to print in the 출석부 cell for `date` — the first mark covering it.
export function noteOn(m: MemberStatus, date: string): string | null {
  return statusMarks(m).find((mark) => coversDate(mark, date))?.note ?? null
}

// 한국 귀국 / 이주 / 졸업 — the member has left the community, as opposed to 방학 or 돌아옴
// which keep them on the roster. Matched by keyword because the note is free text
// (한국 귀국, 이주(타주), 졸업 후 취업, …).
export function isAwayNote(note?: string | null): boolean {
  const n = note ?? ''
  return n.includes('귀국') || n.includes('이주') || n.includes('졸업')
}

export function isBreakNote(note?: string | null): boolean {
  return (note ?? '').includes('방학')
}

// 무기한(종료일 없음) 표기이거나, 떠났다는 뜻의 표기(귀국/이주/졸업)면 숨긴다.
export function isHidingMark(mark: StatusMark): boolean {
  return !mark.end || isAwayNote(mark.note)
}

// Is a hiding mark in force on `date`? (무기한 표기, 또는 귀국/이주/졸업)
export function awayOn(m: MemberStatus, date: string): boolean {
  return statusMarks(m).some((mark) => isHidingMark(mark) && coversDate(mark, date))
}

// Does the member carry a "they've left" mark at all — **whatever its dates**? `awayOn`
// only sees marks covering a given day, which two real cases slip past: a 이주 dated a week
// from now (they are leaving, just not yet) and a 귀국 typed with an end date that has
// already passed. Both mean the same thing for a list that is about who to start working
// with, so the 새가족 · 새가족 교육 탭 ask this instead of the date-relative question.
export function hasHidingMark(m: MemberStatus): boolean {
  return statusMarks(m).some(isHidingMark)
}

// Do the member's hiding marks cover *every* date in [start, end]? Those members drop out of
// the 출석부 entirely rather than taking up a row of grey cells. Someone who leaves midway
// through a term still appears in that term's sheet (their earlier O/X is real history, and
// the mark greys out the tail); they disappear once a whole period falls inside their absence.
// Back-to-back marks (귀국 then 이주) count together — the sweep below closes over them.
export function awayForRange(m: MemberStatus, start: string, end: string): boolean {
  const spans = statusMarks(m)
    .filter((mark) => isHidingMark(mark) && mark.start)
    .map((mark) => ({ start: mark.start as string, end: mark.end }))
    .sort((a, b) => a.start.localeCompare(b.start))
  let covered = start
  for (const span of spans) {
    if (span.start > covered) return false // a gap before this span → not fully covered
    if (!span.end) return true // open-ended from here on
    if (span.end >= end) return true
    // The next span may pick up where this one left off (the day after, or sooner).
    if (span.end >= covered) covered = addDay(span.end)
  }
  return false
}

// 방학 (school break) covering `date` — the 통계 exclusion.
export function onBreak(m: MemberStatus, date: string): boolean {
  return statusMarks(m).some((mark) => isBreakNote(mark.note) && coversDate(mark, date))
}

// 키오스크 hides anyone a hiding mark covers today, plus 방학 (they aren't at this service
// either). A bounded 돌아옴 or another note never hides anyone.
export function hiddenFromKiosk(m: MemberStatus, today: string): boolean {
  return statusMarks(m).some(
    (mark) => (isHidingMark(mark) || isBreakNote(mark.note)) && coversDate(mark, today),
  )
}

function addDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}
