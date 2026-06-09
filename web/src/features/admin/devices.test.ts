import { describe, it, expect } from 'vitest'
import { normalizeDeviceId, isValidDeviceId } from './devices'

describe('normalizeDeviceId', () => {
  it('trims surrounding whitespace from a pasted value', () => {
    expect(normalizeDeviceId('  DEV-AAAA-BBBB  ')).toBe('DEV-AAAA-BBBB')
  })
  it('leaves an already-clean value unchanged', () => {
    expect(normalizeDeviceId('ROSTER-12')).toBe('ROSTER-12')
  })
  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeDeviceId('   ')).toBe('')
  })
})

describe('isValidDeviceId', () => {
  it('accepts any non-empty token (DEV/ROSTER/manual)', () => {
    expect(isValidDeviceId('DEV-AAAA-BBBB')).toBe(true)
    expect(isValidDeviceId('ROSTER-7')).toBe(true)
    expect(isValidDeviceId('anything')).toBe(true)
  })
  it('accepts a value that is non-empty after trimming', () => {
    expect(isValidDeviceId('  DEV-1  ')).toBe(true)
  })
  it('rejects empty or whitespace-only input', () => {
    expect(isValidDeviceId('')).toBe(false)
    expect(isValidDeviceId('   ')).toBe(false)
  })
})
