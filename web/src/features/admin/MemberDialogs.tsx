import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  updateMember,
  deleteMember,
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
import { NewFamilyCardView } from './NewFamilyCardView'
import { exportNewFamilyCards } from './newFamilyCardImage'

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
  allowDelete = false,
}: {
  member: Member
  onClose: () => void
  onAttendance: () => void
  // When true (Members tab, non-pastor), shows an irreversible delete control. The
  // server still enforces scope + read-only regardless of this flag.
  allowDelete?: boolean
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
    statusNote: member.status_note ?? '',
    statusStart: member.status_start ?? null,
    statusEnd: member.status_end ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)

  function set<K extends keyof MemberEdit>(k: K, v: MemberEdit[K]) {
    setF((cur) => ({ ...cur, [k]: v }))
  }

  // Download this member's 새가족 등록 카드 as a JPG (same renderer as the 새가족 tab's
  // batch export — one person, so the clipboard gets just their card).
  async function downloadCard() {
    setExporting(true)
    try {
      await exportNewFamilyCards([member], easternNow().date)
      toast({ title: t('admin.members.card.done'), tone: 'ok' })
    } catch {
      toast({ title: t('admin.newfamily.export.failed'), tone: 'err' })
    } finally {
      setExporting(false)
    }
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

  async function del() {
    setDeleting(true)
    try {
      await deleteMember(member.id)
      await qc.invalidateQueries({ queryKey: ['roster'] })
      toast({ title: t('admin.members.delete.done', { name: member.name }), tone: 'ok' })
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
      setDeleting(false)
    }
  }

  return (
    // wide: the 새가족 등록 카드 replica at the top needs the paper card's landscape width.
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.members.edit')} wide>
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
        {/* ── 새가족 등록 카드 — the member's info in the paper card's exact shape ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-subtle">{t('admin.members.card.section')}</div>
          <button
            type="button"
            onClick={() => void downloadCard()}
            disabled={exporting}
            className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
          >
            {exporting ? t('admin.newfamily.export.busy') : t('admin.members.card.download')}
          </button>
        </div>
        <NewFamilyCardView member={member} />

        {/* ── 기본 정보 ── */}
        <div className="mt-1 border-t border-border pt-3 text-xs font-bold uppercase tracking-wide text-subtle">{t('admin.members.sectionBasic')}</div>
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
        {/* ── 개인 정보 ── */}
        <div className="mt-1 border-t border-border pt-3 text-xs font-bold uppercase tracking-wide text-subtle">
          {t('admin.members.sectionPersonal')}
        </div>
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
        {/* ── 상태 표기: the 출석부 shows this as a grey cell from the start date to the end
            date (or the term's end) instead of O/X — e.g. 한국 귀국, 이주(방문자), 돌아옴. ── */}
        <div className="mt-1 border-t border-border pt-3">
          <div className="text-xs font-bold uppercase tracking-wide text-subtle">{t('admin.members.statusSection')}</div>
          <p className="mt-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">{t('admin.members.statusHelp')}</p>
        </div>
        <Field label={t('admin.members.statusNote')}>
          <Input value={f.statusNote ?? ''} onChange={(e) => set('statusNote', e.target.value)} />
        </Field>
        <Field label={t('admin.members.statusStart')}>
          <Input type="date" value={f.statusStart ?? ''} onChange={(e) => set('statusStart', e.target.value)} />
        </Field>
        <Field label={t('admin.members.statusEnd')}>
          <Input type="date" value={f.statusEnd ?? ''} onChange={(e) => set('statusEnd', e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onAttendance} className="flex-1">
          {t('admin.members.attendance.action')}
        </Button>
        <Button onClick={save} disabled={saving} className="flex-1">
          {saving ? t('common.loading') : t('common.save')}
        </Button>
      </div>
      {allowDelete &&
        (confirmDelete ? (
          <div className="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3">
            <p className="mb-2 text-xs text-danger">{t('admin.members.delete.warn')}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(false)} disabled={deleting} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button variant="danger" onClick={del} disabled={deleting} className="flex-1">
                {deleting ? t('common.loading') : t('admin.members.delete.confirm')}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="mt-3 w-full text-xs font-semibold text-danger hover:underline"
          >
            {t('admin.members.delete.action')}
          </button>
        ))}
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
