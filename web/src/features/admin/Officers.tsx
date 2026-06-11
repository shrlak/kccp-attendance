import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getOfficers, setOfficers } from '../../lib/api'
import { useRoster } from './useRoster'
import { useToast } from '../../components/ui/Toast'
import { Button } from '../../components/ui/Button'
import { isOfficer } from './dongsan'

// The 임원 name list from config. If the endpoint isn't reachable the list stays
// undefined and every badge renders nothing — same graceful degradation as
// useDongsanRole, so the Members/Today tabs never break on it.
export function useOfficers() {
  const { data } = useQuery({
    queryKey: ['officers'],
    queryFn: getOfficers,
    retry: false,
    staleTime: 5 * 60_000,
  })
  return data
}

// The 🎖️ 임원 display badge, shown next to a member's name on the Members grid and the
// Today list. Renders nothing for non-officers.
export function OfficerBadge({ name }: { name: string }) {
  const { t } = useTranslation()
  const officers = useOfficers()
  if (!isOfficer(name, officers)) return null
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-success/15 px-1 py-px align-middle text-[10px] font-semibold text-success">
      🎖️ {t('admin.dongsanRole.officer')}
    </span>
  )
}

// 동산-tab editor: tick the members who carry the 임원 badge (super-admin only).
export function OfficersEditor() {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: officers } = useQuery({ queryKey: ['officers'], queryFn: getOfficers })
  const { data: roster } = useRoster(true)
  const [edit, setEdit] = useState<string[] | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  const names = useMemo(() => {
    if (!roster) return []
    return Array.from(new Set(roster.members.map((m) => m.name))).sort((a, b) => a.localeCompare(b))
  }, [roster])

  if (!officers || !roster) return <p className="text-sm text-muted">{t('common.loading')}</p>

  const list = edit ?? officers
  const dirty = edit !== undefined

  function toggle(name: string) {
    setEdit(list.includes(name) ? list.filter((n) => n !== name) : [...list, name])
  }

  async function save() {
    setSaving(true)
    try {
      await setOfficers(list)
      await qc.invalidateQueries({ queryKey: ['officers'] })
      setEdit(undefined)
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-text">{t('admin.settings.officers')}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">{t('admin.settings.officersDesc')}</p>

      <div className="mb-3 grid max-h-72 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border bg-surface p-2 sm:grid-cols-3">
        {names.map((n) => (
          <label key={n} className="flex cursor-pointer items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={list.includes(n)}
              onChange={() => toggle(n)}
              className="h-3.5 w-3.5 accent-primary"
            />
            {n}
          </label>
        ))}
      </div>

      <Button size="sm" onClick={save} disabled={saving || !dirty}>
        {saving ? t('common.loading') : t('admin.settings.save')}
      </Button>
    </div>
  )
}
