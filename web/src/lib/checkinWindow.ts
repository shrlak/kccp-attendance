// Check-in window helpers — the church runs on America/New_York regardless of
// the visitor's device timezone (matches the edge function and legacy client).

import type { AppConfig } from './api'

const TZ = 'America/New_York'

type WindowConfig = Pick<AppConfig, 'checkinDays' | 'checkinStartMin' | 'checkinEndMin' | 'demoMode'>

export interface EasternNow {
  date: string // YYYY-MM-DD
  weekday: number // 0=Sun … 6=Sat
  minutes: number // minutes since local midnight
  hh: number
  mm: number
  ss: number
}

export function easternNow(now: Date = new Date()): EasternNow {
  const e = new Date(now.toLocaleString('en-US', { timeZone: TZ }))
  return {
    date: now.toLocaleDateString('en-CA', { timeZone: TZ }),
    weekday: e.getDay(),
    minutes: e.getHours() * 60 + e.getMinutes(),
    hh: e.getHours(),
    mm: e.getMinutes(),
    ss: e.getSeconds(),
  }
}

function withinWindow(cfg: WindowConfig, now: Date): boolean {
  const e = easternNow(now)
  return cfg.checkinDays.includes(e.weekday) && e.minutes >= cfg.checkinStartMin && e.minutes <= cfg.checkinEndMin
}

/** Whether check-in is currently accepted. Demo mode is always open. */
export function isCheckinOpen(cfg: WindowConfig, now: Date = new Date()): boolean {
  return cfg.demoMode ? true : withinWindow(cfg, now)
}

/**
 * Whether the client should fetch geolocation before posting. Only when the
 * server would actually enforce location: not demo mode, and inside the window.
 */
export function requiresLocation(cfg: WindowConfig, now: Date = new Date()): boolean {
  return cfg.demoMode ? false : withinWindow(cfg, now)
}

export function formatClock(n: EasternNow): string {
  const h12 = n.hh % 12 || 12
  const ampm = n.hh >= 12 ? 'PM' : 'AM'
  return `${String(h12).padStart(2, '0')}:${String(n.mm).padStart(2, '0')}:${String(n.ss).padStart(2, '0')} ${ampm}`
}

export function formatMinutes(min: number): string {
  const hh = Math.floor(min / 60)
  const mm = min % 60
  const h12 = hh % 12 || 12
  return `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'PM' : 'AM'}`
}
