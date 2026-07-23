import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoster } from './useRoster'
import { mergeMembers, bulkSetSubgroup, getConfig, type Member } from '../../lib/api'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { Search, ListChecks, Merge as MergeIcon, Users, AlertTriangle } from '../../components/ui/Icon'
import { mergeTargets, canMerge, mergeSummary, type MergeState } from './merge'
import { groupsOf } from './filters'
import { IconKey } from './IconKey'
import { EditModal, AttendanceModal, Field } from './MemberDialogs'
import { resolveGroupColor, hexTint } from './groupColors'

// Members management: searchable card grid; tap a card to edit (scoped + read-only
// enforced server-side). Renaming, group/동산 changes (= transfer), role, new-member,
// and contact fields all go through PUT /api/admin/member.
export function AdminMembers() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading, isError } = useRoster(true)
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const [editing, setEditing] = useState<Member | null>(null)
  const [attendanceFor, setAttendanceFor] = useState<Member | null>(null)
  const [merging, setMerging] = useState(false)
  const [search, setSearch] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  if (isLoading) return (
    <div className="fx-fade space-y-6">
      <div className="fx-skeleton h-11 rounded-xl" />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {Array.from({ length: 12 }).map((_, i) => <div key={i} className="fx-skeleton h-20 rounded-2xl" />)}
      </div>
    </div>
  )
  if (isError) return (
    <div className="fx-rise grid place-items-center py-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-danger/10 text-danger"><AlertTriangle className="size-6" aria-hidden /></div>
      <p className="mt-4 text-sm font-semibold text-danger">{t('common.error')}</p>
    </div>
  )
  if (!data) return null

  const q = search.trim().toLowerCase()
  const members = q ? data.members.filter((m) => m.name.toLowerCase().includes(q)) : data.members
  const staffMembers = q ? data.staffMembers.filter((m) => m.name.toLowerCase().includes(q)) : data.staffMembers
  const dongsanOptions = [...new Set(data.members.map((m) => m.subgroup).filter(Boolean))].sort()

  // The card grid is split into one section per 부서 (대학부 first, then 청년부, …);
  // members without a 부서 gather in a trailing "—" section.
  const sections = [
    ...groupsOf(members).map((g) => ({ group: g, list: members.filter((m) => m.group_name === g) })),
    { group: '', list: members.filter((m) => !m.group_name) },
  ].filter((s) => s.list.length > 0)

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
      <div className="mb-5 flex flex-wrap gap-2 border-b border-separator pb-5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.members.search')}
            aria-label={t('admin.members.search')}
            className="pl-10"
          />
        </div>
        {data.canBulkSubgroup && (
          <Button variant="secondary" onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
            <ListChecks className="size-4" aria-hidden />
            {selectMode ? t('common.cancel') : t('admin.members.bulkMove.action')}
          </Button>
        )}
        {!selectMode && (
          <Button variant="secondary" onClick={() => setMerging(true)} disabled={data.members.length < 2}>
            <MergeIcon className="size-4" aria-hidden />
            {t('admin.members.merge.action')}
          </Button>
        )}
      </div>
      {selectMode ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-primary/[0.06] px-4 py-3 shadow-[var(--shadow-sm)]">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
            <ListChecks className="size-4" aria-hidden />
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
        <div className="mb-4 flex items-center gap-2 section-kicker">
          <Users className="size-4 text-subtle" aria-hidden />
          {t('admin.nav.members')} · {members.length}
        </div>
      )}
      <IconKey items={['newMemberStar', 'eduWeek1', 'eduWeek2']} />
      {sections.map(({ group, list }) => {
        // 대학부/청년부 cards get a faint per-부서 tint (configurable in 관리자 › 설정);
        // every other section (EM, staff-ish groups, no 부서) stays the plain surface.
        const tint = group === '대학부' || group === '청년부' ? hexTint(resolveGroupColor(cfg?.groupColors, group), 0.07) : undefined
        return (
        <section key={group || 'none'} className="mb-8 fx-rise">
          <h3 className="mb-3 flex items-center gap-2 border-b border-separator pb-2.5 font-display text-lg font-bold tracking-tight text-text">
            {group || '—'}
            <span className="rounded-full bg-fill px-2 py-0.5 text-xs font-semibold tabular-nums text-muted">{list.length}</span>
          </h3>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {list.map((m) => {
              const sel = selectMode && selected.has(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => (selectMode ? toggleSel(m.id) : setEditing(m))}
                  style={sel ? undefined : { background: tint }}
                  className={
                    'min-h-20 rounded-2xl border p-3.5 text-left shadow-[var(--shadow-sm)] transition-[background-color,border-color,box-shadow,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
                    'hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[var(--shadow)] active:translate-y-0 ' +
                    (sel ? 'border-primary bg-surface ring-2 ring-primary/40' : 'border-border' + (tint ? '' : ' bg-surface'))
                  }
                >
                  <div className="leading-snug">
                    {selectMode && (
                      <span className={'mr-2 inline-grid h-4 w-4 place-items-center rounded-full align-middle text-[10px] font-bold ' + (sel ? 'bg-primary text-primary-fg' : 'border border-border text-transparent')}>
                        ✓
                      </span>
                    )}
                    <span className="break-words text-base font-semibold text-text">{m.name}</span>
                    {m.is_new_member && (
                      <>
                      <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-gold/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-gold">
                        {t('admin.iconKey.newMemberStar')}
                      </span>
                      {m.new_member_edu_week1 && (
                        <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-info/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-info">
                          {t('admin.iconKey.eduWeek1')}
                        </span>
                      )}
                      {m.new_member_edu_week2 && (
                        <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-info/10 px-2 py-0.5 align-middle text-[10px] font-semibold text-info">
                          {t('admin.iconKey.eduWeek2')}
                        </span>
                      )}
                      </>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted">{[m.group_name, m.subgroup].filter(Boolean).join(' · ') || '—'}</div>
                  {m.member_role && <div className="mt-1 text-[11px] font-medium text-subtle">{m.member_role}</div>}
                </button>
              )
            })}
          </div>
        </section>
        )
      })}
      {staffMembers.length > 0 && (
        <>
          <div className="mb-3 mt-6 flex items-center gap-2 section-kicker">
            {t('admin.members.staffSection')}
            <span className="rounded-full bg-fill px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">{staffMembers.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {staffMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setEditing(m)}
                className="min-h-20 rounded-2xl border border-border bg-surface p-3.5 text-left shadow-[var(--shadow-sm)] transition-[background-color,border-color,box-shadow,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[var(--shadow)] active:translate-y-0"
              >
                <div className="text-base font-semibold text-text">{m.name}</div>
                <div className="mt-1 text-xs text-muted">{m.member_role || '—'}</div>
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
          <p className="flex items-start gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t('admin.members.merge.warn', { summary: mergeSummary(members, s) })}</span>
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
