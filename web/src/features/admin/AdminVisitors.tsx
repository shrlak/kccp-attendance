import { useTranslation } from 'react-i18next'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { visitorsByDate, visitCounts } from './visitors'
import { Tag } from '../../components/ui/Tag'

// 방문자 tab: every guest check-in — past and today — grouped by date, newest first.
// Visitors aren't members (they come from the kiosk/공용 방문자 check-in), so this reads
// straight from the attendance log. Visible to every admin; scoped leaders' rosters
// carry no guest rows, so they just see the empty state.
export function AdminVisitors() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const today = easternNow().date
  const groups = visitorsByDate(data.log)
  const counts = visitCounts(groups)
  const total = groups.reduce((n, g) => n + g.entries.length, 0)
  const todayCount = groups.find((g) => g.date === today)?.entries.length ?? 0

  return (
    <>
      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label={t('admin.visitors.stats.today')} value={String(todayCount)} />
        <Stat label={t('admin.visitors.stats.total')} value={String(total)} />
        <Stat label={t('admin.visitors.stats.unique')} value={String(counts.size)} />
      </div>

      <div className="mb-3">
        <span className="font-mono text-xs uppercase tracking-wide text-subtle">
          {t('admin.visitors.title')} · {total}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.visitors.empty')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.date}>
              <div className="mb-1.5 flex items-baseline gap-2 border-b border-border pb-1">
                <span className="font-mono text-sm font-semibold text-text">{g.date}</span>
                {g.date === today && <Tag tone="primary">{t('admin.visitors.today')}</Tag>}
                <span className="text-xs text-subtle">{g.entries.length}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {g.entries.map((e) => (
                  <li
                    key={`${e.name}-${e.ts}`}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                        {(e.name || '?').slice(0, 1)}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-text">
                          {e.name}
                          {(counts.get(e.name) ?? 0) > 1 && (
                            <Tag tone="info" className="ml-1.5 align-middle">
                              {t('admin.visitors.returning', { n: counts.get(e.name) })}
                            </Tag>
                          )}
                        </div>
                        <div className="text-xs text-muted">{e.group || '—'}</div>
                      </div>
                    </div>
                    <span className="font-mono text-xs text-muted">{e.time}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-center">
      <div className="text-xl font-bold text-text">{value}</div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-subtle">{label}</div>
    </div>
  )
}
