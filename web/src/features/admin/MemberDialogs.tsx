import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  updateMember,
  addMemberAttendance,
  removeAttendance,
  type Member,
  type MemberEdit,
  type LogEntry,
} from '../../lib/api'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { memberHistory, hasEntryOn } from './attendance'
import { easternNow } from '../../lib/checkinWindow'

const GROUPS = ['대학부', '청년부', 'EM', 'Adult Ministry']
const MEMBER_ROLES = ['', 'visitor', 'pastor', 'elder', 'deacon', 'mentor']

// A labelled form field wrapper, shared by the member dialogs (and the merge dialog).
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-subtle">{label}</span>
      {children}
    </label>
  )
}

// Member detail/editor dialog: shows + edits all of a member's info (scoped + read-only
// enforced server-side). Shared by the Members tab and the 새가족 (new-family) tab.
export function EditModal({
  member,
  onClose,
  onAttendance,
}: {
  member: Member
  onClose: () => void
  onAttendance: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [f, setF] = useState<MemberEdit>({
    name: member.name,
    group: member.group_name,
    subgroup: member.subgroup,
    memberRole: member.member_role,
    isNewMember: member.is_new_member,
    gender: member.gender,
    phone: member.phone,
    kakaoId: member.kakao_id,
    birthDate: member.birth_date,
    notes: member.notes,
  })
  const [saving, setSaving] = useState(false)

  function set<K extends keyof MemberEdit>(k: K, v: MemberEdit[K]) {
    setF((cur) => ({ ...cur, [k]: v }))
  }

  async function save() {
    setSaving(true)
    try {
      await updateMember(member.id, f)
      await qc.invalidateQueries({ queryKey: ['roster'] })
      toast({ title: t('admin.members.saved'), tone: 'ok' })
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.members.edit')}>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
        <Field label={t('admin.members.name')}>
          <Input value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('admin.members.group')}>
          <Select value={f.group ?? ''} onChange={(e) => set('group', e.target.value)}>
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.members.subgroup')}>
          <Input value={f.subgroup ?? ''} onChange={(e) => set('subgroup', e.target.value)} />
        </Field>
        <Field label={t('admin.members.memberRole')}>
          <Select value={f.memberRole ?? ''} onChange={(e) => set('memberRole', e.target.value)}>
            {MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r || '—'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.members.gender')}>
          <Input value={f.gender ?? ''} onChange={(e) => set('gender', e.target.value)} />
        </Field>
        <Field label={t('admin.members.phone')}>
          <Input value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label={t('admin.members.kakaoId')}>
          <Input value={f.kakaoId ?? ''} onChange={(e) => set('kakaoId', e.target.value)} />
        </Field>
        <Field label={t('admin.members.birthDate')}>
          <Input type="date" value={f.birthDate ?? ''} onChange={(e) => set('birthDate', e.target.value)} />
        </Field>
        <Field label={t('admin.members.notes')}>
          <textarea
            value={f.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={f.isNewMember ?? false} onChange={(e) => set('isNewMember', e.target.checked)} />
          {t('admin.members.isNewMember')}
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onAttendance} className="flex-1">
          {t('admin.members.attendance.action')}
        </Button>
        <Button onClick={save} disabled={saving} className="flex-1">
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </Dialog>
  )
}

// A member's attendance history with add/remove (back-fill). Scoped + read-only enforced
// server-side. Shared by the Members tab and the 새가족 (new-family) tab.
export function AttendanceModal({
  member,
  log,
  readOnly,
  onClose,
}: {
  member: Member
  log: LogEntry[]
  readOnly: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [date, setDate] = useState(easternNow().date)
  const [busy, setBusy] = useState(false)

  const history = memberHistory(log, member.id)

  async function add() {
    if (hasEntryOn(log, member.id, date)) {
      toast({ title: t('admin.members.attendance.already'), tone: 'warn' })
      return
    }
    setBusy(true)
    try {
      const res = await addMemberAttendance(member.id, date)
      if (res.status === 'already') toast({ title: t('admin.members.attendance.already'), tone: 'warn' })
      else toast({ title: t('admin.members.attendance.added'), tone: 'ok' })
      await qc.invalidateQueries({ queryKey: ['roster'] })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    setBusy(true)
    try {
      await removeAttendance(id)
      toast({ title: t('admin.members.attendance.removed'), tone: 'ok' })
      await qc.invalidateQueries({ queryKey: ['roster'] })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${t('admin.members.attendance.title')} · ${member.name}`}>
      {!readOnly && (
        <div className="mb-3 flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.members.attendance.date')}</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <Button onClick={add} disabled={busy}>
            {t('admin.members.attendance.add')}
          </Button>
        </div>
      )}
      <div className="mb-2 font-mono text-xs uppercase tracking-wide text-subtle">
        {t('admin.members.attendance.total', { n: history.length })}
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.members.attendance.empty')}</p>
      ) : (
        <ul className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto pr-1">
          {history.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2"
            >
              <span className="text-sm text-text">
                {e.date}
                {e.time && <span className="ml-2 font-mono text-xs text-muted">{e.time}</span>}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => e.id !== undefined && remove(e.id)}
                  disabled={busy}
                  className="text-xs font-semibold text-danger hover:underline disabled:opacity-50"
                >
                  {t('admin.members.attendance.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={onClose} className="mt-4 w-full">
        {t('common.close')}
      </Button>
    </Dialog>
  )
}
