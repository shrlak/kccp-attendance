import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoster } from './useRoster'
import { buildGrid, shortDate, type Grid } from './sheet'
import type { LogEntry } from '../../lib/api'

// Attendance spreadsheet: grid (members × dates) or reverse-chronological log.
export function AdminSheet() {
  const { t } = useTranslation()
  const [view, setView] = useState<'grid' | 'log'>('grid')
  const { data, isLoading, isError } = useRoster(true)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const grid = buildGrid(data.members, data.log)
  const log = [...data.log].sort((a, b) => b.ts - a.ts)

  return (
    <>
      <div className="mb-3 flex gap-1">
        <Toggle active={view === 'grid'} onClick={() => setView('grid')}>
          {t('admin.sheet.grid')}
        </Toggle>
        <Toggle active={view === 'log'} onClick={() => setView('log')}>
          {t('admin.sheet.log')}
        </Toggle>
      </div>
      {view === 'grid' ? <GridView grid={grid} empty={t('admin.sheet.empty')} totalLabel={t('admin.sheet.total')} /> : <LogView log={log} empty={t('admin.sheet.empty')} />}
    </>
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
