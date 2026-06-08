import { api } from '../../lib/api'
import { syncQueue, type QueuedCheckin } from '../../lib/offlineQueue'

// Replays any offline-queued check-ins. A resolved POST (any 2xx business status)
// counts as synced; api() throws on network failure, so those stay queued.
export function syncQueuedCheckins(): Promise<number> {
  return syncQueue(async (item: QueuedCheckin) => {
    await api('POST', '/api/checkin', { deviceId: item.deviceId, lat: item.lat, lng: item.lng })
    return true
  })
}
