import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getConfig, getCardScanUsage, updateCheckinWindow, updateSettings, type SettingsPatch } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { useLang } from '../../stores/useLang'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Switch } from '../../components/ui/Switch'
import { minutesToHHMM, hhmmToMinutes } from './time'
import { DEFAULT_GROUP_COLORS, isValidHex } from './groupColors'
import { easternNow } from '../../lib/checkinWindow'
import {
  DEFAULT_SEMESTER_DATES,
  SEMESTER_SEASONS,
  dateForYear,
  isValidSemesterDates,
  monthDayFromDate,
  type SemesterDates,
  type SemesterSeason,
} from '../../lib/semester'

const GROUPS = ['대학부', '청년부'] as const

const DAY_LABELS: Record<'ko' | 'en', string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

const timeInput =
  'w-full min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-text outline-none ' +
  'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30'

// Super-admin settings: the adjustable check-in window, announcement, and app-wide mode
// toggles. (동산 names + 동산지기/부동산지기 live in their own 동산 tab now.)
export function AdminSettings() {
  const { t } = useTranslation()
  const lang = useLang((s) => s.lang)
  const toast = useToast()
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const { data: scanUsage, isFetching: scanUsageRefreshing } = useQuery({
    queryKey: ['cardScanUsage'],
    queryFn: getCardScanUsage,
    staleTime: 0,
    refetchInterval: 2_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  const [edits, setEdits] = useState<{ days?: number[]; start?: string; end?: string }>({})
  const [saving, setSaving] = useState(false)
  const [ann, setAnn] = useState<string | undefined>(undefined)
  const [annSaving, setAnnSaving] = useState(false)
  const [busyToggle, setBusyToggle] = useState<keyof SettingsPatch | null>(null)
  const [colorEdits, setColorEdits] = useState<Record<string, string> | undefined>(undefined)
  const [colorsSaving, setColorsSaving] = useState(false)
  const [semesterEdits, setSemesterEdits] = useState<SemesterDates | undefined>(undefined)
  const [semesterSaving, setSemesterSaving] = useState(false)

  const days = edits.days ?? cfg?.checkinDays ?? [0]
  const start = edits.start ?? (cfg ? minutesToHHMM(cfg.checkinStartMin) : '13:00')
  const end = edits.end ?? (cfg ? minutesToHHMM(cfg.checkinEndMin) : '15:00')
  const announcement = ann ?? cfg?.announcement ?? ''
  const colors = colorEdits ?? cfg?.groupColors ?? DEFAULT_GROUP_COLORS
  const colorsDirty = colorEdits !== undefined
  const colorsValid = GROUPS.every((g) => isValidHex(colors[g] ?? ''))
  const currentYear = Number(easternNow().date.slice(0, 4))
  const semesterDates = semesterEdits ?? cfg?.semesterDates ?? DEFAULT_SEMESTER_DATES
  const semesterDatesValid = isValidSemesterDates(semesterDates)
  const usageRemaining = scanUsage?.remaining ?? 0
  const remainingPercent = scanUsage
    ? scanUsage.limit > 0
      ? Math.min(100, Math.round((scanUsage.remaining / scanUsage.limit) * 100))
      : 0
    : 0

  function toggleDay(d: number) {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b)
    setEdits((e) => ({ ...e, days: next }))
  }

  async function save() {
    setSaving(true)
    try {
      await updateCheckinWindow(days, hhmmToMinutes(start), hhmmToMinutes(end))
      await qc.invalidateQueries({ queryKey: ['config'] })
      setEdits({})
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  async function saveAnnouncement() {
    setAnnSaving(true)
    try {
      await updateSettings({ announcement })
      await qc.invalidateQueries({ queryKey: ['config'] })
      setAnn(undefined)
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setAnnSaving(false)
    }
  }

  function setColor(group: string, hex: string) {
    setColorEdits({ ...colors, [group]: hex })
  }

  async function saveColors() {
    if (!colorsValid) return
    setColorsSaving(true)
    try {
      await updateSettings({ groupColors: colors })
      await qc.invalidateQueries({ queryKey: ['config'] })
      setColorEdits(undefined)
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setColorsSaving(false)
    }
  }

  function setSemesterDate(season: SemesterSeason, field: 'start' | 'end', date: string) {
    setSemesterEdits({
      ...semesterDates,
      [season]: { ...semesterDates[season], [field]: date ? monthDayFromDate(date) : '' },
    })
  }

  async function saveSemesterDates() {
    if (!semesterDatesValid) return
    setSemesterSaving(true)
    try {
      await updateSettings({ semesterDates })
      await qc.invalidateQueries({ queryKey: ['config'] })
      setSemesterEdits(undefined)
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSemesterSaving(false)
    }
  }

  async function flip(field: keyof SettingsPatch, value: boolean) {
    setBusyToggle(field)
    try {
      await updateSettings({ [field]: value })
      await qc.invalidateQueries({ queryKey: ['config'] })
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusyToggle(null)
    }
  }

  return (
    <div className="w-full">
      <h2 className="font-display text-lg font-semibold text-text">{t('admin.settings.semesterDates')}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">
        {t('admin.settings.semesterDatesDesc', { year: currentYear })}
      </p>
      <div className="mb-3 grid gap-3 lg:grid-cols-3">
        {SEMESTER_SEASONS.map((season) => (
          <fieldset key={season} className="rounded-lg border border-border bg-surface-alt/40 p-3">
            <legend className="px-1 text-sm font-semibold text-text">
              {t(`admin.settings.semester.${season}`)}
            </legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-subtle">
                  {t('admin.settings.semesterStart')}
                </span>
                <Input
                  type="date"
                  min={`${currentYear}-01-01`}
                  max={`${currentYear}-12-31`}
                  value={dateForYear(currentYear, semesterDates[season].start)}
                  onChange={(e) => setSemesterDate(season, 'start', e.target.value)}
                />
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-subtle">
                  {t('admin.settings.semesterEnd')}
                </span>
                <Input
                  type="date"
                  min={`${currentYear}-01-01`}
                  max={`${currentYear}-12-31`}
                  value={dateForYear(currentYear, semesterDates[season].end)}
                  onChange={(e) => setSemesterDate(season, 'end', e.target.value)}
                />
              </label>
            </div>
          </fieldset>
        ))}
      </div>
      {!semesterDatesValid && (
        <p className="mb-3 text-xs font-semibold text-danger">{t('admin.settings.semesterDatesInvalid')}</p>
      )}
      <Button
        onClick={saveSemesterDates}
        disabled={semesterSaving || semesterEdits === undefined || !semesterDatesValid}
      >
        {semesterSaving ? t('common.loading') : t('admin.settings.save')}
      </Button>

      <hr className="my-8 border-border" />

      <h2 className="font-display text-lg font-semibold text-text">{t('admin.settings.checkinWindow')}</h2>
      <p className="mb-5 mt-1 text-sm text-muted">{t('admin.settings.checkinWindowDesc')}</p>

      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-subtle">
        {t('admin.settings.days')}
      </span>
      <div className="mb-5 flex gap-1.5">
        {DAY_LABELS[lang].map((label, d) => (
          <button
            key={d}
            type="button"
            onClick={() => toggleDay(d)}
            aria-pressed={days.includes(d)}
            aria-label={label}
            className={
              'h-10 w-10 rounded-full text-sm font-semibold transition-colors ' +
              (days.includes(d)
                ? 'bg-primary text-primary-fg'
                : 'border border-border bg-surface text-muted hover:bg-surface-alt')
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-6 flex items-end gap-3">
        <label className="flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-subtle">
            {t('admin.settings.start')}
          </span>
          <input
            type="time"
            value={start}
            onChange={(e) => setEdits((cur) => ({ ...cur, start: e.target.value }))}
            className={timeInput}
          />
        </label>
        <label className="flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-subtle">
            {t('admin.settings.end')}
          </span>
          <input
            type="time"
            value={end}
            onChange={(e) => setEdits((cur) => ({ ...cur, end: e.target.value }))}
            className={timeInput}
          />
        </label>
      </div>

      <Button onClick={save} disabled={saving || days.length === 0}>
        {saving ? t('common.loading') : t('admin.settings.save')}
      </Button>

      <hr className="my-8 border-border" />

      <h2 className="font-display text-lg font-semibold text-text">{t('admin.settings.announcement')}</h2>
      <p className="mb-3 mt-1 text-sm text-muted">{t('admin.settings.announcementDesc')}</p>
      <textarea
        value={announcement}
        onChange={(e) => setAnn(e.target.value)}
        rows={2}
        placeholder={t('admin.settings.announcementPlaceholder')}
        className="mb-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
      />
      <Button onClick={saveAnnouncement} disabled={annSaving || announcement === (cfg?.announcement ?? '')}>
        {annSaving ? t('common.loading') : t('admin.settings.save')}
      </Button>

      <hr className="my-8 border-border" />

      <h2 className="mb-3 font-display text-lg font-semibold text-text">{t('admin.settings.modes')}</h2>
      <div className="flex flex-col divide-y divide-border">
        <ToggleRow
          label={t('admin.settings.summerMode')}
          desc={t('admin.settings.summerModeDesc')}
          checked={!!cfg?.summerMode}
          disabled={!cfg || busyToggle === 'summerMode'}
          onChange={(v) => flip('summerMode', v)}
        />
        <ToggleRow
          label={t('admin.settings.individualCheckin')}
          desc={t('admin.settings.individualCheckinDesc')}
          checked={!!cfg?.individualCheckinEnabled}
          disabled={!cfg || busyToggle === 'individualCheckinEnabled'}
          onChange={(v) => flip('individualCheckinEnabled', v)}
        />
        <ToggleRow
          label={t('admin.settings.demoMode')}
          desc={t('admin.settings.demoModeDesc')}
          checked={!!cfg?.demoMode}
          disabled={!cfg || busyToggle === 'demoMode'}
          onChange={(v) => flip('demoMode', v)}
        />
      </div>

      <hr className="my-8 border-border" />

      <h2 className="font-display text-lg font-semibold text-text">{t('admin.settings.groupColors')}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">{t('admin.settings.groupColorsDesc')}</p>
      <div className="mb-3 flex flex-col gap-3">
        {GROUPS.map((g) => (
          <ColorField key={g} label={g} value={colors[g] ?? DEFAULT_GROUP_COLORS[g]} onChange={(hex) => setColor(g, hex)} />
        ))}
      </div>
      {!colorsValid && <p className="mb-3 text-xs font-semibold text-danger">{t('admin.settings.groupColorInvalid')}</p>}
      <Button onClick={saveColors} disabled={colorsSaving || !colorsDirty || !colorsValid}>
        {colorsSaving ? t('common.loading') : t('admin.settings.save')}
      </Button>

      <hr className="my-8 border-border" />

      <h2 className="font-display text-lg font-semibold text-text">{t('admin.settings.cardScanLimit')}</h2>
      <p className="mb-3 mt-1 text-sm text-muted">{t('admin.settings.cardScanLimitDesc')}</p>
      <div className="mb-4 rounded-lg border border-border bg-surface-alt/50 p-3" aria-live="polite">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-text">
            <span
              className={'h-2 w-2 rounded-full ' + (scanUsageRefreshing ? 'bg-warning' : 'bg-success')}
              aria-hidden
            />
            {t('admin.settings.cardScanLive')}
          </span>
          {scanUsage && (
            <span className="font-mono text-xs tabular-nums text-subtle">
              {t('admin.settings.cardScanUsageDetail', {
                available: usageRemaining,
              })}
            </span>
          )}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={scanUsage?.limit ?? 0} aria-valuenow={usageRemaining}>
          <div
            className={'h-full rounded-full transition-[width] duration-300 ' + (remainingPercent <= 10 ? 'bg-danger' : 'bg-primary')}
            style={{ width: `${remainingPercent}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const valid = isValidHex(value)
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-sm font-semibold text-text">{label}</span>
      <input
        type="color"
        aria-label={label}
        // The native color input requires a well-formed #rrggbb; fall back while the
        // text field is mid-edit (e.g. "#E0A8") so this never throws.
        value={valid ? value : '#000000'}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} hex`}
        placeholder="#E0A800"
        className={'max-w-[10rem] font-mono ' + (valid ? '' : 'border-danger focus-visible:border-danger')}
      />
    </div>
  )
}

function ToggleRow({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  disabled: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-semibold text-text">{label}</div>
        <div className="text-xs text-muted">{desc}</div>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  )
}
