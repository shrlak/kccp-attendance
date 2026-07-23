import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Monitor, ArrowRight } from '../../components/ui/Icon'
import { ThemeLangToggle, iconBtnClass } from '../../components/ui/ThemeLangToggle'
import { KccpLogo } from './KccpLogo'
import { useLang } from '../../stores/useLang'

// Controls only — the logo lives in the centered hero, not the header.
function TopBar() {
  const { t } = useTranslation()
  return (
    <header className="material-bar sticky top-0 z-20 border-b pt-[env(safe-area-inset-top)]">
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
      {/* Soft ambient accents behind the hero for gentle depth. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl" />
        <div className="absolute -bottom-40 right-[-6rem] h-80 w-80 rounded-full bg-gold/[0.06] blur-3xl" />
      </div>

      <TopBar />

      <section className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-14 text-center">
        <div className="fx-rise flex flex-col items-center">
          <KccpLogo size={92} stacked />

          <h1 className="mt-14 font-display text-7xl font-semibold leading-none tabular-nums tracking-[-0.045em] text-text sm:text-8xl">
            {timeLabel}
          </h1>

          <div className="mt-6 inline-flex items-center gap-2.5 rounded-full bg-fill px-4 py-2 text-sm font-semibold text-muted">
            <span className="size-1.5 rounded-full bg-success fx-pulse" aria-hidden />
            {todayLabel}
          </div>
        </div>
      </section>

      <div className="relative flex justify-center px-6 pb-[calc(3rem+env(safe-area-inset-bottom))]">
        <Link
          to="/kiosk"
          className={
            'fx-rise group inline-flex min-h-14 w-full max-w-sm items-center justify-center gap-3 rounded-full border px-8 py-4 text-lg font-semibold ' +
            'transition-[background-color,border-color,color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.97] ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ' +
            'border-primary bg-primary text-primary-fg shadow-[0_8px_28px_color-mix(in_srgb,var(--primary)_32%,transparent)] hover:border-primary-hover hover:bg-primary-hover hover:brightness-[1.02] hover:shadow-[0_12px_36px_color-mix(in_srgb,var(--primary)_40%,transparent)]'
          }
        >
          <Monitor className="size-5" strokeWidth={2} aria-hidden />
          {t('landing.kioskButton')}
          <ArrowRight
            className="size-5 transition-transform duration-200 [transition-timing-function:var(--ease-out-soft)] group-hover:translate-x-0.5"
            strokeWidth={2}
            aria-hidden
          />
        </Link>
      </div>
    </main>
  )
}
