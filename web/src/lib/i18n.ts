import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import ko from '../i18n/ko.json'
import en from '../i18n/en.json'

export const i18n = i18next.createInstance()
i18n.use(initReactI18next).init({
  resources: { ko: { translation: ko }, en: { translation: en } },
  lng: 'ko',
  fallbackLng: 'ko',
  interpolation: { escapeValue: false },
})
