import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { groupsOf, NO_FILTER, type Filter } from './filters'
import {
  visibleNewFamily,
  semesterBounds,
  semesterKey,
  matchesEduFilter,
  eduDongsansOf,
  filterByEduDongsan,
  newFamilyWeek,
  type EduFilter,
  type NewFamilyWeek,
} from './newFamily'
import { NewFamilyWeekChip } from './NewFamilyWeekChip'
import { summerDongsanList } from './dongsan'
import { Pill } from './GroupFilter'
import { DongsanNamesEditor } from './AdminDongsan'
import {
  getConfig,
  getNewMemberDongsanNames,
  updateNewMemberDongsanNames,
  updateMember,
  type Member,
  type DongsanNames,
} from '../../lib/api'
import { Dialog } from '../../components/ui/Dialog'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { Settings, GraduationCap, AlertTriangle, Check } from '../../components/ui/Icon'
import { EditModal, AttendanceModal } from './MemberDialogs'
import { refreshRoster } from '../../lib/live'

const EDU_FILTERS: { key: EduFilter; labelKey: string }[] = [
  { key: 'week1', labelKey: 'admin.newfamily.eduFilter.week1' },
  { key: 'week2', labelKey: 'admin.newfamily.eduFilter.week2' },
  { key: 'both', labelKey: 'admin.newfamily.eduFilter.both' },
  { key: 'none', labelKey: 'admin.newfamily.eduFilter.none' },
]

