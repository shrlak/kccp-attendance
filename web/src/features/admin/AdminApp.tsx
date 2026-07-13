import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { useLang } from '../../stores/useLang'
import { getPending } from '../../lib/api'
import { Button } from '../../components/ui/Button'
import { ThemeLangToggle } from '../../components/ui/ThemeLangToggle'
import {
  type LucideIcon,
  CalendarCheck,
  ClipboardList,
  Users,
  BarChart3,
  UserPlus,
  DoorOpen,
  Shield,
  Sprout,
  Settings,
} from '../../components/ui/Icon'
import { KccpMark } from '../checkin/KccpMark'
import { AdminToday } from './AdminToday'
import { AdminSheet } from './AdminSheet'
import { AdminMembers } from './AdminMembers'
import { AdminAnalytics } from './AdminAnalytics'
import { AdminNewFamily } from './AdminNewFamily'
import { AdminVisitors } from './AdminVisitors'
import { AdminAdmins } from './AdminAdmins'
import { AdminDongsan } from './AdminDongsan'
import { AdminSettings } from './AdminSettings'
import { KioskView } from '../kiosk/KioskView'

type Tab =
  | 'today'
  | 'sheet'
  | 'members'
  | 'analytics'
  | 'newfamily'
  | 'visitors'
  | 'admins'
  | 'dongsan'
  | 'settings'

