import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { todaysCheckins, weeklyComparison, presentNamesToday, checkinCandidates } from './today'
import { checkinTag } from './todaySheet'
import { filterMembers, filterLog, NO_FILTER, type Filter } from './filters'
import { computeStats, leaderDashboard } from './stats'
import { GroupFilter } from './GroupFilter'
import { StatsBar } from './StatsBar'
import { IconKey } from './IconKey'
import { memberCheckin, type Member, type RosterResponse } from '../../lib/api'
import { exportTodaySheets } from './todaySheetImage'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'

// Today's live check-in list (scoped) + stats bar, 부서/동산 filter, weekly comparison,
// a 동산 leader dashboard, and a manual check-in (any admin except pastor).
export function AdminToday() {
  const { t } = useTranslation()
  const toast = useToast()
  const { data, isLoading, isError } = useRoster(true)
  const [checkin, setCheckin] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const today = easternNow().date
  // 새가족 by name — with checkinTag they drive the ✝️ 새가족 / 👋 방문자 icons in
  // today's list, matching the exported 출석부.
  const newMemberNames = new Set(data.members.filter((m) => m.is_new_member).map((m) => m.name))

  // Save the 대학부/청년부 sheets as JPGs and copy both pages to the clipboard. Built from
  // the full visible roster so both 부서 pages populate regardless of the active filter.
  async function handleExport() {
    if (!data) return
    setExporting(true)
    try {
      const { copied } = await exportTodaySheets(data.log, today, newMemberNames)
      toast({ title: copied ? t('admin.today.export.done') : t('admin.today.export.downloadedOnly'), tone: 'ok' })
    } catch {
      toast({ title: t('admin.today.export.failed'), tone: 'err' })
    } finally {
      setExporting(false)
    }
  }
  const members = filterMembers(data.members, filter)
  const log = filterLog(data.log, filter)
  const todays = todaysCheckins(log, today)
  const wk = weeklyComparison(log, today)
  const arrow = wk.delta > 0 ? '↑' : wk.delta < 0 ? '↓' : '→'
  const arrowClass = wk.delta > 0 ? 'text-success' : wk.delta < 0 ? 'text-danger' : 'text-muted'
  const canCheckin = data.role !== 'pastor'

  // The 동산 dashboard shows whenever a single 동산 is in view (a leader's roster, or a
  // super-admin filtered down to one 동산).
  const distinctSubs = new Set(members.map((m) => m.subgroup).filter(Boolean))
  const dash = distinctSubs.size === 1 && members.length > 0 ? leaderDashboard(members, log, today) : null

  return (
    <>
      <StatsBar stats={computeStats(members, log, today)} />
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />

      {/* One row: 오늘 · 지난 주 · 증감 (thisWeek === today's count for a weekly-service
          church, so it doubles as 오늘 출석 인원 next to the numbers it's compared with). */}
      <div className="mb-6 grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-surface">
        <Stat label={t('admin.stats.today')} value={String(wk.thisWeek)} />
        <Stat label={t('admin.today.lastWeek')} value={String(wk.lastWeek)} />
        <Stat label={t('admin.today.change')} value={`${arrow} ${Math.abs(wk.delta)}`} valueClass={arrowClass} />
      </div>

      {dash && (
        <div className="mb-6 border-l-2 border-primary bg-primary/[0.06] px-4 py-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-semibold text-text">
              {t('admin.dashboard.present')} <span className="text-success">{dash.present}</span> / {dash.total}
            </span>
            <span className="text-muted">
              {t('admin.dashboard.avgRate')}{' '}
              <span className={dash.avgRate >= 80 ? 'text-success' : dash.avgRate >= 60 ? 'text-warning' : 'text-danger'}>
                {dash.avgRate}%
              </span>
            </span>
          </div>
          {dash.absent > 0 && (
            <div className="text-xs text-muted">
              <span className="font-semibold">
                {t('admin.dashboard.absent')} ({dash.absent}):
              </span>{' '}
              {dash.absentNames.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Divider: the stats/dashboard zone above, the live check-in list below. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <span className="section-kicker">
          {t('admin.today.title')} · {todays.length}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleExport} disabled={exporting || data.log.length === 0}>
            {exporting ? t('admin.today.export.busy') : t('admin.today.export.action')}
          </Button>
          {canCheckin && (
            <Button variant="secondary" size="sm" onClick={() => setCheckin(true)} disabled={data.members.length === 0}>
              {t('admin.today.manualCheckin.action')}
            </Button>
          )}
        </div>
      </div>
      <IconKey items={['newFamily', 'visitor']} />
      {todays.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.today.none')}</p>
      ) : (
        <ul className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-2 xl:grid-cols-3">
          {todays.map((e) => {
            const tag = checkinTag(e, newMemberNames)
            return (
              <li
                key={`${e.name}-${e.ts}`}
                className="flex items-center justify-between gap-3 border-b border-r border-border px-4 py-3.5 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-success/25 bg-success/10 text-sm font-bold text-success">
                    {(e.name || '?').slice(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-text">
                      {e.name}
                      {tag && (
                        <span className="ml-2 rounded-sm bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-primary">
                          {t(tag === 'visitor' ? 'admin.iconKey.visitor' : 'admin.iconKey.newFamily')}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-sm text-muted">
                      {[e.group, e.subgroup].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-xs text-muted">{e.time}</span>
              </li>
            )
          })}
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
    <div className="border-r border-border px-3 py-4 text-center last:border-r-0 sm:px-5">
      <div className={'font-display text-2xl font-bold tabular-nums sm:text-3xl ' + valueClass}>{value}</div>
      <div className="mt-1.5 text-xs font-semibold text-muted sm:text-sm">{label}</div>
    </div>
  )
}