// 새가족 교육 tab: everything about tracking a current-semester 새가족's education —
// the 4-way completion filter (1주차/2주차/둘 다/안 들음), per-member 1·2주차 +
// 새가족 교육 동산 assignment, and the 새가족 교육 동산 name-list editor (a separate list
// from the regular 동산 tab's, configured here next to what it drives). Visible to every
// admin; pastor is read-only like every other member-editing surface.
export function AdminNewFamilyEdu() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const { data: eduDongsanNames } = useQuery({ queryKey: ['newMemberDongsanNames'], queryFn: getNewMemberDongsanNames })
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const [eduFilter, setEduFilter] = useState<EduFilter>('all')
  const [editing, setEditing] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)
  const [dongsanNamesOpen, setDongsanNamesOpen] = useState(false)

  if (isLoading) return (
    <div className="fx-fade grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => <div key={i} className="fx-skeleton h-28 rounded-2xl" />)}
    </div>
  )
  if (isError) return (
    <div className="fx-rise grid place-items-center py-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-danger/10 text-danger"><AlertTriangle className="size-6" aria-hidden /></div>
      <p className="mt-4 text-sm font-semibold text-danger">{t('common.error')}</p>
    </div>
  )
  if (!data) return null

  const today = easternNow().date
  const scopedMembers = filterByEduDongsan(data.members, filter)
  // 이번 학기 새가족 + 아직 교육이 끝나지 않아 이전 학기에서 넘어온 새가족 — 교육을 마쳐
  // 목록에서 내려가려면 여기서 체크할 수 있어야 하므로 새가족 탭과 같은 기준으로 뽑는다.
  const inScope = visibleNewFamily(scopedMembers, today, cfg?.semesterDates)
  const visible = eduFilter === 'all' ? inScope : inScope.filter((m) => matchesEduFilter(m, eduFilter))
  const currentKey = semesterKey(today, cfg?.semesterDates)
  // 이전 학기에서 넘어온 카드에는 등록 학기를 달아준다 (이번 학기면 null).
  const termLabel = (m: Member): string | null => {
    if (!m.registration_date || semesterKey(m.registration_date, cfg?.semesterDates) === currentKey) return null
    const { year, season } = semesterBounds(m.registration_date, cfg?.semesterDates)
    return `${year} ${t(`admin.newfamily.season.${season}`)}`
  }
  const readOnly = data.role === 'pastor'
  const summerMode = !!cfg?.summerMode

  return (
    <>
      {/* 새가족 교육 동산 이름 설정 — top-right, opens in a dialog instead of an inline
          section so the tab stays focused on the roster. */}
      <div className="mb-3 flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setDongsanNamesOpen(true)}>
          <Settings className="size-4" aria-hidden />
          {t('admin.settings.newMemberDongsanNames')}
        </Button>
      </div>

      {/* 부서 + 새가족 교육 동산 필터 (일반 동산이 아니라 새가족 교육 동산으로 거른다). */}
      <EduDongsanFilter members={data.members} value={filter} onChange={setFilter} />

      {/* 새가족 교육 이수 필터: 1주차만 / 2주차만 / 둘 다 / 아무것도 안 들음 */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Pill active={eduFilter === 'all'} onClick={() => setEduFilter('all')}>
          {t('admin.filter.all')}
        </Pill>
        {EDU_FILTERS.map(({ key, labelKey }) => (
          <Pill key={key} active={eduFilter === key} onClick={() => setEduFilter(key)}>
            {t(labelKey)}
          </Pill>
        ))}
      </div>

      <div className="mb-4 flex items-center gap-2 section-kicker">
        <GraduationCap className="size-4 text-subtle" aria-hidden />
        {t('admin.newfamilyEdu.title')} · {visible.length}
      </div>

      {visible.length === 0 ? (
        <div className="fx-rise grid place-items-center rounded-2xl border border-dashed border-border py-14 text-center">
          <div className="grid size-14 place-items-center rounded-full bg-fill text-subtle"><GraduationCap className="size-6" aria-hidden /></div>
          <p className="mt-4 text-sm font-semibold text-muted">
            {t(inScope.length === 0 ? 'admin.newfamily.empty' : 'admin.newfamily.noFilterMatch')}
          </p>
        </div>
      ) : (
        <ul className="fx-stagger grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {visible.map((m) => (
            <EduCard
              key={m.id}
              member={m}
              week={newFamilyWeek(m.registration_date, today)}
              term={termLabel(m)}
              readOnly={readOnly}
              summerMode={summerMode}
              dongsanNames={eduDongsanNames}
              onOpen={() => setEditing(m)}
            />
          ))}
        </ul>
      )}

      {dongsanNamesOpen && eduDongsanNames && (
        <Dialog open onOpenChange={(o) => !o && setDongsanNamesOpen(false)} title={t('admin.settings.newMemberDongsanNames')}>
          <DongsanNamesEditor
            loaded={eduDongsanNames}
            summer={summerMode}
            desc={t('admin.settings.newMemberDongsanNamesDesc')}
            onSave={async (next) => {
              await updateNewMemberDongsanNames(next)
              await qc.invalidateQueries({ queryKey: ['newMemberDongsanNames'] })
            }}
          />
        </Dialog>
      )}

      {editing && (
        <EditModal
          member={editing}
          onClose={() => setEditing(null)}
          onAttendance={() => {
            setAttendanceFor(editing)
            setEditing(null)
          }}
        />
      )}
      {attendanceFor && (
        <AttendanceModal
          member={attendanceFor}
          log={data.log}
          readOnly={readOnly}
          onClose={() => setAttendanceFor(null)}
        />
      )}
    </>
  )
}

// 부서 (전체/대학부/청년부) + 새가족 교육 동산 pill filter — mirrors GroupFilter's layout
// exactly, but the second row is scoped to member.new_member_dongsan instead of the
// regular subgroup, since that's what this tab is about filtering by.
function EduDongsanFilter({ members, value, onChange }: { members: Member[]; value: Filter; onChange: (f: Filter) => void }) {
  const { t } = useTranslation()
  const groups = groupsOf(members)
  const eduDongsans = eduDongsansOf(members, value.group)
  if (groups.length <= 1 && eduDongsans.length <= 1) return null

  return (
    <div className="mb-5 flex flex-col gap-2 border-b border-separator pb-4">
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
      {eduDongsans.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-l-2 border-primary/30 pl-3">
          <Pill active={!value.subgroup} onClick={() => onChange({ ...value, subgroup: '' })}>
            {t('admin.filter.all')}
          </Pill>
          {eduDongsans.map((d) => (
            <Pill key={d} active={value.subgroup === d} onClick={() => onChange({ ...value, subgroup: d })}>
              {d}
            </Pill>
          ))}
        </div>
      )}
    </div>
  )
}

