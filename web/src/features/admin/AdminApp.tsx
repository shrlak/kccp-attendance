import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { Button } from '../../components/ui/Button'
import { AdminToday } from './AdminToday'
import { AdminRoster } from './AdminRoster'
import { AdminSettings } from './AdminSettings'

type Tab = 'today' | 'roster' | 'settings'

// Authenticated admin layout: header (who/scope/sign-out) + tab nav. Settings is
// super-admin only. Today/Sheet/Members slot in as further tabs in later phases.
export function AdminApp() {
  const { t } = useTranslation()
  const identity = useAdminAuth((s) => s.identity)
  const signOut = useAdminAuth((s) => s.signOut)
  const [tab, setTab] = useState<Tab>('today')
  const isSuper = identity?.role === 'super_admin'

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
          <TabBtn active={tab === 'roster'} onClick={() => setTab('roster')}>
            {t('admin.nav.roster')}
          </TabBtn>
          {isSuper && (
            <TabBtn active={tab === 'settings'} onClick={() => setTab('settings')}>
              {t('admin.nav.settings')}
            </TabBtn>
          )}
        </nav>
      </header>

      <div className="px-5 py-4">
        {tab === 'today' && <AdminToday />}
        {tab === 'roster' && <AdminRoster />}
        {tab === 'settings' && isSuper && <AdminSettings />}
      </div>
    </main>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'min-h-9 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ' +
        (active ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface-alt hover:text-text')
      }
    >
      {children}
    </button>
  )
}
