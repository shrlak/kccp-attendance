import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { todaysCheckins, weeklyComparison } from './today'
import { checkinTag } from './todaySheet'
import { filterMembers, filterLog, NO_FILTER, type Filter } from './filters'
import { leaderDashboard } from './stats'
import { GroupFilter } from './GroupFilter'
import { IconKey } from './IconKey'
import { getConfig } from '../../lib/api'
import { resolveGroupColor, hexTint } from './groupColors'
import { copyTodaySheets, saveTodaySheets } from './todaySheetImage'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'

// Today's live check-in list (scoped) + stats bar, 부서/동산 filter, weekly comparison,
// and a 동산 leader dashboard.
export function AdminToday() {
  const { t } = useTranslation()
  const toast = useToast()
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const [exporting, setExporting] = useState<'copy' | 'save' | null>(null)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const today = easternNow().date
  // 새가족 by name — with checkinTag they drive the ✝️ 새가족 / 👋 방문자 icons in
  // today's list, matching the exported 출석부.
  const newMemberNames = new Set(data.members.filter((m) => m.is_new_member).map((m) => m.name))

  // Copy or save the 대학부/청년부 sheets as JPGs — separate actions since only the
  // clipboard copy is usually needed. Built from the full visible roster so both 부서
  // pages populate regardless of the active filter.
  async function handleCopy() {
    if (!data) return
    setExporting('copy')
    try {
      const { copied } = await copyTodaySheets(data.log, today, newMemberNames)
      toast({ title: t(copied ? 'admin.today.export.copyDone' : 'admin.today.export.copyFailed'), tone: copied ? 'ok' : 'err' })
    } catch {
      toast({ title: t('admin.today.export.saveFailed'), tone: 'err' })
    } finally {
      setExporting(null)
    }
  }

  async function handleSave() {
    if (!data) return
    setExporting('save')
    try {
      await saveTodaySheets(data.log, today, newMemberNames)
      toast({ title: t('admin.today.export.saveDone'), tone: 'ok' })
    } catch {
      toast({ title: t('admin.today.export.saveFailed'), tone: 'err' })
    } finally {
      setExporting(null)
    }
  }
  const members = filterMembers(data.members, filter)
  const log = filterLog(data.log, filter)
  const todays = todaysCheckins(log, today)
  const wk = weeklyComparison(log, today)
  const arrow = wk.delta > 0 ? '↑' : wk.delta < 0 ? '↓' : '→'
  const arrowClass = wk.delta > 0 ? 'text-success' : wk.delta < 0 ? 'text-danger' : 'text-muted'

  // The 동산 dashboard shows whenever a single 동산 is in view (a leader's roster, or a
  // super-admin filtered down to one 동산).
  const distinctSubs = new Set(members.map((m) => m.subgroup).filter(Boolean))
  const dash = distinctSubs.size === 1 && members.length > 0 ? leaderDashboard(members, log, today) : null

  return (
    <>
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
          <Button variant="secondary" size="sm" onClick={handleCopy} disabled={exporting !== null || data.log.length === 0}>
            {exporting === 'copy' ? t('admin.today.export.busy') : t('admin.today.export.copy')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleSave} disabled={exporting !== null || data.log.length === 0}>
            {exporting === 'save' ? t('admin.today.export.busy') : t('admin.today.export.save')}
          </Button>
        </div>
      </div>
      <IconKey items={['newFamily', 'visitor']} />
      {todays.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.today.none')}</p>
      ) : (
        <ul className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-2 xl:grid-cols-3">
          {todays.map((e) => {
            const tag = checkinTag(e, newMemberNames)
            const color = resolveGroupColor(cfg?.groupColors, e.group)
            return (
              <li
                key={`${e.name}-${e.ts}`}
                className="flex items-center justify-between gap-3 border-b border-r border-border px-4 py-3.5 last:border-b-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md border text-sm font-bold"
                    style={{ borderColor: hexTint(color, 0.3), background: hexTint(color, 0.12), color }}
                  >
                    {(e.name || '?').slice(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-text">
                      {e.name}
                      {tag && (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-primary">
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
    </>
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
