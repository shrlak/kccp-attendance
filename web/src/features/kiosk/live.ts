import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

// Live multi-device kiosk sync via Supabase Realtime *broadcast*. Broadcast relays
// messages between connected clients without touching the database, so it works with
// the deny-all RLS posture (postgres_changes would deliver nothing to the anon key).
// Every open kiosk joins the same channel; after any attendance change (tile check-in,
// undo, 방문자, 새가족) the originating kiosk sends a PII-free ping and every other
// kiosk refetches the roster immediately. The KioskView poll stays as the fallback for
// changes made outside a kiosk (admin panel) or missed while disconnected.

const CHANNEL = 'kiosk-attendance'
const EVENT = 'attendance-changed'

// The currently subscribed channel (one kiosk view at a time). Module-level so the
// guest/새가족 dialogs can broadcast through the same joined channel.
let channel: RealtimeChannel | null = null

// Subscribe while the kiosk is mounted; refetch the roster on any peer's ping.
export function useKioskLive() {
  const qc = useQueryClient()
  useEffect(() => {
    const ch = supabase.channel(CHANNEL, { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: EVENT }, () => {
      void qc.invalidateQueries({ queryKey: ['roster'] })
    })
    ch.subscribe()
    channel = ch
    return () => {
      if (channel === ch) channel = null
      void supabase.removeChannel(ch)
    }
  }, [qc])
}

// Fire-and-forget ping to the other kiosks. No-op when no kiosk channel is joined
// (e.g. in tests); payload carries no PII — receivers just refetch.
export function broadcastKioskChange() {
  void channel?.send({ type: 'broadcast', event: EVENT, payload: { ts: Date.now() } })
}
