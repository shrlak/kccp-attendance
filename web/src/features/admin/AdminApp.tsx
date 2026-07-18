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
  GraduationCap,
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
import { AdminNewFamilyEdu } from './AdminNewFamilyEdu'
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
  | 'newfamilyEdu'
  | 'visitors'
  | 'admins'
  | 'dongsan'
  | 'settings'

// Compact administration shell: a 64 px icon rail expands only when someone needs its
// labels, keeping the attendance workspace visually quiet on desktop and tablet.
export function AdminApp() {
  const { t } = useTranslation()
  const lang = useLang((s) => s.lang)
  const navigate = useNavigate()
  const identity = useAdminAuth((s) => s.identity)
  const signOut = useAdminAuth((s) => s.signOut)
  const [tab, setTab] = useState<Tab>('today')
  const [kiosk, setKiosk] = useState(false)
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
    { id: 'newfamilyEdu', icon: GraduationCap, show: true },
    { id: 'visitors', icon: DoorOpen, show: true },
    { id: 'admins', icon: Shield, show: isSuper, badge: pendingCount },
    { id: 'dongsan', icon: Sprout, show: isSuper },
    { id: 'settings', icon: Settings, show: isSuper },
  ]

  return (
    <div className="min-h-dvh bg-canvas">
      <aside
        className={
          'fixed inset-y-0 left-0 z-30 flex flex-col overflow-hidden border-r border-border bg-canvas/[0.92] backdrop-blur-xl transition-[width] duration-200 ease-out ' +
          (navOpen ? 'w-60' : 'w-16')
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
            <KccpMark size={24} />
          </span>
          <div className={'whitespace-nowrap transition-opacity duration-150 ' + (navOpen ? 'opacity-100' : 'opacity-0')}>
            <div className="text-sm font-semibold tracking-tight text-text">KCCP</div>
            <div className="mt-0.5 text-[10px] font-medium text-muted">{t('admin.workspace')}</div>
          </div>
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

      <main className="min-h-dvh pl-16">
        <header className="sticky top-0 z-20 border-b border-border bg-canvas/[0.82] px-5 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-semibold tracking-tight text-text">{t(`admin.nav.${tab}`)}</h1>
              <p className="mt-0.5 truncate text-xs text-muted">{dateLabel} · {roleScope}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <ThemeLangToggle />
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

        <div className="mx-auto max-w-[1480px] px-5 py-5 md:px-8 md:py-7">
          {tab === 'today' && <AdminToday />}
          {tab === 'sheet' && <AdminSheet />}
          {tab === 'members' && <AdminMembers />}
          {tab === 'analytics' && <AdminAnalytics />}
          {tab === 'newfamily' && <AdminNewFamily />}
          {tab === 'newfamilyEdu' && <AdminNewFamilyEdu />}
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
      {active && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />}
      <span className="grid w-16 shrink-0 place-items-center">
        <span className="relative">
          <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
          {badge > 0 && (
            <span className="absolute -right-2.5 -top-2.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
      </span>
      <span className={'whitespace-nowrap pr-3 transition-opacity duration-150 ' + (open ? 'opacity-100' : 'opacity-0')}>
        {label}
      </span>
    </button>
  )
}
