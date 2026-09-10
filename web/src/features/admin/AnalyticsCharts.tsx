import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Chart as ChartType, ChartConfiguration, Plugin } from 'chart.js'
import { useTheme } from '../../stores/useTheme'
import { shortDate, shortMonth } from './sheet'
import {
  trendSeries,
  groupSeries,
  newFamilyRegistrations,
  newFamilyTrend,
  RECENT_WEEKS,
  type Granularity,
  type SchoolRow,
} from './analytics'
import { SCHOOL_NAMES } from './eduDongsanTraits'
import { type Member, type LogEntry } from '../../lib/api'
import { resolveGroupColor } from './groupColors'
import { Activity, BarChart3, GraduationCap, Sprout, UserPlus } from '../../components/ui/Icon'
import { Pill } from './GroupFilter'
import { type EduFilter } from './newFamily'
import { useAppConfig } from '../../lib/useAppConfig'

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

// 막대 위에 값을 적는 짝. 선 그래프의 pointValueLabels가 첫 데이터셋만 도는 것과 달리
// **모든 데이터셋**을 도는데, 학교별 막대는 한 자리에 셋이 나란히 서므로 한 줄만 적으면
// 나머지 둘은 눈금으로 어림해 읽게 된다 — 옆에 같은 수의 표가 서 있는 자리라 그림 안의
// 숫자가 표와 바로 맞물려야 한다. 숨긴(범례에서 끈) 데이터셋은 건너뛴다.
function barValueLabels(tick: string): Plugin {
  return {
    id: 'barValueLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart
      ctx.save()
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif'
      ctx.fillStyle = tick
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      chart.data.datasets.forEach((ds, i) => {
        if (!chart.isDatasetVisible(i)) return
        chart.getDatasetMeta(i).data.forEach((bar, j) => {
          const value = ds.data[j]
          if (value == null) return
          ctx.fillText(String(value), bar.x, bar.y - 4)
        })
      })
      ctx.restore()
    },
  }
}

