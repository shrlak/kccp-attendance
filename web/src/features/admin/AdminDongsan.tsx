import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getConfig, getDongsanNames, updateDongsanNames, type DongsanNames } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Sprout, Trash2, Plus, AlertTriangle, Save } from '../../components/ui/Icon'
import { renameAt, addDongsan, removeAt, cleanNames, summerDongsanList } from './dongsan'
import { DongsanLeadersEditor } from './DongsanLeaders'

const KM_GROUPS = ['대학부', '청년부']

// 동산 admin tab (super-admin only): edit 동산 names + 동산지기/부동산지기. In summer mode the
// names editor collapses to ONE combined set of 동산 (no 대학부/청년부 split) which is written
// to both KM departments, matching how summer mode merges them everywhere else. (The separate
// 새가족 교육 동산 names live on the 새가족 교육 tab, next to the education tracking they configure.)
export function AdminDongsan() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const { data: loaded } = useQuery({ queryKey: ['dongsanNames'], queryFn: getDongsanNames })
  const summer = !!cfg?.summerMode

  if (!loaded) return <p className="text-sm text-muted">{t('common.loading')}</p>

  return (
    <div className="w-full">
      {/* Side by side on wide screens so neither list has to scroll the whole page to
          reach the other. 동산이름 only holds a name input per row, so it gets the narrow
          column; 동산지기/부동산지기 takes the rest so its cards can sit in one row
          (see DongsanLeadersEditor). */}
      <div className="grid grid-cols-1 gap-8 divide-y divide-border lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] lg:divide-y-0 lg:divide-x">
        <div>
          <DongsanNamesEditor
            loaded={loaded}
            summer={summer}
            title={t('admin.settings.dongsanNames')}
            desc={t('admin.settings.dongsanNamesDesc')}
            onSave={async (next) => {
              await updateDongsanNames(next)
              await qc.invalidateQueries({ queryKey: ['dongsanNames'] })
            }}
          />
        </div>
        <div className="pt-8 lg:pl-8 lg:pt-0">
          <DongsanLeadersEditor />
        </div>
      </div>
    </div>
  )
}

// A 동산-names list editor (add/rename/remove per 부서, or one combined list in summer
// mode) — shared by the regular 동산 tab (its own title/desc heading) and the 새가족 교육
// tab's separate 새가족 교육 동산 names (title/desc omitted there — it's embedded in a
// Dialog that already supplies its own title).
export function DongsanNamesEditor({
  loaded,
  summer,
  title,
  desc,
  onSave,
}: {
  loaded: DongsanNames
  summer: boolean
  title?: string
  desc?: string
  onSave: (next: DongsanNames) => Promise<void>
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const [edits, setEdits] = useState<DongsanNames | undefined>(undefined) // per-group (semester)
  const [combined, setCombined] = useState<string[] | undefined>(undefined) // single list (summer)
  const [saving, setSaving] = useState(false)

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
      await onSave(next)
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
    <div>
      {title && (
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-success/12 text-success">
            <Sprout size={18} strokeWidth={2} aria-hidden />
          </span>
          <h2 className="font-display text-xl font-bold tracking-tight text-text">{title}</h2>
        </div>
      )}
      {desc && <p className={`text-sm text-muted ${title ? 'mb-4 mt-2' : 'mb-4'}`}>{desc}</p>}

      {summer && (
        <p className="mb-4 flex w-fit items-center gap-1.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
          <AlertTriangle size={14} strokeWidth={2} aria-hidden />
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
                className="min-w-0 flex-1"
                onChange={(e) =>
                  setCombined(combinedList.map((n, i) => (i === idx ? e.target.value : n)))
                }
              />
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 !min-h-11 !w-11 !px-0 text-danger hover:bg-danger/10"
                onClick={() => setCombined(combinedList.filter((_, i) => i !== idx))}
                aria-label={`${t('admin.settings.removeDongsan')} ${name}`}
              >
                <Trash2 size={16} strokeWidth={2} aria-hidden />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setCombined([...combinedList, ''])}>
            <Plus size={15} strokeWidth={2.25} aria-hidden />
            {t('admin.settings.addDongsan')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group}>
              <span className="section-kicker mb-2 block">{group}</span>
              <div className="flex flex-col gap-2">
                {(names[group] ?? []).map((name, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={name}
                      placeholder={t('admin.settings.dongsanPlaceholder')}
                      aria-label={`${group} ${idx + 1}`}
                      className="min-w-0 flex-1"
                      onChange={(e) => setEdits(renameAt(names, group, idx, e.target.value))}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 !min-h-11 !w-11 !px-0 text-danger hover:bg-danger/10"
                      onClick={() => setEdits(removeAt(names, group, idx))}
                      aria-label={`${t('admin.settings.removeDongsan')} ${name}`}
                    >
                      <Trash2 size={16} strokeWidth={2} aria-hidden />
                    </Button>
                  </div>
                ))}
                <Button variant="ghost" size="sm" className="self-start" onClick={() => setEdits(addDongsan(names, group))}>
                  <Plus size={15} strokeWidth={2.25} aria-hidden />
                  {t('admin.settings.addDongsan')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button className="mt-6" onClick={save} disabled={saving || !dirty}>
        {!saving && <Save size={15} strokeWidth={2} aria-hidden />}
        {saving ? t('common.loading') : t('admin.settings.save')}
      </Button>
    </div>
  )
}
