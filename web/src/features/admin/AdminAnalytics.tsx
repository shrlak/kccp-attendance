import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoster } from './useRoster'
import { filterMembers, filterLog, NO_FILTER, type Filter } from './filters'
import { GroupFilter } from './GroupFilter'
import { AnalyticsCharts } from './AnalyticsCharts'
import { monthlySummary, semesterSummary, weeklyRecap, recapText, excludeOnBreak, type SemesterRow } from './analytics'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { GraduationCap, Calendar, ListChecks, Copy, BarChart3 } from '../../components/ui/Icon'
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
  const log = excludeOnBreak(data.members, filterLog(data.log, filter))

  return (
    <>
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />
      <AnalyticsCharts members={members} log={log} />
      <div className="fx-rise grid grid-cols-1 gap-4 lg:grid-cols-3">
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
    <Section title={t('admin.analytics.monthly')} icon={<Calendar size={15} strokeWidth={2} aria-hidden />}>
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
    <Section title={t('admin.analytics.semester')} icon={<GraduationCap size={15} strokeWidth={2} aria-hidden />}>
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
      icon={<ListChecks size={15} strokeWidth={2} aria-hidden />}
      action={
        rows.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={copy}>
            <Copy size={14} strokeWidth={2} aria-hidden />
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
    <div className="scroll-x -mx-1">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={h}
                className={'px-3 pb-2 section-kicker ' + (i === 0 ? 'text-left' : 'text-right')}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-separator">
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={
                    'px-3 py-2.5 ' +
                    (i === 0 ? 'text-left font-semibold text-text' : 'text-right font-mono tabular-nums text-muted')
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

function Section({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="surface-panel p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        {icon && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>}
        <h3 className="font-display text-base font-bold tracking-tight text-text">{title}</h3>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  )
}

function Empty() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-8 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-fill text-muted">
        <BarChart3 size={20} strokeWidth={1.75} aria-hidden />
      </span>
      <p className="text-sm text-muted">{t('admin.sheet.empty')}</p>
    </div>
  )
}
