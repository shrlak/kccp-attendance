import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getConfig,
  getAdminRoles,
  getAuditLog,
  getPending,
  approvePending,
  rejectPending,
  updateSettings,
  setAdminRole,
  removeAdminRole,
  getBackup,
  postRestore,
  type AdminRole,
  type RoleAssignment,
} from '../../lib/api'
import { sortAdminRoles, auditDetail, roleNeedsScope, backupFilename } from './admins'
import { useRoster } from './useRoster'
import { groupsOf, subgroupsOf } from './filters'
import { checkinCandidates } from './today'
import { Switch } from '../../components/ui/Switch'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'

const ROLES: AdminRole[] = ['super_admin', 'leader', 'pastor', 'welcoming']

// Admins tab (super-admin): registration-approval toggle, pending queue, the admin
// roster with add/remove, and the audit log.
export function AdminAdmins() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const { data: rolesData, isLoading: rolesLoading } = useQuery({ queryKey: ['adminRoles'], queryFn: getAdminRoles })
  const { data: pendingData } = useQuery({ queryKey: ['pending'], queryFn: getPending })
  const [pendingBusy, setPendingBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [roleBusy, setRoleBusy] = useState<string | null>(null)
  const [showAudit, setShowAudit] = useState(false)
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => getAuditLog(100),
    enabled: showAudit,
  })
  const [busy, setBusy] = useState(false)

  async function toggleApproval(v: boolean) {
    setBusy(true)
    try {
      await updateSettings({ requireApproval: v })
      await qc.invalidateQueries({ queryKey: ['config'] })
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  async function decide(deviceId: string, approve: boolean) {
    setPendingBusy(deviceId)
    try {
      await (approve ? approvePending(deviceId) : rejectPending(deviceId))
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['pending'] }),
        qc.invalidateQueries({ queryKey: ['roster'] }),
      ])
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setPendingBusy(null)
    }
  }

  async function removeRole(memberId: string) {
    setRoleBusy(memberId)
    try {
      await removeAdminRole(memberId)
      await qc.invalidateQueries({ queryKey: ['adminRoles'] })
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    } finally {
      setRoleBusy(null)
    }
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  // The picked restore file is staged here; the destructive restore only runs after a
  // second explicit "confirm" click (parity with the legacy hold-to-confirm gate).
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoreArmed, setRestoreArmed] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)

  async function downloadBackup() {
    setBackupBusy(true)
    try {
      const data = await getBackup()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = backupFilename()
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setBackupBusy(false)
    }
  }

  function pickRestoreFile(file: File | null) {
    setRestoreFile(file)
    setRestoreArmed(false)
  }

  async function runRestore() {
    if (!restoreFile) return
    setRestoreBusy(true)
    try {
      const parsed = JSON.parse(await restoreFile.text())
      await postRestore(parsed)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['roster'] }),
        qc.invalidateQueries({ queryKey: ['config'] }),
        qc.invalidateQueries({ queryKey: ['adminRoles'] }),
        qc.invalidateQueries({ queryKey: ['pending'] }),
      ])
      toast({ title: t('admin.admins.restored'), tone: 'ok' })
      setRestoreFile(null)
      setRestoreArmed(false)
      if (fileRef.current) fileRef.current.value = ''
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setRestoreBusy(false)
    }
  }

  const roles = sortAdminRoles(rolesData?.roles ?? [])
  const pending = pendingData?.pending ?? []

  return (
    <div className="max-w-lg">
      {pending.length > 0 && (
        <>
          <h2 className="mb-3 font-display text-lg font-semibold text-text">
            {t('admin.admins.pending')} · {pending.length}
          </h2>
          <ul className="mb-6 flex flex-col gap-2">
            {pending.map((p) => (
              <li
                key={p.deviceId}
                className="flex items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-semibold text-text">{p.name}</div>
                  <div className="text-xs text-muted">{[p.group, p.subgroup].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(p.deviceId, true)} disabled={pendingBusy !== null}>
                    {t('admin.admins.approve')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => decide(p.deviceId, false)} disabled={pendingBusy !== null}>
                    {t('admin.admins.reject')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <hr className="my-6 border-border" />
        </>
      )}

      <div className="flex items-center justify-between gap-4 py-3">
        <div>
          <div className="text-sm font-semibold text-text">{t('admin.admins.approval')}</div>
          <div className="text-xs text-muted">{t('admin.admins.approvalDesc')}</div>
        </div>
        <Switch
          checked={!!cfg?.requireApproval}
          onChange={toggleApproval}
          disabled={!cfg || busy}
          label={t('admin.admins.approval')}
        />
      </div>

      <hr className="my-6 border-border" />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-text">
          {t('admin.admins.adminsList')} · {roles.length}
        </h2>
        <Button size="sm" onClick={() => setAdding(true)}>
          {t('admin.admins.addAdmin')}
        </Button>
      </div>
      {rolesLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : roles.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.admins.noAdmins')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {roles.map((r) => (
            <li key={r.memberId} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-text">{r.name}</div>
                {(r.group || r.subgroup) && (
                  <div className="text-xs text-muted">{[r.group, r.subgroup].filter(Boolean).join(' · ')}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {t(`admin.roles.${r.role}`)}
                </span>
                <button
                  type="button"
                  onClick={() => removeRole(r.memberId)}
                  disabled={roleBusy !== null}
                  aria-label={t('admin.admins.remove')}
                  className="text-sm font-bold text-danger hover:opacity-70 disabled:opacity-40"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddAdminModal onClose={() => setAdding(false)} />}

      <hr className="my-6 border-border" />

      <h2 className="mb-3 font-display text-lg font-semibold text-text">{t('admin.admins.auditLog')}</h2>
      {!showAudit ? (
        <Button variant="secondary" onClick={() => setShowAudit(true)}>
          {t('admin.admins.loadAudit')}
        </Button>
      ) : auditLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : (auditData?.log.length ?? 0) === 0 ? (
        <p className="text-sm text-muted">{t('admin.admins.noAudit')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {auditData!.log.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold text-text">{e.action}</span>
                <span className="text-subtle">{new Date(e.ts).toLocaleString()}</span>
              </div>
              <div className="mt-0.5 text-muted">
                {e.adminName}
                {auditDetail(e.details) && <span className="text-subtle"> · {auditDetail(e.details)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <hr className="my-6 border-border" />

      <h2 className="mb-1 font-display text-lg font-semibold text-text">{t('admin.admins.backup')}</h2>
      <p className="mb-3 text-xs text-muted">{t('admin.admins.backupDesc')}</p>

      <Button variant="secondary" onClick={downloadBackup} disabled={backupBusy}>
        {t('admin.admins.download')}
      </Button>

      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
        <label className="text-sm font-semibold text-text">{t('admin.admins.restore')}</label>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => pickRestoreFile(e.target.files?.[0] ?? null)}
          className="text-xs text-muted file:mr-3 file:rounded-sm file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-text"
        />
        {restoreFile && (
          <div className="flex flex-wrap items-center gap-2">
            {!restoreArmed ? (
              <Button size="sm" variant="danger" onClick={() => setRestoreArmed(true)} disabled={restoreBusy}>
                {t('admin.admins.restore')}
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={runRestore} disabled={restoreBusy}>
                {t('admin.admins.restoreConfirm')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => pickRestoreFile(null)} disabled={restoreBusy}>
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function AddAdminModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const { data } = useRoster(true)
  const [search, setSearch] = useState('')
  const [memberId, setMemberId] = useState('')
  const [role, setRole] = useState<AdminRole>('leader')
  const [group, setGroup] = useState('')
  const [subgroup, setSubgroup] = useState('')
  const [saving, setSaving] = useState(false)

  const members = data?.members ?? []
  const candidates = checkinCandidates(members, search).slice(0, 50)
  const groups = groupsOf(members)
  const subgroups = subgroupsOf(members, group)
  const needsScope = roleNeedsScope(role)
  const valid = !!memberId && !!role && (!needsScope || !!group)

  async function save() {
    if (!valid) return
    setSaving(true)
    try {
      const payload: RoleAssignment = needsScope
        ? { memberId, role, group, subgroup, ministry: 'KM' }
        : { memberId, role, ministry: role === 'welcoming' ? 'KM' : '' }
      await setAdminRole(payload)
      await qc.invalidateQueries({ queryKey: ['adminRoles'] })
      toast({ title: t('admin.settings.saved'), tone: 'ok' })
      onClose()
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('admin.admins.addAdmin')}>
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.admins.member')}</span>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('admin.members.search')} className="mb-2" />
          <Select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">—</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {[m.group_name, m.subgroup].filter(Boolean).length ? ` (${[m.group_name, m.subgroup].filter(Boolean).join(' · ')})` : ''}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.admins.role')}</span>
          <Select value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`admin.roles.${r}`)}
              </option>
            ))}
          </Select>
        </label>
        {needsScope && (
          <>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.members.group')}</span>
              <Select value={group} onChange={(e) => { setGroup(e.target.value); setSubgroup('') }}>
                <option value="">—</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.members.subgroup')}</span>
              <Select value={subgroup} onChange={(e) => setSubgroup(e.target.value)} disabled={!group}>
                <option value="">{t('admin.filter.all')}</option>
                {subgroups.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button onClick={save} disabled={!valid || saving} className="flex-1">
          {saving ? t('common.loading') : t('admin.admins.addAdmin')}
        </Button>
      </div>
    </Dialog>
  )
}
