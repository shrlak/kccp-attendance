import { describe, it, expect } from 'vitest'
import {
  todayGroupRoster,
  todaySheetSlots,
  todaySheetFilename,
  TODAY_SHEET_SLOTS,
  TODAY_SHEET_ROWS,
} from './todaySheet'
import type { LogEntry } from '../../lib/api'

const entry = (name: string, group: string, ts: number, date = '2026-06-21', extra: Partial<LogEntry> = {}): LogEntry => ({
  name, group, subgroup: '', date, time: '01:00:00 PM', ts, ...extra,
})

describe('todayGroupRoster', () => {
  const today = '2026-06-21'
  const log = [
    entry('B', '대학부', 30),
    entry('A', '대학부', 10),
    entry('Y', '청년부', 20),
    entry('A', '대학부', 50), // duplicate — keeps the earlier slot
    entry('C', '대학부', 40),
    entry('Old', '대학부', 5, '2026-06-14'), // a different date — excluded
  ]

  it('returns today’s names for the group in check-in order, deduped', () => {
    expect(todayGroupRoster(log, today, '대학부')).toEqual(['A', 'B', 'C'])
    expect(todayGroupRoster(log, today, '청년부')).toEqual(['Y'])
  })

  it('excludes other dates and other groups, and ignores blank names', () => {
    const withBlank = [...log, entry('', '대학부', 60)]
    expect(todayGroupRoster(withBlank, today, '대학부')).toEqual(['A', 'B', 'C'])
    expect(todayGroupRoster(log, '2026-06-14', '대학부')).toEqual(['Old'])
  })
})

describe('todaySheetSlots', () => {
  it('always produces 60 numbered slots filled column-major', () => {
    const slots = todaySheetSlots(['A', 'B', 'C'])
    expect(slots).toHaveLength(TODAY_SHEET_SLOTS)
    expect(slots[0]).toEqual({ num: 1, name: 'A' })
    expect(slots[1]).toEqual({ num: 2, name: 'B' })
    expect(slots[2]).toEqual({ num: 3, name: 'C' })
    expect(slots[3]).toEqual({ num: 4, name: '' }) // empty beyond the roster
    expect(slots[TODAY_SHEET_SLOTS - 1]).toEqual({ num: 60, name: '' })
  })

  it('caps at 60 even with an overflowing roster (extras simply do not show)', () => {
    const many = Array.from({ length: 70 }, (_, i) => `M${i + 1}`)
    const slots = todaySheetSlots(many)
    expect(slots).toHaveLength(TODAY_SHEET_SLOTS)
    expect(slots[TODAY_SHEET_SLOTS - 1]).toEqual({ num: 60, name: 'M60' })
  })

  it('lays out as 4 columns of 15', () => {
    expect(TODAY_SHEET_ROWS).toBe(15)
    expect(TODAY_SHEET_SLOTS / TODAY_SHEET_ROWS).toBe(4)
  })
})

describe('todaySheetFilename', () => {
  it('builds kccp-today-{group}-{date}.{ext}', () => {
    expect(todaySheetFilename('대학부', '2026-06-21', 'png')).toBe('kccp-today-대학부-2026-06-21.png')
    expect(todaySheetFilename('청년부', '2026-06-21', 'jpg')).toBe('kccp-today-청년부-2026-06-21.jpg')
  })
  it('strips whitespace and omits an empty group', () => {
    expect(todaySheetFilename(' Adult Ministry ', '2026-06-21', 'png')).toBe('kccp-today-AdultMinistry-2026-06-21.png')
    expect(todaySheetFilename('', '2026-06-21', 'png')).toBe('kccp-today-2026-06-21.png')
  })
})
