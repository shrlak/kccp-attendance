import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getConfig, getAdminRoles, getAuditLog, getPending, approvePending, rejectPending, updateSettings } from '../../lib/api'
import { sortAdminRoles, auditDetail } from './admins'
import { Switch } from '../../components/ui/Switch'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'

// Admins tab (super-admin): registration-approval toggle, the admin roster, and the
// audit log. Add/remove and pending-approval land in follow-ups.
export function AdminAdmins() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: cfg } = useQuery({ queryKey: ['config'], queryFn: getConfig })
  const { data: rolesData, isLoading: rolesLoading } = useQuery({ queryKey: ['adminRoles'], queryFn: getAdminRoles })
  const { data: pendingData } = useQuery({ queryKey: ['pending'], queryFn: getPending })
  const [pendingBusy, setPendingBusy] = useState<string | null>(null)
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

      <h2 className="mb-3 font-display text-lg font-semibold text-text">
        {t('admin.admins.adminsList')} · {roles.length}
      </h2>
      {rolesLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : roles.length === 0 ? (
        <p className="text-sm text-muted">{t('admin.admins.noAdmins')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {roles.map((r) => (
            <li key={r.memberId} className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2">
              <div>
                <div className="text-sm font-semibold text-text">{r.name}</div>
                {(r.group || r.subgroup) && (
                  <div className="text-xs text-muted">{[r.group, r.subgroup].filter(Boolean).join(' · ')}</div>
                )}
              </div>
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
                {t(`admin.roles.${r.role}`)}
              </span>
            </li>
          ))}
        </ul>
      )}

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
    </div>
  )
}