// 칸의 열쇠를 축에 적을 글자로. 주별은 그 주일("8/30"), 월별은 그 달("26.8")이다.
const axisLabel = (key: string, gran: Granularity): string => (gran === 'month' ? shortMonth(key) : shortDate(key))

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
export function ChartCanvas({ build }: { build: (tick: string, grid: string) => ChartConfiguration }) {
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
// `gran`은 탭 맨 위의 주별/월별 토글이 정한다 — 아래 새가족 그래프도 같은 값을 받는다.
export function AnalyticsCharts({ members, log, gran }: { members: Member[]; log: LogEntry[]; gran: Granularity }) {
  const { t } = useTranslation()
  const { data: cfg } = useAppConfig()
  const trend = useMemo(() => trendSeries(log, gran), [log, gran])
  const groups = useMemo(() => groupSeries(members, log, gran), [members, log, gran])
  const showGroups = groups.groups.length > 1 && groups.dates.length > 0

  // Builders are memoized on their data so the chart only rebuilds when the underlying
  // series (or theme, handled inside ChartCanvas) actually changes.
  const trendBuild = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'line',
      data: {
        labels: trend.map((p) => axisLabel(p.date, gran)),
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
    [trend, t, gran],
  )

  const groupBuild = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: groups.dates.map((d) => axisLabel(d, gran)),
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
    [cfg?.groupColors, groups, gran],
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

// 새가족 차트의 색. 전체 출석 추이의 파랑(#0071E3)과 갈라 보이도록 초록 하나로 두 그래프를
// 묶는다 — 등록과 출석은 다른 사실이지만 둘 다 "새가족의 것"이라는 표시다. 기존 차트처럼
// 테마별로 나누지 않는 중간 명도라 밝은 바탕과 어두운 바탕 양쪽에서 읽힌다.
const NEW_FAMILY_COLOR = '#2E9E63'
const NEW_FAMILY_TINT = 'rgba(46,158,99,0.14)'

// 등록 막대를 몇 칸까지 그리는가. 주별 16주는 한 학기(15~16주)가 통째로 한 화면에 들어오는
// 수이고, 월별 12달은 한 해를 넘겨 본다 — 둘 다 막대 스무 개를 넘지 않아 x축이 겹치지 않는다.
const REG_BUCKETS: Record<Granularity, number> = { week: 16, month: 12 }

// 새가족만 따로 본 두 그래프 — 주별 등록(막대)과 주일별 새가족 출석(선). 둘 다 값이 점/막대
// 위에 적히므로 그래프에서 바로 숫자를 읽을 수 있다.
export function NewFamilyCharts({
  members,
  log,
  showEdu,
  today,
  gran,
}: {
  members: Member[]
  log: LogEntry[]
  showEdu: boolean
  today: string
  gran: Granularity
}) {
  const { t } = useTranslation()
  // 새가족 출석 추이를 새가족 교육 단계로 갈라 본다. 장년부에는 그 교육이 없으므로 칩도 없고
  // 언제나 '전체'다.
  const [edu, setEdu] = useState<EduFilter>('all')
  const cohort = showEdu ? edu : 'all'
  // 최근 칸만 그린다 — 그 앞은 아래 월별 표가 달 단위로 그대로 들고 있다. `today`를 넘겨
  // 축을 지금 칸까지 이어 두므로, 마지막 몇 칸이 비어 있으면 그것이 곧 "요즘 등록이 없다"다.
  const regs = useMemo(
    () => newFamilyRegistrations(members, today, gran).slice(-REG_BUCKETS[gran]),
    [members, today, gran],
  )
  const trend = useMemo(() => newFamilyTrend(members, log, cohort, gran), [members, log, cohort, gran])
  const cohortLabel = cohort === 'all' ? t('admin.analytics.nfAttendance') : t(`admin.newfamily.eduFilter.${cohort}`)

  const regBuild = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels: regs.map((p) => axisLabel(p.bucket, gran)),
        datasets: [
          {
            label: t('admin.analytics.nfRegistered'),
            data: regs.map((p) => p.count),
            backgroundColor: NEW_FAMILY_COLOR,
            borderRadius: 4,
            maxBarThickness: 32,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: tick }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: tick, precision: 0 }, grid: { color: grid } },
        },
      },
      plugins: [pointValueLabels(tick)],
    }),
    [regs, t, gran],
  )

  const trendBuild = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'line',
      data: {
        labels: trend.map((p) => axisLabel(p.date, gran)),
        datasets: [
          {
            label: cohortLabel,
            data: trend.map((p) => p.count),
            borderColor: NEW_FAMILY_COLOR,
            backgroundColor: NEW_FAMILY_TINT,
            tension: 0.25,
            fill: true,
            pointRadius: 3,
          },
          // 한 단계만 골랐을 때 그 뒤에 새가족 전체를 흐린 점선으로 깔아 준다 — 미수강 3명은
          // 새가족이 4명일 때와 40명일 때가 다른 사실이라, 고른 선만으로는 읽을 수 없다.
          ...(cohort === 'all'
            ? []
            : [
                {
                  label: t('admin.analytics.nfAllNewFamily'),
                  data: trend.map((p) => p.newFamily),
                  borderColor: tick,
                  borderDash: [4, 4],
                  borderWidth: 1.5,
                  tension: 0.25,
                  fill: false,
                  pointRadius: 0,
                },
              ]),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: {
          // 선이 둘일 때만 범례를 켠다 — 하나뿐이면 제목이 이미 그 이름이다.
          legend: { display: cohort !== 'all', labels: { color: tick, boxHeight: 1 } },
          // 점 위에 적히는 것은 인원수뿐이라, 그날 전체 출석 대비 비중은 눌렀을 때 나온다 —
          // 20명 중 5명과 200명 중 5명은 같은 5가 아니다.
          tooltip: {
            callbacks: {
              label: (item: { dataIndex: number; datasetIndex: number }) => {
                const p = trend[item.dataIndex]
                if (!p) return ''
                if (item.datasetIndex === 1) return `${t('admin.analytics.nfAllNewFamily')} ${p.newFamily}`
                const share = p.total === 0 ? 0 : Math.round((p.count / p.total) * 100)
                return `${cohortLabel} ${p.count} / ${p.total} (${share}%)`
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: tick }, grid: { color: grid } },
          y: { beginAtZero: true, ticks: { color: tick, precision: 0 }, grid: { color: grid } },
        },
      },
      plugins: [pointValueLabels(tick)],
    }),
    [trend, t, cohort, cohortLabel, gran],
  )

  if (regs.length === 0 && trend.length === 0) return null
  const both = regs.length > 0 && trend.length > 0

  return (
    <div className={'grid gap-5 ' + (both ? 'md:grid-cols-2' : 'grid-cols-1')}>
      {regs.length > 0 && (
        <Panel title={t('admin.analytics.nfRegTrend')} icon={<UserPlus size={16} strokeWidth={2} aria-hidden />}>
          <ChartCanvas build={regBuild} />
        </Panel>
      )}
      {trend.length > 0 && (
        <Panel
          title={t('admin.analytics.nfAttendTrend')}
          icon={<Sprout size={16} strokeWidth={2} aria-hidden />}
          toolbar={showEdu ? <EduPills value={edu} onChange={setEdu} /> : undefined}
        >
          <ChartCanvas build={trendBuild} />
        </Panel>
      )}
    </div>
  )
}

