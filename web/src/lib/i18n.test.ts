import { describe, it, expect, beforeAll } from 'vitest'
import { i18n } from './i18n'

describe('i18n', () => {
  beforeAll(async () => { await i18n.init() })
  it('defaults to Korean', () => {
    expect(i18n.t('checkin.button')).toBe('체크인')
  })
  it('switches to English', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('checkin.button')).toBe('Check in')
    await i18n.changeLanguage('ko')
  })
})
