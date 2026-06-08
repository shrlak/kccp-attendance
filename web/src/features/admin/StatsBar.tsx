import { useTranslation } from 'react-i18next'
import type { Stats } from './stats'

// The four reactive stat cards shown atop Today/Sheet, reflecting the active filter.
export function StatsBar({ stats }: { stats: Stats }) {
  const { t } = useTranslation()
  const items: [string, number][] = [
    [t('admin.stats.today'), stats.today],
    [t('admin.stats.members'), stats.members],
    [t('admin.stats.records'), stats.records],
    [t('admin.stats.days'), stats.days],
  ]
  return (
    <div className="mb-4 grid grid-cols-4 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-surface px-2 py-2 text-center">
          <div className="text-lg font-bold text-text">{value}</div>
          <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-subtle">{label}</div>
        </div>
      ))}
    </div>
  )
}
