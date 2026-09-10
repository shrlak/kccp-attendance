import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { awayOn, type Lang } from './exports'
import { addBulkAttendance, clearAttendance, configCalendar, type RosterResponse } from '../../lib/api'
import { easternNow } from '../../lib/checkinWindow'
import { checkinCandidates } from './today'
import { memberIdsPresentOn, toggleId } from './bulk'
import { filterMembers, filterLog, NO_FILTER, type Filter } from './filters'
import { computeStats } from './stats'
import { GroupFilter } from './GroupFilter'
import { AttendanceGrid } from './AttendanceGrid'
import { ExportMenu } from './ExportMenu'
import { ArchiveSection } from './ArchiveSection'
import { StatsBar } from './StatsBar'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { Plus, Trash2, AlertTriangle, Search, Calendar, Check } from '../../components/ui/Icon'
import { refreshRoster } from '../../lib/live'
import { useAppConfig } from '../../lib/useAppConfig'

// Attendance spreadsheet: the Excel-style 출석부 grid — an on-screen replica of the exported
// "Attendance" sheet (color-coded 동산 blocks, O/X cells, 예배 총 출석 + 총 출석 rows) — plus a
// bulk attendance entry (any admin except pastor).
//
// 시간순 '기록' 화면은 없앴다. 표가 이미 같은 사실을 담고 있고(누가 어느 주일에 왔나) 기록은
// 그것을 한 번 더 늘어놓을 뿐이라, 두 화면을 같이 두면 어느 쪽이 정본인지가 흐려진다. 한 줄
// 단위로 봐야 할 때는 내보내기의 엑셀(전체 기록 시트)이 그 자리를 대신한다.
export function AdminSheet() {
  const { t, i18n } = useTranslation()
  const [bulk, setBulk] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useAppConfig()

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
  // `data.members` already has the 숨긴 멤버 taken out (useRoster), so every number and row
  // on this screen is about who is actually on the roster now.
  const members = filterMembers(data.members, filter)
  const fLog = filterLog(data.log, filter)
  // 동산모임 출석 (구글 시트 연동이 들어오기 전에는 비어 있다). 예배 출석과 같은 필터를
  // 거쳐야 부서/동산을 좁혔을 때 두 값이 같은 사람들의 것으로 남는다.
  const fDongsanLog = filterLog(data.dongsanLog ?? [], filter)
  const canBulk = data.role !== 'pastor'
  // 아카이브만은 숨긴 멤버까지 되돌려 넣는다: 이미 끝난 학기의 출석부는 그때 실제로 있던
  // 사람이 다 들어 있어야 하는 기록이고, 그 안에서 누구를 넣고 뺄지는 buildAttendanceModel의
  // 기간 규칙(awayForRange)이 학기별로 판단한다.
  const archiveMembers = filterMembers([...data.members, ...data.hiddenMembers], filter)

  return (
    <>
      <StatsBar stats={computeStats(members, fLog, today)} />
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
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
      <AttendanceGrid
        members={members}
        log={fLog}
        dongsanLog={fDongsanLog}
        lang={lang}
        today={today}
        filter={filter}
        semesterDates={configCalendar(cfg)}
      />
      {/* Finished 학기 / 전환 기간 / 연도 출석부, downloadable — the tab's closing section. */}
      <ArchiveSection
        members={archiveMembers}
        log={fLog}
        filter={filter}
        today={today}
        lang={lang}
        semesterDates={configCalendar(cfg)}
        dongsanHistory={data.dongsanHistory}
      />
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
        refreshRoster(qc)
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
  // 한국 귀국 / 이주 중인 멤버는 출석부에서 숨기므로 일괄 출석 목록에도 올리지 않는다.
  const candidates = checkinCandidates(data.members.filter((m) => !awayOn(m, date)), search)
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
      refreshRoster(qc)
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
