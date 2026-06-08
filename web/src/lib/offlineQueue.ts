// Offline check-in queue — ported from legacy queueCheckin()/syncOfflineQueue().
// When a check-in POST fails (no network), we stash it locally and replay it
// once connectivity returns. Keyed by device so a device queues at most once.

import { getDeviceId } from './device'

const QUEUE_KEY = 'kccp-offline-queue'

export interface QueuedCheckin {
  deviceId: string
  lat: number | null
  lng: number | null
  ts: number
}

function read(): QueuedCheckin[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
    return Array.isArray(parsed) ? (parsed as QueuedCheckin[]) : []
  } catch {
    return []
  }
}

function write(q: QueuedCheckin[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
  } catch {
    /* non-fatal */
  }
}

/** Queue the current device's check-in. No-op if it's already queued. */
export function queueCheckin(lat: number | null, lng: number | null): void {
  const deviceId = getDeviceId()
  const q = read()
  if (q.some((x) => x.deviceId === deviceId)) return
  q.push({ deviceId, lat, lng, ts: Date.now() })
  write(q)
}

export function queuedCount(): number {
  return read().length
}

/**
 * Replay queued check-ins via `post`. Items for which `post` resolves truthy are
 * dropped; everything else (rejected or falsy) is retained for a later attempt.
 * `post` is injected so this stays free of network/api coupling and testable.
 * Returns the number successfully synced.
 */
export async function syncQueue(post: (item: QueuedCheckin) => Promise<boolean>): Promise<number> {
  const q = read()
  if (!q.length) return 0
  let synced = 0
  const remaining: QueuedCheckin[] = []
  for (const item of q) {
    try {
      if (await post(item)) synced++
      else remaining.push(item)
    } catch {
      remaining.push(item)
    }
  }
  write(remaining)
  return synced
}
