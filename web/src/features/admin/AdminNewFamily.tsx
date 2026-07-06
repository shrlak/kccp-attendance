import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { easternNow } from '../../lib/checkinWindow'
import { filterMembers, NO_FILTER, type Filter } from './filters'
import { semesterKey, newFamilyByDate, monthlyRegistrations } from './newFamily'
import { exportNewFamilyCards } from './newFamilyCardImage'
import { toggleId } from './bulk'
import { GroupFilter } from './GroupFilter'
import { updateMember, type Member, type MemberEdit } from '../../lib/api'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { EditModal, AttendanceModal } from './MemberDialogs'

// 새가족 (new-family) tab: the current-semester new members with inline education
// tracking, plus a monthly-registrations roll-up. Visible to every admin.
export function AdminNewFamily() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)
  const [filter, setFilter] = useState<Filter>(NO_FILTER)
  const [editing, setEditing] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const today = easternNow().date
  const scopedMembers = filterMembers(data.members, filter)
  const dateGroups = newFamilyByDate(scopedMembers, today)
  const allNewFamily = dateGroups.flatMap((g) => g.members)
  const total = allNewFamily.length
  const months = monthlyRegistrations(scopedMembers)
  const [, season] = semesterKey(today).split('-')
  const year = semesterKey(today).split('-')[0]
  const readOnly = data.role === 'pastor'

  return (
    <>
      <GroupFilter members={data.members} value={filter} onChange={setFilter} />

      <div className="mb-1.5 flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">
          {year} {t(`admin.newfamily.season.${season}`)}
        </span>
        <span className="font-mono text-xs uppercase tracking-wide text-subtle">
          {t('admin.newfamily.title')} · {total}
        </span>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setExportOpen(true)}>
          {t('admin.newfamily.export.action')}
        </Button>
      </div>
      {/* Legend for the card badge below */}
      <p className="mb-3 text-xs text-subtle">{t('admin.newfamily.legend')}</p>

      {dateGroups.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.newfamily.empty')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {dateGroups.map((g) => (
            <div key={g.date ?? 'no-date'}>
              <div className="mb-1.5 flex items-baseline gap-2 border-b border-border pb-1">
                {g.date ? (
                  <span className="font-mono text-sm font-semibold text-text">{g.date}</span>
                ) : (
                  <span className="text-sm font-semibold text-warning">{t('admin.newfamily.noRegDate')}</span>
                )}
                <span className="text-xs text-subtle">{g.members.length}</span>
              </div>
              <ul className="grid grid-cols-4 gap-2">
                {g.members.map((m) => (
                  <NewFamilyCard key={m.id} member={m} readOnly={readOnly} onOpen={() => setEditing(m)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {months.length > 0 && (
        <div className="mt-8 border-t border-border pt-4">
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

      {exportOpen && <ExportCardsModal members={allNewFamily} today={today} onClose={() => setExportOpen(false)} />}

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

// Pick which 새가족 to export as 등록 카드 JPGs. Lists the whole current-semester tab
// (name-searchable), with today's registrations pre-checked — the previous "export
// today" behavior stays the default, but any subset of the semester can be chosen.
function ExportCardsModal({ members, today, onClose }: { members: Member[]; today: string; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(members.filter((m) => m.registration_date === today).map((m) => m.id)),
  )
  const [busy, setBusy] = useState(false)

  const q = search.trim().toLowerCase()
  const visible = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members

  async function confirm() {
    // Export in the tab's display order (newest registration date first).
    const chosen = members.filter((m) => selected.has(m.id))
    if (!chosen.length) return
    setBusy(true)
    try {
      const { copied } = await exportNewFamilyCards(chosen, today)
      toast({
        title: t(copied ? 'admin.newfamily.export.done' : 'admin.newfamily.export.downloadedOnly'),
        tone: 'ok',
      })
    } catch {
      toast({ title: t('admin.newfamily.export.failed'), tone: 'err' })
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.newfamily.export.title')}>
      <p className="mb-3 text-sm text-muted">{t('admin.newfamily.export.select')}</p>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.members.search')}
        aria-label={t('admin.members.search')}
        className="mb-2"
      />
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-wide text-subtle">
          {t('admin.newfamily.export.selected', { n: selected.size })}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSelected((cur) => new Set([...cur, ...visible.map((m) => m.id)]))}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {t('admin.newfamily.export.all')}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs font-semibold text-muted hover:underline"
          >
            {t('admin.newfamily.export.none')}
          </button>
        </div>
      </div>
      <ul className="flex max-h-[42vh] flex-col gap-1 overflow-y-auto pr-1">
        {visible.length === 0 && <li className="text-sm text-muted">{t('admin.newfamily.export.noMatch')}</li>}
        {visible.map((m) => (
          <li key={m.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-surface-alt">
              <input
                type="checkbox"
                checked={selected.has(m.id)}
                disabled={busy}
                onChange={() => setSelected((cur) => toggleId(cur, m.id))}
              />
              <span className="font-medium text-text">{m.name}</span>
              <span className="text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ')}</span>
              {m.registration_date && (
                <span className="ml-auto font-mono text-[11px] text-subtle">{m.registration_date}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      <Button onClick={() => void confirm()} disabled={busy || selected.size === 0} className="mt-4 w-full">
        {busy ? t('admin.newfamily.export.busy') : t('admin.newfamily.export.confirm', { n: selected.size })}
      </Button>
    </Dialog>
  )
}

function NewFamilyCard({
  member,
  readOnly,
  onOpen,
}: {
  member: Member
  readOnly: boolean
  onOpen: () => void
}) {
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
    <li className="rounded-lg border border-border bg-surface p-3">
      {/* Tap the body to open the member's full info/editor (feature parity with 멤버 tab) */}
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="text-sm font-semibold text-text">
          {member.name}
          {member.pastoral_visit_requested && (
            <span className="ml-1.5 text-xs" title={t('admin.newfamily.pastoralVisit')}>🙏</span>
          )}
        </div>
        <div className="text-xs text-muted">{[member.group_name, member.subgroup].filter(Boolean).join(' · ') || '—'}</div>
        {member.phone && <div className="text-xs text-subtle">{member.phone}</div>}
      </button>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
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
