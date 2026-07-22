import { describe, it, expect, beforeAll } from 'vitest'
import { i18n } from './i18n'

describe('i18n', () => {
  beforeAll(async () => { await i18n.init() })
  it('defaults to Korean', () => {
    expect(i18n.t('checkin.admin')).toBe('관리자')
  })
  it('switches to English', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('checkin.admin')).toBe('Admin')
    await i18n.changeLanguage('ko')
  })
})