// ── 학교별 비교 ─────────────────────────────────────────────────────────────
// 학교별 요약 표와 **같은 수를 같은 자리에서** 그린다 — 표가 `schoolSummary`를 부르고 그
// 결과(`rows`)를 그대로 넘겨받으므로, 화면 위아래 두 그림이 갈릴 수가 없다 (각자 세면
// 필터가 바뀌는 순간 어느 쪽이 맞는지 알 수 없게 된다).
//
// **쌓지 않고 나란히 세운다**: 세 수가 한 덩어리의 조각이 아니기 때문이다 — 새가족은 인원
// 안의 일부이고 최근 출석은 그 주일들에 온 사람이라, 쌓으면 셋을 더한 높이가 무언가를
// 뜻하는 것처럼 읽힌다 (더해도 아무것도 아니다).
const SCHOOL_SERIES_COLOR = {
  // 인원은 나머지 둘이 딛고 선 바탕이라 이 탭에 없던 세 번째 색(앰버)을 뒀고, 최근 출석과
  // 새가족은 **이미 이 탭에서 뜻이 정해진 색을 그대로** 쓴다 — 출석 추이의 파랑, 새가족
  // 그래프의 초록. 같은 사실이 화면 위아래에서 같은 색이라야 눈이 따라간다.
  // 셋 다 밝은 바탕(#ffffff)·어두운 바탕(#1c1c1e) 양쪽에서 3:1을 넘고 색각 이상에서도
  // 서로 갈린다.
  members: '#D97706',
  recent: '#0071E3',
  newFamily: NEW_FAMILY_COLOR,
}

