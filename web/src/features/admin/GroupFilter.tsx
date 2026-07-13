import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { Member } from '../../lib/api'
import { groupsOf, subgroupsOf, type Filter } from './filters'

// Shared 부서 → 동산 pill filter for the Today/Sheet tabs. Renders nothing when the
// scoped roster has only one group and one 동산 (e.g. a 동산 leader — already pinned).
export function GroupFilter({ members, value, onChange }: { members: Member[]; value: Filter; onChange: (f: Filter) => void }) {
  const { t } = useTranslation()
  const groups = groupsOf(members)
  const subgroups = subgroupsOf(members, value.group)
  if (groups.length <= 1 && subgroups.length <= 1) return null

  return (
    <div className="mb-5 flex flex-col gap-2 border-b border-border pb-4">
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <Pill active={!value.group} onClick={() => onChange({ group: '', subgroup: '' })}>
            {t('admin.filter.all')}
          </Pill>
          {groups.map((g) => (
            <Pill key={g} active={value.group === g} onClick={() => onChange({ group: g, subgroup: '' })}>
              {g}
            </Pill>
          ))}
        </div>
      )}
      {subgroups.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-l-2 border-primary/30 pl-3">
          <Pill active={!value.subgroup} onClick={() => onChange({ ...value, subgroup: '' })}>
            {t('admin.filter.all')}
          </Pill>
          {subgroups.map((s) => (
            <Pill key={s} active={value.subgroup === s} onClick={() => onChange({ ...value, subgroup: s })}>
              {s}
            </Pill>
          ))}
        </div>
      )}
    </div>
  )
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'min-h-8 rounded-sm px-3 py-1 text-xs font-semibold transition-colors ' +
        (active ? 'border border-primary bg-primary text-primary-fg' : 'border border-border bg-surface text-muted hover:border-primary/30 hover:bg-surface-alt')
      }
    >
      {children}
    </button>
  )
}
