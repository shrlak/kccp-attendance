import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { filterMembers, NO_FILTER, type Filter } from './filters'
import { currentNewFamily, matchesEduFilter, type EduFilter } from './newFamily'
import { summerDongsanList } from './dongsan'
import { GroupFilter, Pill } from './GroupFilter'
import { DongsanNamesEditor } from './AdminDongsan'
import {
  getConfig,
  getNewMemberDongsanNames,
  updateNewMemberDongsanNames,
  updateMember,
  type Member,
  type DongsanNames,
} from '../../lib/api'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { EditModal, AttendanceModal } from './MemberDialogs'

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

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const today = easternNow().date
  const scopedMembers = filterMembers(data.members, filter)
  const currentSemester = currentNewFamily(scopedMembers, today)
  const visible = eduFilter === 'all' ? currentSemester : currentSemester.filter((m) => matchesEduFilter(m, eduFilter))
  const readOnly = data.role === 'pastor'
  const summerMode = !!cfg?.summerMode

  return (
    <>
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />

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

      <div className="mb-4 font-mono text-xs uppercase tracking-wide text-subtle">
        {t('admin.newfamilyEdu.title')} · {visible.length}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted">
          {t(currentSemester.length === 0 ? 'admin.newfamily.empty' : 'admin.newfamily.noFilterMatch')}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {visible.map((m) => (
            <EduCard
              key={m.id}
              member={m}
              readOnly={readOnly}
              summerMode={summerMode}
              dongsanNames={eduDongsanNames}
              onOpen={() => setEditing(m)}
            />
          ))}
        </ul>
      )}

      {eduDongsanNames && (
        <div className="mt-10 border-t border-border pt-6">
          <DongsanNamesEditor
            loaded={eduDongsanNames}
            summer={summerMode}
            title={t('admin.settings.newMemberDongsanNames')}
            desc={t('admin.settings.newMemberDongsanNamesDesc')}
            onSave={async (next) => {
              await updateNewMemberDongsanNames(next)
              await qc.invalidateQueries({ queryKey: ['newMemberDongsanNames'] })
            }}
          />
        </div>
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

function EduCard({
  member,
  readOnly,
  summerMode,
  dongsanNames,
  onOpen,
}: {
  member: Member
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
      await qc.invalidateQueries({ queryKey: ['roster'] })
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
      await qc.invalidateQueries({ queryKey: ['roster'] })
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
    <li className="rounded-lg border border-border bg-surface p-3">
      {/* Tap the body to open the member's full info/editor (feature parity with 새가족 tab) */}
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="text-sm font-semibold text-text">{member.name}</div>
        <div className="text-xs text-muted">{[member.group_name, member.subgroup].filter(Boolean).join(' · ') || '—'}</div>
      </button>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
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
      <label className="mt-2 block">
        <span className="mb-1 block text-[11px] font-semibold text-subtle">{t('admin.members.eduDongsan')}</span>
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
    <label className="flex items-center gap-1.5 text-xs text-text">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
