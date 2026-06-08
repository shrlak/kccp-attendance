import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { todaysCheckins, weeklyComparison, presentNamesToday, checkinCandidates } from './today'
import { memberCheckin, type Member, type RosterResponse } from '../../lib/api'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'

// Today's live check-in list (scoped) + a this-week-vs-last-week comparison, plus a
// manual check-in (any admin except pastor).
export function AdminToday() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)
  const [checkin, setCheckin] = useState(false)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const today = easternNow().date
  const todays = todaysCheckins(data.log, today)
  const wk = weeklyComparison(data.log, today)
  const arrow = wk.delta > 0 ? '↑' : wk.delta < 0 ? '↓' : '→'
  const arrowClass = wk.delta > 0 ? 'text-success' : wk.delta < 0 ? 'text-danger' : 'text-muted'
  const canCheckin = data.role !== 'pastor'

  return (
    <>
      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label={t('admin.today.thisWeek')} value={String(wk.thisWeek)} />
        <Stat label={t('admin.today.lastWeek')} value={String(wk.lastWeek)} />
        <Stat label={t('admin.today.change')} value={`${arrow} ${Math.abs(wk.delta)}`} valueClass={arrowClass} />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wide text-subtle">
          {t('admin.today.title')} · {todays.length}
        </span>
        {canCheckin && (
          <Button variant="secondary" size="sm" onClick={() => setCheckin(true)} disabled={data.members.length === 0}>
            {t('admin.today.manualCheckin.action')}
          </Button>
        )}
      </div>
      {todays.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.today.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {todays.map((e) => (
            <li
              key={`${e.name}-${e.ts}`}
              className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-full bg-success/15 text-sm font-bold text-success">
                  {(e.name || '?').slice(0, 1)}
                </div>
                <div>
                  <div className="text-sm font-semibold text-text">
                    {e.name}
                    {e.firstVisit && <span className="ml-1.5 align-middle text-xs">🌟</span>}
                  </div>
                  <div className="text-xs text-muted">{[e.group, e.subgroup].filter(Boolean).join(' · ') || '—'}</div>
                </div>
              </div>
              <span className="font-mono text-xs text-muted">{e.time}</span>
            </li>
          ))}
        </ul>
      )}
      {checkin && <ManualCheckinModal data={data} today={today} onClose={() => setCheckin(false)} />}
    </>
  )
}

function ManualCheckinModal({ data, today, onClose }: { data: RosterResponse; today: string; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const present = presentNamesToday(data.log, today)
  const candidates = checkinCandidates(data.members, search)

  async function add(m: Member) {
    setBusy(m.id)
    try {
      const res = await memberCheckin(m.id)
      if (res.status === 'already') toast({ title: t('admin.today.manualCheckin.already', { name: m.name }), tone: 'warn' })
      else toast({ title: t('admin.today.manualCheckin.done', { name: m.name }), tone: 'ok' })
      await qc.invalidateQueries({ queryKey: ['roster'] })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.today.manualCheckin.title')}>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.members.search')}
        aria-label={t('admin.members.search')}
        className="mb-3"
      />
      <ul className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto pr-1">
        {candidates.length === 0 && <li className="text-sm text-muted">{t('admin.today.manualCheckin.none')}</li>}
        {candidates.map((m) => {
          const here = present.has(m.name)
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => add(m)}
                disabled={here || busy !== null}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-alt disabled:opacity-50"
              >
                <span>
                  <span className="text-sm font-semibold text-text">{m.name}</span>
                  <span className="ml-2 text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ')}</span>
                </span>
                {here ? (
                  <span className="text-xs font-semibold text-success">✓ {t('admin.today.manualCheckin.present')}</span>
                ) : (
                  <span className="font-mono text-xs text-primary">{busy === m.id ? '…' : '＋'}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <Button variant="secondary" onClick={onClose} className="mt-4 w-full">
        {t('common.close')}
      </Button>
    </Dialog>
  )
}

function Stat({ label, value, valueClass = 'text-text' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-center">
      <div className={'text-xl font-bold ' + valueClass}>{value}</div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-subtle">{label}</div>
    </div>
  )
}
