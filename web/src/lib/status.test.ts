import { describe, it, expect } from 'vitest'
import type { Member } from './api'
import {
  awayForRange,
  awayOn,
  coversDate,
  hiddenFromKiosk,
  isAwayNote,
  noteOn,
  onBreak,
  statusMarks,
  type StatusMark,
} from './status'

const member = (extra: Partial<Member> = {}): Member => ({
  id: '1', name: 'A', group_name: '청년부', subgroup: '건영동산', member_role: '', gender: '',
  phone: '', birth_date: null, kakao_id: '', is_new_member: false, notes: '', ...extra,
})
const mark = (note: string, start: string | null, end: string | null = null): StatusMark => ({ note, start, end })

describe('statusMarks', () => {
  it('reads the list, newest span first', () => {
    const m = member({ status_marks: [mark('방학', '2026-06-07', '2026-07-05'), mark('한국 귀국', '2026-08-02')] })
    expect(statusMarks(m).map((s) => s.note)).toEqual(['한국 귀국', '방학'])
  })
  it('falls back to the legacy single mark when the list is empty', () => {
    const m = member({ status_note: '이주', status_start: '2026-07-12', status_end: null })
    expect(statusMarks(m)).toEqual([{ note: '이주', start: '2026-07-12', end: null }])
  })
  it('drops blank notes and returns nothing for a clean member', () => {
    expect(statusMarks(member({ status_marks: [mark('  ', '2026-06-07')] }))).toEqual([])
    expect(statusMarks(member())).toEqual([])
  })
})

describe('coversDate / noteOn', () => {
  const m = member({ status_marks: [mark('방학', '2026-06-07', '2026-07-05'), mark('한국 귀국', '2026-08-02')] })
  it('covers from start through end, open-ended when end is null', () => {
    expect(coversDate(mark('방학', '2026-06-07', '2026-07-05'), '2026-06-07')).toBe(true)
    expect(coversDate(mark('방학', '2026-06-07', '2026-07-05'), '2026-07-06')).toBe(false)
    expect(coversDate(mark('이주', '2026-07-12', null), '2027-01-01')).toBe(true)
    // 시작일 없는 표기는 아무 날짜도 덮지 않는다 (아직 덜 쓴 항목).
    expect(coversDate(mark('이주', null), '2026-07-12')).toBe(false)
  })
  it('prints the mark that covers the date — each span its own note', () => {
    expect(noteOn(m, '2026-06-14')).toBe('방학')
    expect(noteOn(m, '2026-07-19')).toBeNull() // 사이 기간엔 표기 없음
    expect(noteOn(m, '2026-08-09')).toBe('한국 귀국')
  })
})

describe('isAwayNote', () => {
  it('is about 귀국 / 이주 — not 방학 or 돌아옴', () => {
    expect(isAwayNote('한국 귀국')).toBe(true)
    expect(isAwayNote('이주(타주)')).toBe(true)
    expect(isAwayNote('방학')).toBe(false)
    expect(isAwayNote('돌아옴')).toBe(false)
    expect(isAwayNote('')).toBe(false)
    expect(isAwayNote(undefined)).toBe(false)
  })
})

describe('awayOn', () => {
  const m = member({ status_marks: [mark('방학', '2026-06-07', '2026-07-05'), mark('한국 귀국', '2026-08-02')] })
  it('only counts the 귀국/이주 spans', () => {
    expect(awayOn(m, '2026-06-14')).toBe(false) // 방학은 자리를 지킨다
    expect(awayOn(m, '2026-08-01')).toBe(false)
    expect(awayOn(m, '2026-08-02')).toBe(true)
    expect(awayOn(m, '2027-05-01')).toBe(true) // 열린 기간
  })
})

describe('awayForRange (출석부에서 숨기는 조건)', () => {
  it('hides a member whose 귀국 covers the whole shown stretch', () => {
    const m = member({ status_marks: [mark('한국 귀국', '2026-07-05')] })
    expect(awayForRange(m, '2026-08-09', '2026-08-30')).toBe(true)
  })
  it('keeps a member who was around for part of it (그 학기 기록은 남는다)', () => {
    const m = member({ status_marks: [mark('한국 귀국', '2026-07-05')] })
    expect(awayForRange(m, '2026-06-07', '2026-08-02')).toBe(false)
  })
  it('keeps a member whose mark ends inside the range (돌아온 뒤)', () => {
    const m = member({ status_marks: [mark('이주', '2026-05-01', '2026-08-16')] })
    expect(awayForRange(m, '2026-08-09', '2026-08-30')).toBe(false)
  })
  it('closes over back-to-back 귀국 → 이주 spans', () => {
    const m = member({
      status_marks: [mark('한국 귀국', '2026-06-01', '2026-08-16'), mark('이주', '2026-08-17')],
    })
    expect(awayForRange(m, '2026-08-09', '2026-08-30')).toBe(true)
  })
  it('ignores 방학 and unmarked members', () => {
    expect(awayForRange(member({ status_marks: [mark('방학', '2026-01-01')] }), '2026-08-09', '2026-08-30')).toBe(false)
    expect(awayForRange(member(), '2026-08-09', '2026-08-30')).toBe(false)
  })
})

describe('onBreak / hiddenFromKiosk', () => {
  const m = member({ status_marks: [mark('방학', '2026-06-07', '2026-07-05'), mark('한국 귀국', '2026-08-02')] })
  it('방학 covers the analytics exclusion', () => {
    expect(onBreak(m, '2026-06-14')).toBe(true)
    expect(onBreak(m, '2026-08-09')).toBe(false)
  })
  it('the kiosk hides 귀국·이주·방학 while a mark covers today', () => {
    expect(hiddenFromKiosk(m, '2026-06-14')).toBe(true) // 방학
    expect(hiddenFromKiosk(m, '2026-07-19')).toBe(false) // 사이 기간
    expect(hiddenFromKiosk(m, '2026-08-09')).toBe(true) // 한국 귀국
    expect(hiddenFromKiosk(member({ status_marks: [mark('돌아옴', '2026-06-07')] }), '2026-06-14')).toBe(false)
  })
})
