import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { Member } from '../../lib/api'
import { groupsOf, schoolsOf, subgroupsOf, type Filter, type SchoolFilter } from './filters'
import { GraduationCap } from '../../components/ui/Icon'
import { SCHOOL_NAMES } from './eduDongsanTraits'

// Shared 부서 → 동산 → 학교 pill filter for the Today/Sheet tabs. Renders nothing when the
// scoped roster has only one group, one 동산 and no school to tell apart (e.g. a 동산
// leader — already pinned).
export function GroupFilter({ members, value, onChange }: { members: Member[]; value: Filter; onChange: (f: Filter) => void }) {
  const { t } = useTranslation()
  const groups = groupsOf(members)
  const subgroups = subgroupsOf(members, value.group)
  // 학교 칩은 **고를 것이 있을 때만** 뜬다: CMU나 Pitt이 실제로 있고 묶음이 둘 이상일 때.
  // 한 학교뿐이면 좁힐 것이 없고, 장년부처럼 아무도 학교를 적지 않는 부에서는 아예 없다.
  const schools = schoolsOf(members)
  const showSchools = schools.length > 1 && schools.some((s) => s !== 'none')
  if (groups.length <= 1 && subgroups.length <= 1 && !showSchools) return null

  return (
    <div className="mb-5 flex flex-col gap-2.5">
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <Pill active={!value.group} onClick={() => onChange({ ...value, group: '', subgroup: '' })}>
            {t('admin.filter.all')}
          </Pill>
          {groups.map((g) => (
            <Pill key={g} active={value.group === g} onClick={() => onChange({ ...value, group: g, subgroup: '' })}>
              {g}
            </Pill>
          ))}
        </div>
      )}
      {subgroups.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 h-4 w-1 shrink-0 rounded-full bg-primary/40" aria-hidden />
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
      {/* 학교 — 부서·동산과 **곱해진다** (대학부 × CMU). 부서가 아니라 사람의 칸에서 읽는
          값이라(`school_or_work`) 줄머리의 표도 모자로 둔다: 위의 두 줄과 다른 종류의 가름이다. */}
      {showSchools && (
        <div className="flex flex-wrap items-center gap-1.5">
          <GraduationCap className="mr-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
          <Pill active={!value.school} onClick={() => onChange({ ...value, school: '' })}>
            {t('admin.filter.all')}
          </Pill>
          {schools.map((s) => (
            <Pill key={s} active={value.school === s} onClick={() => onChange({ ...value, school: s })}>
              {schoolLabel(s, t)}
            </Pill>
          ))}
        </div>
      )}
    </div>
  )
}

// CMU·Pitt은 두 언어가 같은 말로 부르므로 번역 파일에 두지 않는다 — 갈리는 것은 '학교 미기재'
// 한 칸뿐이다.
function schoolLabel(s: SchoolFilter, t: (k: string) => string): string {
  return s === 'none' || s === '' ? t('admin.filter.noSchool') : SCHOOL_NAMES[s]
}

export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'min-h-9 rounded-full px-3.5 py-1 text-xs font-semibold ' +
        'transition-[background-color,border-color,color,transform,box-shadow] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-[0.94] ' +
        (active
          ? 'bg-primary text-primary-fg shadow-[var(--shadow-sm)]'
          : 'bg-fill text-muted hover:bg-fill-hover hover:text-text')
      }
    >
      {children}
    </button>
  )
}
