import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'
interface ThemeState { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void }

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      setTheme: (theme) => { apply(theme); set({ theme }) },
      toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    }),
    { name: 'kccp-theme', onRehydrateStorage: () => (state) => state && apply(state.theme) },
  ),
)
// Apply current value at module load (covers first paint before React mounts).
apply(useTheme.getState().theme)
