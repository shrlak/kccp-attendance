import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../../stores/useAdminAuth'
import { useLang } from '../../stores/useLang'
import { runDbBackupNow } from '../../lib/api'
import { Button } from '../../components/ui/Button'
import { BottomNav } from '../../components/ui/BottomNav'
import { Dialog } from '../../components/ui/Dialog'
import { ThemeLangToggle } from '../../components/ui/ThemeLangToggle'
import { useToast } from '../../components/ui/Toast'
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
  MoreHorizontal,
  LogOut,
  Save,
  Monitor,
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
import { useAttendanceLive } from '../../lib/live'
import { readLastTab, writeLastTab, clearLastTab, type Tab } from './adminTab'
import { prefetchPanelExtrasOnIdle } from '../../app/prefetch'

// Compact administration shell. Desktop (lg+) keeps the 64 px icon rail that expands
// only when someone needs its labels; below lg the rail (hover-driven, so useless on
// touch) is replaced by a bottom tab bar — the 4 everyday tabs plus a 더보기 sheet for
// the rest — per mobile navigation conventions.
export function AdminApp() {
  const { t } = useTranslation()
  const toast = useToast()
  const lang = useLang((s) => s.lang)
  const navigate = useNavigate()
  const identity = useAdminAuth((s) => s.identity)
  const signOut = useAdminAuth((s) => s.signOut)
  // Restored from the last visit in this browser tab, so a reload (or the Google OAuth
  // round-trip) comes back to the same screen instead of 오늘.
  const [tab, setTab] = useState<Tab>(() => readLastTab() ?? 'today')
  const [kiosk, setKiosk] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  // Live cross-device sync for every admin tab: a kiosk check-in, another admin's
  // 출석부 entry or a member-record edit refetches the roster here immediately, so the
  // 출석부 and each member's 출석기록 never show different attendance.
  useAttendanceLive()
  // Every tab already ships inside this chunk; Chart.js (분석) is the one thing that would
  // still have to download on a tab switch, so pull it once the panel is idle.
  useEffect(prefetchPanelExtrasOnIdle, [])
  function selectTab(id: Tab) {
    setTab(id)
    writeLastTab(id)
    setNavOpen(false)
    setMoreOpen(false)
  }
  // Sign out drops back to the public landing page, and forgets which tab we were on.
  function handleSignOut() {
    clearLastTab()
    signOut()
    navigate('/')
  }
  const isSuper = identity?.role === 'super_admin'
  // A password-only (break-glass) login on an unroled device resolves to the 'staff'
  // role — surfaced as a plain badge in the header so it's clear this is a limited login.
  const isStaff = identity?.role === 'staff'
  // Pastors are read-only and can't check anyone in, so they don't get the kiosk.
  const canKiosk = identity?.role !== 'pastor'
  // Leaders/새가족팀/break-glass staff get just the "run a backup now" trigger from
  // anywhere in the panel — everything else in the full off-site backup UI (listing,
  // downloading, restoring) stays behind the super-admin-only Admins tab.
  const canRunBackup = identity?.role === 'leader' || identity?.role === 'welcoming' || isStaff

  async function runBackup() {
    setBackupBusy(true)
    try {
      await runDbBackupNow()
      toast({ title: t('admin.admins.dbBackup.dispatched'), tone: 'ok' })
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : t('common.error'), tone: 'err' })
    } finally {
      setBackupBusy(false)
    }
  }
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

  // One row per tab; `show` gates by role, `badge` shows an optional count bubble.
  const tabs: { id: Tab; icon: LucideIcon; show: boolean; badge?: number }[] = [
    { id: 'today', icon: CalendarCheck, show: true },
    { id: 'sheet', icon: ClipboardList, show: true },
    { id: 'members', icon: Users, show: true },
    { id: 'analytics', icon: BarChart3, show: true },
    { id: 'newfamily', icon: UserPlus, show: true },
    { id: 'newfamilyEdu', icon: GraduationCap, show: true },
    { id: 'visitors', icon: DoorOpen, show: true },
    { id: 'admins', icon: Shield, show: isSuper },
    { id: 'dongsan', icon: Sprout, show: isSuper },
    { id: 'settings', icon: Settings, show: isSuper },
  ]

  const visibleTabs = tabs.filter((item) => item.show)
  // A tab restored from before a reload can be out of this role's reach — a device that
  // was on 설정 signing back in as a leader, say. Fall back to 오늘 rather than rendering
  // a titled but empty page.
  const activeTab = visibleTabs.some((item) => item.id === tab) ? tab : 'today'
  // Mobile bottom bar: the 4 everyday tabs stay one tap away; everything else lives in
  // the 더보기 sheet (any tab badges roll up onto 더보기 so they stay visible).
  const primaryTabs = visibleTabs.slice(0, 4)
  const moreTabs = visibleTabs.slice(4)
  const moreBadge = moreTabs.reduce((n, item) => n + (item.badge ?? 0), 0)
  const bottomItems = [
    ...primaryTabs.map((item) => ({ id: item.id as string, label: t(`admin.nav.${item.id}`), icon: item.icon, badge: item.badge })),
    ...(moreTabs.length > 0
      ? [{ id: 'more', label: t('admin.nav.more'), icon: MoreHorizontal, badge: moreBadge }]
      : []),
  ]
  const bottomActive = primaryTabs.some((item) => item.id === activeTab) ? activeTab : 'more'

  return (
    <div className="min-h-dvh bg-canvas">
      <aside
        className={
          'material-bar fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden border-r transition-[width] duration-200 ease-out lg:flex ' +
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

        <nav aria-label={t('admin.pageTitle')} className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden py-2">
          {tabs
            .filter((item) => item.show)
            .map((item) => (
              <TabItem
                key={item.id}
                icon={item.icon}
                label={t(`admin.nav.${item.id}`)}
                active={activeTab === item.id}
                open={navOpen}
                onClick={() => selectTab(item.id)}
                badge={item.badge}
              />
            ))}
        </nav>
      </aside>

      <main className="min-h-dvh lg:pl-16">
        {/* Five labelled controls plus the title never fit across a phone — at 320 px the
            heading was squeezed down to a single character. On mobile the header keeps
            only the two actions that are used mid-service (키오스크, 로그아웃), as icons;
            테마·언어 and 백업 move into the 더보기 sheet below. From `sm` up everything is
            back in the bar with its label. */}
        <header className="material-bar safe-x sticky top-0 z-20 border-b py-3 pt-[calc(0.75rem+var(--safe-top))]">
          <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-2 sm:gap-4">
            <span className="grid shrink-0 place-items-center lg:hidden" aria-hidden>
              <KccpMark size={26} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-display text-xl font-bold tracking-tight text-text sm:text-2xl">{t(`admin.nav.${activeTab}`)}</h1>
              <p className="mt-0.5 truncate text-xs text-muted">{dateLabel} · {roleScope}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              <span className="hidden items-center gap-1.5 sm:flex">
                <ThemeLangToggle />
                {canRunBackup && (
                  <Button variant="secondary" size="sm" onClick={runBackup} disabled={backupBusy}>
                    {backupBusy ? t('common.loading') : t('admin.admins.dbBackup.runNow')}
                  </Button>
                )}
              </span>
              {canKiosk && (
                <Button variant="secondary" size="sm" onClick={() => setKiosk(true)} className="max-sm:aspect-square max-sm:px-0">
                  <Monitor className="size-4 sm:hidden" strokeWidth={2} aria-hidden />
                  <span className="max-sm:sr-only">{t('kiosk.enter')}</span>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleSignOut} className="max-sm:aspect-square max-sm:px-0">
                <LogOut className="size-4" strokeWidth={2} aria-hidden />
                <span className="max-sm:sr-only">{t('admin.signOut')}</span>
              </Button>
            </div>
          </div>
        </header>

        <div className="safe-x mx-auto max-w-[1480px] py-5 pb-[calc(5.5rem+var(--safe-bottom))] md:py-7 md:pb-[calc(5.5rem+var(--safe-bottom))] md:[--gutter:2rem] lg:pb-7">
          {/* key={activeTab} remounts the wrapper on every tab switch so the fade runs — a
              light cross-fade instead of content snapping into place. */}
          <div key={activeTab} className="fx-fade">
            {activeTab === 'today' && <AdminToday />}
            {activeTab === 'sheet' && <AdminSheet />}
            {activeTab === 'members' && <AdminMembers />}
            {activeTab === 'analytics' && <AdminAnalytics />}
            {activeTab === 'newfamily' && <AdminNewFamily />}
            {activeTab === 'newfamilyEdu' && <AdminNewFamilyEdu />}
            {activeTab === 'visitors' && <AdminVisitors />}
            {activeTab === 'admins' && isSuper && <AdminAdmins />}
            {activeTab === 'dongsan' && isSuper && <AdminDongsan />}
            {activeTab === 'settings' && isSuper && <AdminSettings />}
          </div>
        </div>
      </main>

      <BottomNav
        className="lg:hidden"
        label={t('admin.quickNav')}
        items={bottomItems}
        active={bottomActive}
        onSelect={(id) => (id === 'more' ? setMoreOpen(true) : selectTab(id as Tab))}
      />

      <Dialog open={moreOpen} onOpenChange={setMoreOpen} title={t('admin.nav.more')}>
        <div className="grid grid-cols-3 gap-2.5">
          {moreTabs.map((item) => {
            const Icon = item.icon
            const active = activeTab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={
                  'flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-xs font-semibold transition-[background-color,border-color,color,transform] duration-200 [transition-timing-function:var(--ease-out-soft)] active:scale-95 ' +
                  (active
                    ? 'border-primary bg-primary text-primary-fg shadow-[var(--shadow-sm)]'
                    : 'border-separator bg-surface-2 text-muted hover:bg-fill hover:text-text')
                }
              >
                <span className="relative">
                  <span
                    className={
                      'grid size-11 place-items-center rounded-full transition-colors ' +
                      (active ? 'bg-white/20' : 'bg-fill')
                    }
                  >
                    <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                  </span>
                  {(item.badge ?? 0) > 0 && (
                    <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                      {item.badge}
                    </span>
                  )}
                </span>
                {t(`admin.nav.${item.id}`)}
              </button>
            )
          })}
        </div>

        {/* The controls the header gives up on a phone (see the comment there). Only
            rendered where they've actually been displaced — from `sm` up they're in the
            bar and repeating them here would be two of each. */}
        <div className="mt-4 border-t border-separator pt-4 sm:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <ThemeLangToggle />
            {canRunBackup && (
              <Button variant="secondary" size="sm" onClick={runBackup} disabled={backupBusy} className="ml-auto">
                <Save className="size-4" strokeWidth={2} aria-hidden />
                {backupBusy ? t('common.loading') : t('admin.admins.dbBackup.runNow')}
              </Button>
            )}
          </div>
        </div>
      </Dialog>

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
      {active && <span className="fx-fade absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" aria-hidden />}
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
