// Eastern-time helpers — the church runs on America/New_York regardless of the
// visitor's device timezone (matches the edge function and legacy client).

const TZ = 'America/New_York'

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
