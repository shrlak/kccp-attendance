import { useTranslation } from 'react-i18next'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { todaysCheckins, weeklyComparison } from './today'

// Today's live check-in list (scoped) + a this-week-vs-last-week comparison.
export function AdminToday() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const today = easternNow().date
  const todays = todaysCheckins(data.log, today)
  const wk = weeklyComparison(data.log, today)
  const arrow = wk.delta > 0 ? '↑' : wk.delta < 0 ? '↓' : '→'
  const arrowClass = wk.delta > 0 ? 'text-success' : wk.delta < 0 ? 'text-danger' : 'text-muted'

  return (
    <>
      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label={t('admin.today.thisWeek')} value={String(wk.thisWeek)} />
        <Stat label={t('admin.today.lastWeek')} value={String(wk.lastWeek)} />
        <Stat label={t('admin.today.change')} value={`${arrow} ${Math.abs(wk.delta)}`} valueClass={arrowClass} />
      </div>

      <div className="mb-3 font-mono text-xs uppercase tracking-wide text-subtle">
        {t('admin.today.title')} · {todays.length}
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
    </>
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
