import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoster } from './useRoster'
import { filterMembers, filterLog, NO_FILTER, type Filter } from './filters'
import { GroupFilter } from './GroupFilter'
import { AnalyticsCharts } from './AnalyticsCharts'
import { monthlySummary, semesterSummary, weeklyRecap, recapText, type SemesterRow } from './analytics'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import type { Member, LogEntry } from '../../lib/api'

// Analytics tab: trend + group-comparison charts, monthly/semester summary tables, and
// a weekly recap — all derived client-side from the scoped roster and reactive to the
// shared 부서/동산 filter.
export function AdminAnalytics() {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const { data, isLoading, isError } = useRoster(true)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const members = filterMembers(data.members, filter)
  const log = filterLog(data.log, filter)

  return (
    <>
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />
      <AnalyticsCharts members={members} log={log} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SemesterTable members={members} log={log} />
        <MonthlyTable members={members} log={log} />
        <WeeklyRecap log={log} />
      </div>
    </>
  )
}

function MonthlyTable({ members, log }: { members: Member[]; log: LogEntry[] }) {
  const { t } = useTranslation()
  const rows = monthlySummary(members, log)
  return (
    <Section title={t('admin.analytics.monthly')}>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <SummaryTable
          head={[t('admin.analytics.month'), t('admin.analytics.sundays'), t('admin.analytics.attendees'), t('admin.analytics.firstVisits')]}
          rows={rows.map((r) => ({ key: r.month, cells: [r.month, r.sundays, r.attendees, r.firstVisits] }))}
        />
      )}
    </Section>
  )
}

function SemesterTable({ members, log }: { members: Member[]; log: LogEntry[] }) {
  const { t } = useTranslation()
  const rows = semesterSummary(members, log)
  return (
    <Section title={t('admin.analytics.semester')}>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <SummaryTable
          head={[t('admin.analytics.semester'), t('admin.analytics.sundays'), t('admin.analytics.attendees'), t('admin.analytics.firstVisits')]}
          rows={rows.map((r) => ({ key: r.key, cells: [semesterLabel(r, t), r.sundays, r.attendees, r.firstVisits] }))}
        />
      )}
    </Section>
  )
}

// "2026 상반기" / "2026 Spring" (한국어), "2026 H1" / "2026 H2" via the i18n half label.
function semesterLabel(r: SemesterRow, t: (k: string) => string): string {
  return `${r.year} ${t(r.half === 1 ? 'admin.analytics.half1' : 'admin.analytics.half2')}`
}

function WeeklyRecap({ log }: { log: LogEntry[] }) {
  const { t } = useTranslation()
  const toast = useToast()
  const rows = weeklyRecap(log)

  async function copy() {
    try {
      await navigator.clipboard.writeText(recapText(rows))
      toast({ title: t('admin.analytics.copied'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    }
  }

  return (
    <Section
      title={t('admin.analytics.weeklyRecap')}
      action={
        rows.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={copy}>
            {t('admin.analytics.copy')}
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <SummaryTable
          head={[t('admin.analytics.date'), t('admin.analytics.attendance'), t('admin.analytics.firstVisits')]}
          rows={rows.map((r) => ({ key: r.date, cells: [r.date, r.attendance, r.firstVisits] }))}
        />
      )}
    </Section>
  )
}

function SummaryTable({ head, rows }: { head: string[]; rows: { key: string; cells: (string | number)[] }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {head.map((h, i) => (
              <th
                key={h}
                className={'px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-subtle ' + (i === 0 ? 'text-left' : 'text-right')}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/60">
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={
                    'px-3 py-2 ' +
                    (i === 0 ? 'text-left font-medium text-text' : 'text-right font-mono tabular-nums text-muted')
                  }
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="surface-panel p-5">
      <div className="mb-3 flex items-center justify-between border-b border-border pb-3">
        <h3 className="section-kicker">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Empty() {
  const { t } = useTranslation()
  return <p className="text-sm text-muted">{t('admin.sheet.empty')}</p>
}
