import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { updateMember, type Member, type MemberEdit } from '../../lib/api'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'

const GROUPS = ['대학부', '청년부', 'EM', 'Adult Ministry']
const MEMBER_ROLES = ['', 'visitor', 'pastor', 'elder', 'deacon', 'mentor']

// Members management: searchable card grid; tap a card to edit (scoped + read-only
// enforced server-side). Renaming, group/동산 changes (= transfer), role, new-member,
// and contact fields all go through PUT /api/admin/member.
export function AdminMembers() {
  const { t } = useTranslation()
  const { data, isLoading, isError } = useRoster(true)
  const [editing, setEditing] = useState<Member | null>(null)
  const [search, setSearch] = useState('')

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const q = search.trim().toLowerCase()
  const members = q ? data.members.filter((m) => m.name.toLowerCase().includes(q)) : data.members

  return (
    <>
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.members.search')}
        aria-label={t('admin.members.search')}
        className="mb-4"
      />
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
            </div>
            <div className="text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ') || '—'}</div>
            {m.member_role && <div className="mt-1 font-mono text-[10px] text-subtle">{m.member_role}</div>}
          </button>
        ))}
      </div>
      {editing && <EditModal member={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function EditModal({ member, onClose }: { member: Member; onClose: () => void }) {
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
      <Button onClick={save} disabled={saving} className="mt-4 w-full">
        {saving ? t('common.loading') : t('common.save')}
      </Button>
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
