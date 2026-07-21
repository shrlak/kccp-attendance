import { describe, it, expect } from 'vitest'
import { easternNow } from './checkinWindow'

// 2026-06-07 is a Sunday. EDT = UTC-4 in June.
const sun1430 = new Date('2026-06-07T18:30:00Z') // Sun 14:30 ET → minutes 870

describe('easternNow', () => {
  it('converts to America/New_York wall clock', () => {
    const e = easternNow(sun1430)
    expect(e.weekday).toBe(0)
    expect(e.minutes).toBe(870)
    expect(e.date).toBe('2026-06-07')
  })
})
