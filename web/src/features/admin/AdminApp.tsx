import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { getPending } from '../../lib/api'
import { Button } from '../../components/ui/Button'
import { AdminToday } from './AdminToday'
import { AdminSheet } from './AdminSheet'
import { AdminMembers } from './AdminMembers'
import { AdminNewFamily } from './AdminNewFamily'
import { AdminDevices } from './AdminDevices'
import { AdminAdmins } from './AdminAdmins'
import { AdminSettings } from './AdminSettings'

type Tab = 'today' | 'sheet' | 'members' | 'newfamily' | 'devices' | 'admins' | 'settings'

// Authenticated admin layout: header (who/scope/sign-out) + tab nav. Settings is
// super-admin only. Today/Sheet/Members slot in as further tabs in later phases.
export function AdminApp() {
  const { t } = useTranslation()
  const identity = useAdminAuth((s) => s.identity)
  const signOut = useAdminAuth((s) => s.signOut)
  const [tab, setTab] = useState<Tab>('today')
  const isSuper = identity?.role === 'super_admin'
  const canDevices = identity?.role !== 'pastor'
  const { data: pending } = useQuery({ queryKey: ['pending'], queryFn: getPending, enabled: isSuper })
  const pendingCount = pending?.pending.length ?? 0

  const scopeLabel =
    identity && identity.role === 'leader'
      ? [identity.group, identity.subgroup].filter(Boolean).join(' · ')
      : t('admin.scopeAll')

  return (
    <main className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-canvas/90 px-5 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-display text-lg font-semibold text-text">{t('admin.title')}</div>
            <div className="text-xs text-muted">
              {identity ? t(`admin.roles.${identity.role}`) : ''}
              {identity ? ' · ' : ''}
              {scopeLabel}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            {t('admin.signOut')}
          </Button>
        </div>
        <nav className="mt-3 flex gap-1">
          <TabBtn active={tab === 'today'} onClick={() => setTab('today')}>
            {t('admin.nav.today')}
          </TabBtn>
          <TabBtn active={tab === 'sheet'} onClick={() => setTab('sheet')}>
            {t('admin.nav.sheet')}
          </TabBtn>
          <TabBtn active={tab === 'members'} onClick={() => setTab('members')}>
            {t('admin.nav.members')}
          </TabBtn>
          <TabBtn active={tab === 'newfamily'} onClick={() => setTab('newfamily')}>
            {t('admin.nav.newfamily')}
          </TabBtn>
          {canDevices && (
            <TabBtn active={tab === 'devices'} onClick={() => setTab('devices')}>
              {t('admin.nav.devices')}
            </TabBtn>
          )}
          {isSuper && (
            <TabBtn active={tab === 'admins'} onClick={() => setTab('admins')} badge={pendingCount}>
              {t('admin.nav.admins')}
            </TabBtn>
          )}
          {isSuper && (
            <TabBtn active={tab === 'settings'} onClick={() => setTab('settings')}>
              {t('admin.nav.settings')}
            </TabBtn>
          )}
        </nav>
      </header>

      <div className="px-5 py-4">
        {tab === 'today' && <AdminToday />}
        {tab === 'sheet' && <AdminSheet />}
        {tab === 'members' && <AdminMembers />}
        {tab === 'newfamily' && <AdminNewFamily />}
        {tab === 'devices' && canDevices && <AdminDevices />}
        {tab === 'admins' && isSuper && <AdminAdmins />}
        {tab === 'settings' && isSuper && <AdminSettings />}
      </div>
    </main>
  )
}

function TabBtn({
  active,
  onClick,
  children,
  badge = 0,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'relative min-h-9 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ' +
        (active ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface-alt hover:text-text')
      }
    >
      {children}
      {badge > 0 && (
        <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  )
}
