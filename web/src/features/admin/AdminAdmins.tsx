import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getConfig,
  getAdminRoles,
  getAuditLog,
  getLoginLog,
  getPending,
  approvePending,
  rejectPending,
  updateSettings,
  setAdminRole,
  removeAdminRole,
  getBackup,
  postRestore,
  getClearPending,
  approveClear,
  rejectClear,
  runDbBackupNow,
  listDbBackups,
  getDbBackupDownloadUrl,
  restoreDbBackup,
  type AdminRole,
  type RoleAssignment,
  type DbBackupEntry,
} from '../../lib/api'
import {
  sortAdminRoles,
  auditDetail,
  roleNeedsScope,
  backupFilename,
  formatBytes,
  backupTotalSize,
  formatBackupTimestamp,
  storagePercent,
  formatStoragePercent,
} from './admins'
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

type DbRestoreTarget = { source: 'online'; key: string; date: string } | { source: 'upload'; file: File }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'))
    reader.readAsDataURL(file)
  })
}

// Admins tab (super-admin): registration-approval toggle, pending queue, the admin
// roster with add/remove, and the audit log.
export function AdminAdmins() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const { data: rolesData, isLoading: rolesLoading } = useQuery({ queryKey: ['adminRoles'], queryFn: getAdminRoles })
  const { data: pendingData } = useQuery({ queryKey: ['pending'], queryFn: getPending })
  const { data: clearPending } = useQuery({ queryKey: ['clearPending'], queryFn: getClearPending })
  const [clearBusy, setClearBusy] = useState(false)
  const [pendingBusy, setPendingBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [roleBusy, setRoleBusy] = useState<string | null>(null)
  const [showAudit, setShowAudit] = useState(false)
  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['audit'],
    queryFn: () => getAuditLog(100),
    enabled: showAudit,
  })
  const [showLogins, setShowLogins] = useState(false)
  const { data: loginData, isLoading: loginLoading } = useQuery({
    queryKey: ['loginLog'],
    queryFn: () => getLoginLog(100),
    enabled: showLogins,
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

  // ── Off-site encrypted DB backup (scripts/backup/) ──────────────────────
  const dbRestoreFileRef = useRef<HTMLInputElement>(null)
  const [showDbBackups, setShowDbBackups] = useState(false)
  const { data: dbBackupsData, isLoading: dbBackupsLoading } = useQuery({
    queryKey: ['dbBackups'],
    queryFn: listDbBackups,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
  const [dbBackupRunBusy, setDbBackupRunBusy] = useState(false)
  const [dbRestoreTarget, setDbRestoreTarget] = useState<DbRestoreTarget | null>(null)

  async function runDbBackup() {
    setDbBackupRunBusy(true)
    try {
      await runDbBackupNow()
      toast({ title: t('admin.admins.dbBackup.dispatched'), tone: 'ok' })
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    } finally {
      setDbBackupRunBusy(false)
    }
  }

  async function downloadDbBackup(key: string) {
    try {
      const { url } = await getDbBackupDownloadUrl(key)
      window.open(url, '_blank')
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    }
  }

  function pickDbRestoreFile(file: File | null) {
    if (file) setDbRestoreTarget({ source: 'upload', file })
    if (dbRestoreFileRef.current) dbRestoreFileRef.current.value = ''
  }

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

  async function clearDecide(approve: boolean) {
    setClearBusy(true)
    try {
      if (approve) {
        await approveClear()
        await qc.invalidateQueries({ queryKey: ['roster'] })
      } else {
        await rejectClear()
      }
      await qc.invalidateQueries({ queryKey: ['clearPending'] })
      toast({ title: t(approve ? 'admin.sheet.clearAll.cleared' : 'admin.admins.clearReq.rejected'), tone: 'ok' })
    } catch {
      toast({ title: t('common.error'), tone: 'err' })
    } finally {
      setClearBusy(false)
    }
  }

  const roles = sortAdminRoles(rolesData?.roles ?? [])
  const pending = pendingData?.pending ?? []
  const clearReqs = clearPending ?? []
  const currentBackup = dbBackupsData?.backups[0]
  const currentBackupSize = currentBackup ? backupTotalSize(currentBackup) : undefined
  const currentBackupTime = formatBackupTimestamp(currentBackup?.updatedAt, i18n.resolvedLanguage || i18n.language)

  return (
    <div className="w-full">
      {clearReqs.length > 0 && (
        <>
          <h2 className="mb-2 font-display text-lg font-semibold text-text">{t('admin.admins.clearReq.title')}</h2>
          <div className="mb-6 rounded-lg border border-danger/40 bg-danger/5 px-3 py-3">
            <p className="mb-2 text-xs text-muted">
              {t('admin.admins.clearReq.by', { name: clearReqs.map((r) => r.requestedByName).join(', ') })}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="danger" onClick={() => clearDecide(true)} disabled={clearBusy}>
                {t('admin.admins.clearReq.approve')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => clearDecide(false)} disabled={clearBusy}>
                {t('admin.admins.clearReq.reject')}
              </Button>
            </div>
          </div>
          <hr className="my-6 border-border" />
        </>
      )}
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
                  className="-my-2 grid min-h-11 min-w-11 place-items-center rounded-full text-base font-bold text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
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

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-text">{t('admin.admins.auditLog')}</h2>
        {showAudit && (
          <Button variant="ghost" size="sm" onClick={() => setShowAudit(false)}>
            {t('admin.admins.collapse')}
          </Button>
        )}
      </div>
      {!showAudit ? (
        <Button variant="secondary" onClick={() => setShowAudit(true)}>
          {t('admin.admins.loadAudit')}
        </Button>
      ) : auditLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : (auditData?.log.length ?? 0) === 0 ? (
        <p className="text-sm text-muted">{t('admin.admins.noAudit')}</p>
      ) : (
        <ul className="fx-rise flex flex-col gap-1.5">
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

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-text">{t('admin.admins.loginLog')}</h2>
        {showLogins && (
          <Button variant="ghost" size="sm" onClick={() => setShowLogins(false)}>
            {t('admin.admins.collapse')}
          </Button>
        )}
      </div>
      {!showLogins ? (
        <Button variant="secondary" onClick={() => setShowLogins(true)}>
          {t('admin.admins.loadLogins')}
        </Button>
      ) : loginLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : (loginData?.log.length ?? 0) === 0 ? (
        <p className="text-sm text-muted">{t('admin.admins.noLogins')}</p>
      ) : (
        <ul className="fx-rise flex flex-col gap-1.5">
          {loginData!.log.map((e, i) => (
            <li key={`${e.ts}-${i}`} className="rounded-md border border-border bg-surface px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-text">
                  {e.memberName || t('admin.admins.sharedLogin')}
                  <span className="ml-1.5 rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-primary">
                    {t(`admin.roles.${e.role}`)}
                  </span>
                </span>
                <span className="text-subtle">{new Date(e.ts).toLocaleString()}</span>
              </div>
              <div className="mt-0.5 font-mono text-muted">
                {e.ip || '—'}
                <span className="text-subtle"> · {t(`admin.admins.method.${e.method}`)}</span>
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
          className="text-xs text-muted file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-xs file:font-semibold file:text-text hover:file:bg-surface-alt"
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

      <hr className="my-6 border-border" />

      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="font-display text-lg font-semibold text-text">{t('admin.admins.dbBackup.title')}</h2>
        {currentBackup && currentBackupSize != null && currentBackupTime && (
          <span className="font-mono text-xs tabular-nums text-subtle" aria-live="polite">
            {t('admin.dbBackupCurrentMeta', { size: formatBytes(currentBackupSize), time: currentBackupTime })}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-muted">{t('admin.dbBackupCurrentDesc')}</p>

      {dbBackupsData?.storage && (
        <div className="mb-3 rounded-lg border border-border bg-surface p-3">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
            <span className="font-semibold text-text">{t('admin.admins.dbBackup.storage')}</span>
            <span className="font-mono tabular-nums text-subtle">
              {t('admin.admins.dbBackup.storageUsage', {
                used: formatBytes(dbBackupsData.storage.usedBytes),
                limit: formatBytes(dbBackupsData.storage.limitBytes),
                percent: formatStoragePercent(dbBackupsData.storage.usedBytes, dbBackupsData.storage.limitBytes),
              })}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-border"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(storagePercent(dbBackupsData.storage.usedBytes, dbBackupsData.storage.limitBytes))}
            aria-label={t('admin.admins.dbBackup.storage')}
          >
            {/* Keep a visible sliver for any nonzero usage — real backups are a few
                hundred KB against a 10 GB allowance and would otherwise render 0px. */}
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{
                width: `${Math.max(
                  storagePercent(dbBackupsData.storage.usedBytes, dbBackupsData.storage.limitBytes),
                  dbBackupsData.storage.usedBytes > 0 ? 1 : 0,
                )}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={runDbBackup} disabled={dbBackupRunBusy}>
          {dbBackupRunBusy ? t('common.loading') : t('admin.admins.dbBackup.runNow')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setShowDbBackups((v) => !v)}>
          {showDbBackups ? t('admin.admins.dbBackup.hideList') : t('admin.admins.dbBackup.showList')}
        </Button>
      </div>

      {showDbBackups && (
        <div className="mt-3">
          {dbBackupsLoading ? (
            <p className="text-sm text-muted">{t('common.loading')}</p>
          ) : !dbBackupsData?.backups.length ? (
            <p className="text-sm text-muted">{t('admin.admins.dbBackup.none')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {dbBackupsData.backups.map((b: DbBackupEntry) => {
                const size = backupTotalSize(b)
                const time = formatBackupTimestamp(b.updatedAt, i18n.resolvedLanguage || i18n.language)
                return (
                <li key={b.sqlKey ?? b.date} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs">
                  <span className="font-semibold text-text">
                    {time || b.date}
                    {size != null && <span className="ml-2 font-normal text-subtle">{formatBytes(size)}</span>}
                  </span>
                  {b.sqlKey && (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => downloadDbBackup(b.sqlKey!)}>
                        {t('admin.admins.dbBackup.download')}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDbRestoreTarget({ source: 'online', key: b.sqlKey!, date: time || b.date })}>
                        {t('admin.admins.dbBackup.restore')}
                      </Button>
                    </div>
                  )}
                </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3">
        <label className="text-sm font-semibold text-text">{t('admin.admins.dbBackup.restoreFromFile')}</label>
        <input
          ref={dbRestoreFileRef}
          type="file"
          accept=".age"
          onChange={(e) => pickDbRestoreFile(e.target.files?.[0] ?? null)}
          className="text-xs text-muted file:mr-3 file:cursor-pointer file:rounded-full file:border file:border-border file:bg-surface file:px-4 file:py-2 file:text-xs file:font-semibold file:text-text hover:file:bg-surface-alt"
        />
      </div>

      {dbRestoreTarget && <RestoreDbDialog target={dbRestoreTarget} onClose={() => setDbRestoreTarget(null)} />}
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

// Confirms + runs a destructive DB-level restore (see /api/admin/db-backup/restore).
// Stronger gate than the JSON restore above: a private key must be typed in fresh (it is
// never stored anywhere, client or server) and the literal word RESTORE must be typed to
// enable the button, on top of this already only being reachable via its own confirm step.
function RestoreDbDialog({ target, onClose }: { target: DbRestoreTarget; onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const [privateKey, setPrivateKey] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)

  const valid = privateKey.trim().startsWith('AGE-SECRET-KEY-1') && confirmText === 'RESTORE'

  async function run() {
    if (!valid) return
    setBusy(true)
    try {
      const fileBase64 = target.source === 'upload' ? await fileToBase64(target.file) : undefined
      const result = await restoreDbBackup({
        source: target.source,
        key: target.source === 'online' ? target.key : undefined,
        fileBase64,
        privateKey: privateKey.trim(),
        confirm: confirmText,
      })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['roster'] }),
        qc.invalidateQueries({ queryKey: ['config'] }),
        qc.invalidateQueries({ queryKey: ['adminRoles'] }),
        qc.invalidateQueries({ queryKey: ['pending'] }),
        qc.invalidateQueries({ queryKey: ['dbBackups'] }),
      ])
      toast({ title: t('admin.admins.dbBackup.restored', { count: result.tables }), tone: 'ok' })
      onClose()
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()} title={t('admin.admins.dbBackup.restoreTitle')}>
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-xs text-danger">
          {t('admin.admins.dbBackup.restoreWarning')}
        </div>
        <p className="text-xs text-muted">
          {target.source === 'online'
            ? t('admin.admins.dbBackup.restoreFromOnline', { date: target.date })
            : t('admin.admins.dbBackup.restoreFromUpload', { name: target.file.name })}
        </p>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.admins.dbBackup.privateKey')}</span>
          <textarea
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="AGE-SECRET-KEY-1..."
            rows={3}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-text outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <span className="mt-1 block text-[11px] text-subtle">{t('admin.admins.dbBackup.privateKeyHint')}</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-subtle">{t('admin.admins.dbBackup.confirmPhrase', { phrase: 'RESTORE' })}</span>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE" />
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button variant="danger" onClick={run} disabled={!valid || busy} className="flex-1">
          {busy ? t('common.loading') : t('admin.admins.dbBackup.restoreConfirm')}
        </Button>
      </div>
    </Dialog>
  )
}
