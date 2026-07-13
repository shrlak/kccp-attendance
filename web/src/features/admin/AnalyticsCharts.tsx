import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Chart as ChartType, ChartConfiguration, Plugin } from 'chart.js'
import { useTheme } from '../../stores/useTheme'
import { shortDate } from './sheet'
import { trendSeries, groupSeries } from './analytics'
import type { Member, LogEntry } from '../../lib/api'

// Per-부서 bar colors (대학부 yellow, 청년부 blue, then a small palette).
const GROUP_COLORS: Record<string, string> = {
  대학부: '#9A682C',
  청년부: '#315F78',
  EM: '#2F704F',
  'Adult Ministry': '#75567D',
}
const FALLBACK = ['#A33E34', '#4A7182', '#9A682C', '#637A52', '#835E70']
const colorFor = (group: string, i: number) => GROUP_COLORS[group] ?? FALLBACK[i % FALLBACK.length]

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
            borderColor: '#245441',
            backgroundColor: 'rgba(36,84,65,0.12)',
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
        datasets: groups.groups.map((g, i) => ({
          label: g,
          data: groups.counts[g],
          backgroundColor: colorFor(g, i),
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
    [groups],
  )

  if (trend.length === 0) return <p className="text-sm text-muted">{t('admin.sheet.empty')}</p>

  return (
    <div className={'mb-5 grid gap-5 ' + (showGroups ? 'md:grid-cols-2' : 'grid-cols-1')}>
      <Panel title={t('admin.analytics.trend')}>
        <ChartCanvas build={trendBuild} />
      </Panel>
      {showGroups && (
        <Panel title={t('admin.analytics.groupCompare')}>
          <ChartCanvas build={groupBuild} />
        </Panel>
      )}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="surface-panel p-5">
      <h3 className="section-kicker mb-4 border-b border-border pb-3">{title}</h3>
      <div className="relative h-56">{children}</div>
    </div>
  )
}
