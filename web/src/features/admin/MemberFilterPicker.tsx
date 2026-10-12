import type { Member } from '../../lib/api'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { Check } from '../../components/ui/Icon'
import { usePartitionT } from '../../lib/useAppConfig'
import { groupChipsOf, subgroupSectionsOf, countSubgroups, careersOf, schoolsOf, NO_GROUP } from './filters'
import { SCHOOL_NAMES } from './eduDongsanTraits'
import { sortChipsOf, sortValueLabel } from './memberSort'
import { ROSTER_DIMS, CARD_ONLY_DIMS, INFO_DIMS, DEFAULT_FILTER_DIMS, toggleDim, isCardDim, type FilterDim } from './memberFilters'

// 멤버 탭의 '필터' 단추가 여는 창 — **칩 줄에 내걸 필터를 고른다.** 한 줄마다 그 필터가 무엇으로
// 가르는지(보기)를 미리 적어 준다: 이름만으로는 '소속'이 대학생/대학원생인지 학교인지 알 수 없고,
// 켜 보기 전에 무엇이 나올지 알아야 고를 수 있다.
//
// 누르는 순간 칩 줄이 바뀐다 (창 뒤에서 바로 보인다) — '완료'는 닫기만 한다. 끈 필터로 좁혀
// 두었던 것은 부르는 쪽이 푼다 (AdminMembers `chooseFilters`).
//
// 정렬로 고른 칸은 여기서 켜지 않아도 칩 줄에 선다 (AdminMembers `shown`) — 그 줄에는 '정렬'
// 딱지를 붙여, 켜지 않은 필터가 왜 위에 서 있는지를 여기서 읽을 수 있게 한다.
export function MemberFilterPicker({
  members,
  available,
  value,
  sortDim,
  onChange,
  onClose,
}: {
  members: Member[] // 보기를 미리 적을 명단 (숨긴 멤버 포함 — 칩 줄이 고를 수 있는 전체)
  available: FilterDim[] // 이 명단에서 고를 것이 있는 필터 (availableFilterDims)
  value: FilterDim[]
  sortDim?: FilterDim | '' // 지금 정렬로 고른 칸 — 켜지 않았어도 칩 줄에 서 있다
  onChange: (dims: FilterDim[]) => void
  onClose: () => void
}) {
  const t = usePartitionT()

  const label = (d: FilterDim): string => {
    if (d === 'group') return t('admin.members.group')
    if (d === 'subgroup') return t('admin.members.subgroup')
    if (d === 'career') return t('admin.members.careerFilter')
    if (d === 'school') return t('admin.members.schoolFilter')
    return t(`admin.members.sort.keys.${d}`)
  }
  // 그 필터가 내걸 보기 — 칩 줄에 실제로 서는 것과 같은 함수에서 뽑는다.
  const preview = (d: FilterDim): string => {
    if (d === 'group') return groupChipsOf(members).map((g) => (g === NO_GROUP ? t('admin.members.noGroup') : g)).join(' · ')
    if (d === 'subgroup') {
      const n = countSubgroups(subgroupSectionsOf(members, ''))
      return t('admin.members.filters.subgroupCount', { n })
    }
    if (d === 'career') {
      const careers = careersOf(members.filter((m) => m.group_name === '청년부'))
      return `${careers.map((c) => t(`admin.members.career.${c}`)).join(' · ')} — ${t('admin.members.filters.careerNote')}`
    }
    if (d === 'school') return schoolsOf(members).map((s) => (s === 'none' ? t('admin.members.school.none') : SCHOOL_NAMES[s])).join(' · ')
    if (isCardDim(d)) return sortChipsOf(members, d).map((v) => sortValueLabel(t, d, v)).join(' · ')
    return ''
  }

  const sections: { key: string; title: string; dims: FilterDim[] }[] = [
    { key: 'roster', title: t('admin.members.filters.sectionRoster'), dims: ROSTER_DIMS.filter((d) => available.includes(d)) },
    { key: 'card', title: t('admin.members.filters.sectionCard'), dims: CARD_ONLY_DIMS.filter((d) => available.includes(d)) },
    { key: 'info', title: t('admin.members.filters.sectionInfo'), dims: INFO_DIMS.filter((d) => available.includes(d)) },
  ].filter((s) => s.dims.length > 0)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.members.filters.title')}>
      <p className="mb-4 text-xs text-muted">{t('admin.members.filters.hint')}</p>
      {sections.length === 0 && <p className="py-6 text-center text-sm text-muted">{t('admin.members.filters.none')}</p>}
      <div className="flex flex-col gap-5">
        {sections.map((section) => (
          <div key={section.key}>
            <div className="section-kicker mb-2">{section.title}</div>
            <ul className="flex flex-col gap-1.5">
              {section.dims.map((d) => {
                const on = value.includes(d)
                return (
                  <li key={d}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => onChange(toggleDim(value, d))}
                      className={
                        'flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ' +
                        (on ? 'border-primary/40 bg-primary/[0.06]' : 'border-border bg-surface hover:bg-fill')
                      }
                    >
                      <span
                        className={
                          'grid size-5 shrink-0 place-items-center rounded-full ' +
                          (on ? 'bg-primary text-primary-fg' : 'border border-border')
                        }
                        aria-hidden
                      >
                        {on && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-text">
                          {label(d)}
                          {d === sortDim && !on && (
                            <span className="rounded-full bg-fill px-2 py-0.5 text-[10px] font-semibold text-muted">
                              {t('admin.members.filters.bySort')}
                            </span>
                          )}
                        </span>
                        {/* 보기는 길면 잘리고 원문은 title에 — 장년부 세례여부처럼 자유 기입이 섞이면 줄이 길다. */}
                        <span className="block truncate text-xs text-muted" title={preview(d)}>
                          {preview(d)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" onClick={() => onChange([...DEFAULT_FILTER_DIMS])} className="flex-1">
          {t('admin.members.filters.reset')}
        </Button>
        <Button onClick={onClose} className="flex-1">
          {t('admin.members.filters.done')}
        </Button>
      </div>
    </Dialog>
  )
}
