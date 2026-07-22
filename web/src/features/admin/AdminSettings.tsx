import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getConfig, getCardScanUsage, updateSettings, type SettingsPatch } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Switch } from '../../components/ui/Switch'
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

// Super-admin settings: semester dates and app-wide mode toggles.
// (동산 names + 동산지기/부동산지기 live in their own 동산 tab now.)
export function AdminSettings() {
  const { t } = useTranslation()
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
  const [busyToggle, setBusyToggle] = useState<keyof SettingsPatch | null>(null)
  const [colorEdits, setColorEdits] = useState<Record<string, string> | undefined>(undefined)
  const [colorsSaving, setColorsSaving] = useState(false)
  const [semesterEdits, setSemesterEdits] = useState<SemesterDates | undefined>(undefined)
  const [semesterSaving, setSemesterSaving] = useState(false)

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
          <fieldset key={season} className="rounded-xl border border-border bg-surface-alt/40 p-4">
            {/* legend renders as an in-card header (float trick) instead of the
                browser's border-interrupting legend style; fieldset keeps semantics. */}
            <legend className="float-left mb-2.5 w-full p-0 text-sm font-semibold text-text">
              {t(`admin.settings.semester.${season}`)}
            </legend>
            <div className="clear-both grid grid-cols-2 gap-2">
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

      <h2 className="mb-3 font-display text-lg font-semibold text-text">{t('admin.settings.modes')}</h2>
      <div className="flex flex-col divide-y divide-border">
        <ToggleRow
          label={t('admin.settings.summerMode')}
          desc={t('admin.settings.summerModeDesc')}
          checked={!!cfg?.summerMode}
          disabled={!cfg || busyToggle === 'summerMode'}
          onChange={(v) => flip('summerMode', v)}
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
