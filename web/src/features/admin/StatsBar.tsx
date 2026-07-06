import { useTranslation } from 'react-i18next'
import type { Stats } from './stats'

// The four reactive stat cards shown atop Today/Sheet, reflecting the active filter.
export function StatsBar({ stats }: { stats: Stats }) {
  const { t } = useTranslation()
  const items: [string, number][] = [
    [t('admin.stats.today'), stats.today],
    [t('admin.stats.members'), stats.members],
    [t('admin.stats.days'), stats.days],
  ]
  return (
    <div className="mb-4 grid grid-cols-3 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-surface px-2 py-2.5 text-center">
          <div className="text-2xl font-bold text-text">{value}</div>
          <div className="mt-1 text-sm font-semibold text-text">{label}</div>
        </div>
      ))}
    </div>
  )
}
