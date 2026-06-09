import { describe, it, expect } from 'vitest'
import { renameAt, addDongsan, removeAt, cleanNames } from './dongsan'
import type { DongsanNames } from '../../lib/api'

const base: DongsanNames = {
  대학부: ['동산1', '동산2'],
  청년부: ['건영동산'],
}

describe('dongsan name-map helpers (immutable)', () => {
  it('renameAt replaces one entry without mutating the input', () => {
    const next = renameAt(base, '대학부', 1, '새동산')
    expect(next.대학부).toEqual(['동산1', '새동산'])
    expect(next.청년부).toBe(base.청년부) // untouched group keeps identity
    expect(base.대학부).toEqual(['동산1', '동산2']) // original unchanged
    expect(next).not.toBe(base)
    expect(next.대학부).not.toBe(base.대학부)
  })

  it('renameAt is a no-op for out-of-range / unknown', () => {
    expect(renameAt(base, '대학부', 9, 'x')).toBe(base)
    expect(renameAt(base, '대학부', -1, 'x')).toBe(base)
    expect(renameAt(base, '없는부서', 0, 'x')).toBe(base)
  })

  it('addDongsan appends an empty slot', () => {
    const next = addDongsan(base, '청년부')
    expect(next.청년부).toEqual(['건영동산', ''])
    expect(base.청년부).toEqual(['건영동산'])
  })

  it('addDongsan creates the group when absent', () => {
    const next = addDongsan(base, 'EM')
    expect(next.EM).toEqual([''])
  })

  it('removeAt drops one entry immutably', () => {
    const next = removeAt(base, '대학부', 0)
    expect(next.대학부).toEqual(['동산2'])
    expect(base.대학부).toEqual(['동산1', '동산2'])
  })

  it('removeAt is a no-op for out-of-range / unknown', () => {
    expect(removeAt(base, '대학부', 9)).toBe(base)
    expect(removeAt(base, '없는부서', 0)).toBe(base)
  })

  it('cleanNames trims and drops blanks', () => {
    const messy: DongsanNames = { 대학부: ['  동산1 ', '', '   ', '동산2'] }
    expect(cleanNames(messy)).toEqual({ 대학부: ['동산1', '동산2'] })
  })
})
