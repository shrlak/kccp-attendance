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
import { useKioskLive, broadcastKioskChange } from './live'
import { KioskGuestDialog } from './KioskGuestDialog'
import { KioskNewMemberDialog } from './KioskNewMemberDialog'
import { ThemeLangToggle } from '../../components/ui/ThemeLangToggle'
import { Search, Check, Clock, ClipboardList, RotateCcw, AlertTriangle } from '../../components/ui/Icon'
import { KccpMark } from '../checkin/KccpMark'

const TILE = 'border-border bg-surface text-text hover:border-primary/35 hover:bg-surface-alt'
const DONE_TILE = 'border-primary bg-primary text-white'

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

  // Live cross-device sync: other kiosks' check-ins/undos arrive as broadcast pings.
  useKioskLive()

  // 15-second roster auto-refresh as the fallback for changes made outside a kiosk
  // (admin panel, self check-in); cleared on unmount (which includes exit).
  useEffect(() => {
    const id = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['roster'] })
    }, 15_000)
    return () => clearInterval(id)
  }, [qc])

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
      broadcastKioskChange()
      void qc.invalidateQueries({ queryKey: ['roster'] })
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
        className={'flex min-h-14 items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-sm font-semibold transition-[background-color,border-color,transform] active:scale-[0.985] ' + (done ? DONE_TILE : TILE)}
      >
        {done && <Check className="size-3.5 shrink-0" aria-hidden />}
        {m.name}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-canvas">
      {/* Header: title + live attendance count + exit */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface/[0.88] px-5 py-3 text-text pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-xl sm:px-7">
        <div className="flex items-center gap-3">
          <KccpMark size={32} />
          <div>
            <div className="font-display text-lg font-bold tracking-tight">{t('kiosk.title')}</div>
            <div className="mt-0.5 text-[10px] font-semibold tracking-wide text-muted">KCCP Sunday Check-in</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="mr-2 hidden border-r border-border pr-4 text-right sm:block">
            <div className="text-xl font-bold tabular-nums">{count}</div>
            <div className="text-[10px] font-semibold text-muted">{t('kiosk.count', { n: count })}</div>
          </div>
          <ThemeLangToggle />
          {/* One-tap exit, no confirmation — the session stays signed in and lands on
              the admin panel (KioskShell navigates to /admin; the admin-launched
              overlay simply closes back to it). */}
          <button
            type="button"
            onClick={onExit}
            className="min-h-10 rounded-full border border-border bg-surface-alt px-4 text-sm font-semibold text-muted hover:text-text"
          >
            {t('kiosk.exit')}
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1500px] px-5 pt-4 sm:px-7">
        <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('kiosk.searchPlaceholder')}
          aria-label={t('kiosk.searchPlaceholder')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-xl border border-border bg-surface py-3.5 pl-10 pr-4 text-base text-text shadow-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
        />
        </div>
        <div className="mt-2 text-right text-xs font-semibold text-muted sm:hidden">{t('kiosk.count', { n: count })}</div>
      </div>

      <div className="mx-auto w-full max-w-[1500px] flex-1 overflow-y-auto px-5 py-4 sm:px-7">
        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted">{t('common.loading')}</p>
        ) : !hasAnyResult ? (
          <p className="py-12 text-center text-sm text-muted">
            {search ? t('kiosk.noResults') : t('kiosk.noMembers')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {cols.depts.map((dept) => {
                const color = resolveGroupColor(cfg?.groupColors, dept.key)
                return (
                  <div key={dept.key} className="rounded-2xl p-3" style={{ background: hexTint(color, 0.07) }}>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-5 min-[480px]:grid-cols-4">
                      {dept.columns.map((part, i) => (
                        <div key={`${dept.key}-${i}`} className="flex flex-col gap-2">
                          <div
                            className="border-b-2 pb-2 text-xs font-bold uppercase tracking-wide"
                            style={{ color, borderColor: color }}
                          >
                            {i === 0 ? (
                              <>
                                {dept.key} <span className="text-subtle">{dept.total}</span>
                              </>
                            ) : (
                              ' '
                            )}
                          </div>
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
                <div className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                  {t('kiosk.other')}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
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
      <footer className="flex gap-3 border-t border-border bg-surface px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-7">
        <button
          type="button"
          onClick={() => setDialog('guest')}
          className="min-h-12 flex-1 rounded-full border border-border bg-surface text-sm font-semibold text-text hover:bg-surface-alt"
        >
          {t('kiosk.guest.action')}
        </button>
        <button
          type="button"
          onClick={() => setDialog('newMember')}
          className="min-h-12 flex-1 rounded-full border border-primary bg-primary text-sm font-semibold text-primary-fg hover:bg-primary-hover"
        >
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
      <div
        className="mb-6 flex h-20 w-20 items-center justify-center rounded-xl border"
        style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, borderColor: color, color }}
      >
        <OverlayIcon className={'size-10' + (tone === 'loading' ? ' fx-pulse' : '')} aria-hidden />
      </div>
      <div className="font-display text-2xl font-semibold" style={{ color }}>
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
      <div className="mt-2 text-base font-semibold text-text">{name}</div>
      {tone === 'error' && detail && <div className="mt-3 max-w-xs text-xs text-muted">{detail}</div>}
    </div>
  )
}
