import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { todaysCheckins, weeklyComparison } from './today'
import { isActiveNewFamily } from './newFamily'
import { checkinTag } from './todaySheet'
import { filterMembers, filterLog, NO_FILTER, type Filter } from './filters'
import { leaderDashboard } from './stats'
import { GroupFilter } from './GroupFilter'
import { IconKey } from './IconKey'
import { getConfig, type Member } from '../../lib/api'
import { resolveGroupColor, hexTint } from './groupColors'
import { copyTodaySheets, saveTodaySheets } from './todaySheetImage'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { useToast } from '../../components/ui/Toast'
import { RefreshCw, CalendarCheck, Clock, TrendingUp, TrendingDown, Minus, Copy, Download, Users } from '../../components/ui/Icon'
import { EditModal, AttendanceModal } from './MemberDialogs'

// Today's live check-in list (scoped) + stats bar, 부서/동산 filter, weekly comparison,
// and a 동산 leader dashboard.
export function AdminToday() {
  const { t } = useTranslation()
  const toast = useToast()
  const { data, isLoading, isError, isFetching, refetch } = useRoster(true)
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const [exporting, setExporting] = useState<'copy' | 'save' | null>(null)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const [editingMember, setEditingMember] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)

  if (isLoading) return (
    <div className="grid grid-cols-3 gap-3">
      {[0, 1, 2].map((i) => <div key={i} className="fx-skeleton h-24 rounded-2xl" />)}
    </div>
  )
  if (isError) return (
    <div className="fx-rise grid place-items-center py-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-danger/10 text-danger"><TrendingDown className="size-6" aria-hidden /></div>
      <p className="mt-4 text-sm font-semibold text-danger">{t('common.error')}</p>
    </div>
  )
  if (!data) return null

  const today = easternNow().date
  // 새가족 by name — with checkinTag they drive the ✝️ 새가족 / 👋 방문자 icons in
  // today's list, matching the exported 출석부. Stops once a newcomer finishes both
  // weeks of education (isActiveNewFamily), even though is_new_member itself stays true.
  const newMemberNames = new Set(data.members.filter((m) => isActiveNewFamily(m)).map((m) => m.name))

  // Copy or save the 대학부/청년부 sheets as JPGs — separate actions since only the
  // clipboard copy is usually needed. Built from the full visible roster so both 부서
  // pages populate regardless of the active filter.
  async function handleCopy() {
    if (!data) return
    setExporting('copy')
    try {
      const { copied } = await copyTodaySheets(data.log, today, newMemberNames)
      toast({ title: t(copied ? 'admin.mergedCopy.sheetsDone' : 'admin.mergedCopy.failed'), tone: copied ? 'ok' : 'err' })
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
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat icon={<CalendarCheck className="size-4" aria-hidden />} label={t('admin.stats.today')} value={String(wk.thisWeek)} accent />
        <Stat icon={<Clock className="size-4" aria-hidden />} label={t('admin.today.lastWeek')} value={String(wk.lastWeek)} />
        <Stat
          icon={wk.delta > 0 ? <TrendingUp className="size-4" aria-hidden /> : wk.delta < 0 ? <TrendingDown className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
          label={t('admin.today.change')}
          value={`${arrow}${Math.abs(wk.delta)}`}
          valueClass={arrowClass}
        />
      </div>

      {dash && (
        <Card className="mb-6 fx-rise border-primary/25 bg-primary/[0.05] p-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5 font-semibold text-text">
              <Users className="size-4 text-primary" aria-hidden />
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
        </Card>
      )}

      {/* Divider: the stats/dashboard zone above, the live check-in list below. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-5">
        <span className="section-kicker">
          {t('admin.today.title')} · {todays.length}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={'size-4' + (isFetching ? ' animate-spin' : '')} aria-hidden />
            {t('admin.today.reload')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleCopy} disabled={exporting !== null || data.log.length === 0}>
            <Copy className="size-4" aria-hidden />
            {exporting === 'copy' ? t('admin.today.export.busy') : t('admin.today.export.copy')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleSave} disabled={exporting !== null || data.log.length === 0}>
            <Download className="size-4" aria-hidden />
            {exporting === 'save' ? t('admin.today.export.busy') : t('admin.today.export.save')}
          </Button>
        </div>
      </div>
      <IconKey items={['newFamily', 'visitor']} />
      {todays.length === 0 ? (
        <div className="fx-rise grid place-items-center rounded-2xl border border-dashed border-border py-14 text-center">
          <div className="grid size-14 place-items-center rounded-full bg-fill text-subtle"><CalendarCheck className="size-6" aria-hidden /></div>
          <p className="mt-4 text-sm font-semibold text-muted">{t('admin.today.none')}</p>
        </div>
      ) : (
        <ul className="fx-stagger grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {todays.map((e) => {
            const tag = checkinTag(e, newMemberNames)
            const color = resolveGroupColor(cfg?.groupColors, e.group)
            const member = e.memberId
              ? (data.members.find((m) => m.id === e.memberId) ?? data.staffMembers.find((m) => m.id === e.memberId))
              : undefined
            return (
              <li
                key={`${e.name}-${e.ts}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-3.5 py-3 shadow-[var(--shadow-sm)] transition-[box-shadow,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:-translate-y-0.5 hover:shadow-[var(--shadow)]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold"
                    style={{ background: hexTint(color, 0.16), color }}
                  >
                    {(e.name || '?').slice(0, 1)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[15px] font-semibold text-text">
                      {member ? (
                        <button
                          type="button"
                          onClick={() => setEditingMember(member)}
                          className="rounded text-left hover:text-primary focus-visible:text-primary focus-visible:outline-none"
                        >
                          {e.name}
                        </button>
                      ) : (
                        e.name
                      )}
                      {tag && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {t(tag === 'visitor' ? 'admin.iconKey.visitor' : 'admin.iconKey.newFamily')}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[13px] text-muted">
                      {[e.group, e.subgroup].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 tabular-nums text-xs font-medium text-subtle">
                  <Clock className="size-3.5" aria-hidden />{e.time}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {editingMember && (
        <EditModal
          member={editingMember}
          allowDelete={data.role !== 'pastor'}
          onClose={() => setEditingMember(null)}
          onAttendance={() => {
            setAttendanceFor(editingMember)
            setEditingMember(null)
          }}
        />
      )}
      {attendanceFor && (
        <AttendanceModal
          member={attendanceFor}
          log={data.log}
          readOnly={data.role === 'pastor'}
          onClose={() => setAttendanceFor(null)}
        />
      )}
    </>
  )
}

function Stat({
  label,
  value,
  valueClass = 'text-text',
  icon,
  accent = false,
}: {
  label: string
  value: string
  valueClass?: string
  icon?: ReactNode
  accent?: boolean
}) {
  return (
    <div
      className={
        'rounded-2xl border p-3.5 text-center shadow-[var(--shadow-sm)] sm:p-4 ' +
        (accent ? 'border-primary/20 bg-primary/[0.06]' : 'border-border bg-surface')
      }
    >
      {icon && (
        <div className={'mb-1.5 flex justify-center ' + (accent ? 'text-primary' : 'text-subtle')}>{icon}</div>
      )}
      <div className={'font-display text-2xl font-bold tabular-nums sm:text-[28px] ' + valueClass}>{value}</div>
      <div className="mt-1 text-[11px] font-semibold text-muted sm:text-xs">{label}</div>
    </div>
  )
}
