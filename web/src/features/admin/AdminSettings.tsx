import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getConfig, updateCheckinWindow, updateSettings, type SettingsPatch } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { useLang } from '../../stores/useLang'
import { Button } from '../../components/ui/Button'
import { Switch } from '../../components/ui/Switch'
import { minutesToHHMM, hhmmToMinutes } from './time'

const DAY_LABELS: Record<'ko' | 'en', string[]> = {
  ko: ['일', '월', '화', '수', '목', '금', '토'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
}

const timeInput =
  'w-full min-h-11 rounded-md border border-border bg-surface px-3 text-sm text-text outline-none ' +
  'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30'

// The adjustable check-in window (day(s) + start/end). Super-admin only — matches the
// legacy Settings tab. Form values are DERIVED from the loaded config with an edits
// overlay, so there's no setState-in-effect and no flash of defaults.
export function AdminSettings() {
  const { t } = useTranslation()
  const lang = useLang((s) => s.lang)
  const toast = useToast()
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const [edits, setEdits] = useState<{ days?: number[]; start?: string; end?: string }>({})
  const [saving, setSaving] = useState(false)
  const [ann, setAnn] = useState<string | undefined>(undefined)
  const [annSaving, setAnnSaving] = useState(false)
  const [busyToggle, setBusyToggle] = useState<keyof SettingsPatch | null>(null)

  const days = edits.days ?? cfg?.checkinDays ?? [0]
  const start = edits.start ?? (cfg ? minutesToHHMM(cfg.checkinStartMin) : '13:00')
  const end = edits.end ?? (cfg ? minutesToHHMM(cfg.checkinEndMin) : '15:00')
  const announcement = ann ?? cfg?.announcement ?? ''

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
    <div className="max-w-md">
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
