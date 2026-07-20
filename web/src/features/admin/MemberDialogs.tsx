import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getConfig,
  getDongsanNames,
  getNewMemberDongsanNames,
  updateMember,
  deleteMember,
  addMemberAttendance,
  removeAttendance,
  type Member,
  type MemberEdit,
  type LogEntry,
} from '../../lib/api'
import { summerDongsanList } from './dongsan'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { memberHistory, hasEntryOn } from './attendance'
import { easternNow } from '../../lib/checkinWindow'
import { NewFamilyCardForm } from './NewFamilyCardForm'
import { cardFormFromMember, joinAffiliation, type CardFormValue } from './newFamilyCard'
import { copyNewFamilyCards, saveNewFamilyCards } from './newFamilyCardImage'

// 상태 표기 quick presets — canonical note values the 출석부 renders as grey spans.
// 방학 additionally hides the member from the kiosk and excludes their attendance from
// analytics while it's active (see kiosk.ts hiddenByStatus / analytics.ts excludeOnBreak).
const STATUS_PRESETS = ['이주', '한국 귀국', '방학']

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
  // Configured 동산 names feed the 동산 dropdown (combined list in summer mode).
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const { data: dongsanNames } = useQuery({ queryKey: ['dongsanNames'], queryFn: getDongsanNames })
  // 새가족 교육 동산: a separate, education-only 동산 list (config › 동산 tab has its own
  // editor for this) — distinct from the member's eventual regular 동산 above.
  const { data: eduDongsanNames } = useQuery({ queryKey: ['newMemberDongsanNames'], queryFn: getNewMemberDongsanNames })
  // The card carries everything printed on the 새가족 등록 카드; `f` keeps the
  // system-only fields (부서/동산/역할/메모/새가족 flag/상태 표기).
  const [card, setCard] = useState<CardFormValue>(() => cardFormFromMember(member))
  const [f, setF] = useState<MemberEdit>({
    group: member.group_name,
    subgroup: member.subgroup,
    memberRole: member.member_role,
    isNewMember: member.is_new_member,
    notes: member.notes,
    statusNote: member.status_note ?? '',
    statusStart: member.status_start ?? null,
    statusEnd: member.status_end ?? null,
    newMemberDongsan: member.new_member_dongsan ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState<'copy' | 'download' | null>(null)

  function set<K extends keyof MemberEdit>(k: K, v: MemberEdit[K]) {
    setF((cur) => ({ ...cur, [k]: v }))
  }

  // 동산 dropdown options: the configured names for the selected 부서 (the combined 합동
  // list in summer mode). A stored 동산 that's no longer configured stays selectable so
  // opening + saving the dialog never silently drops it.
  const dongsanOptions = cfg?.summerMode
    ? summerDongsanList(dongsanNames ?? {})
    : [...(dongsanNames?.[f.group ?? ''] ?? [])]
  const currentDongsan = f.subgroup ?? ''
  if (currentDongsan && !dongsanOptions.includes(currentDongsan)) dongsanOptions.push(currentDongsan)
  // Same pattern for the separate 새가족 교육 동산 list.
  const eduDongsanOptions = cfg?.summerMode
    ? summerDongsanList(eduDongsanNames ?? {})
    : [...(eduDongsanNames?.[f.group ?? ''] ?? [])]
  const currentEduDongsan = f.newMemberDongsan ?? ''
  if (currentEduDongsan && !eduDongsanOptions.includes(currentEduDongsan)) eduDongsanOptions.push(currentEduDongsan)
  const patchCard = (patch: Partial<CardFormValue>) => setCard((cur) => ({ ...cur, ...patch }))

  // "등록일 제거": clears the 등록일 AND the 새가족 flag, so saving drops the member
  // from the 새가족 list (the list keeps flagged members even without a date).
  function removeRegistration() {
    patchCard({ registrationDate: '' })
    set('isNewMember', false)
  }

  // 상태 표기 quick preset — tapping the active one clears it; activating one starts
  // the covered span today unless a start date is already set.
  function toggleStatusPreset(note: string) {
    if (f.statusNote === note) return set('statusNote', '')
    setF((cur) => ({ ...cur, statusNote: note, statusStart: cur.statusStart || easternNow().date }))
  }

  // Copy or download this member's 새가족 등록 카드 as a JPG (same renderer as the
  // 새가족 tab's batch export — one person, so the clipboard/download gets just their card).
  async function copyCard() {
    setExporting('copy')
    try {
      const { status } = await copyNewFamilyCards([member])
      const copied = status === 'copied'
      toast({ title: t(copied ? 'admin.newfamily.export.cardsCopyDone' : 'admin.newfamily.export.cardsCopyFailed'), tone: copied ? 'ok' : 'err' })
    } catch {
      toast({ title: t('admin.newfamily.export.cardsSaveFailed'), tone: 'err' })
    } finally {
      setExporting(null)
    }
  }

  async function downloadCard() {
    setExporting('download')
    try {
      await saveNewFamilyCards([member], easternNow().date)
      toast({ title: t('admin.members.card.done'), tone: 'ok' })
    } catch {
      toast({ title: t('admin.newfamily.export.cardsSaveFailed'), tone: 'err' })
    } finally {
      setExporting(null)
    }
  }

  async function save() {
    setSaving(true)
    try {
      await updateMember(member.id, {
        ...f,
        name: card.name,
        gender: card.gender,
        phone: card.phone,
        kakaoId: card.kakaoId,
        birthDate: card.birthDate || null,
        baptismStatus: card.baptismStatus,
        // 소속 category stored as a prefix inside school_or_work (no DB column).
        schoolOrWork: joinAffiliation(card.affiliationCategory, card.affiliationDetail),
        faithDuration: card.faithDuration,
        registrationDate: card.registrationDate || null,
        pastoralVisitRequested: card.pastoralVisitRequested,
      })
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
        {/* ── 새가족 등록 카드 — edit the member's info directly on the paper card ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-subtle">{t('admin.members.card.section')}</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void copyCard()}
              disabled={exporting !== null}
              className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
            >
              {exporting === 'copy' ? t('admin.newfamily.export.busy') : t('admin.members.card.copy')}
            </button>
            <button
              type="button"
              onClick={() => void downloadCard()}
              disabled={exporting !== null}
              className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
            >
              {exporting === 'download' ? t('admin.newfamily.export.busy') : t('admin.members.card.download')}
            </button>
          </div>
        </div>
        <NewFamilyCardForm value={card} onChange={patchCard} />
        {(card.registrationDate || f.isNewMember) && (
          <button
            type="button"
            onClick={removeRegistration}
            className="self-start text-xs font-semibold text-danger hover:underline"
          >
            {t('admin.members.card.removeReg')}
          </button>
        )}

        {/* ── 상태 표기 box — 이주/귀국 spans, right beneath the card ── */}
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
          <div className="text-xs font-bold uppercase tracking-wide text-subtle">{t('admin.members.statusSection')}</div>
          <p className="mt-1.5 text-sm text-warning">{t('admin.members.statusHelp')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATUS_PRESETS.map((note) => (
              <button
                key={note}
                type="button"
                aria-pressed={f.statusNote === note}
                onClick={() => toggleStatusPreset(note)}
                className={
                  'min-h-9 rounded-md border px-3 text-sm transition-colors ' +
                  (f.statusNote === note
                    ? 'border-warning bg-warning/15 font-semibold text-warning'
                    : 'border-border bg-surface text-text hover:bg-surface-alt')
                }
              >
                {note}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-3">
            <Field label={t('admin.members.statusNote')}>
              <Input value={f.statusNote ?? ''} onChange={(e) => set('statusNote', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('admin.members.statusStart')}>
                <Input type="date" value={f.statusStart ?? ''} onChange={(e) => set('statusStart', e.target.value)} />
              </Field>
              <Field label={t('admin.members.statusEnd')}>
                <Input type="date" value={f.statusEnd ?? ''} onChange={(e) => set('statusEnd', e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        {/* ── 기본 정보 — the system fields the paper card doesn't carry ── */}
        <div className="mt-1 border-t border-border pt-3 text-xs font-bold uppercase tracking-wide text-subtle">{t('admin.members.sectionBasic')}</div>
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
          <Select value={currentDongsan} onChange={(e) => set('subgroup', e.target.value)}>
            <option value="">—</option>
            {dongsanOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        {f.isNewMember && (
          <Field label={t('admin.members.eduDongsan')}>
            <Select value={currentEduDongsan} onChange={(e) => set('newMemberDongsan', e.target.value)}>
              <option value="">—</option>
              {eduDongsanOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('admin.members.memberRole')}>
          <Select value={f.memberRole ?? ''} onChange={(e) => set('memberRole', e.target.value)}>
            {MEMBER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r || '—'}
              </option>
            ))}
          </Select>
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
