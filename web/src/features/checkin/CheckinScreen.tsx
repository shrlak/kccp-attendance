import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Monitor } from '../../components/ui/Icon'
import { ThemeLangToggle, iconBtnClass } from '../../components/ui/ThemeLangToggle'
import { KccpLogo } from './KccpLogo'
import { useLang } from '../../stores/useLang'

// Controls only — the logo lives in the centered hero, not the header.
function TopBar() {
  const { t } = useTranslation()
  return (
    <header className="pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-end px-5 sm:px-8">
        <ThemeLangToggle />
        <Link to="/admin" className={iconBtnClass + ' ml-1 px-2.5'}>
          {t('checkin.admin')}
        </Link>
      </div>
    </header>
  )
}

// The public landing page: a branded hero with a live Pittsburgh clock and the kiosk
// launcher. On-site attendance is taken at the kiosk (an admin device); there is no
// individual self check-in.
export function CheckinScreen() {
  const { t } = useTranslation()
  const lang = useLang((s) => s.lang)

  // Live Pittsburgh clock for the landing hero (minute precision, ticked every second).
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const locale = lang === 'ko' ? 'ko-KR' : 'en-US'
  const todayLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'America/New_York',
  }).format(now)
  const timeLabel = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(now)

  return (
    <main className="relative flex min-h-dvh flex-col bg-canvas">
      <TopBar />
      <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="fx-rise flex flex-col items-center">
          <KccpLogo size={88} stacked />
          <h1 className="mt-10 font-display text-5xl font-semibold tabular-nums tracking-[-0.03em] text-text sm:text-6xl">
            {timeLabel}
          </h1>
          <div className="mt-3 text-base font-semibold text-muted">{todayLabel}</div>
        </div>
      </section>

      <div className="flex justify-center px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <Link
          to="/kiosk"
          className={
            'fx-rise inline-flex min-h-12 w-full max-w-sm items-center justify-center gap-2.5 rounded-full border px-8 py-3.5 text-base font-semibold ' +
            'transition-[background-color,border-color,color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.97] ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ' +
            'border-primary bg-primary text-primary-fg shadow-md shadow-primary/20 hover:border-primary-hover hover:bg-primary-hover hover:shadow-lg hover:shadow-primary/25'
          }
        >
          <Monitor className="size-5" aria-hidden />
          {t('landing.kioskButton')}
        </Link>
      </div>
    </main>
  )
}
