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
    <div className="surface-panel mb-5 grid grid-cols-3 overflow-hidden">
      {items.map(([label, value]) => (
        <div key={label} className="border-r border-border px-4 py-4 last:border-r-0 sm:px-5 sm:py-5">
          <div className="section-kicker leading-4">{label}</div>
          <div className="mt-2 font-display text-2xl font-bold tabular-nums tracking-tight text-text sm:text-3xl">{value}</div>
        </div>
      ))}
    </div>
  )
}
