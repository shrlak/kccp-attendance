import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import {
  buildAttendanceModel,
  attendanceGroupBy,
  blockColors,
  cssColor,
  exportSundays,
  semesterLabel,
  filterLabel,
  HEADER_TOTAL_FILL,
  KEY_FILL,
  NOTE_FILL,
  type Lang,
} from './exports'
import { addBulkAttendance, clearAttendance, getConfig, type LogEntry, type Member, type RosterResponse } from '../../lib/api'
import type { SemesterDates } from '../../lib/semester'
import { easternNow } from '../../lib/checkinWindow'
import { checkinCandidates } from './today'
import { memberIdsPresentOn, toggleId } from './bulk'
import { filterMembers, filterLog, NO_FILTER, type Filter } from './filters'
import { orderByDongsanRole } from './dongsan'
import { useDongsanRole } from './useDongsanRole'
import { computeStats } from './stats'
import { GroupFilter } from './GroupFilter'
import { ExportMenu } from './ExportMenu'
import { StatsBar } from './StatsBar'
import { IconKey } from './IconKey'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { Tag } from '../../components/ui/Tag'
import { useToast } from '../../components/ui/Toast'
import { Plus, Trash2, AlertTriangle, Search, Calendar, ClipboardList, Check } from '../../components/ui/Icon'
import { refreshRoster } from '../../lib/live'

// Attendance spreadsheet: the Excel-style 출석부 grid (an on-screen replica of the exported
// "Attendance" sheet — color-coded 동산 blocks, O/X cells, 예배 총 출석 + 총 출석 rows) or a
// reverse-chronological log, plus a bulk attendance entry (any admin except pastor).
export function AdminSheet() {
  const { t, i18n } = useTranslation()
  const [view, setView] = useState<'grid' | 'log'>('grid')
  const [bulk, setBulk] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })

  if (isLoading) return (
    <div className="fx-fade space-y-3">
      <div className="fx-skeleton h-16 rounded-2xl" />
      <div className="fx-skeleton h-64 rounded-2xl" />
    </div>
  )
  if (isError) return (
    <div className="fx-rise grid place-items-center py-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-danger/10 text-danger"><AlertTriangle className="size-6" aria-hidden /></div>
      <p className="mt-4 text-sm font-semibold text-danger">{t('common.error')}</p>
    </div>
  )
  if (!data) return null

  const lang: Lang = i18n.language === 'en' ? 'en' : 'ko'
  const today = easternNow().date
  const members = filterMembers(data.members, filter)
  const fLog = filterLog(data.log, filter)
  const log = [...fLog].sort((a, b) => b.ts - a.ts)
  const canBulk = data.role !== 'pastor'

  return (
    <>
      <StatsBar stats={computeStats(members, fLog, easternNow().date)} />
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="segmented">
          <Toggle active={view === 'grid'} onClick={() => setView('grid')}>
            {t('admin.sheet.grid')}
          </Toggle>
          <Toggle active={view === 'log'} onClick={() => setView('log')}>
            {t('admin.sheet.log')}
          </Toggle>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportMenu members={members} log={fLog} filter={filter} />
          {canBulk && (
            <Button variant="secondary" size="sm" onClick={() => setBulk(true)} disabled={data.members.length === 0}>
              <Plus className="size-4" aria-hidden />
              {t('admin.sheet.bulk.action')}
            </Button>
          )}
          {data.canClearAttendance && (
            <Button variant="danger" size="sm" onClick={() => setClearing(true)}>
              <Trash2 className="size-4" aria-hidden />
              {t('admin.sheet.clearAll.action')}
            </Button>
          )}
        </div>
      </div>
      {view === 'log' && <IconKey items={['firstVisit']} />}
      {view === 'grid' ? (
        <GridView
          members={members}
          log={fLog}
          lang={lang}
          today={today}
          filter={filter}
          semesterDates={cfg?.semesterDates}
        />
      ) : (
        <LogView log={log} empty={t('admin.sheet.empty')} />
      )}
      {bulk && <BulkModal data={data} onClose={() => setBulk(false)} />}
      {clearing && <ClearDialog isSuper={data.role === 'super_admin'} onClose={() => setClearing(false)} />}
    </>
  )
}

