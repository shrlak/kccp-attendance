import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { buildGrid, shortDate, type Grid } from './sheet'
import { addBulkAttendance, type LogEntry, type RosterResponse } from '../../lib/api'
import { easternNow } from '../../lib/checkinWindow'
import { checkinCandidates } from './today'
import { memberIdsPresentOn, toggleId } from './bulk'
import { filterMembers, filterLog, NO_FILTER, type Filter } from './filters'
import { computeStats } from './stats'
import { GroupFilter } from './GroupFilter'
import { ExportMenu } from './ExportMenu'
import { StatsBar } from './StatsBar'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'

// Attendance spreadsheet: grid (members × dates) or reverse-chronological log, plus a
// bulk attendance entry (any admin except pastor).
export function AdminSheet() {
  const { t } = useTranslation()
  const [view, setView] = useState<'grid' | 'log'>('grid')
  const [bulk, setBulk] = useState(false)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const { data, isLoading, isError } = useRoster(true)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const members = filterMembers(data.members, filter)
  const fLog = filterLog(data.log, filter)
  const grid = buildGrid(members, fLog)
  const log = [...fLog].sort((a, b) => b.ts - a.ts)
  const canBulk = data.role !== 'pastor'

  return (
    <>
      <StatsBar stats={computeStats(members, fLog, easternNow().date)} />
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1">
          <Toggle active={view === 'grid'} onClick={() => setView('grid')}>
            {t('admin.sheet.grid')}
          </Toggle>
          <Toggle active={view === 'log'} onClick={() => setView('log')}>
            {t('admin.sheet.log')}
          </Toggle>
        </div>
        <div className="flex gap-2">
          <ExportMenu members={members} log={fLog} filter={filter} />
          {canBulk && (
            <Button variant="secondary" size="sm" onClick={() => setBulk(true)} disabled={data.members.length === 0}>
              {t('admin.sheet.bulk.action')}
            </Button>
          )}
        </div>
      </div>
      {view === 'grid' ? <GridView grid={grid} empty={t('admin.sheet.empty')} totalLabel={t('admin.sheet.total')} /> : <LogView log={log} empty={t('admin.sheet.empty')} />}
      {bulk && <BulkModal data={data} onClose={() => setBulk(false)} />}
    </>
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
      await qc.invalidateQueries({ queryKey: ['roster'] })
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
          <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.sheet.bulk.date')}</span>
          <Input type="date" value={date} onChange={(e) => setDateReset(e.target.value)} />
        </label>
      </div>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.members.search')}
        aria-label={t('admin.members.search')}
        className="mb-2"
      />
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wide text-subtle">
          {t('admin.sheet.bulk.selected', { n: selected.size })}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setSelected(new Set(selectable.map((m) => m.id)))} className="text-xs font-semibold text-primary hover:underline">
            {t('admin.sheet.bulk.all')}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs font-semibold text-muted hover:underline">
            {t('admin.sheet.bulk.none')}
          </button>
        </div>
      </div>
      <ul className="flex max-h-[42vh] flex-col gap-1 overflow-y-auto pr-1">
        {candidates.length === 0 && <li className="text-sm text-muted">{t('admin.today.manualCheckin.none')}</li>}
        {candidates.map((m) => {
          const here = present.has(m.id)
          const checked = here || selected.has(m.id)
          return (
            <li key={m.id}>
              <label
                className={
                  'flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm ' +
                  (here ? 'bg-surface-alt opacity-60' : 'bg-surface cursor-pointer hover:bg-surface-alt')
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={here || saving}
                  onChange={() => setSelected((cur) => toggleId(cur, m.id))}
                />
                <span className="font-medium text-text">{m.name}</span>
                <span className="text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ')}</span>
                {here && <span className="ml-auto text-xs font-semibold text-success">✓</span>}
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

function GridView({ grid, empty, totalLabel }: { grid: Grid; empty: string; totalLabel: string }) {
  if (grid.dates.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-canvas px-2 py-1.5 text-left font-semibold text-muted">{' '}</th>
            {grid.dates.map((d) => (
              <th key={d} className="px-2 py-1.5 font-mono text-[11px] font-medium text-subtle">
                {shortDate(d)}
              </th>
            ))}
            <th className="px-2 py-1.5 text-xs font-semibold text-muted">{totalLabel}</th>
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((r) => (
            <tr key={r.member.id} className="border-t border-border">
              <td className="sticky left-0 z-10 bg-canvas px-2 py-1.5 font-medium text-text">{r.member.name}</td>
              {grid.dates.map((d) => (
                <td key={d} className="px-2 py-1.5 text-center">
                  {r.present.has(d) ? <span className="text-success">✓</span> : <span className="text-subtle">·</span>}
                </td>
              ))}
              <td className="px-2 py-1.5 text-center font-bold text-primary">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function LogView({ log, empty }: { log: LogEntry[]; empty: string }) {
  if (log.length === 0) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ul className="flex flex-col gap-1.5">
      {log.map((e) => (
        <li key={`${e.name}-${e.ts}`} className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <span className="font-medium text-text">
            {e.name}
            {e.firstVisit && <span className="ml-1.5 text-xs">🌟</span>}
          </span>
          <span className="font-mono text-xs text-muted">
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
      onClick={onClick}
      className={
        'min-h-9 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ' +
        (active ? 'bg-primary/15 text-primary' : 'border border-border bg-surface text-muted hover:bg-surface-alt')
      }
    >
      {children}
    </button>
  )
}
