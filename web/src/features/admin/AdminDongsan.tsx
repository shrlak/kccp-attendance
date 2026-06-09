import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getConfig, getDongsanNames, updateDongsanNames, type DongsanNames } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { renameAt, addDongsan, removeAt, cleanNames, summerDongsanList } from './dongsan'
import { DongsanLeadersEditor } from './DongsanLeaders'

const KM_GROUPS = ['대학부', '청년부']

// 동산 admin tab (super-admin only): edit 동산 names + 동산지기/부동산지기. In summer mode the
// names editor collapses to ONE combined set of 동산 (no 대학부/청년부 split) which is written
// to both KM departments, matching how summer mode merges them everywhere else.
export function AdminDongsan() {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const { data: loaded } = useQuery({ queryKey: ['dongsanNames'], queryFn: getDongsanNames })
  const summer = !!cfg?.summerMode

  const [edits, setEdits] = useState<DongsanNames | undefined>(undefined) // per-group (semester)
  const [combined, setCombined] = useState<string[] | undefined>(undefined) // single list (summer)
  const [saving, setSaving] = useState(false)

  if (!loaded) return <p className="text-sm text-muted">{t('common.loading')}</p>

  const names = edits ?? loaded
  const groups = Object.keys(names)
  const combinedList = combined ?? summerDongsanList(loaded)
  const dirty = summer ? combined !== undefined : edits !== undefined

  async function save() {
    setSaving(true)
    try {
      let next: DongsanNames
      if (summer) {
        const clean = combinedList.map((n) => n.trim()).filter((n) => n.length > 0)
        next = { ...loaded }
        for (const g of KM_GROUPS) next[g] = clean
      } else {
        next = cleanNames(names)
      }
      await updateDongsanNames(next)
      await qc.invalidateQueries({ queryKey: ['dongsanNames'] })
      setEdits(undefined)
      setCombined(undefined)
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full">
      <h2 className="font-display text-lg font-semibold text-text">{t('admin.settings.dongsanNames')}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">{t('admin.settings.dongsanNamesDesc')}</p>

      {summer && (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
          {t('admin.settings.summerCombined')}
        </p>
      )}

      {summer ? (
        <div className="flex flex-col gap-2">
          {combinedList.map((name, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={name}
                placeholder={t('admin.settings.dongsanPlaceholder')}
                aria-label={`동산 ${idx + 1}`}
                onChange={(e) =>
                  setCombined(combinedList.map((n, i) => (i === idx ? e.target.value : n)))
                }
              />
              <Button
                variant="ghost"
                onClick={() => setCombined(combinedList.filter((_, i) => i !== idx))}
                aria-label={`${t('admin.settings.removeDongsan')} ${name}`}
              >
                {t('admin.settings.removeDongsan')}
              </Button>
            </div>
          ))}
          <Button variant="ghost" className="self-start" onClick={() => setCombined([...combinedList, ''])}>
            + {t('admin.settings.addDongsan')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group}>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-subtle">{group}</span>
              <div className="flex flex-col gap-2">
                {(names[group] ?? []).map((name, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={name}
                      placeholder={t('admin.settings.dongsanPlaceholder')}
                      aria-label={`${group} ${idx + 1}`}
                      onChange={(e) => setEdits(renameAt(names, group, idx, e.target.value))}
                    />
                    <Button
                      variant="ghost"
                      onClick={() => setEdits(removeAt(names, group, idx))}
                      aria-label={`${t('admin.settings.removeDongsan')} ${name}`}
                    >
                      {t('admin.settings.removeDongsan')}
                    </Button>
                  </div>
                ))}
                <Button variant="ghost" className="self-start" onClick={() => setEdits(addDongsan(names, group))}>
                  + {t('admin.settings.addDongsan')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button className="mt-5" onClick={save} disabled={saving || !dirty}>
        {saving ? t('common.loading') : t('admin.settings.save')}
      </Button>

      <hr className="my-8 border-border" />

      <DongsanLeadersEditor />
    </div>
  )
}
