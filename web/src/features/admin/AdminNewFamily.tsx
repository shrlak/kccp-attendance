import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { filterMembers, NO_FILTER, type Filter } from './filters'
import { semesterKey, currentNewFamily, monthlyRegistrations } from './newFamily'
import { GroupFilter } from './GroupFilter'
import { updateMember, type Member, type MemberEdit } from '../../lib/api'
import { useToast } from '../../components/ui/Toast'

// 새가족 (new-family) tab: the current-semester new members with inline education
// tracking, plus a monthly-registrations roll-up. Visible to every admin.
export function AdminNewFamily() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const today = easternNow().date
  const scopedMembers = filterMembers(data.members, filter)
  const list = currentNewFamily(scopedMembers, today)
  const months = monthlyRegistrations(scopedMembers)
  const [, season] = semesterKey(today).split('-')
  const year = semesterKey(today).split('-')[0]
  const readOnly = data.role === 'pastor'

  return (
    <>
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />

      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
          {year} {t(`admin.newfamily.season.${season}`)}
        </span>
        <span className="font-mono text-xs uppercase tracking-wide text-subtle">
          {t('admin.newfamily.title')} · {list.length}
        </span>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.newfamily.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((m) => (
            <NewFamilyCard key={m.id} member={m} readOnly={readOnly} />
          ))}
        </ul>
      )}

      {months.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 font-mono text-xs uppercase tracking-wide text-subtle">{t('admin.newfamily.monthly')}</div>
          <div className="flex flex-col gap-4">
            {months.map((g) => (
              <div key={g.month}>
                <div className="mb-1.5 text-sm font-semibold text-text">
                  {g.month} · {g.members.length}
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {g.members.map((m) => (
                    <li key={m.id} className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-muted">
                      {m.name}
                      {[m.group_name, m.subgroup].filter(Boolean).length ? (
                        <span className="ml-1 text-subtle">· {[m.group_name, m.subgroup].filter(Boolean).join(' ')}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function NewFamilyCard({ member, readOnly }: { member: Member; readOnly: boolean }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState<keyof MemberEdit | null>(null)

  async function toggle(field: 'newMemberEduWeek1' | 'newMemberEduWeek2', value: boolean) {
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

  return (
    <li className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-semibold text-text">
            {member.name}
            {member.pastoral_visit_requested && <span className="ml-1.5 text-xs" title={t('admin.newfamily.pastoralVisit')}>🙏</span>}
          </div>
          <div className="text-xs text-muted">{[member.group_name, member.subgroup].filter(Boolean).join(' · ') || '—'}</div>
          <div className="mt-0.5 text-xs">
            {member.registration_date ? (
              <span className="font-mono text-subtle">{member.registration_date}</span>
            ) : (
              <span className="font-semibold text-warning">{t('admin.newfamily.noRegDate')}</span>
            )}
            {member.phone && <span className="ml-2 text-subtle">{member.phone}</span>}
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-4">
        <EduCheck
          label={t('admin.newfamily.edu1')}
          checked={!!member.new_member_edu_week1}
          disabled={readOnly || busy !== null}
          onChange={(v) => toggle('newMemberEduWeek1', v)}
        />
        <EduCheck
          label={t('admin.newfamily.edu2')}
          checked={!!member.new_member_edu_week2}
          disabled={readOnly || busy !== null}
          onChange={(v) => toggle('newMemberEduWeek2', v)}
        />
      </div>
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
