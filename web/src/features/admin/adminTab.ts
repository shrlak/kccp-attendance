// The admin panel's tabs, and where the last-viewed one is remembered so a reload comes
// back to the screen the admin was actually on instead of dropping them on 오늘. Kept in
// sessionStorage — the same scope as the admin session itself (per browser tab, gone when
// the tab closes), so a shared kiosk/office computer never resurrects someone else's tab.
export const ADMIN_TABS = [
  'today',
  'sheet',
  'members',
  'analytics',
  'newfamily',
  'newfamilyEdu',
  'visitors',
  'admins',
  'dongsan',
  'settings',
] as const

export type Tab = (typeof ADMIN_TABS)[number]

const KEY = 'kccp-admin-tab'

// 로그인하고 처음 보는 탭. **주일에는 오늘 탭**(그날 누가 왔는지를 보는 날이다), **그 밖의
// 날에는 멤버 탭** — 주중에 패널을 여는 이유는 명단을 찾거나 고치기 위해서이고, 그날은 오늘
// 탭에 찍힌 출석이 없어 빈 화면부터 보게 된다. 요일은 기기 시간대가 아니라 교회의
// 시간대(America/New_York)로 센다 — 출석이 그 날짜로 찍힌다. 새로고침은 여기로 오지 않는다:
// 기억해 둔 탭(readLastTab)이 있으면 그것이 먼저다.
export function defaultTab(weekday: number): Tab {
  return weekday === 0 ? 'today' : 'members'
}

export function isTab(value: unknown): value is Tab {
  return typeof value === 'string' && (ADMIN_TABS as readonly string[]).includes(value)
}

// The remembered tab, or null when there is none, it's unrecognised (an older build's id),
// or storage is unreachable — Safari private mode throws on the very access.
export function readLastTab(): Tab | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return isTab(raw) ? raw : null
  } catch {
    return null
  }
}

export function writeLastTab(tab: Tab): void {
  try { sessionStorage.setItem(KEY, tab) } catch { /* non-fatal */ }
}

// Signing out ends the session, so the next person to sign in on this device starts on
// 오늘 rather than wherever the previous admin left off.
export function clearLastTab(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* non-fatal */ }
}
