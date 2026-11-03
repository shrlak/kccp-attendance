import { describe, it, expect, beforeEach } from 'vitest'
import { ADMIN_TABS, isTab, readLastTab, writeLastTab, clearLastTab, defaultTab } from './adminTab'

beforeEach(() => { sessionStorage.clear() })

describe('adminTab (마지막으로 보던 탭 기억)', () => {
  it('round-trips a tab through sessionStorage', () => {
    expect(readLastTab()).toBeNull()
    writeLastTab('newfamilyEdu')
    expect(readLastTab()).toBe('newfamilyEdu')
    clearLastTab()
    expect(readLastTab()).toBeNull()
  })

  it('rejects anything that is not a known tab id', () => {
    expect(isTab('today')).toBe(true)
    expect(isTab('nope')).toBe(false)
    expect(isTab(null)).toBe(false)
    expect(isTab(3)).toBe(false)
    // A value left by an older build must not resurrect a tab that no longer exists.
    sessionStorage.setItem('kccp-admin-tab', 'retired-tab')
    expect(readLastTab()).toBeNull()
  })

  it('every id in ADMIN_TABS survives a round trip', () => {
    for (const tab of ADMIN_TABS) {
      writeLastTab(tab)
      expect(readLastTab()).toBe(tab)
    }
  })

  it('starts on 오늘 only on Sunday, 멤버 every other day', () => {
    expect(defaultTab(0)).toBe('today')
    for (const wd of [1, 2, 3, 4, 5, 6]) expect(defaultTab(wd)).toBe('members')
  })
})
