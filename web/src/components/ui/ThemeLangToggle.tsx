import { useTheme } from '../../stores/useTheme'
import { useLang } from '../../stores/useLang'
import { Sun, Moon } from './Icon'

// Shared button styling so the toggles (and any sibling control, e.g. the landing
// page's 관리자 link) look identical everywhere they appear.
export const iconBtnClass =
  'min-h-10 min-w-10 inline-flex items-center justify-center rounded-full text-muted hover:text-text hover:bg-fill text-xs font-semibold ' +
  'transition-[background-color,color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.9]'

// Theme (light/dark) + language (ko/en) toggle buttons. Rendered as a fragment so the
// caller controls the surrounding layout; used on the landing page, the kiosk, and the
// admin panel so the same controls are available everywhere.
export function ThemeLangToggle() {
  const theme = useTheme((s) => s.theme)
  const toggleTheme = useTheme((s) => s.toggle)
  const lang = useLang((s) => s.lang)
  const toggleLang = useLang((s) => s.toggle)
  return (
    <>
      <button type="button" onClick={toggleTheme} className={iconBtnClass} aria-label="Toggle theme">
        {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      </button>
      <button type="button" onClick={toggleLang} className={iconBtnClass} aria-label="Toggle language">
        {lang === 'ko' ? 'EN' : 'KO'}
      </button>
    </>
  )
}
