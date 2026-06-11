import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { getPending } from '../../lib/api'
import { Button } from '../../components/ui/Button'
import {
  type LucideIcon,
  CalendarCheck,
  ClipboardList,
  Users,
  BarChart3,
  UserPlus,
  Smartphone,
  Shield,
  Sprout,
  Medal,
  Settings,
} from '../../components/ui/Icon'
import { KccpMark } from '../checkin/KccpMark'
import { AdminToday } from './AdminToday'
import { AdminSheet } from './AdminSheet'
import { AdminMembers } from './AdminMembers'
import { AdminAnalytics } from './AdminAnalytics'
import { AdminNewFamily } from './AdminNewFamily'
import { AdminDevices } from './AdminDevices'
import { AdminAdmins } from './AdminAdmins'
import { AdminDongsan } from './AdminDongsan'
import { AdminOfficers } from './AdminOfficers'
import { AdminSettings } from './AdminSettings'
import { KioskView } from '../kiosk/KioskView'

type Tab =
  | 'today'
  | 'sheet'
  | 'members'
  | 'analytics'
  | 'newfamily'
  | 'devices'
  | 'admins'
  | 'dongsan'
  | 'officers'
  | 'settings'

// Authenticated admin layout: a left icon rail that expands to show labels on hover
// (the nav) + a main column with a contextual header. Settings/Admins/Dongsan are
// super-admin only; Devices is hidden from pastors.
export function AdminApp() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const identity = useAdminAuth((s) => s.identity)
  const signOut = useAdminAuth((s) => s.signOut)
  const [tab, setTab] = useState<Tab>('today')
  const [kiosk, setKiosk] = useState(false)
  // Rail expansion is state-driven (not pure CSS hover/focus) so selecting a tab can
  // collapse it immediately — even while the pointer is still over the rail or the
  // clicked button keeps focus. It re-expands on the next hover / keyboard focus.
  const [navOpen, setNavOpen] = useState(false)
  function selectTab(id: Tab) {
    setTab(id)
    setNavOpen(false)
  }
  // Sign out drops back to the public landing page.
  function handleSignOut() {
    signOut()
    navigate('/')
  }
  const isSuper = identity?.role === 'super_admin'
  const canDevices = identity?.role !== 'pastor'
  // Pastors are read-only and can't check anyone in, so they don't get the kiosk.
  const canKiosk = identity?.role !== 'pastor'
  const { data: pending } = useQuery({ queryKey: ['pending'], queryFn: getPending, enabled: isSuper })
  const pendingCount = pending?.pending.length ?? 0

  const scopeLabel =
    identity && identity.role === 'leader'
      ? [identity.group, identity.subgroup].filter(Boolean).join(' · ')
      : t('admin.scopeAll')

  // One row per tab; `show` gates by role, `badge` surfaces the pending-approval count.
  const tabs: { id: Tab; icon: LucideIcon; show: boolean; badge?: number }[] = [
    { id: 'today', icon: CalendarCheck, show: true },
    { id: 'sheet', icon: ClipboardList, show: true },
    { id: 'members', icon: Users, show: true },
    { id: 'analytics', icon: BarChart3, show: true },
    { id: 'newfamily', icon: UserPlus, show: true },
    { id: 'devices', icon: Smartphone, show: canDevices },
    { id: 'admins', icon: Shield, show: isSuper, badge: pendingCount },
    { id: 'dongsan', icon: Sprout, show: isSuper },
    { id: 'officers', icon: Medal, show: isSuper },
    { id: 'settings', icon: Settings, show: isSuper },
  ]

  return (
    <div className="min-h-dvh">
      {/* Left rail: icons only until hover/keyboard focus expands it to reveal labels;
          selecting a tab collapses it again. It's fixed (overlays content on expand)
          so the main column never reflows. */}
      <aside
        className={
          'fixed inset-y-0 left-0 z-30 flex flex-col overflow-hidden border-r border-border bg-canvas/95 backdrop-blur transition-all duration-200 ease-out ' +
          (navOpen ? 'w-60 shadow-xl' : 'w-16')
        }
        onMouseEnter={() => setNavOpen(true)}
        onMouseLeave={() => setNavOpen(false)}
        onFocusCapture={() => setNavOpen(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setNavOpen(false)
        }}
      >
        <div className="flex h-16 shrink-0 items-center pt-[env(safe-area-inset-top)]">
          <span className="grid w-16 shrink-0 place-items-center">
            <span className="grid size-9 place-items-center rounded-xl bg-white shadow-sm">
              <KccpMark size={22} />
            </span>
          </span>
          <span
            className={
              'whitespace-nowrap font-display text-base font-semibold text-text transition-opacity duration-200 ' +
              (navOpen ? 'opacity-100' : 'opacity-0')
            }
          >
            {t('admin.pageTitle')}
          </span>
        </div>
        <nav aria-label={t('admin.pageTitle')} className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden py-2">
          {tabs
            .filter((item) => item.show)
            .map((item) => (
              <TabItem
                key={item.id}
                icon={item.icon}
                label={t(`admin.nav.${item.id}`)}
                active={tab === item.id}
                open={navOpen}
                onClick={() => selectTab(item.id)}
                badge={item.badge}
              />
            ))}
        </nav>
      </aside>

      {/* Main column — pl-16 reserves the collapsed rail's width. */}
      <main className="min-h-dvh pl-16">
        <header className="sticky top-0 z-10 border-b border-border bg-canvas/90 px-5 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-display text-lg font-semibold text-text">{t(`admin.nav.${tab}`)}</div>
              <div className="truncate text-xs text-muted">
                {identity ? t(`admin.roles.${identity.role}`) : ''}
                {identity ? ' · ' : ''}
                {scopeLabel}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canKiosk && (
                <Button variant="secondary" size="sm" onClick={() => setKiosk(true)}>
                  {t('kiosk.enter')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                {t('admin.signOut')}
              </Button>
            </div>
          </div>
        </header>

        <div className="px-5 py-4">
          {tab === 'today' && <AdminToday />}
          {tab === 'sheet' && <AdminSheet />}
          {tab === 'members' && <AdminMembers />}
          {tab === 'analytics' && <AdminAnalytics />}
          {tab === 'newfamily' && <AdminNewFamily />}
          {tab === 'devices' && canDevices && <AdminDevices />}
          {tab === 'admins' && isSuper && <AdminAdmins />}
          {tab === 'dongsan' && isSuper && <AdminDongsan />}
          {tab === 'officers' && isSuper && <AdminOfficers />}
          {tab === 'settings' && isSuper && <AdminSettings />}
        </div>
      </main>

      {kiosk && canKiosk && <KioskView onExit={() => setKiosk(false)} />}
    </div>
  )
}

function TabItem({
  icon: Icon,
  label,
  active,
  open,
  onClick,
  badge = 0,
}: {
  icon: LucideIcon
  label: string
  active: boolean
  open: boolean
  onClick: () => void
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={
        'relative flex w-full items-center py-2.5 text-sm font-semibold transition-colors ' +
        (active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-surface-alt hover:text-text')
      }
    >
      {/* Active accent on the rail's edge, stays put whether collapsed or expanded. */}
      {active && (
        <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />
      )}
      {/* Icon sits in a rail-width slot so it stays centered while collapsed. */}
      <span className="grid w-16 shrink-0 place-items-center">
        <span className="relative">
          <Icon className="size-5" strokeWidth={2} aria-hidden />
          {badge > 0 && (
            <span className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
      </span>
      <span className={'whitespace-nowrap pr-3 transition-opacity duration-200 ' + (open ? 'opacity-100' : 'opacity-0')}>
        {label}
      </span>
    </button>
  )
}