function ClearDialog({ isSuper, onClose }: { isSuper: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      const res = await clearAttendance()
      if (res.status === 'cleared') {
        toast({ title: t('admin.sheet.clearAll.cleared'), tone: 'ok' })
        await refreshRoster(qc)
      } else {
        toast({ title: t('admin.sheet.clearAll.requested'), tone: 'ok' })
      }
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.sheet.clearAll.title')}>
      <p className="flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-3 text-sm text-danger">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t(isSuper ? 'admin.sheet.clearAll.warnSuper' : 'admin.sheet.clearAll.warnRequest')}</span>
      </p>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button variant="danger" onClick={confirm} disabled={busy} className="flex-1">
          {busy ? t('common.loading') : t(isSuper ? 'admin.sheet.clearAll.confirm' : 'admin.sheet.clearAll.request')}
        </Button>
      </div>
    </Dialog>
  )
}

function BulkModal({ data, onClose }: { data: RosterResponse; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [date, setDate] = useState(easternNow().date)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const present = memberIdsPresentOn(data.log, date)
  const candidates = checkinCandidates(data.members, search)
  const selectable = candidates.filter((m) => !present.has(m.id))

  function setDateReset(d: string) {
    setDate(d)
    setSelected(new Set()) // present-set changes with the date — start clean
  }

  async function submit() {
    if (selected.size === 0) return
    setSaving(true)
    try {
      const res = await addBulkAttendance([...selected], date)
      toast({ title: t('admin.sheet.bulk.done', { n: res.added }), tone: 'ok' })
      await refreshRoster(qc)
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.sheet.bulk.title')}>
      <div className="mb-3 flex items-end gap-2">
        <label className="flex-1">
          <span className="field-label inline-flex items-center gap-1.5"><Calendar className="size-3.5" aria-hidden />{t('admin.sheet.bulk.date')}</span>
          <Input type="date" value={date} onChange={(e) => setDateReset(e.target.value)} />
        </label>
      </div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.members.search')}
          aria-label={t('admin.members.search')}
          className="pl-10"
        />
      </div>
      <div className="mb-2 flex items-center justify-between">
        <span className="section-kicker">
          {t('admin.sheet.bulk.selected', { n: selected.size })}
        </span>
        <div className="flex gap-1">
          <button type="button" onClick={() => setSelected(new Set(selectable.map((m) => m.id)))} className="rounded-full px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/10">
            {t('admin.sheet.bulk.all')}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="rounded-full px-2.5 py-1 text-xs font-semibold text-muted hover:bg-fill">
            {t('admin.sheet.bulk.none')}
          </button>
        </div>
      </div>
      <ul className="flex max-h-[42vh] flex-col gap-1.5 overflow-y-auto pr-1">
        {candidates.length === 0 && <li className="py-4 text-center text-sm text-muted">{t('admin.today.manualCheckin.none')}</li>}
        {candidates.map((m) => {
          const here = present.has(m.id)
          const checked = here || selected.has(m.id)
          return (
            <li key={m.id}>
              <label
                className={
                  'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ' +
                  (here
                    ? 'border-success/30 bg-success/5 opacity-70'
                    : checked
                      ? 'cursor-pointer border-primary/40 bg-primary/[0.06]'
                      : 'cursor-pointer border-border bg-surface hover:bg-fill')
                }
              >
                <span className={'grid size-5 shrink-0 place-items-center rounded-full ' + (checked ? 'bg-primary text-primary-fg' : 'border border-border')}>
                  {checked && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
                </span>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  disabled={here || saving}
                  onChange={() => setSelected((cur) => toggleId(cur, m.id))}
                />
                <span className="font-medium text-text">{m.name}</span>
                <span className="text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ')}</span>
                {here && <Check className="ml-auto size-4 text-success" strokeWidth={3} aria-hidden />}
              </label>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button onClick={submit} disabled={selected.size === 0 || saving} className="flex-1">
          {saving ? t('common.loading') : t('admin.sheet.bulk.confirm', { n: selected.size })}
        </Button>
      </div>
    </Dialog>
  )
}

// On-screen 출석부: an exact preview of the exported "Attendance" sheet. Members are split
// into color-coded 동산 blocks (green → blue → yellow → red), each a single date-header row
// over O = 출석 (green) / X = 결석 (red) cells — status marks (한국 귀국 / 이주 / 새가족 …)
// render as grey cells spanning the dates they cover, like the master sheet — a per-member
// 예배 총 출석 count and a 총 출석 totals row, opened by the KEY legend up top — see
// exports.ts (gridSheet / reportHtml) for the shared spine. Date columns are the term's
// worship Sundays. Each block lists its 동산지기 first, then 부동산지기, then the rest in
// roster order, with the leaders' name cells bolded + highlighted (no icon).
const CELL = 'whitespace-nowrap border border-[#b7b7b7] px-3 py-1.5'
// Variable-length cells (names, status notes) truncate instead of stretching their
// column, so every 동산 block's table keeps the same fixed-layout width.
const CLIP = 'overflow-hidden text-ellipsis'
const DARK = '#1f2937'

// Fixed column widths (px), shared by every 동산 block so all tables end up the exact
// same overall width regardless of name/label lengths: 이름 · 예배 총 출석 · one per date.
const NAME_COL = 160
const TOTAL_COL = 120
const DATE_COL = 72

function GridView({
  members,
  log,
  lang,
  today,
  filter,
  semesterDates,
}: {
  members: Member[]
  log: LogEntry[]
  lang: Lang
  today: string
  filter: Filter
  semesterDates?: SemesterDates | null
}) {
  const roleOf = useDongsanRole()
  const L =
    lang === 'ko'
      ? { name: '이름', memberTotal: '예배 총 출석', total: '총 출석', key: 'KEY', present: '출석', absent: '결석', etc: '기타', leaderKey: '동산지기', subleaderKey: '부동산지기', unassigned: '동산 미지정', newFamily: '새가족', empty: '출석 기록이 없습니다' }
      : { name: 'Name', memberTotal: 'Worship Total', total: 'Total', key: 'KEY', present: 'Present', absent: 'Absent', etc: 'Other', leaderKey: 'Dongsan leader', subleaderKey: 'Assistant leader', unassigned: 'Unassigned', newFamily: 'New family', empty: 'No attendance records' }

  // 동산지기/부동산지기 float to the top of their own 동산 block (roster order otherwise).
  const ordered = orderByDongsanRole(members, roleOf)
  const model = buildAttendanceModel(
    ordered,
    log,
    exportSundays(today, semesterDates),
    today,
    { unassigned: L.unassigned, newFamily: L.newFamily },
    attendanceGroupBy(today, semesterDates, L.unassigned),
  )
  const pink = cssColor(HEADER_TOTAL_FILL)
  const grey = cssColor(NOTE_FILL)

  if (model.sections.length === 0) return <p className="text-sm text-muted">{L.empty}</p>

  return (
    <div className="overflow-x-auto">
      <p className="mb-3 text-sm text-muted">
        {semesterLabel(today, lang, semesterDates)} · {filterLabel(filter.group, filter.subgroup, lang)}
      </p>
      {/* Legend text uses theme tokens so it stays readable in dark mode; only the
          swatches keep the sheet's hardcoded paper palette. */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-muted">
        <b className="rounded px-2.5 py-0.5 text-white" style={{ background: cssColor(KEY_FILL) }}>{L.key}</b>
        <span><b>O</b> {L.present}</span>
        <span><b>X</b> {L.absent}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: grey }} />
          {L.etc}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: '#FFF3C4' }} />
          <b>{L.leaderKey}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-5 rounded-sm" style={{ background: '#FFF9E1' }} />
          <b>{L.subleaderKey}</b>
        </span>
      </div>
      <div className="flex flex-col gap-6 text-sm" style={{ color: DARK }}>
        {model.sections.map((s, si) => {
          const { light: lightArgb, medium: mediumArgb } = blockColors(si)
          const light = cssColor(lightArgb)
          const medium = cssColor(mediumArgb)
          return (
            <section key={s.subgroup} className="w-max">
              <h3 className="mb-1.5 inline-block rounded px-3 py-1 text-base font-bold" style={{ background: medium, color: DARK }}>
                {s.subgroup}
              </h3>
              <table className="table-fixed border-collapse bg-white">
                <colgroup>
                  <col style={{ width: NAME_COL }} />
                  <col style={{ width: TOTAL_COL }} />
                  {model.dateLabels.map((d) => (
                    <col key={d} style={{ width: DATE_COL }} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th className={`${CELL} ${CLIP} text-left font-bold`} style={{ background: light }}>{L.name}</th>
                    <th className={`${CELL} text-center font-bold`} style={{ background: pink }}>{L.memberTotal}</th>
                    {model.dateLabels.map((d) => (
                      <th key={d} className={`${CELL} text-center font-bold`} style={{ background: medium }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => {
                    const role = roleOf(r.member.name, r.member.group_name, r.member.subgroup || '')
                    return (
                    <tr key={r.member.id}>
                      {role ? (
                        // 동산지기 / 부동산지기: bold, warm-highlighted name cell (no icon). The
                        // grid is fixed light-scheme (hex fills) like the export, so hardcoded
                        // hex highlights are consistent here.
                        <td
                          className={`${CELL} ${CLIP} text-left font-bold`}
                          style={{ background: role === '동산지기' ? '#FFF3C4' : '#FFF9E1' }}
                        >
                          {r.member.name}
                        </td>
                      ) : (
                        <td className={`${CELL} ${CLIP} bg-white text-left font-medium`}>{r.member.name}</td>
                      )}
                      <td className={`${CELL} bg-white text-center font-bold`}>{r.total}</td>
                      {r.marks.map((c, di) => {
                        const d = model.dates[di]
                        // Status marks: one grey cell spanning the covered dates (master-sheet style).
                        if (c.kind === 'note')
                          return (
                            <td key={d} colSpan={c.span} className={`${CELL} ${CLIP} text-center`} style={{ background: grey }}>
                              {c.note}
                            </td>
                          )
                        if (c.kind === 'inNote') return null
                        // Pre-등록일자, upcoming Sundays and not-yet-entered dates render blank.
                        if (c.kind === 'blank') return <td key={d} className={`${CELL} bg-white`} />
                        const here = c.kind === 'present'
                        return (
                          <td
                            key={d}
                            className={`${CELL} bg-white text-center ${here ? 'font-bold text-[#16a34a]' : 'text-[#dc2626]'}`}
                          >
                            {here ? 'O' : 'X'}
                          </td>
                        )
                      })}
                    </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className={`${CELL} text-left font-bold`} style={{ background: medium }}>{L.total}</td>
                    {model.dates.map((d, i) => (
                      <td key={d} className={`${CELL} bg-white text-center font-bold`}>
                        {s.totals[i]}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function LogView({ log, empty }: { log: LogEntry[]; empty: string }) {
  const { t } = useTranslation()
  if (log.length === 0) return (
    <div className="fx-rise grid place-items-center rounded-2xl border border-dashed border-border py-14 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-fill text-subtle"><ClipboardList className="size-6" aria-hidden /></div>
      <p className="mt-4 text-sm font-semibold text-muted">{empty}</p>
    </div>
  )
  return (
    <ul className="fx-stagger inset-list text-sm">
      {log.map((e) => (
        <li key={`${e.name}-${e.ts}`} className="inset-row min-h-12 justify-between gap-3 py-2.5">
          <span className="flex items-center gap-2 font-medium text-text">
            {e.name}
            {e.firstVisit && (
              <Tag tone="gold" className="text-[10px]">{t('admin.iconKey.firstVisit')}</Tag>
            )}
          </span>
          <span className="tabular-nums text-xs text-subtle">
            {e.date} · {e.time}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        'min-h-9 rounded-full px-4 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
        (active ? 'bg-surface text-primary shadow-[var(--shadow-sm)]' : 'text-muted hover:text-text')
      }
    >
      {children}
    </button>
  )
}
