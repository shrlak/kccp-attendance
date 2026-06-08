import { describe, it, expect } from 'vitest'
import { easternNow, isCheckinOpen, requiresLocation, formatMinutes } from './checkinWindow'

// 2026-06-07 is a Sunday. EDT = UTC-4 in June.
const sun1430 = new Date('2026-06-07T18:30:00Z') // Sun 14:30 ET → minutes 870
const sun0700 = new Date('2026-06-07T11:00:00Z') // Sun 07:00 ET → minutes 420
const mon1430 = new Date('2026-06-08T18:30:00Z') // Mon 14:30 ET

const cfg = { checkinDays: [0], checkinStartMin: 780, checkinEndMin: 900, demoMode: false }

describe('easternNow', () => {
  it('converts to America/New_York wall clock', () => {
    const e = easternNow(sun1430)
    expect(e.weekday).toBe(0)
    expect(e.minutes).toBe(870)
    expect(e.date).toBe('2026-06-07')
  })
})

describe('isCheckinOpen', () => {
  it('open inside the Sunday window', () => expect(isCheckinOpen(cfg, sun1430)).toBe(true))
  it('closed before the window', () => expect(isCheckinOpen(cfg, sun0700)).toBe(false))
  it('closed on a non-check-in day', () => expect(isCheckinOpen(cfg, mon1430)).toBe(false))
  it('demo mode is always open', () => expect(isCheckinOpen({ ...cfg, demoMode: true }, mon1430)).toBe(true))
})

describe('requiresLocation', () => {
  it('true when the server would enforce it', () => expect(requiresLocation(cfg, sun1430)).toBe(true))
  it('false in demo mode', () => expect(requiresLocation({ ...cfg, demoMode: true }, sun1430)).toBe(false))
  it('false outside the window', () => expect(requiresLocation(cfg, sun0700)).toBe(false))
})

describe('formatMinutes', () => {
  it('formats 12h clock with AM/PM', () => {
    expect(formatMinutes(780)).toBe('01:00 PM')
    expect(formatMinutes(900)).toBe('03:00 PM')
    expect(formatMinutes(0)).toBe('12:00 AM')
    expect(formatMinutes(720)).toBe('12:00 PM')
  })
})
