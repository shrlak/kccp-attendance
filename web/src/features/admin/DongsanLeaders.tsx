import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getDongsanNames,
  getDongsanLeaders,
  setDongsanLeader,
  type DongsanLeaderEntry,
} from '../../lib/api'
import { useRoster } from './useRoster'
import { useToast } from '../../components/ui/Toast'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { Medal, Shield, AlertTriangle, Save } from '../../components/ui/Icon'
import { leaderEntry, summerDongsanList, membersInDongsan, leaderOptions, withLeader, setSubLeaderAt } from './dongsan'
import { useAppConfig, usePartition, usePartitionT } from '../../lib/useAppConfig'
import { groupsOfPartition, summerAppliesTo } from '../../lib/partition'

const SUMMER_KEY = '합동'

// Settings-tab editor: assign the 동산지기 + 부동산지기 for each 동산 (super-admin only).
// In summer mode the 동산 list collapses to a single combined ("합동") set spanning both
// KM departments, matching the legacy renderDongsanLeadersEditor() behaviour.
export function DongsanLeadersEditor() {
  const t = usePartitionT()
  const { data: cfg } = useAppConfig()
  const { data: names } = useQuery({ queryKey: ['dongsanNames'], queryFn: getDongsanNames })
  const { data: leaders } = useQuery({ queryKey: ['dongsanLeaders'], queryFn: getDongsanLeaders })
  const { data: roster } = useRoster(true)
  // Local edits keyed by `${group}__${subgroup}`, overlaid on the loaded map.
  const [edits, setEdits] = useState<Record<string, DongsanLeaderEntry>>({})

  const partition = usePartition()
  const ownGroups = useMemo(() => groupsOfPartition(partition), [partition])
  const summer = !!cfg?.summerMode && summerAppliesTo(partition)

  // 부서마다 자기 줄을 갖는다 — 대학부 동산과 청년부 동산이 한 줄에 섞이지 않도록
  // 섹션으로 나눠 렌더한다. 여름 모드에서는 합동 한 덩어리가 유일한 섹션이다.
  const sections = useMemo(() => {
    if (!names || !roster) return []
    if (summer) {
      return [{
        group: SUMMER_KEY,
        blocks: summerDongsanList(names).map((subgroup) => ({
          group: SUMMER_KEY,
          subgroup,
          members: membersInDongsan(roster.members, null, subgroup),
        })),
      }]
    }
    return ownGroups.concat(Object.keys(names).filter((g) => !ownGroups.includes(g)))
      .map((group) => ({
        group,
        blocks: (names[group] ?? []).map((subgroup) => ({
          group,
          subgroup,
          members: membersInDongsan(roster.members, group, subgroup),
        })),
      }))
      .filter((section) => section.blocks.length > 0)
  }, [names, roster, summer, ownGroups])

  if (!names || !leaders || !roster) return <p className="text-sm text-muted">{t('common.loading')}</p>

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">
          <Medal size={18} strokeWidth={2} aria-hidden />
        </span>
        <h2 className="font-display text-xl font-bold tracking-tight text-text">{t('admin.settings.dongsanLeaders')}</h2>
      </div>
      <p className="mb-4 mt-2 text-sm text-muted">{t('admin.settings.dongsanLeadersDesc')}</p>

      {summer && (
        <p className="mb-4 flex w-fit items-center gap-1.5 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
          <AlertTriangle size={14} strokeWidth={2} aria-hidden />
          {t('admin.settings.summerCombined')}
        </p>
      )}

      {sections.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted">
          {t('admin.settings.dongsanEmptyAfterTerm')}
        </p>
      )}

      {/* One row per 부서: each section's cards auto-fit across their own grid, so 대학부
          and 청년부 동산 never share a row. 여름 모드는 합동 한 섹션뿐이다. */}
      <div className="flex flex-col gap-7">
        {sections.map((section) => (
          <div key={section.group}>
            {section.group !== SUMMER_KEY && <span className="section-kicker mb-2 block">{section.group}</span>}
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
              {section.blocks.map(({ group, subgroup, members }) => {
                const key = `${group}__${subgroup}`
                const entry = edits[key] ?? leaderEntry(leaders, group, subgroup)
                return (
                  <LeaderBlock
                    key={key}
                    header={group === SUMMER_KEY ? subgroup : subgroup}
                    members={members}
                    entry={entry}
                    dirty={key in edits}
                    onLeader={(name) => setEdits((e) => ({ ...e, [key]: withLeader(entry, name) }))}
                    onSub={(idx, name) => setEdits((e) => ({ ...e, [key]: setSubLeaderAt(entry, idx, name) }))}
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
        ))}
      </div>
    </div>
  )
}

// Two 부동산지기 dropdown slots per 동산 (extra slots appear only for legacy data that
// already stored more than two).
const SUB_LEADER_SLOTS = 2

function LeaderBlock({
  header,
  members,
  entry,
  dirty,
  group,
  subgroup,
  onLeader,
  onSub,
  onSaved,
}: {
  header: string
  members: string[]
  entry: DongsanLeaderEntry
  dirty: boolean
  group: string
  subgroup: string
  onLeader: (name: string) => void
  onSub: (idx: number, name: string) => void
  onSaved: () => void
}) {
  const t = usePartitionT()
  const toast = useToast()
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  // 그 동산의 사람들 + 이미 지기로 적혀 있는 바깥 사람 (leaderOptions 주석 참고).
  const options = useMemo(() => leaderOptions(members, entry), [members, entry])

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
    <div className="min-w-0 rounded-2xl border border-border bg-surface-2 p-3.5 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-bold tracking-tight text-text">
        <Medal size={15} strokeWidth={2} className="shrink-0 text-gold" aria-hidden />
        <span className="truncate">{header}</span>
      </div>

      {options.length === 0 ? (
        <p className="text-xs text-muted">{t('admin.settings.noDongsanMembers')}</p>
      ) : (
        <>
          <label className="mb-3 block">
            <span className="field-label flex items-center gap-1">
              <Medal size={12} strokeWidth={2} className="text-gold" aria-hidden />
              {t('admin.settings.leader')}
            </span>
            <Select value={entry.leader} onChange={(e) => onLeader(e.target.value)}>
              <option value="">{t('admin.settings.noLeader')}</option>
              {options.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>

          <span className="field-label flex items-center gap-1">
            <Shield size={12} strokeWidth={2} className="text-muted" aria-hidden />
            {t('admin.settings.subLeaders')}
          </span>
          <div className="mb-3 flex flex-col gap-2">
            {Array.from({ length: Math.max(SUB_LEADER_SLOTS, entry.subLeaders.length) }, (_, i) => (
              <Select
                key={i}
                value={entry.subLeaders[i] ?? ''}
                aria-label={`${t('admin.settings.subLeaders')} ${i + 1}`}
                onChange={(e) => onSub(i, e.target.value)}
              >
                <option value="">{t('admin.settings.noLeader')}</option>
                {options.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            ))}
          </div>

          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {!saving && <Save size={14} strokeWidth={2} aria-hidden />}
            {saving ? t('common.loading') : t('admin.settings.save')}
          </Button>
        </>
      )}
    </div>
  )
}
