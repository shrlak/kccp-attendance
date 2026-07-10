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
    <header className="flex items-center justify-between px-5 pt-[calc(1rem+env(safe-area-inset-top))]">
      <div className="flex items-center gap-2 text-primary">
        <KccpMark size={22} />
        <span className="font-display text-base font-semibold tracking-tight">KCCP</span>
      </div>
      <div className="flex items-center gap-1">
        <ThemeLangToggle />
        <Link to="/admin" className={iconBtnClass + ' px-2'}>
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
    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3.5 py-1.5 text-xs backdrop-blur">
      <span className={'h-2 w-2 rounded-full ' + (open ? 'bg-success' : 'bg-subtle')} aria-hidden />
      <span className={open ? 'font-semibold text-success' : 'text-muted'}>
        {open ? t('checkin.open') : t('checkin.closed')}
      </span>
      <span className="font-mono text-subtle">
        {t('checkin.windowRange', { from: formatMinutes(cfg.checkinStartMin), to: formatMinutes(cfg.checkinEndMin) })}
      </span>
    </div>
  )
}

export function CheckinScreen() {
  const { t } = useTranslation()
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

  return (
    <main className="relative flex min-h-dvh flex-col">
      {phase.kind === 'idle' && (
        <>
          <TopBar />
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-16 text-center">
            <KccpLogo size={200} />
            <div className="fx-rise">
              <h1 className="font-display text-3xl font-semibold tracking-tight text-text">{t('landing.title')}</h1>
              <p className="mt-2 text-sm text-muted">{t('landing.subtitle')}</p>
            </div>
            {config.announcement && (
              <div className="fx-rise mx-auto max-w-xs rounded-xl border border-gold/30 bg-gold/10 px-4 py-2.5">
                <div className="mb-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-gold">
                  {t('announce.label')}
                </div>
                <div className="text-xs leading-relaxed text-text">{config.announcement}</div>
              </div>
            )}
            {/* Check-in only surfaces when individual check-in is enabled; otherwise this is
                purely the system's landing page (check-in runs on the church kiosk). */}
            {config.individualCheckinEnabled ? (
              <>
                <WindowBadge cfg={config} />
                <Button onClick={() => void checkIn()} className="fx-rise min-w-[12rem] px-10 py-4 text-base">
                  {t('checkin.button')}
                </Button>
              </>
            ) : (
              <p className="fx-rise text-xs text-subtle">{t('landing.kioskNote')}</p>
            )}
            {/* Kiosk entry for the church tablet — /kiosk opens the kiosk directly for
                an authed session and shows the login gate (team password or Google)
                otherwise, so it's safe to surface publicly. */}
            <Link
              to="/kiosk"
              className="fx-rise inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-text transition-colors hover:bg-surface-alt"
            >
              <Monitor className="size-4" aria-hidden />
              {t('landing.kioskButton')}
            </Link>
          </div>
        </>
      )}

      {phase.kind === 'checking' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
          <KccpMark size={120} className="fx-pulse text-primary" />
          <div>
            <div className="font-display text-xl font-semibold text-text">{t('checkin.checking')}</div>
            <div className="mt-1 font-mono text-xs text-subtle">{t('checkin.checkingLocation')}</div>
          </div>
        </div>
      )}

      {phase.kind === 'result' && (
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <CheckinResult view={phase.view} cfg={config} onRetry={reset} onRegister={() => setRegisterOpen(true)} />
        </div>
      )}

      <SelfRegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} onRegistered={handleRegistered} />
    </main>
  )
}
