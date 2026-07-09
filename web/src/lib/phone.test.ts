import { describe, it, expect } from 'vitest'
import { formatPhoneNumber } from './phone'

describe('formatPhoneNumber', () => {
  it('masks progressively as digits are typed', () => {
    expect(formatPhoneNumber('4')).toBe('(4')
    expect(formatPhoneNumber('412')).toBe('(412')
    expect(formatPhoneNumber('4125')).toBe('(412) 5')
    expect(formatPhoneNumber('412555')).toBe('(412) 555')
    expect(formatPhoneNumber('4125551')).toBe('(412) 555-1')
  })
  it('formats a full 10-digit US number', () => {
    expect(formatPhoneNumber('4125551234')).toBe('(412) 555-1234')
    expect(formatPhoneNumber('(412) 555-1234')).toBe('(412) 555-1234')
  })
  it('formats 11-digit 010 Korean mobiles', () => {
    expect(formatPhoneNumber('01012345678')).toBe('010-1234-5678')
    expect(formatPhoneNumber('010 1234 5678')).toBe('010-1234-5678')
  })
  it('passes through empty, partial-looking, and unrecognized values unchanged', () => {
    expect(formatPhoneNumber('')).toBe('')
    expect(formatPhoneNumber('  +82 10 1234 5678 ')).toBe('  +82 10 1234 5678 ')
    expect(formatPhoneNumber('연락처 없음')).toBe('연락처 없음')
  })
})
