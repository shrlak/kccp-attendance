import { describe, it, expect, beforeEach } from 'vitest'
import { queueCheckin, queuedCount, syncQueue } from './offlineQueue'

beforeEach(() => localStorage.clear())

describe('offline queue', () => {
  it('queues the current device once (dedupes)', () => {
    queueCheckin(1, 2)
    queueCheckin(3, 4)
    expect(queuedCount()).toBe(1)
  })

  it('replays via post, keeping the ones that fail', async () => {
    localStorage.setItem(
      'kccp-offline-queue',
      JSON.stringify([
        { deviceId: 'A', lat: null, lng: null, ts: 1 },
        { deviceId: 'B', lat: 1, lng: 2, ts: 2 },
      ]),
    )
    const synced = await syncQueue(async (item) => item.deviceId === 'A')
    expect(synced).toBe(1)
    expect(queuedCount()).toBe(1) // B remains for a later attempt
  })

  it('keeps items when post throws', async () => {
    localStorage.setItem('kccp-offline-queue', JSON.stringify([{ deviceId: 'A', lat: null, lng: null, ts: 1 }]))
    const synced = await syncQueue(async () => {
      throw new Error('network')
    })
    expect(synced).toBe(0)
    expect(queuedCount()).toBe(1)
  })

  it('is a no-op on an empty queue', async () => {
    expect(await syncQueue(async () => true)).toBe(0)
  })
})
