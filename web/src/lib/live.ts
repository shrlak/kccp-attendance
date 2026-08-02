import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

// ── Live attendance sync across every open device ─────────────────────────────
// Supabase Realtime *broadcast* relays messages between connected clients without
// touching the database, so it works with the deny-all RLS posture (postgres_changes
// would deliver nothing to the anon key). Every open kiosk and admin panel joins the
// same channel; after any attendance/roster change (kiosk tile, 방문자, 새가족, 출석부
// 일괄 등록, 멤버별 출석 추가·삭제, 카드 사진 등록…) the originating client sends a
// PII-free ping and everyone else refetches the roster immediately — which is what
// keeps the 출석부 and each member's 출석기록 showing the same thing on every device.
// The roster's own poll (useRoster) stays as the fallback for pings missed while
// disconnected.

const CHANNEL = 'kiosk-attendance'
const EVENT = 'attendance-changed'

// One shared channel for the whole tab, however many views are mounted (the admin
// panel keeps its subscription while the kiosk view is open on top of it). Listeners
// are refcounted: the first mount joins, the last unmount leaves.
let channel: RealtimeChannel | null = null
const listeners = new Set<() => void>()

function joinChannel(): RealtimeChannel {
  if (channel) return channel
  const ch = supabase.channel(CHANNEL, { config: { broadcast: { self: false } } })
  // Bound once, before subscribing, and fanned out to the current listeners — so a
  // later mount doesn't need its own binding (or its own channel).
  ch.on('broadcast', { event: EVENT }, () => listeners.forEach((l) => l()))
  ch.subscribe()
  channel = ch
  return ch
}

// Subscribe while the view is mounted; refetch the roster on any peer's ping.
export function useAttendanceLive() {
  const qc = useQueryClient()
  useEffect(() => {
    const listener = () => { void qc.invalidateQueries({ queryKey: ['roster'] }) }
    listeners.add(listener)
    joinChannel()
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && channel) {
        const ch = channel
        channel = null
        void supabase.removeChannel(ch)
      }
    }
  }, [qc])
}

// Fire-and-forget ping to the other devices. No-op when no channel is joined (e.g. in
// tests); the payload carries no PII — receivers just refetch.
export function broadcastAttendanceChange() {
  void channel?.send({ type: 'broadcast', event: EVENT, payload: { ts: Date.now() } })
}

// The one call to make after a mutation that changes the roster or the attendance log:
// refetch here and tell every other open device to do the same, so the 출석부, 오늘 탭
// and 멤버별 출석기록 never drift apart.
export async function refreshRoster(qc: QueryClient) {
  broadcastAttendanceChange()
  await qc.invalidateQueries({ queryKey: ['roster'] })
}
