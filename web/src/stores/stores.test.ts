import { describe, it, expect, beforeEach } from 'vitest'
import { useTheme } from './useTheme'
import { useLang } from './useLang'

beforeEach(() => { localStorage.clear(); document.documentElement.className = '' })

describe('useTheme', () => {
  it('toggles and reflects on <html>.dark', () => {
    useTheme.getState().setTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    useTheme.getState().setTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
  it('persists the choice', () => {
    useTheme.getState().setTheme('dark')
    expect(localStorage.getItem('kccp-theme')).toContain('dark')
  })
})

describe('useLang', () => {
  it('defaults to ko and switches', () => {
    expect(useLang.getState().lang).toBe('ko')
    useLang.getState().setLang('en')
    expect(useLang.getState().lang).toBe('en')
  })
})
