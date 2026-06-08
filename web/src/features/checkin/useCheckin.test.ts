import { describe, it, expect } from 'vitest'
import { toView } from './useCheckin'

const cfg = { checkinDays: [0] }
const sun = new Date('2026-06-07T18:30:00Z') // Sunday
const mon = new Date('2026-06-08T18:30:00Z') // Monday

describe('toView', () => {
  it('maps a regular success', () => {
    expect(toView({ status: 'ok', name: '김호연', time: '01:15:00 PM', totalAttendance: 5, isRegistered: true }, cfg)).toEqual({
      status: 'ok',
      name: '김호연',
      time: '01:15:00 PM',
      total: 5,
      firstVisit: false,
      registered: true,
    })
  })

  it('treats total===1 as a first visit', () => {
    const v = toView({ status: 'ok', name: 'X', totalAttendance: 1, isRegistered: false }, cfg)
    expect(v.status).toBe('ok')
    if (v.status === 'ok') expect(v.firstVisit).toBe(true)
  })

  it('maps already', () => {
    expect(toView({ status: 'already', name: 'A', time: 't' }, cfg)).toEqual({ status: 'already', name: 'A', time: 't' })
  })

  it('distinguishes wrong-time vs wrong-day from the weekday', () => {
    expect(toView({ status: 'time-restricted' }, cfg, sun).status).toBe('wrong-time')
    expect(toView({ status: 'time-restricted' }, cfg, mon).status).toBe('wrong-day')
  })

  it('maps location states', () => {
    expect(toView({ status: 'location-restricted', distance: 42 }, cfg)).toEqual({ status: 'location-restricted', distance: 42 })
    expect(toView({ status: 'location-required' }, cfg)).toEqual({ status: 'location-required' })
  })
})
