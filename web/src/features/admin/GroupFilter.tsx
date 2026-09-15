import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { Member } from '../../lib/api'
import { groupsOf, subgroupSectionsOf, countSubgroups, NO_SUBGROUP, type Filter, type SubgroupSection } from './filters'
import { Sprout, Users } from '../../components/ui/Icon'

// 필터 줄이 앉는 자리 — **패널 헤더 바로 밑에 붙어 스크롤을 따라온다** (엑셀의 행 고정과
// 같은 뜻이다). 명단·출석부는 한 화면에 안 들어가는 표라, 아래로 내려가 있는 동안 지금
// 어느 부서·어느 동산을 보고 있는지가 화면에서 사라지고 바꾸려면 매번 맨 위로 되돌아가야
// 했다. 카드와 표가 이 줄 뒤로 지나가므로 배경은 불투명해야 하고(bg-canvas), 좌우 여백만큼
// 늘려서(-mx/px) 내용이 가장자리로 비어져 나오지 않게 한다.
//
// 높이는 화면의 40%까지만 쓴다: 동산이 스물이 넘는 부에서는 이 줄이 화면을 통째로 덮을 수
// 있는데, 고정은 명단을 보면서 고르라고 두는 것이라 명단이 안 보이면 뜻이 없다. 넘치면 이
// 줄 안에서 스크롤된다.
export function StickyFilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-[var(--admin-header-h,4.5rem)] z-10 -mx-[var(--gutter)] mb-5 flex max-h-[40vh] flex-col gap-2 overflow-y-auto border-b border-separator bg-canvas px-[var(--gutter)] pb-3 pt-2">
      {children}
    </div>
  )
}

// Shared 부서 → 동산 pill filter for the Today/Sheet/새가족 tabs. Renders nothing when the
// scoped roster has only one group and one 동산 (e.g. a 동산 leader — already pinned).
export function GroupFilter({ members, value, onChange }: { members: Member[]; value: Filter; onChange: (f: Filter) => void }) {
  const { t } = useTranslation()
  const groups = groupsOf(members)
  const sections = subgroupSectionsOf(members, value.group)
  if (groups.length <= 1 && countSubgroups(sections) <= 1) return null

  return (
    <StickyFilterBar>
      {groups.length > 1 && (
        <div role="group" aria-label={t('admin.members.group')} className="flex flex-wrap items-center gap-1.5">
          <Users className="mr-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
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
      <SubgroupChips
        sections={sections}
        value={value.subgroup}
        onChange={(subgroup) => onChange({ ...value, subgroup })}
      />
    </StickyFilterBar>
  )
}

// **동산 줄을 그리는 자리는 하나다** — 오늘·출석부·새가족 탭(GroupFilter)과 멤버 탭이 같은
// 컴포넌트를 쓴다. 두 자리가 같은 목록을 다르게 그리면 '호연동산'이 탭마다 다른 묶음처럼
// 읽힌다 (AttendanceGrid·TraitFilter와 같은 규칙).
//
// **부서마다 한 줄이다**: 청년부 동산은 청년부 줄에, 대학부 동산은 대학부 줄에 (묶음은
// filters.ts subgroupSectionsOf가 정한다 — 두 부서가 같은 이름을 나눠 가진 여름 합동이면
// 이름표 없는 한 줄로 돌아온다). '전체'와 '동산 미지정'은 어느 부서의 것도 아니라 맨 윗줄에
// 함께 선다.
export function SubgroupChips({
  sections,
  value,
  onChange,
  // 동산이 비어 있는 사람의 칩('동산 미지정')을 내걸까 — 멤버 탭만 쓴다. 출석부·오늘의
  // Filter.subgroup은 이름으로만 좁히므로(filterMembers) 그 자리에 자리표를 넣을 수 없다.
  noneChip = false,
}: {
  sections: SubgroupSection[]
  value: string
  onChange: (subgroup: string) => void
  noneChip?: boolean
}) {
  const { t } = useTranslation()
  // 고를 것이 하나뿐이면 줄이 없다 — '전체'와 그 하나가 같은 사람들을 가리킨다 (칩 줄의
  // 규칙 그대로: 줄이 사라지는 것은 고를 것이 없다는 뜻이어야 한다).
  if (countSubgroups(sections) + (noneChip ? 1 : 0) <= 1) return null
  // 부서 이름표는 가를 것이 둘 이상일 때만 — 줄이 하나뿐이면 그 이름은 늘 같은 값이라
  // 아무것도 말해 주지 않는다 (부서가 하나뿐인 장년부가 그렇다).
  const labelled = sections.length > 1

  return (
    <div role="group" aria-label={t('admin.members.subgroup')} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Sprout className="mr-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
        <Pill active={!value} onClick={() => onChange('')}>
          {t('admin.filter.all')}
        </Pill>
        {noneChip && (
          <Pill active={value === NO_SUBGROUP} onClick={() => onChange(NO_SUBGROUP)}>
            {t('admin.members.noSubgroup')}
          </Pill>
        )}
      </div>
      {sections.map((section) => (
        <div key={section.group || 'none'} className="flex flex-wrap items-center gap-1.5">
          {labelled && (
            <span className="section-kicker mr-0.5 shrink-0">{section.group || '—'}</span>
          )}
          {section.subgroups.map((sg) => (
            <Pill key={sg} active={value === sg} onClick={() => onChange(sg)}>
              {sg}
            </Pill>
          ))}
        </div>
      ))}
    </div>
  )
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
