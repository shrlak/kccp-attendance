import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { Chart as ChartType, ChartConfiguration, Plugin } from 'chart.js'
import { useTheme } from '../../stores/useTheme'
import { shortDate } from './sheet'
import { trendSeries, groupSeries } from './analytics'
import { getConfig, type Member, type LogEntry } from '../../lib/api'
import { resolveGroupColor } from './groupColors'
import { Activity, BarChart3 } from '../../components/ui/Icon'

// Inline plugin that prints each datapoint's value just above its dot on the trend
// line. `tick` is the theme-aware label color already resolved for the axes.
function pointValueLabels(tick: string): Plugin {
  return {
    id: 'pointValueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart
      const meta = chart.getDatasetMeta(0)
      const data = chart.data.datasets[0]?.data ?? []
      ctx.save()
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = tick
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      meta.data.forEach((point, i) => {
        const value = data[i]
        if (value == null) return
        ctx.fillText(String(value), point.x, point.y - 6)
      })
      ctx.restore()
    },
  }
}

// Chart.js is loaded once, lazily, on first chart mount — it must never be in the
// initial bundle. registerables wires up the line/bar controllers, scales, etc.
let chartLib: Promise<typeof import('chart.js')> | null = null
function loadChart() {
  if (!chartLib) {
    chartLib = import('chart.js').then((mod) => {
      mod.Chart.register(...mod.registerables)
      return mod
    })
  }
  return chartLib
}

// A single <canvas> driven by a Chart.js config builder. The instance is recreated
// whenever the config (data) or theme changes, and destroyed on unmount.
function ChartCanvas({ build }: { build: (tick: string, grid: string) => ChartConfiguration }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<ChartType | null>(null)
  const theme = useTheme((s) => s.theme)

  useEffect(() => {
    let cancelled = false
    const tick = theme === 'dark' ? '#9ca3af' : '#6b7280'
    const grid = theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
    loadChart().then(({ Chart }) => {
      if (cancelled || !canvasRef.current) return
      chartRef.current?.destroy()
      chartRef.current = new Chart(canvasRef.current, build(tick, grid))
    })
    return () => {
      cancelled = true
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [build, theme])

  return <canvas ref={canvasRef} role="img" />
}

// 4.1 + 4.2 — trend line + (when more than one 부서 is in scope) the grouped bar chart.
export function AnalyticsCharts({ members, log }: { members: Member[]; log: LogEntry[] }) {
  const { t } = useTranslation()
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const trend = useMemo(() => trendSeries(log), [log])
  const groups = useMemo(() => groupSeries(members, log), [members, log])
  const showGroups = groups.groups.length > 1 && groups.dates.length > 0

  // Builders are memoized on their data so the chart only rebuilds when the underlying
  // series (or theme, handled inside ChartCanvas) actually changes.
  const trendBuild = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'line',
      data: {
        labels: trend.map((p) => shortDate(p.date)),
        datasets: [
          {
            label: t('admin.analytics.attendance'),
            data: trend.map((p) => p.count),
            borderColor: '#0071E3',
            backgroundColor: 'rgba(0,113,227,0.12)',
            tension: 0.25,
            fill: true,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Headroom so the label drawn above the topmost point isn't clipped.
        layout: { padding: { top: 16 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: tick }, grid: { color: grid } },
          y: { beginAtZero: true, ticks: { color: tick, precision: 0 }, grid: { color: grid } },
        },
      },
      // Inline plugin: draw each point's count just above its dot.
      plugins: [pointValueLabels(tick)],
    }),
    [trend, t],
  )

  const groupBuild = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: groups.dates.map((d) => shortDate(d)),
        datasets: groups.groups.map((g) => ({
          label: g,
          data: groups.counts[g],
          backgroundColor: resolveGroupColor(cfg?.groupColors, g),
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: tick } } },
        scales: {
          x: { ticks: { color: tick }, grid: { color: grid } },
          y: { beginAtZero: true, ticks: { color: tick, precision: 0 }, grid: { color: grid } },
        },
      },
    }),
    [cfg?.groupColors, groups],
  )

  if (trend.length === 0)
    return (
      <div className="fx-fade mb-5 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-surface-2 py-16 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-fill text-muted">
          <Activity size={26} strokeWidth={1.75} aria-hidden />
        </span>
        <p className="text-sm font-semibold text-text">{t('admin.sheet.empty')}</p>
      </div>
    )

  return (
    <div className={'fx-rise mb-5 grid gap-5 ' + (showGroups ? 'md:grid-cols-2' : 'grid-cols-1')}>
      <Panel title={t('admin.analytics.trend')} icon={<Activity size={16} strokeWidth={2} aria-hidden />}>
        <ChartCanvas build={trendBuild} />
      </Panel>
      {showGroups && (
        <Panel title={t('admin.analytics.groupCompare')} icon={<BarChart3 size={16} strokeWidth={2} aria-hidden />}>
          <ChartCanvas build={groupBuild} />
        </Panel>
      )}
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="surface-panel p-5">
      <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <h3 className="font-display text-base font-bold tracking-tight text-text">{title}</h3>
      </div>
      <div className="relative h-56">{children}</div>
    </div>
  )
}
