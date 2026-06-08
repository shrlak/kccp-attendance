import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getConfig, updateCheckinWindow } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { useLang } from '../../stores/useLang'
import { Button } from '../../components/ui/Button'
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

  const days = edits.days ?? cfg?.checkinDays ?? [0]
  const start = edits.start ?? (cfg ? minutesToHHMM(cfg.checkinStartMin) : '13:00')
  const end = edits.end ?? (cfg ? minutesToHHMM(cfg.checkinEndMin) : '15:00')

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
    </div>
  )
}
