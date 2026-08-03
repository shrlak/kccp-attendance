import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { hydrateQueryCache, startQueryPersistence, clearPersistedQueries } from './queryPersist'

const KEY = 'kccp-query-cache-v1'

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

// The persistence writer debounces; drive it with fake timers rather than real waits.
async function flushWrites() {
  await vi.advanceTimersByTimeAsync(1_500)
}

beforeEach(() => {
  sessionStorage.clear()
  vi.useRealTimers()
})

describe('queryPersist', () => {
  it('restores a snapshot so a reload paints data instead of a skeleton', () => {
    const roster = { members: [{ id: '1', name: '김호연' }], log: [] }
    sessionStorage.setItem(KEY, JSON.stringify([{ key: ['roster'], data: roster, updatedAt: Date.now() }]))

    const qc = client()
    hydrateQueryCache(qc)
    expect(qc.getQueryData(['roster'])).toEqual(roster)
  })

  it('keeps the original timestamp, so the restored data is still refetched', () => {
    const updatedAt = Date.now() - 60_000
    sessionStorage.setItem(KEY, JSON.stringify([{ key: ['config'], data: { summerMode: true }, updatedAt }]))

    const qc = client()
    hydrateQueryCache(qc)
    // Not backdated to "just fetched" — the query's own staleness rules still apply, so
    // the panel corrects itself a moment after painting.
    expect(qc.getQueryState(['config'])?.dataUpdatedAt).toBe(updatedAt)
  })

  it('ignores a snapshot older than the freshness window', () => {
    const stale = Date.now() - 7 * 60 * 60 * 1000
    sessionStorage.setItem(KEY, JSON.stringify([{ key: ['roster'], data: { members: [] }, updatedAt: stale }]))

    const qc = client()
    hydrateQueryCache(qc)
    expect(qc.getQueryData(['roster'])).toBeUndefined()
  })

  it('ignores keys outside the allowlist, however they got into storage', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify([{ key: ['loginLog'], data: [{ ip: '1.2.3.4' }], updatedAt: Date.now() }]),
    )

    const qc = client()
    hydrateQueryCache(qc)
    expect(qc.getQueryData(['loginLog'])).toBeUndefined()
  })

  it('survives a corrupt snapshot and clears it', () => {
    sessionStorage.setItem(KEY, '{not json')
    const qc = client()
    expect(() => hydrateQueryCache(qc)).not.toThrow()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('mirrors successful allowlisted queries and skips the rest', async () => {
    vi.useFakeTimers()
    const qc = client()
    const stop = startQueryPersistence(qc)

    await qc.fetchQuery({ queryKey: ['roster'], queryFn: async () => ({ members: ['a'] }) })
    await qc.fetchQuery({ queryKey: ['cardScanUsage'], queryFn: async () => ({ remaining: 9 }) })
    await flushWrites()

    const written = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as { key: string[] }[]
    expect(written.map((e) => e.key[0])).toEqual(['roster'])
    stop()
  })

  it('clears the snapshot on sign-out', () => {
    sessionStorage.setItem(KEY, JSON.stringify([{ key: ['roster'], data: {}, updatedAt: Date.now() }]))
    clearPersistedQueries()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })
})
