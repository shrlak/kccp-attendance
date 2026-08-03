// ── Web Share Target hand-off: service worker → app ──────────────────────────
// When someone shares 새가족 카드 photos into the installed app from the phone's share
// sheet, the OS POSTs them to the worker (src/sw.ts). A POST body can't survive the
// redirect to a client route, so the worker parks the files in the Cache API and the
// /share screen picks them up from here.
//
// Deliberately dependency-free and window-free: this module is bundled into *both* the
// worker and the app, so it may only touch APIs that exist in both (caches, Request,
// Response, File).

export const SHARED_CARD_CACHE = 'kccp-shared-cards-v1'

// Cache keys are synthetic — they're never fetched, only matched — so they sit at the
// origin root rather than under the Pages base path. That keeps the worker (which knows
// its scope) and the app (which knows import.meta.env.BASE_URL) writing the same keys in
// dev and in production, where those two differ.
const KEY_PREFIX = '/__kccp-shared-card__/'
const AT_HEADER = 'x-kccp-shared-at'
const NAME_HEADER = 'x-kccp-shared-name'

// A share older than this is a leftover — an earlier hand-off the user abandoned at the
// login screen, say. Dropped rather than replayed, so re-opening /share days later never
// resurrects a stale photo.
const MAX_AGE_MS = 30 * 60 * 1000

function keyFor(index: number): string {
  return new URL(`${KEY_PREFIX}${index}`, self.location.origin).href
}

/** Worker side: replace any pending hand-off with `files`. Returns how many were kept. */
export async function stashSharedCards(files: File[]): Promise<number> {
  const cache = await caches.open(SHARED_CARD_CACHE)
  for (const key of await cache.keys()) await cache.delete(key)

  const sharedAt = String(Date.now())
  let kept = 0
  for (const file of files) {
    // Some Android share sheets hand over `application/octet-stream` for a HEIC; accept
    // anything that isn't obviously non-image and let the scan dialog's decoder judge.
    if (file.type && !file.type.startsWith('image/') && file.type !== 'application/octet-stream') continue
    // Stored as raw bytes rather than by handing the File straight to Response: the
    // round trip then only ever moves ArrayBuffers, which every File/Blob implementation
    // accepts, instead of depending on Blob-as-body interop.
    await cache.put(
      new Request(keyFor(kept)),
      new Response(await file.arrayBuffer(), {
        headers: {
          'Content-Type': file.type || 'image/jpeg',
          [NAME_HEADER]: encodeURIComponent(file.name || `card-${kept + 1}.jpg`),
          [AT_HEADER]: sharedAt,
        },
      }),
    )
    kept++
  }
  return kept
}

/**
 * App side: the photos waiting to be registered, oldest key first. Non-destructive —
 * a share that lands on the login screen must survive the sign-in (and the Google OAuth
 * round-trip, which reloads the page). `clearSharedCards` is what consumes them.
 */
export async function readSharedCards(): Promise<File[]> {
  if (typeof caches === 'undefined') return []
  let cache: Cache
  try {
    cache = await caches.open(SHARED_CARD_CACHE)
  } catch {
    return [] // private-mode / storage-denied browsers
  }
  const keys = [...(await cache.keys())].sort((a, b) => indexOf(a.url) - indexOf(b.url))
  const files: File[] = []
  for (const key of keys) {
    const res = await cache.match(key)
    if (!res) continue
    const sharedAt = Number(res.headers.get(AT_HEADER) ?? 0)
    if (!sharedAt || Date.now() - sharedAt > MAX_AGE_MS) {
      await clearSharedCards()
      return []
    }
    const bytes = await res.arrayBuffer()
    const name = decodeURIComponent(res.headers.get(NAME_HEADER) ?? `card-${files.length + 1}.jpg`)
    const type = res.headers.get('Content-Type') || 'image/jpeg'
    files.push(new File([bytes], name, { type }))
  }
  return files
}

/** App side: drop the hand-off once the photos are in the scan dialog's hands. */
export async function clearSharedCards(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    await caches.delete(SHARED_CARD_CACHE)
  } catch {
    /* non-fatal */
  }
}

function indexOf(url: string): number {
  const n = Number(url.slice(url.lastIndexOf('/') + 1))
  return Number.isFinite(n) ? n : 0
}