function EduCard({
  member,
  week,
  term,
  readOnly,
  summerMode,
  dongsanNames,
  onOpen,
}: {
  member: Member
  week: NewFamilyWeek | null
  term: string | null // 이전 학기에서 넘어온 새가족의 등록 학기 (이번 학기면 null)
  readOnly: boolean
  summerMode: boolean
  dongsanNames: DongsanNames | undefined
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState<'newMemberEduWeek1' | 'newMemberEduWeek2' | 'newMemberDongsan' | null>(null)

  async function toggleEdu(field: 'newMemberEduWeek1' | 'newMemberEduWeek2', value: boolean) {
    setBusy(field)
    try {
      await updateMember(member.id, { [field]: value })
      await refreshRoster(qc)
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(null)
    }
  }

  async function setDongsan(value: string) {
    setBusy('newMemberDongsan')
    try {
      await updateMember(member.id, { newMemberDongsan: value })
      await refreshRoster(qc)
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(null)
    }
  }

  // Same 부서-scoped (or summer-combined) option list as the regular 동산 dropdown,
  // just against the separate 새가족 교육 동산 names.
  const dongsanOptions = summerMode
    ? summerDongsanList(dongsanNames ?? {})
    : [...(dongsanNames?.[member.group_name] ?? [])]
  const currentDongsan = member.new_member_dongsan ?? ''
  if (currentDongsan && !dongsanOptions.includes(currentDongsan)) dongsanOptions.push(currentDongsan)

  return (
    <li className="rounded-2xl border border-border bg-surface p-3.5 shadow-[var(--shadow-sm)] transition-shadow duration-200 hover:shadow-[var(--shadow)]">
      {/* Tap the body to open the member's full info/editor (feature parity with 새가족 tab) */}
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="text-sm font-semibold text-text">{member.name}</div>
        <div className="mt-0.5 text-xs text-muted">{[member.group_name, member.subgroup].filter(Boolean).join(' · ') || '—'}</div>
        {/* 이번 주일에 등록한 새가족인지, 그 전 주에 등록했는지 — 교육 진도와 함께 보이도록. */}
        {(week === 'thisWeek' || week === 'lastWeek') && (
          <div className="mt-1.5"><NewFamilyWeekChip week={week} /></div>
        )}
        {/* 이전 학기에 등록했는데 교육이 남아 넘어온 새가족 — 어느 학기 사람인지 표시. */}
        {term && (
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-fill px-2 py-0.5 text-[10px] font-semibold text-muted">
            <GraduationCap className="size-3" aria-hidden />
            {term}
          </div>
        )}
      </button>
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5">
        <EduCheck
          label={t('admin.newfamily.edu1')}
          checked={!!member.new_member_edu_week1}
          disabled={readOnly || busy !== null}
          onChange={(v) => void toggleEdu('newMemberEduWeek1', v)}
        />
        <EduCheck
          label={t('admin.newfamily.edu2')}
          checked={!!member.new_member_edu_week2}
          disabled={readOnly || busy !== null}
          onChange={(v) => void toggleEdu('newMemberEduWeek2', v)}
        />
      </div>
      <label className="mt-2.5 block">
        <span className="mb-1 block text-[11px] font-semibold text-muted">{t('admin.members.eduDongsan')}</span>
        <Select
          value={currentDongsan}
          disabled={readOnly || busy !== null}
          onChange={(e) => void setDongsan(e.target.value)}
          aria-label={t('admin.members.eduDongsan')}
          className="!min-h-8 !py-1 !pr-8 text-xs"
        >
          <option value="">—</option>
          {dongsanOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      </label>
    </li>
  )
}

function EduCheck({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      className={
        'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ' +
        (disabled ? 'cursor-not-allowed opacity-50 ' : '') +
        (checked ? 'bg-success/15 text-success' : 'bg-fill text-muted hover:text-text')
      }
    >
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={'grid size-4 place-items-center rounded-full ' + (checked ? 'bg-success text-white' : 'border border-border')}>
        {checked && <Check className="size-3" strokeWidth={3} aria-hidden />}
      </span>
      {label}
    </label>
  )
}
