import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLang } from '../../stores/useLang'
import type { AppConfig } from '../../lib/api'
import { formatMinutes } from '../../lib/checkinWindow'
import { Button } from '../../components/ui/Button'
import { ClipboardList, MapPin, WifiOff, Clock, Star } from '../../components/ui/Icon'
import { LiveClock } from './LiveClock'
import { CountdownBar } from './CountdownBar'
import type { CheckinView } from './useCheckin'

const DAY_SHORT: Record<'ko' | 'en', string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <div
      className="fx-rise mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full"
      style={{ background: `color-mix(in oklab, ${tone} 12%, transparent)`, color: tone }}
    >
      {children}
    </div>
  )
}

function DrawnCheck({ color }: { color: string }) {
  return (
    <div className="fx-rise mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full" style={{ background: color }}>
      <svg width="48" height="48" viewBox="0 0 52 52" fill="none" aria-hidden>
        <path className="fx-draw" d="M14 27l8 8 16-18" stroke="var(--canvas)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function Announcement({ text }: { text: string }) {
  const { t } = useTranslation()
  if (!text) return null
  return (
    <div className="mx-auto mt-4 max-w-xs rounded-xl border border-border bg-surface-alt px-4 py-2.5">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">{t('announce.label')}</div>
      <div className="text-xs leading-relaxed text-text">{text}</div>
    </div>
  )
}

export function CheckinResult({
  view,
  cfg,
  onRetry,
  onRegister,
}: {
  view: CheckinView
  cfg: AppConfig
  onRetry: () => void
  onRegister: () => void
}) {
  const { t } = useTranslation()
  const lang = useLang((s) => s.lang)

  useEffect(() => {
    if (view.status === 'ok' && 'vibrate' in navigator) {
      navigator.vibrate(view.firstVisit ? [100, 50, 100, 50, 200] : [100, 50, 200])
    }
  }, [view])

  // ── Success (regular / first-visit) ───────────────────────────────────
  if (view.status === 'ok') {
    const tone = view.firstVisit ? 'var(--primary)' : 'var(--success)'
    return (
      <Result>
        {view.firstVisit && <Star className="fx-rise mx-auto mb-2 size-6" style={{ color: tone }} aria-hidden />}
        <DrawnCheck color={tone} />
        {view.firstVisit && (
          <div className="fx-rise mb-1 font-display text-xl font-semibold" style={{ color: tone }}>
            {t('checkin.firstVisit')}
          </div>
        )}
        <div className="fx-rise font-display text-2xl font-semibold" style={{ color: tone }}>
          {t('checkin.success')}
        </div>
        <div className="fx-rise mt-1 text-base font-medium text-text">{view.name}</div>
        <div className="fx-rise mt-0.5 text-sm text-muted">{view.time}</div>
        {view.total > 0 && (
          <div className="fx-rise mt-3 inline-flex items-baseline gap-1.5 rounded-full bg-surface-alt px-3 py-1">
            <span className="text-[10px] uppercase tracking-wide text-subtle">{t('checkin.total')}</span>
            <span className="text-sm font-semibold" style={{ color: tone }}>
              {view.total}
            </span>
          </div>
        )}
        <Announcement text={cfg.announcement} />
        {!view.registered && (
          <div className="fx-rise mt-5 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
            <p className="mb-2">{t('checkin.registerPrompt')}</p>
            <Button variant="secondary" size="sm" onClick={onRegister}>
              {t('checkin.registerButton')}
            </Button>
          </div>
        )}
        <div style={{ color: tone }}>
          <CountdownBar seconds={5} />
        </div>
        <p className="mt-2 text-xs text-subtle">{t('checkin.closePage')}</p>
      </Result>
    )
  }

  // ── Already checked in ────────────────────────────────────────────────
  if (view.status === 'already') {
    return (
      <Result>
        <Badge tone="var(--warning)">
          <ClipboardList className="size-9" aria-hidden />
        </Badge>
        <div className="fx-rise font-display text-2xl font-semibold text-warning">{t('checkin.already')}</div>
        <div className="fx-rise mt-1 text-base font-medium text-text">{view.name}</div>
        <div className="fx-rise mt-0.5 text-sm text-muted">{view.time}</div>
        <Announcement text={cfg.announcement} />
        <div className="text-warning">
          <CountdownBar seconds={4} />
        </div>
        <p className="mt-2 text-xs text-subtle">{t('checkin.closePage')}</p>
      </Result>
    )
  }

  // ── Schedule restrictions (with a live clock) ─────────────────────────
  if (view.status === 'wrong-day' || view.status === 'wrong-time') {
    const isDay = view.status === 'wrong-day'
    return (
      <Result>
        <div className="fx-rise mb-6 flex flex-col items-center gap-3 text-warning">
          <LiveClock />
        </div>
        <div className="fx-rise font-display text-xl font-semibold text-warning">
          {isDay ? t('restriction.day') : t('restriction.time')}
        </div>
        <p className="fx-rise mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">
          {isDay
            ? t('restriction.daySub', { days: cfg.checkinDays.map((d) => DAY_SHORT[lang][d]).join(', ') })
            : t('restriction.timeSub', { from: formatMinutes(cfg.checkinStartMin), to: formatMinutes(cfg.checkinEndMin) })}
        </p>
        <RetryButton onRetry={onRetry} />
      </Result>
    )
  }

  // ── Location restrictions ─────────────────────────────────────────────
  if (view.status === 'location-restricted' || view.status === 'location-required') {
    const far = view.status === 'location-restricted'
    return (
      <Result>
        <Badge tone="var(--danger)">
          <MapPin className="size-9" aria-hidden />
        </Badge>
        <div className="fx-rise font-display text-xl font-semibold text-danger">
          {far ? t('restriction.locationFar') : t('restriction.locationRequired')}
        </div>
        {far && view.distance != null && (
          <p className="fx-rise mx-auto mt-2 max-w-xs text-sm text-muted">
            {t('restriction.locationFarSub', { distance: view.distance })}
          </p>
        )}
        <RetryButton onRetry={onRetry} />
      </Result>
    )
  }

  // ── Offline ───────────────────────────────────────────────────────────
  if (view.status === 'offline') {
    return (
      <Result>
        <Badge tone="var(--warning)">
          <WifiOff className="size-9" aria-hidden />
        </Badge>
        <div className="fx-rise font-display text-xl font-semibold text-warning">{t('offline.title')}</div>
        <p className="fx-rise mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">{t('offline.msg')}</p>
        <p className="fx-rise mt-3 text-xs text-subtle">{t('offline.queued')}</p>
      </Result>
    )
  }

  // ── Pending approval ──────────────────────────────────────────────────
  return (
    <Result>
      <Badge tone="var(--warning)">
        <Clock className="size-9" aria-hidden />
      </Badge>
      <div className="fx-rise font-display text-xl font-semibold text-warning">{t('register.pendingTitle')}</div>
      <p className="fx-rise mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">{t('register.pendingMsg')}</p>
    </Result>
  )
}

function Result({ children }: { children: ReactNode }) {
  return <div className="relative flex flex-col items-center text-center">{children}</div>
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <Button variant="secondary" size="sm" className="mt-6" onClick={onRetry}>
      {t('common.retry')}
    </Button>
  )
}