export function SchoolChart({ rows }: { rows: SchoolRow[] }) {
  const { t } = useTranslation()
  const build = useCallback(
    (tick: string, grid: string): ChartConfiguration => ({
      type: 'bar',
      data: {
        // 가로축의 학교와 그 순서는 `rows`가 들고 온 것 그대로다 (schoolSummary → schoolsOf) —
        // 멤버 탭의 학교 칩, 옆의 표, 이 그래프가 모두 같은 순서라 셋을 오가며 볼 수 있다.
        labels: rows.map((r) => (r.school === 'none' ? t('admin.members.school.none') : SCHOOL_NAMES[r.school])),
        datasets: [
          {
            label: t('admin.analytics.schoolMembers'),
            data: rows.map((r) => r.members),
            backgroundColor: SCHOOL_SERIES_COLOR.members,
            borderRadius: 4,
            maxBarThickness: 28,
          },
          {
            label: t('admin.analytics.nfRecent', { n: RECENT_WEEKS }),
            data: rows.map((r) => r.recent),
            backgroundColor: SCHOOL_SERIES_COLOR.recent,
            borderRadius: 4,
            maxBarThickness: 28,
          },
          {
            label: t('admin.analytics.schoolNewFamily'),
            data: rows.map((r) => r.newFamily),
            backgroundColor: SCHOOL_SERIES_COLOR.newFamily,
            borderRadius: 4,
            maxBarThickness: 28,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        // 줄이 셋이라 범례는 언제나 켠다 — 색만으로는 어느 막대가 무엇인지 말해 주지 못한다.
        plugins: { legend: { labels: { color: tick, boxHeight: 10 } } },
        scales: {
          x: { ticks: { color: tick }, grid: { display: false } },
          // `grace`가 세로축을 제일 큰 값보다 한 뼘 높게 잡아 준다. 이 그래프에만 있는 이유는
          // 범례가 그림 위에 앉기 때문 — 그러지 않으면 제일 높은 막대가 그림 꼭대기에 닿고
          // 그 위에 적히는 숫자가 범례 글자와 겹친다 (layout.padding은 범례째로 밀어내므로
          // 이 사이를 벌려 주지 못한다).
          y: { beginAtZero: true, grace: '12%', ticks: { color: tick, precision: 0 }, grid: { color: grid } },
        },
      },
      plugins: [barValueLabels(tick)],
    }),
    [rows, t],
  )

  return (
    <Panel title={t('admin.analytics.schoolCompare')} icon={<GraduationCap size={16} strokeWidth={2} aria-hidden />}>
      <ChartCanvas build={build} />
    </Panel>
  )
}

// 주별/월별 토글. 탭 맨 위에 한 번만 놓여 네 그래프를 함께 옮긴다 — 그래프마다 따로 두면
// 위아래를 견주는 순간 서로 다른 축을 보게 된다. 칩이 아니라 segmented control인 이유는
// 고르는 값이 둘뿐이고 언제나 하나가 켜져 있기 때문이다 (끄는 상태가 없다).
const GRANULARITIES: Granularity[] = ['week', 'month']

export function GranularityToggle({ value, onChange }: { value: Granularity; onChange: (g: Granularity) => void }) {
  const { t } = useTranslation()
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-subtle">{t('admin.analytics.granularity')}</span>
      <div className="segmented" role="group" aria-label={t('admin.analytics.granularity')}>
        {GRANULARITIES.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={value === g}
            onClick={() => onChange(g)}
            className={
              'min-h-9 rounded-full px-4 py-1.5 text-xs font-semibold transition-[background-color,color,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
              (value === g ? 'bg-surface text-primary shadow-[var(--shadow-sm)]' : 'text-muted hover:text-text')
            }
          >
            {t(`admin.analytics.by_${g}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

// 새가족 교육 단계 칩. 갈래와 문구는 새가족 교육 탭의 것을 그대로 쓴다 — 같은 네 갈래를
// 두 화면이 다르게 부르면 "1주차만"이 어디서는 다른 뜻인가 싶어진다.
const EDU_COHORTS: EduFilter[] = ['both', 'week1', 'week2', 'none']

function EduPills({ value, onChange }: { value: EduFilter; onChange: (v: EduFilter) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1.5">
      <Pill active={value === 'all'} onClick={() => onChange('all')}>
        {t('admin.filter.all')}
      </Pill>
      {EDU_COHORTS.map((key) => (
        <Pill key={key} active={value === key} onClick={() => onChange(key)}>
          {t(`admin.newfamily.eduFilter.${key}`)}
        </Pill>
      ))}
    </div>
  )
}

// `toolbar`는 제목 줄과 그래프 상자 **사이**에 놓인다 — 제목 오른쪽에 붙이면 칩 다섯 개가
// 좁은 화면에서 제목을 밀어낸다.
export function Panel({
  title,
  icon,
  toolbar,
  children,
}: {
  title: string
  icon: ReactNode
  toolbar?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="surface-panel p-5">
      <div className={'flex items-center gap-2 border-b border-border pb-3 ' + (toolbar ? 'mb-3' : 'mb-4')}>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <h3 className="font-display text-base font-bold tracking-tight text-text">{title}</h3>
      </div>
      {toolbar && <div className="mb-3">{toolbar}</div>}
      <div className="relative h-56">{children}</div>
    </div>
  )
}
