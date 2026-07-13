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
    <div className="inline-flex items-center gap-2.5 rounded-full border border-border bg-surface-alt px-3 py-2 text-xs">
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
          <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-6 py-10 text-center">
            <div className="fx-rise flex flex-col items-center">
              <KccpLogo size={88} stacked />
              <h1
                aria-label={t('landing.title')}
                className="mt-10 break-keep font-display text-3xl font-semibold leading-[1.2] tracking-[-0.03em] text-text sm:text-4xl"
              >
                <span className="block">{t('landing.titleLine1')}</span>
                <span className="block">{t('landing.titleLine2')}</span>
              </h1>
              <div className="mt-4 section-kicker">{todayLabel}</div>
            </div>

            {config.announcement && (
              <div className="fx-rise mt-8 w-full max-w-md border-l-2 border-gold bg-gold/[0.08] px-4 py-3 text-left">
                <div className="section-kicker text-gold">{t('announce.label')}</div>
                <div className="mt-1.5 text-sm leading-6 text-text">{config.announcement}</div>
              </div>
            )}

            {config.individualCheckinEnabled && (
              <div className="fx-rise mt-8 flex w-full max-w-sm flex-col items-center gap-4">
                <WindowBadge cfg={config} />
                <Button onClick={() => void checkIn()} className="w-full py-3.5 text-base">
                  {t('checkin.button')}
                </Button>
              </div>
            )}
          </section>

          <div className="flex justify-center px-6 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
            <Link
              to="/kiosk"
              className="fx-rise inline-flex min-h-12 w-full max-w-sm items-center justify-center gap-2.5 rounded-full border border-primary bg-primary px-8 py-3.5 text-base font-semibold text-primary-fg transition-colors hover:border-primary-hover hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
