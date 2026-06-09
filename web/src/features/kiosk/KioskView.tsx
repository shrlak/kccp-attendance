import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from '../admin/useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { memberCheckin, type Member } from '../../lib/api'
import {
  kioskColumns,
  filterByName,
  presentNamesToday,
  attendanceCount,
  type KioskDept,
} from './kiosk'
import { KioskGuestDialog } from './KioskGuestDialog'
import { KioskNewMemberDialog } from './KioskNewMemberDialog'
import { KioskExitDialog } from './KioskExitDialog'

const DEPT_STYLE: Record<KioskDept, { color: string; tile: string }> = {
  대학부: { color: '#FBBF24', tile: 'border-[#FBBF24]/40 bg-[#FBBF24]/10 text-text hover:bg-[#FBBF24]/20' },
  청년부: { color: '#60A5FA', tile: 'border-[#60A5FA]/40 bg-[#60A5FA]/10 text-text hover:bg-[#60A5FA]/20' },
}
const DONE_TILE = 'border-success/50 bg-success/15 text-success'

// Full-screen kiosk for touchscreen attendance (Phase 3). Runs on an already-verified
// admin device, so taps go through the hardened member-checkin endpoint. Auto-refreshes
// the roster every 30s; cleared on exit. `onExit` returns to the admin panel.
export function KioskView({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading } = useRoster(true)
  const [search, setSearch] = useState('')
  const [overlay, setOverlay] = useState<{ tone: 'loading' | 'ok' | 'already'; name: string } | null>(null)
  const [dialog, setDialog] = useState<'guest' | 'newMember' | 'exit' | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 30-second roster auto-refresh; cleared on unmount (which includes exit).
  useEffect(() => {
    const id = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['roster'] })
    }, 30_000)
    return () => clearInterval(id)
  }, [qc])

  useEffect(() => () => { if (dismissTimer.current) clearTimeout(dismissTimer.current) }, [])

  const today = easternNow().date
  const members = data?.members ?? []
  const log = data?.log ?? []
  const present = presentNamesToday(log, today)
  const count = attendanceCount(log, today)
  const visible = filterByName(members, search)
  const cols = kioskColumns(visible)
  const hasAnyResult = cols.depts.some((d) => d.total > 0) || cols.others.length > 0

  async function tap(m: Member) {
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    setOverlay({ tone: 'loading', name: m.name })
    try {
      const res = await memberCheckin(m.id)
      void qc.invalidateQueries({ queryKey: ['roster'] })
      setOverlay(
        res.status === 'already'
          ? { tone: 'already', name: m.name }
          : { tone: 'ok', name: m.name },
      )
    } catch {
      setOverlay({ tone: 'already', name: m.name }) // amber fallback; auto-dismisses
    }
    dismissTimer.current = setTimeout(() => setOverlay(null), 1000)
  }

  function Tile({ m }: { m: Member }) {
    const done = present.has(m.name)
    const style = DEPT_STYLE[m.group_name as KioskDept]
    const cls = done ? DONE_TILE : style ? style.tile : 'border-border bg-surface text-text hover:bg-surface-alt'
    return (
      <button
        type="button"
        onClick={() => void tap(m)}
        className={'min-h-12 rounded-lg border px-2 py-2.5 text-sm font-semibold transition-colors ' + cls}
      >
        {done && <span aria-hidden>✓ </span>}
        {m.name}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[999] flex flex-col bg-canvas">
      {/* Header: title + live attendance count + exit */}
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div>
          <div className="font-display text-lg font-semibold text-text">{t('kiosk.title')}</div>
          <div className="font-mono text-xs text-muted">{t('kiosk.count', { n: count })}</div>
        </div>
        <button
          type="button"
          onClick={() => setDialog('exit')}
          className="min-h-11 rounded-md bg-surface px-4 text-sm font-semibold text-muted hover:bg-surface-alt"
        >
          {t('kiosk.exit')}
        </button>
      </header>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('kiosk.searchPlaceholder')}
        aria-label={t('kiosk.searchPlaceholder')}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="mx-5 mt-3 rounded-xl border border-border bg-surface px-4 py-3 text-base text-text outline-none focus-visible:border-primary"
      />

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted">{t('common.loading')}</p>
        ) : !hasAnyResult ? (
          <p className="py-12 text-center text-sm text-muted">
            {search ? t('kiosk.noResults') : t('kiosk.noMembers')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
              {cols.depts.map((dept) =>
                dept.thirds.map((part, i) => (
                  <div key={`${dept.key}-${i}`} className="flex flex-col gap-2">
                    <div
                      className="border-b pb-1 font-mono text-xs font-bold uppercase tracking-wide"
                      style={{ color: DEPT_STYLE[dept.key].color, borderColor: DEPT_STYLE[dept.key].color + '55' }}
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
                )),
              )}
            </div>
            {cols.others.length > 0 && (
              <>
                <div className="mt-5 mb-2 font-mono text-xs font-bold uppercase tracking-wide text-subtle">
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
      <footer className="flex gap-3 border-t border-border px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => setDialog('guest')}
          className="min-h-12 flex-1 rounded-lg border border-border bg-surface text-sm font-semibold text-text hover:bg-surface-alt"
        >
          {t('kiosk.guest.action')}
        </button>
        <button
          type="button"
          onClick={() => setDialog('newMember')}
          className="min-h-12 flex-1 rounded-lg border border-border bg-surface text-sm font-semibold text-text hover:bg-surface-alt"
        >
          {t('kiosk.newMember.action')}
        </button>
      </footer>

      {overlay && <SuccessOverlay tone={overlay.tone} name={overlay.name} />}

      <KioskGuestDialog open={dialog === 'guest'} onClose={() => setDialog(null)} />
      <KioskNewMemberDialog open={dialog === 'newMember'} onClose={() => setDialog(null)} />
      <KioskExitDialog open={dialog === 'exit'} onClose={() => setDialog(null)} onExit={onExit} />
    </div>
  )
}

// Full-screen 1-second feedback overlay: amber for already, green check for success.
function SuccessOverlay({ tone, name }: { tone: 'loading' | 'ok' | 'already'; name: string }) {
  const { t } = useTranslation()
  const color = tone === 'already' ? 'var(--warning)' : 'var(--success)'
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[1002] flex flex-col items-center justify-center bg-canvas/95 text-center"
    >
      <div
        className="mb-5 flex h-28 w-28 items-center justify-center rounded-full text-5xl"
        style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, border: `2px solid ${color}` }}
      >
        {tone === 'loading' ? '⏳' : tone === 'already' ? '📋' : '✓'}
      </div>
      <div className="font-display text-2xl font-bold" style={{ color }}>
        {tone === 'loading' ? t('kiosk.loading') : tone === 'already' ? t('kiosk.already') : t('kiosk.success')}
      </div>
      <div className="mt-1 text-base font-medium text-text">{name}</div>
    </div>
  )
}
