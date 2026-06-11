import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getConfig,
  getDongsanNames,
  getDongsanLeaders,
  setDongsanLeader,
  type DongsanLeaderEntry,
} from '../../lib/api'
import { useRoster } from './useRoster'
import { useToast } from '../../components/ui/Toast'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import {
  leaderEntry,
  summerDongsanList,
  membersInDongsan,
  withLeader,
  toggleSubLeader,
  isOfficer,
  type DongsanRole,
} from './dongsan'

const SUMMER_KEY = '합동'

// The 👑 동산지기 / ⭐ 부동산지기 display badge, shown next to a member's name on the
// Members grid and the Today list. Renders nothing for ordinary members.
export function DongsanBadge({ role }: { role: DongsanRole }) {
  const { t } = useTranslation()
  if (!role) return null
  const isLeader = role === '동산지기'
  return (
    <span
      className={
        'ml-1.5 inline-flex items-center gap-0.5 rounded px-1 py-px align-middle text-[10px] font-semibold ' +
        (isLeader ? 'bg-warning/15 text-warning' : 'bg-primary/15 text-primary')
      }
    >
      {isLeader ? '👑' : '⭐'} {t(`admin.dongsanRole.${isLeader ? 'leader' : 'subleader'}`)}
    </span>
  )
}

// The 🎖️ 임원 display badge, shown next to a member's name on the Members grid and the
// Today list. Renders nothing for non-officers.
export function OfficerBadge({ name }: { name: string }) {
  const { t } = useTranslation()
  if (!isOfficer(name)) return null
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-success/15 px-1 py-px align-middle text-[10px] font-semibold text-success">
      🎖️ {t('admin.dongsanRole.officer')}
    </span>
  )
}

// Settings-tab editor: assign the 동산지기 + 부동산지기 for each 동산 (super-admin only).
// In summer mode the 동산 list collapses to a single combined ("합동") set spanning both
// KM departments, matching the legacy renderDongsanLeadersEditor() behaviour.
export function DongsanLeadersEditor() {
  const { t } = useTranslation()
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const { data: names } = useQuery({ queryKey: ['dongsanNames'], queryFn: getDongsanNames })
  const { data: leaders } = useQuery({ queryKey: ['dongsanLeaders'], queryFn: getDongsanLeaders })
  const { data: roster } = useRoster(true)
  // Local edits keyed by `${group}__${subgroup}`, overlaid on the loaded map.
  const [edits, setEdits] = useState<Record<string, DongsanLeaderEntry>>({})

  const summer = !!cfg?.summerMode

  const blocks = useMemo(() => {
    if (!names || !roster) return []
    if (summer) {
      return summerDongsanList(names).map((subgroup) => ({
        group: SUMMER_KEY,
        subgroup,
        members: membersInDongsan(roster.members, null, subgroup),
      }))
    }
    return Object.keys(names).flatMap((group) =>
      (names[group] ?? []).map((subgroup) => ({
        group,
        subgroup,
        members: membersInDongsan(roster.members, group, subgroup),
      })),
    )
  }, [names, roster, summer])

  if (!names || !leaders || !roster) return <p className="text-sm text-muted">{t('common.loading')}</p>

  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-text">{t('admin.settings.dongsanLeaders')}</h2>
      <p className="mb-4 mt-1 text-sm text-muted">{t('admin.settings.dongsanLeadersDesc')}</p>

      {summer && (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
          {t('admin.settings.summerCombined')}
        </p>
      )}

      <div className="flex flex-col gap-5">
        {blocks.map(({ group, subgroup, members }) => {
          const key = `${group}__${subgroup}`
          const entry = edits[key] ?? leaderEntry(leaders, group, subgroup)
          return (
            <LeaderBlock
              key={key}
              header={group === SUMMER_KEY ? subgroup : `${group} · ${subgroup}`}
              members={members}
              entry={entry}
              dirty={key in edits}
              onLeader={(name) => setEdits((e) => ({ ...e, [key]: withLeader(entry, name) }))}
              onToggleSub={(name) => setEdits((e) => ({ ...e, [key]: toggleSubLeader(entry, name) }))}
              onSaved={() =>
                setEdits((e) => {
                  const next = { ...e }
                  delete next[key]
                  return next
                })
              }
              group={group}
              subgroup={subgroup}
            />
          )
        })}
      </div>
    </div>
  )
}

function LeaderBlock({
  header,
  members,
  entry,
  dirty,
  group,
  subgroup,
  onLeader,
  onToggleSub,
  onSaved,
}: {
  header: string
  members: string[]
  entry: DongsanLeaderEntry
  dirty: boolean
  group: string
  subgroup: string
  onLeader: (name: string) => void
  onToggleSub: (name: string) => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await setDongsanLeader(group, subgroup, entry.leader, entry.subLeaders)
      await qc.invalidateQueries({ queryKey: ['dongsanLeaders'] })
      onSaved()
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-b border-border pb-4 last:border-0">
      <div className="mb-2.5 text-sm font-semibold text-primary">{header}</div>

      {members.length === 0 ? (
        <p className="text-xs text-muted">{t('admin.settings.noDongsanMembers')}</p>
      ) : (
        <>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.settings.leader')}</span>
            <Select value={entry.leader} onChange={(e) => onLeader(e.target.value)}>
              <option value="">{t('admin.settings.noLeader')}</option>
              {members.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>

          <span className="mb-1.5 block text-xs font-semibold text-subtle">{t('admin.settings.subLeaders')}</span>
          <div className="mb-3 flex max-h-28 flex-col gap-1 overflow-y-auto rounded-md border border-border bg-surface p-2">
            {members.map((n) => (
              <label key={n} className="flex cursor-pointer items-center gap-2 text-sm text-text">
                <input
                  type="checkbox"
                  checked={entry.subLeaders.includes(n)}
                  onChange={() => onToggleSub(n)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {n}
              </label>
            ))}
          </div>

          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? t('common.loading') : t('admin.settings.save')}
          </Button>
        </>
      )}
    </div>
  )
}
