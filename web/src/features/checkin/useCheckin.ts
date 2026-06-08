import { useCallback, useState } from 'react'
import { postCheckin, type AppConfig, type CheckinResponse } from '../../lib/api'
import { getLocation } from '../../lib/geo'
import { queueCheckin } from '../../lib/offlineQueue'
import { easternNow, requiresLocation } from '../../lib/checkinWindow'

// A view-model for the result screen — server statuses, plus the locally-derived
// distinction between a wrong-day vs wrong-time restriction, and an offline state.
export type CheckinView =
  | { status: 'ok'; name: string; time: string; total: number; firstVisit: boolean; registered: boolean }
  | { status: 'already'; name: string; time: string }
  | { status: 'wrong-day' }
  | { status: 'wrong-time' }
  | { status: 'location-restricted'; distance: number | null }
  | { status: 'location-required' }
  | { status: 'offline' }
  | { status: 'pending' }

export type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; view: CheckinView }

/** Map a raw check-in response to a view-model. Pure + exported for testing. */
export function toView(
  r: CheckinResponse,
  cfg: Pick<AppConfig, 'checkinDays'>,
  now: Date = new Date(),
): CheckinView {
  switch (r.status) {
    case 'ok':
      return {
        status: 'ok',
        name: r.name ?? '',
        time: r.time ?? '',
        total: r.totalAttendance ?? 0,
        firstVisit: Boolean(r.firstVisit) || (r.totalAttendance ?? 0) === 1,
        registered: Boolean(r.isRegistered),
      }
    case 'already':
      return { status: 'already', name: r.name ?? '', time: r.time ?? '' }
    case 'location-restricted':
      return { status: 'location-restricted', distance: r.distance ?? null }
    case 'location-required':
      return { status: 'location-required' }
    case 'time-restricted':
      // The server message distinguishes day vs time in Korean prose; derive it
      // robustly from config + the current Eastern weekday instead of parsing.
      return cfg.checkinDays.includes(easternNow(now).weekday)
        ? { status: 'wrong-time' }
        : { status: 'wrong-day' }
  }
}

export function useCheckin(cfg: AppConfig | undefined) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  const checkIn = useCallback(async () => {
    if (!cfg) return
    setPhase({ kind: 'checking' })
    let lat: number | null = null
    let lng: number | null = null
    if (requiresLocation(cfg)) {
      const loc = await getLocation()
      lat = loc.lat
      lng = loc.lng
    }
    try {
      const r = await postCheckin(lat, lng)
      setPhase({ kind: 'result', view: toView(r, cfg) })
    } catch {
      queueCheckin(lat, lng)
      setPhase({ kind: 'result', view: { status: 'offline' } })
    }
  }, [cfg])

  const reset = useCallback(() => setPhase({ kind: 'idle' }), [])

  return { phase, checkIn, reset, setPhase }
}