// Authenticated ministry workspace. Navigation stays visible on desktop and becomes a
// horizontally scrollable work bar on smaller church tablets and phones.
export function AdminApp() {
  const { t } = useTranslation()
  const lang = useLang((s) => s.lang)
  const navigate = useNavigate()
  const identity = useAdminAuth((s) => s.identity)
  const signOut = useAdminAuth((s) => s.signOut)
  const [tab, setTab] = useState<Tab>('today')
  const [kiosk, setKiosk] = useState(false)
  function selectTab(id: Tab) {
    setTab(id)
  }
  // Sign out drops back to the public landing page.
  function handleSignOut() {
    signOut()
    navigate('/')
  }
  const isSuper = identity?.role === 'super_admin'
  // A password-only (break-glass) login on an unroled device resolves to the 'staff'
  // role — surfaced as a plain badge in the header so it's clear this is a limited login.
  const isStaff = identity?.role === 'staff'
  // Pastors are read-only and can't check anyone in, so they don't get the kiosk.
  const canKiosk = identity?.role !== 'pastor'
  const { data: pending } = useQuery({ queryKey: ['pending'], queryFn: getPending, enabled: isSuper })
  const pendingCount = pending?.pending.length ?? 0

  // A scoped (roled-device) leader shows their 부서·동산; a break-glass leader/welcoming
  // password login has no group/동산 and sees the whole roster, so it shows "All".
  const scopeLabel =
    identity && identity.role === 'leader' && identity.group
      ? [identity.group, identity.subgroup].filter(Boolean).join(' · ')
      : t('admin.scopeAll')
  const roleLabel = identity && !isStaff ? t(`admin.roles.${identity.role}`) : t('admin.roles.staff')
  const roleScope = `${roleLabel} · ${scopeLabel}`
  const dateLabel = new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'America/New_York',
  }).format(new Date())

  // One row per tab; `show` gates by role, `badge` surfaces the pending-approval count.
  const tabs: { id: Tab; icon: LucideIcon; show: boolean; badge?: number }[] = [
    { id: 'today', icon: CalendarCheck, show: true },
    { id: 'sheet', icon: ClipboardList, show: true },
    { id: 'members', icon: Users, show: true },
    { id: 'analytics', icon: BarChart3, show: true },
    { id: 'newfamily', icon: UserPlus, show: true },
    { id: 'visitors', icon: DoorOpen, show: true },
    { id: 'admins', icon: Shield, show: isSuper, badge: pendingCount },
    { id: 'dongsan', icon: Sprout, show: isSuper },
    { id: 'settings', icon: Settings, show: isSuper },
  ]

  return (
    <div className="min-h-dvh bg-canvas">
      <aside className="sticky top-0 z-30 flex flex-col border-b border-nav-border bg-nav text-white md:fixed md:inset-y-0 md:left-0 md:w-[248px] md:border-b-0 md:border-r">
        <div className="flex h-16 shrink-0 items-center justify-between px-4 pt-[env(safe-area-inset-top)] md:h-auto md:justify-start md:gap-3 md:px-6 md:pb-7 md:pt-8">
          <KccpMark size={32} />
          <div>
            <div className="text-sm font-bold leading-none tracking-tight">KCCP</div>
            <div className="mt-1 text-[10px] font-semibold tracking-[0.08em] text-nav-muted">{t('admin.workspace')}</div>
          </div>
          <div className="ml-auto flex items-center gap-1 md:hidden">
            <ThemeLangToggle />
          </div>
        </div>

        <div className="hidden px-6 pb-3 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-nav-muted md:block">
          {t('admin.serviceOps')}
        </div>
        <nav aria-label={t('admin.pageTitle')} className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-1 md:overflow-y-auto md:px-3 md:pb-5">
          {tabs
            .filter((item) => item.show)
            .map((item) => (
              <TabItem
                key={item.id}
                icon={item.icon}
                label={t(`admin.nav.${item.id}`)}
                active={tab === item.id}
                onClick={() => selectTab(item.id)}
                badge={item.badge}
              />
            ))}
        </nav>

        <div className="hidden border-t border-nav-border px-5 py-5 md:block">
          <div className="text-xs font-semibold text-white">{roleScope}</div>
          <button type="button" onClick={handleSignOut} className="mt-3 text-xs font-semibold text-nav-muted hover:text-white">
            {t('admin.signOut')}
          </button>
        </div>
      </aside>

      <main className="min-h-dvh md:pl-[248px]">
        <header className="sticky top-[7.25rem] z-20 border-b border-border bg-canvas/95 px-5 py-4 backdrop-blur md:top-0 md:px-8 md:py-5 md:pt-[calc(1.25rem+env(safe-area-inset-top))]">
          <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="section-kicker hidden sm:block">{dateLabel}</div>
              <h1 className="mt-1 truncate font-display text-xl font-bold tracking-[-0.02em] text-text md:text-2xl">{t(`admin.nav.${tab}`)}</h1>
              <p className="mt-1 hidden truncate text-xs text-muted sm:block">{t(`admin.navHelp.${tab}`)} · {roleScope}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="hidden md:contents"><ThemeLangToggle /></span>
              {canKiosk && (
                <Button size="sm" onClick={() => setKiosk(true)}>
                  {t('kiosk.enter')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleSignOut} className="md:hidden">
                {t('admin.signOut')}
              </Button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1480px] px-5 py-6 md:px-8 md:py-8">
          {tab === 'today' && <AdminToday />}
          {tab === 'sheet' && <AdminSheet />}
          {tab === 'members' && <AdminMembers />}
          {tab === 'analytics' && <AdminAnalytics />}
          {tab === 'newfamily' && <AdminNewFamily />}
          {tab === 'visitors' && <AdminVisitors />}
          {tab === 'admins' && isSuper && <AdminAdmins />}
          {tab === 'dongsan' && isSuper && <AdminDongsan />}
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
  onClick,
  badge = 0,
}: {
  icon: LucideIcon
  label: string
  active: boolean
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
        'relative flex min-w-fit shrink-0 items-center gap-2.5 rounded-sm px-3 py-2.5 text-sm font-semibold transition-colors md:w-full ' +
        (active ? 'bg-white/[0.12] text-white' : 'text-nav-muted hover:bg-white/[0.07] hover:text-white')
      }
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center">
        <span className="relative">
          <Icon className="size-[18px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
          {badge > 0 && (
            <span className="absolute -right-2.5 -top-2.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
