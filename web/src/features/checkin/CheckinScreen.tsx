import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getConfig, type AppConfig, type SelfRegisterResponse } from '../../lib/api'
import { DEFAULT_GROUP_COLORS } from '../admin/groupColors'
import { isCheckinOpen, formatMinutes } from '../../lib/checkinWindow'
import { Button } from '../../components/ui/Button'
import { Monitor } from '../../components/ui/Icon'
import { ThemeLangToggle, iconBtnClass } from '../../components/ui/ThemeLangToggle'
import { KccpMark } from './KccpMark'
import { KccpLogo } from './KccpLogo'
import { CheckinResult } from './CheckinResult'
import { SelfRegisterDialog } from './SelfRegisterDialog'
import { useCheckin } from './useCheckin'
import { syncQueuedCheckins } from './sync'
import { useLang } from '../../stores/useLang'

const DEFAULT_CFG: AppConfig = {
  announcement: '',
  checkinDays: [0],
  checkinStartMin: 780,
  checkinEndMin: 900,
  requireApproval: false,
  summerMode: false,
  demoMode: false,
  individualCheckinEnabled: false,
  groupColors: DEFAULT_GROUP_COLORS,
}

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

function WindowBadge({ cfg }: { cfg: AppConfig }) {
  const { t } = useTranslation()
  const open = isCheckinOpen(cfg)
  return (
    <div className="inline-flex items-center gap-2.5 rounded-full border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <span className={'h-1.5 w-1.5 rounded-full ' + (open ? 'bg-success' : 'bg-subtle')} aria-hidden />
      <span className={open ? 'font-semibold text-success' : 'font-semibold text-muted'}>
        {open ? t('checkin.open') : t('checkin.closed')}
      </span>
      <span className="border-l border-border pl-2.5 font-mono text-[11px] text-subtle">
        {t('checkin.windowRange', { from: formatMinutes(cfg.checkinStartMin), to: formatMinutes(cfg.checkinEndMin) })}
      </span>
    </div>
  )
}

export function CheckinScreen() {
  const { t } = useTranslation()
  const lang = useLang((s) => s.lang)
  const { data, isLoading, isError } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const cfg: AppConfig | undefined = data ?? (isError ? DEFAULT_CFG : undefined)
  const { phase, checkIn, reset, setPhase } = useCheckin(cfg)
  const [registerOpen, setRegisterOpen] = useState(false)

  // Live Pittsburgh clock for the landing hero (minute precision, ticked every second).
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Drain any offline-queued check-ins now and whenever connectivity returns.
  useEffect(() => {
    if (navigator.onLine) void syncQueuedCheckins()
    const onOnline = () => void syncQueuedCheckins()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  function handleRegistered(res: SelfRegisterResponse) {
    if (res.status === 'pending') {
      setPhase({ kind: 'result', view: { status: 'pending' } })
      return
    }
    // Back-fill the name onto the success screen we already showed.
    setPhase((p) =>
      p.kind === 'result' && p.view.status === 'ok'
        ? { kind: 'result', view: { ...p.view, name: res.name ?? p.view.name, registered: true } }
        : p,
    )
  }

  if (!cfg && isLoading) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <KccpMark size={72} className="fx-pulse text-primary" />
      </main>
    )
  }

  const config = cfg ?? DEFAULT_CFG
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
      {phase.kind === 'idle' && (
        <>
          <TopBar />
          <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-10 text-center">
            <div className="fx-rise flex flex-col items-center">
              <KccpLogo size={88} stacked />
              <h1 className="mt-10 font-display text-5xl font-semibold tabular-nums tracking-[-0.03em] text-text sm:text-6xl">
                {timeLabel}
              </h1>
              <div className="mt-3 text-base font-semibold text-muted">{todayLabel}</div>
            </div>

            {config.individualCheckinEnabled && (
              <div className="fx-rise mt-8 flex w-full max-w-sm flex-col items-center gap-4">
                {config.announcement && (
                  <div className="w-full rounded-r-xl border-l-2 border-gold bg-gold/[0.08] px-4 py-3 text-left">
                    <div className="section-kicker text-gold">{t('announce.label')}</div>
                    <div className="mt-1.5 text-sm leading-6 text-text">{config.announcement}</div>
                  </div>
                )}
                <WindowBadge cfg={config} />
                <Button onClick={() => void checkIn()} className="w-full py-3.5 text-base">
                  {t('checkin.button')}
                </Button>
              </div>
            )}
          </section>

          <div className="flex justify-center px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
            {/* One primary action per screen: when individual check-in is on, 체크인 is the
                primary CTA and the kiosk launcher steps back to a secondary style. With
                individual check-in off, the kiosk launcher is the only action → primary. */}
            <Link
              to="/kiosk"
              className={
                'fx-rise inline-flex min-h-12 w-full max-w-sm items-center justify-center gap-2.5 rounded-full border px-8 py-3.5 text-base font-semibold ' +
                'transition-[background-color,border-color,color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.97] ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ' +
                (config.individualCheckinEnabled
                  ? 'border-border bg-surface text-text hover:border-primary/35 hover:bg-surface-alt hover:shadow-sm'
                  : 'border-primary bg-primary text-primary-fg shadow-md shadow-primary/20 hover:border-primary-hover hover:bg-primary-hover hover:shadow-lg hover:shadow-primary/25')
              }
            >
              <Monitor className="size-5" aria-hidden />
              {t('landing.kioskButton')}
            </Link>
          </div>
        </>
      )}

      {phase.kind === 'checking' && (
        <div className="grid flex-1 place-items-center px-6 py-12">
          <div className="surface-panel flex w-full max-w-sm flex-col items-center px-8 py-12 text-center">
            <KccpMark size={72} className="fx-pulse" />
            <div className="mt-6 font-display text-xl font-bold text-text">{t('checkin.checking')}</div>
            <div className="mt-2 text-xs text-subtle">{t('checkin.checkingLocation')}</div>
          </div>
        </div>
      )}

      {phase.kind === 'result' && (
        <div className="grid flex-1 place-items-center px-6 py-12">
          <div className="surface-panel w-full max-w-md px-8 py-10">
            <CheckinResult view={phase.view} cfg={config} onRetry={reset} onRegister={() => setRegisterOpen(true)} />
          </div>
        </div>
      )}

      <SelfRegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onRegistered={handleRegistered} />
    </main>
  )
}
