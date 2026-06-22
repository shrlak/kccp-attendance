import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { mergeMembers, bulkSetSubgroup, type Member } from '../../lib/api'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { mergeTargets, canMerge, mergeSummary, type MergeState } from './merge'
import { DongsanBadge } from './DongsanLeaders'
import { OfficerBadge } from './Officers'
import { useDongsanRole } from './useDongsanRole'
import { EditModal, AttendanceModal, Field } from './MemberDialogs'

// Members management: searchable card grid; tap a card to edit (scoped + read-only
// enforced server-side). Renaming, group/동산 changes (= transfer), role, new-member,
// and contact fields all go through PUT /api/admin/member.
export function AdminMembers() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading, isError } = useRoster(true)
  const dongsanRole = useDongsanRole()
  const [editing, setEditing] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)
  const [merging, setMerging] = useState(false)
  const [search, setSearch] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  if (isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>
  if (isError) return <p className="text-sm text-danger">{t('common.error')}</p>
  if (!data) return null

  const q = search.trim().toLowerCase()
  const members = q ? data.members.filter((m) => m.name.toLowerCase().includes(q)) : data.members
  const staffMembers = q ? data.staffMembers.filter((m) => m.name.toLowerCase().includes(q)) : data.staffMembers
  const dongsanOptions = [...new Set(data.members.map((m) => m.subgroup).filter(Boolean))].sort()

  function toggleSel(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function exitSelect() {
    setSelectMode(false)
    setSelected(new Set())
    setTarget('')
  }
  async function applyBulk(subgroup: string) {
    if (selected.size === 0) return
    setBulkBusy(true)
    try {
      const res = await bulkSetSubgroup([...selected], subgroup)
      toast({ title: t('admin.members.bulkMove.done', { n: res.updated }), tone: 'ok' })
      await qc.invalidateQueries({ queryKey: ['roster'] })
      exitSelect()
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBulkBusy(false)
    }
  }

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
        {data.canBulkSubgroup && (
          <Button variant="secondary" onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
            {selectMode ? t('common.cancel') : t('admin.members.bulkMove.action')}
          </Button>
        )}
        {!selectMode && (
          <Button variant="secondary" onClick={() => setMerging(true)} disabled={data.members.length < 2}>
            {t('admin.members.merge.action')}
          </Button>
        )}
      </div>
      {selectMode ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="font-mono text-xs font-semibold text-primary">
            {t('admin.members.bulkMove.selected', { n: selected.size })}
          </span>
          <Select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-[8rem] flex-1">
            <option value="">{t('admin.members.bulkMove.placeholder')}</option>
            {dongsanOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={selected.size === 0 || !target || bulkBusy} onClick={() => applyBulk(target)}>
            {t('admin.members.bulkMove.moveTo')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={selected.size === 0 || bulkBusy}
            onClick={() => applyBulk('')}
          >
            {t('admin.members.bulkMove.remove')}
          </Button>
        </div>
      ) : (
        <div className="mb-3 font-mono text-xs uppercase tracking-wide text-subtle">
          {t('admin.nav.members')} · {members.length}
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        {members.map((m) => {
          const sel = selectMode && selected.has(m.id)
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => (selectMode ? toggleSel(m.id) : setEditing(m))}
              className={
                'rounded-lg border bg-surface p-3 text-left transition-colors hover:bg-surface-alt ' +
                (sel ? 'border-primary ring-2 ring-primary/40' : 'border-border')
              }
            >
              <div className="text-sm font-semibold text-text">
                {selectMode && <span className="mr-1 text-primary">{sel ? '☑' : '☐'}</span>}
                {m.name}
                {m.is_new_member && <span className="ml-1 text-xs">🌟</span>}
                <DongsanBadge role={dongsanRole(m.name, m.group_name, m.subgroup)} />
                <OfficerBadge name={m.name} />
              </div>
              <div className="text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ') || '—'}</div>
              {m.member_role && <div className="mt-1 font-mono text-[10px] text-subtle">{m.member_role}</div>}
            </button>
          )
        })}
      </div>
      {staffMembers.length > 0 && (
        <>
          <div className="mb-3 mt-6 font-mono text-xs uppercase tracking-wide text-subtle">
            {t('admin.members.staffSection')} · {staffMembers.length}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {staffMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setEditing(m)}
                className="rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:bg-surface-alt"
              >
                <div className="text-sm font-semibold text-text">{m.name}</div>
                <div className="text-xs text-muted">{m.member_role || '—'}</div>
              </button>
            ))}
          </div>
        </>
      )}
      {editing && (
        <EditModal
          member={editing}
          allowDelete={data.role !== 'pastor'}
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

