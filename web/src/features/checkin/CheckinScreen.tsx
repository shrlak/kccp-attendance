import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { getConfig, type AppConfig, type SelfRegisterResponse } from '../../lib/api'
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
}

function TopBar() {
  const { t } = useTranslation()
  return (
    <header className="border-b border-border bg-surface/75 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5" aria-label="KCCP">
          <KccpMark size={28} />
          <div>
            <div className="font-display text-sm font-bold leading-none tracking-tight text-text">KCCP</div>
            <div className="mt-1 text-[10px] font-semibold text-muted">대학 · 청년부 출석</div>
          </div>
        </Link>
        <div className="flex items-center gap-1">
          <ThemeLangToggle />
          <Link to="/admin" className={iconBtnClass + ' ml-1 px-2.5'}>
            {t('checkin.admin')}
          </Link>
        </div>
      </div>
    </header>
  )
}

function WindowBadge({ cfg }: { cfg: AppConfig }) {
  const { t } = useTranslation()
  const open = isCheckinOpen(cfg)
  return (
    <div className="inline-flex items-center gap-2.5 rounded-sm border border-border bg-surface-alt px-3 py-2 text-xs">
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
  const todayLabel = new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'America/New_York',
  }).format(new Date())

  return (
    <main className="relative flex min-h-dvh flex-col bg-canvas">
      {phase.kind === 'idle' && (
        <>
          <TopBar />
          <div className="mx-auto grid w-full max-w-6xl flex-1 items-stretch lg:grid-cols-[1.08fr_.92fr]">
            <section className="flex flex-col justify-between px-6 py-12 sm:px-10 sm:py-16 lg:px-12 lg:py-20">
              <div className="fx-rise max-w-xl">
                <KccpLogo size={48} />
                <div className="mt-14 section-kicker">Sunday Attendance · Pittsburgh</div>
                <h1 className="mt-4 max-w-lg font-display text-4xl font-bold leading-[1.16] tracking-[-0.035em] text-text sm:text-5xl">
                  {t('landing.title')}
                </h1>
                <p className="mt-5 max-w-md text-base leading-7 text-muted">{t('landing.description')}</p>

                <dl className="mt-10 grid max-w-lg grid-cols-2 border-y border-border py-5">
                  <div className="border-r border-border pr-5">
                    <dt className="section-kicker">{t('landing.today')}</dt>
                    <dd className="mt-2 text-sm font-semibold text-text">{todayLabel}</dd>
                  </div>
                  <div className="pl-5">
                    <dt className="section-kicker">{t('landing.checkinMethod')}</dt>
                    <dd className="mt-2 text-sm font-semibold text-text">{t('landing.checkinMethodValue')}</dd>
                  </div>
                </dl>
              </div>

              <p className="mt-14 text-xs leading-5 text-subtle">{t('landing.subtitle')}</p>
            </section>

            <aside className="flex items-center border-t border-border bg-surface-alt/55 px-6 py-10 sm:px-10 lg:border-l lg:border-t-0 lg:px-12">
              <div className="surface-panel fx-rise w-full overflow-hidden">
                <div className="border-b border-border px-6 py-5 sm:px-7">
                  <div className="section-kicker">{t('landing.attendanceDesk')}</div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-display text-xl font-bold tracking-tight text-text">{t('landing.thisSunday')}</h2>
                    <WindowBadge cfg={config} />
                  </div>
                </div>

                <div className="px-6 py-6 sm:px-7">
                  {config.announcement && (
                    <div className="mb-6 border-l-2 border-gold bg-gold/[0.08] px-4 py-3">
                      <div className="section-kicker text-gold">{t('announce.label')}</div>
                      <div className="mt-1.5 text-sm leading-6 text-text">{config.announcement}</div>
                    </div>
                  )}

                  <p className="text-sm leading-6 text-muted">
                    {config.individualCheckinEnabled ? t('landing.memberCheckinHelp') : t('landing.kioskNote')}
                  </p>

                  <div className="mt-6 flex flex-col gap-2.5">
                    {config.individualCheckinEnabled && (
                      <Button onClick={() => void checkIn()} className="w-full py-3.5 text-base">
                        {t('checkin.button')}
                      </Button>
                    )}
                    <Link
                      to="/kiosk"
                      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-5 py-3 text-sm font-semibold text-text transition-colors hover:border-primary/35 hover:bg-surface-alt"
                    >
                      <Monitor className="size-4" aria-hidden />
                      {t('landing.kioskButton')}
                    </Link>
                  </div>

                  <div className="mt-6 border-t border-border pt-4 text-xs leading-5 text-subtle">
                    {t('landing.privacyNote')}
                  </div>
                </div>
              </div>
            </aside>
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
