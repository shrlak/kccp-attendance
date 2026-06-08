import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { i18n } from '../lib/i18n'

type Lang = 'ko' | 'en'
interface LangState { lang: Lang; setLang: (l: Lang) => void; toggle: () => void }

export const useLang = create<LangState>()(
  persist(
    (set, get) => ({
      lang: 'ko',
      setLang: (lang) => { i18n.changeLanguage(lang); document.documentElement.lang = lang; set({ lang }) },
      toggle: () => get().setLang(get().lang === 'ko' ? 'en' : 'ko'),
    }),
    {
      name: 'kccp-lang',
      onRehydrateStorage: () => (state) => {
        if (state) { i18n.changeLanguage(state.lang); document.documentElement.lang = state.lang }
      },
    },
  ),
)
