import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import {
  updateMember,
  mergeMembers,
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
import { mergeTargets, canMerge, mergeSummary, type MergeState } from './merge'
import { memberHistory, hasEntryOn } from './attendance'
import { easternNow } from '../../lib/checkinWindow'
import { DongsanBadge } from './DongsanLeaders'
import { useDongsanRole } from './useDongsanRole'

const GROUPS = ['대학부', '청년부', 'EM', 'Adult Ministry']
const MEMBER_ROLES = ['', 'visitor', 'pastor', 'elder', 'deacon', 'mentor']

// Members management: searchable card grid; tap a card to edit (scoped + read-only
// enforced server-side). Renaming, group/동산 changes (= transfer), role, new-member,
// and contact fields all go through PUT /api/admin/member.
export function AdminMembers() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)
  const dongsanRole = useDongsanRole()
  const [editing, setEditing] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)
  const [merging, setMerging] = useState(false)
  const [search, setSearch] = useState('')

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const q = search.trim().toLowerCase()
  const members = q ? data.members.filter((m) => m.name.toLowerCase().includes(q)) : data.members

  return (
    <>
      <div className="mb-4 flex gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.members.search')}
          aria-label={t('admin.members.search')}
          className="flex-1"
        />
        <Button variant="secondary" onClick={() => setMerging(true)} disabled={data.members.length < 2}>
          {t('admin.members.merge.action')}
        </Button>
      </div>
      <div className="mb-3 font-mono text-xs uppercase tracking-wide text-subtle">
        {t('admin.nav.members')} · {members.length}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setEditing(m)}
            className="rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:bg-surface-alt"
          >
            <div className="text-sm font-semibold text-text">
              {m.name}
              {m.is_new_member && <span className="ml-1 text-xs">🌟</span>}
              <DongsanBadge role={dongsanRole(m.name, m.group_name, m.subgroup)} />
            </div>
            <div className="text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ') || '—'}</div>
            {m.member_role && <div className="mt-1 font-mono text-[10px] text-subtle">{m.member_role}</div>}
          </button>
        ))}
      </div>
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
          readOnly={data.role === 'pastor'}
          onClose={() => setAttendanceFor(null)}
        />
      )}
      {merging && <MergeModal members={data.members} onClose={() => setMerging(false)} />}
    </>
  )
}

function AttendanceModal({
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

function MergeModal({ members, onClose }: { members: Member[]; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [s, setS] = useState<MergeState>({ fromId: '', toId: '' })
  const [saving, setSaving] = useState(false)

  const sorted = mergeTargets(members, '') // all members, by name — the source picker
  const targets = mergeTargets(members, s.fromId) // everyone except the chosen source

  async function submit() {
    if (!canMerge(s)) return
    setSaving(true)
    try {
      await mergeMembers(s.fromId, s.toId)
      await qc.invalidateQueries({ queryKey: ['roster'] })
      toast({ title: t('admin.members.merge.done'), tone: 'ok' })
      onClose()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.members.merge.title')}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">{t('admin.members.merge.help')}</p>
        <Field label={t('admin.members.merge.from')}>
          <Select value={s.fromId} onChange={(e) => setS({ fromId: e.target.value, toId: '' })}>
            <option value="">—</option>
            {sorted.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {[m.group_name, m.subgroup].filter(Boolean).length ? ` (${[m.group_name, m.subgroup].filter(Boolean).join(' · ')})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.members.merge.to')}>
          <Select value={s.toId} onChange={(e) => setS((cur) => ({ ...cur, toId: e.target.value }))} disabled={!s.fromId}>
            <option value="">—</option>
            {targets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {[m.group_name, m.subgroup].filter(Boolean).length ? ` (${[m.group_name, m.subgroup].filter(Boolean).join(' · ')})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        {canMerge(s) && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            {t('admin.members.merge.warn', { summary: mergeSummary(members, s) })}
          </p>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button variant="danger" onClick={submit} disabled={!canMerge(s) || saving} className="flex-1">
          {saving ? t('common.loading') : t('admin.members.merge.confirm')}
        </Button>
      </div>
    </Dialog>
  )
}

function EditModal({ member, onClose, onAttendance }: { member: Member; onClose: () => void; onAttendance: () => void }) {
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-subtle">{label}</span>
      {children}
    </label>
  )
}
