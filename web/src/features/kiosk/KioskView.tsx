import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoster } from '../admin/useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { memberCheckin, removeAttendance, getConfig, type Member } from '../../lib/api'
import { resolveGroupColor, hexTint } from '../admin/groupColors'
import {
  kioskColumns,
  filterByName,
  presentNamesToday,
  attendanceCount,
  todayEntryFor,
  hiddenByStatus,
} from './kiosk'
import { useAttendanceLive, refreshRoster } from '../../lib/live'
import { KioskGuestDialog } from './KioskGuestDialog'
import { KioskNewMemberDialog } from './KioskNewMemberDialog'
import { ThemeLangToggle } from '../../components/ui/ThemeLangToggle'
import {
  Search, Check, Clock, ClipboardList, RotateCcw, AlertTriangle,
  Users, DoorOpen, UserPlus, Sparkles,
} from '../../components/ui/Icon'
import { KccpMark } from '../checkin/KccpMark'

const TILE = 'border-border bg-surface text-text shadow-[var(--shadow-sm)] hover:border-primary/40 hover:bg-surface-alt'
const DONE_TILE = 'border-primary bg-primary text-white shadow-[0_6px_18px_color-mix(in_srgb,var(--primary)_30%,transparent)]'

// Full-screen kiosk for touchscreen attendance (Phase 3). Runs on an already-verified
// admin device, so taps go through the hardened member-checkin endpoint. Auto-refreshes
// the roster every 30s; cleared on exit. `onExit` returns to the admin panel.
export function KioskView({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading } = useRoster(true)
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const [search, setSearch] = useState('')
  const [overlay, setOverlay] = useState<{ tone: OverlayTone; name: string; detail?: string } | null>(null)
  const [dialog, setDialog] = useState<'guest' | 'newMember' | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live cross-device sync: check-ins/undos made on any other kiosk or in the admin
  // panel arrive as broadcast pings; useRoster's own poll is the missed-ping fallback.
  useAttendanceLive()

  useEffect(() => () => { if (dismissTimer.current) clearTimeout(dismissTimer.current) }, [])

  const today = easternNow().date
  const members = data?.members ?? []
  const log = data?.log ?? []
  const present = presentNamesToday(log, today)
  const count = attendanceCount(log, today)
  // 이주/한국 귀국 members whose status covers today never show as tiles.
  const visible = filterByName(members.filter((m) => !hiddenByStatus(m, today)), search)
  const cols = kioskColumns(visible)
  const hasAnyResult = cols.depts.some((d) => d.total > 0) || cols.others.length > 0

  // Tiles toggle: tapping an unchecked member checks them in; tapping their green
  // (already checked-in) tile undoes today's attendance entry.
  async function tap(m: Member) {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    const entry = present.has(m.name) ? todayEntryFor(log, today, m) : undefined
    setOverlay({ tone: 'loading', name: m.name })
    let hold = 1000
    try {
      if (entry?.id != null) {
        await removeAttendance(entry.id)
        setOverlay({ tone: 'undone', name: m.name })
      } else {
        const res = await memberCheckin(m.id)
        setOverlay(
          res.status === 'already'
            ? { tone: 'already', name: m.name }
            : { tone: 'ok', name: m.name },
        )
      }
      void refreshRoster(qc)
    } catch (e) {
      // A real failure (auth/network) — show it as an error, not a misleading "already".
      setOverlay({ tone: 'error', name: m.name, detail: (e as Error)?.message })
      hold = 3500 // hold longer so the operator can read the failure
    }
    dismissTimer.current = setTimeout(() => setOverlay(null), hold)
  }

  function Tile({ m }: { m: Member }) {
    const done = present.has(m.name)
    return (
      <button
        type="button"
        onClick={() => void tap(m)}
        className={'flex min-h-16 items-center justify-center gap-1.5 rounded-2xl border px-3 py-3 text-sm font-semibold transition-[background-color,border-color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.94] ' + (done ? DONE_TILE : TILE)}
      >
        {done && <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden />}
        {m.name}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-canvas">
      {/* Header: title + live attendance count + exit */}
      <header className="material-bar flex items-center justify-between gap-3 border-b px-5 py-3 text-text pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-7">
        <div className="flex items-center gap-3">
          <KccpMark size={34} />
          <div>
            <div className="font-display text-lg font-bold tracking-tight">{t('kiosk.title')}</div>
            <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">KCCP Sunday Check-in</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="mr-1 hidden items-center gap-2 rounded-full bg-fill px-3.5 py-1.5 sm:flex">
            <Users className="size-4 text-primary" strokeWidth={2} aria-hidden />
            <span className="text-sm font-bold tabular-nums text-text">{count}</span>
            <span className="text-xs font-semibold text-muted">{t('kiosk.count', { n: count })}</span>
          </div>
          <ThemeLangToggle />
          {/* One-tap exit, no confirmation — the session stays signed in and lands on
              the admin panel (KioskShell navigates to /admin; the admin-launched
              overlay simply closes back to it). */}
          <button
            type="button"
            onClick={onExit}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-sm font-semibold text-muted transition-[background-color,color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:bg-surface-alt hover:text-text active:scale-[0.96]"
          >
            <DoorOpen className="size-4" strokeWidth={2} aria-hidden />
            {t('kiosk.exit')}
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1500px] px-5 pt-5 sm:px-7">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-subtle" strokeWidth={2} aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('kiosk.searchPlaceholder')}
            aria-label={t('kiosk.searchPlaceholder')}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-2xl border border-border bg-surface py-4 pl-12 pr-4 text-lg text-text shadow-[var(--shadow-sm)] outline-none transition-[border-color,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] placeholder:text-subtle focus-visible:border-primary focus-visible:ring-[3.5px] focus-visible:ring-primary/18"
          />
        </div>
        <div className="mt-2 text-right text-xs font-semibold text-muted sm:hidden">{t('kiosk.count', { n: count })}</div>
      </div>

      <div className="mx-auto w-full max-w-[1500px] flex-1 overflow-y-auto px-5 py-5 sm:px-7">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="fx-skeleton h-16 rounded-2xl" aria-hidden />
            ))}
          </div>
        ) : !hasAnyResult ? (
          <div className="fx-rise flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 grid size-16 place-items-center rounded-full bg-fill text-subtle">
              {search
                ? <Search className="size-7" strokeWidth={1.75} aria-hidden />
                : <Users className="size-7" strokeWidth={1.75} aria-hidden />}
            </div>
            <p className="text-base font-semibold text-text">
              {search ? t('kiosk.noResults') : t('kiosk.noMembers')}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {cols.depts.map((dept) => {
                const color = resolveGroupColor(cfg?.groupColors, dept.key)
                return (
                  <div key={dept.key} className="rounded-[26px] border border-border/60 p-4" style={{ background: hexTint(color, 0.07) }}>
                    {/* Full-width department header, so every column below starts on the same
                        line — the round-robin split reads alphabetically across each row. */}
                    <div
                      className="mb-3 flex items-baseline gap-2 border-b-2 pb-2 text-xs font-bold uppercase tracking-wide"
                      style={{ color, borderColor: color }}
                    >
                      {dept.key} <span className="text-subtle">{dept.total}</span>
                    </div>
                    <div className="grid grid-cols-2 items-start gap-x-3 gap-y-2 min-[480px]:grid-cols-4">
                      {dept.columns.map((part, i) => (
                        <div key={`${dept.key}-${i}`} className="flex flex-col gap-2">
                          {part.length ? (
                            part.map((m) => <Tile key={m.id} m={m} />)
                          ) : (
                            <div className="py-3 text-center text-xs text-subtle">—</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            {cols.others.length > 0 && (
              <>
                <div className="section-kicker mb-2.5 mt-6">
                  {t('kiosk.other')}
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-6">
                  {cols.others.map((m) => (
                    <Tile key={m.id} m={m} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Footer: guest + 새가족 registration */}
      <footer className="material-bar flex gap-3 border-t px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-7">
        <button
          type="button"
          onClick={() => setDialog('guest')}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-border bg-surface text-sm font-semibold text-text shadow-[var(--shadow-sm)] transition-[background-color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:bg-surface-alt active:scale-[0.98]"
        >
          <UserPlus className="size-4" strokeWidth={2} aria-hidden />
          {t('kiosk.guest.action')}
        </button>
        <button
          type="button"
          onClick={() => setDialog('newMember')}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-primary bg-primary text-sm font-semibold text-primary-fg shadow-[var(--shadow-sm)] transition-[background-color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:bg-primary-hover hover:shadow-[0_6px_20px_color-mix(in_srgb,var(--primary)_32%,transparent)] active:scale-[0.98]"
        >
          <Sparkles className="size-4" strokeWidth={2} aria-hidden />
          {t('kiosk.newMember.action')}
        </button>
      </footer>

      {overlay && <SuccessOverlay tone={overlay.tone} name={overlay.name} detail={overlay.detail} />}

      <KioskGuestDialog open={dialog === 'guest'} onClose={() => setDialog(null)} />
      <KioskNewMemberDialog open={dialog === 'newMember'} onClose={() => setDialog(null)} />
    </div>
  )
}

type OverlayTone = 'loading' | 'ok' | 'already' | 'undone' | 'error'

// Full-screen feedback overlay: green check for success, amber for already, blue for an
// undone check-in, red for a real failure (with the underlying reason so a broken kiosk
// is diagnosable on-screen).
function SuccessOverlay({ tone, name, detail }: { tone: OverlayTone; name: string; detail?: string }) {
  const { t } = useTranslation()
  const color =
    tone === 'already'
      ? 'var(--warning)'
      : tone === 'undone'
        ? 'var(--info)'
        : tone === 'error'
          ? 'var(--danger)'
          : 'var(--success)'
  const OverlayIcon =
    tone === 'loading' ? Clock : tone === 'already' ? ClipboardList : tone === 'undone' ? RotateCcw : tone === 'error' ? AlertTriangle : Check
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[1002] flex flex-col items-center justify-center bg-canvas/[0.96] px-6 text-center backdrop-blur-xl"
    >
      <div className="fx-pop flex flex-col items-center">
        <div
          className="mb-6 grid size-24 place-items-center rounded-full border-2 shadow-[var(--shadow-lg)]"
          style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, borderColor: color, color }}
        >
          <OverlayIcon className={'size-11' + (tone === 'loading' ? ' fx-pulse' : '')} strokeWidth={2.25} aria-hidden />
        </div>
        <div className="font-display text-3xl font-bold tracking-tight" style={{ color }}>
          {tone === 'loading'
            ? t('kiosk.loading')
            : tone === 'already'
              ? t('kiosk.already')
              : tone === 'undone'
                ? t('kiosk.undone')
                : tone === 'error'
                  ? t('kiosk.fail')
                  : t('kiosk.success')}
        </div>
        <div className="mt-2 text-lg font-semibold text-text">{name}</div>
        {tone === 'error' && detail && <div className="mt-3 max-w-xs text-xs text-muted">{detail}</div>}
      </div>
    </div>
  )
}
