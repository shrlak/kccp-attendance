import type { QueryClient } from '@tanstack/react-query'

// ── Reload without the skeleton ───────────────────────────────────────────────
// TanStack Query's cache lives in memory, so every reload of the admin panel used to
// drop back to the loading skeletons and wait a full round trip to the edge function
// before showing anything — even though the roster it just had is almost always still
// correct. A snapshot of the slow, high-value queries is mirrored to sessionStorage and
// restored before the first render, so a reload paints real data immediately and the
// refetch (useRoster still runs one on every mount) lands underneath it.
//
// sessionStorage, not localStorage, and deliberately so: the snapshot holds roster PII,
// and this matches how the admin session itself is stored — scoped to the tab, gone when
// it closes. Signing out clears it outright.

const KEY = 'kccp-query-cache-v1'

// Only queries worth the bytes: slow to fetch, stable enough that a stale first paint is
// an improvement over an empty one. Anything not listed here (usage counters, audit logs,
// backup listings) stays memory-only.
const PERSIST_KEYS = new Set([
  'roster',
  'config',
  'dongsanLeaders',
  'dongsanNames',
  'adminRoles',
])

// Beyond this a snapshot is more likely to mislead than to help — a stale roster from
// last Sunday shouldn't flash on screen before the refetch corrects it.
const MAX_AGE_MS = 6 * 60 * 60 * 1000

// sessionStorage caps out around 5 MB; stop well short rather than throwing on write.
const MAX_BYTES = 2_000_000

// Coalesce the burst of cache events a single refetch produces into one write.
const WRITE_DELAY_MS = 1_000

interface Snapshot {
  key: unknown[]
  data: unknown
  updatedAt: number
}

function persistable(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === 'string' && PERSIST_KEYS.has(queryKey[0])
}

/** Restore the last snapshot into `client`. Call before the first render. */
export function hydrateQueryCache(client: QueryClient): void {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(KEY)
  } catch {
    return // private mode / storage disabled
  }
  if (!raw) return
  try {
    const entries = JSON.parse(raw) as Snapshot[]
    if (!Array.isArray(entries)) return
    const now = Date.now()
    for (const entry of entries) {
      if (!Array.isArray(entry?.key) || !persistable(entry.key)) continue
      if (!entry.updatedAt || now - entry.updatedAt > MAX_AGE_MS) continue
      // updatedAt is preserved so the query's own staleness rules still apply — a
      // restored roster is immediately stale (staleTime: 0) and refetches on mount,
      // which is exactly the intent: show it now, correct it a moment later.
      client.setQueryData(entry.key, entry.data, { updatedAt: entry.updatedAt })
    }
  } catch {
    // Corrupt or from an older shape — drop it rather than fail the boot.
    try {
      sessionStorage.removeItem(KEY)
    } catch {
      /* non-fatal */
    }
  }
}

function write(client: QueryClient): void {
  const entries: Snapshot[] = []
  for (const query of client.getQueryCache().getAll()) {
    if (query.state.status !== 'success' || query.state.data === undefined) continue
    if (!persistable(query.queryKey)) continue
    entries.push({
      key: [...query.queryKey],
      // The raw query data, not the `select`ed view — consumers re-derive that.
      data: query.state.data,
      updatedAt: query.state.dataUpdatedAt,
    })
  }
  try {
    if (entries.length === 0) {
      sessionStorage.removeItem(KEY)
      return
    }
    const json = JSON.stringify(entries)
    if (json.length > MAX_BYTES) return
    sessionStorage.setItem(KEY, json)
  } catch {
    /* quota or storage disabled — the cache is an optimization, never a requirement */
  }
}

/** Mirror future cache updates into sessionStorage. Returns an unsubscribe function. */
export function startQueryPersistence(client: QueryClient): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      write(client)
    }, WRITE_DELAY_MS)
  }
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    write(client)
  }

  const unsubscribe = client.getQueryCache().subscribe(schedule)
  // A phone backgrounding the tab (or the OS reclaiming it) never runs the pending
  // timeout, so commit on the way out — that's precisely the reload we're optimizing.
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', flush)

  return () => {
    unsubscribe()
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('pagehide', flush)
    if (timer) clearTimeout(timer)
  }
}

/** Drop the snapshot — the roster in it is only for whoever was signed in. */
export function clearPersistedQueries(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* non-fatal */
  }
}
