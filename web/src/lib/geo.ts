// Geolocation with caching — ported from the legacy index.html getLocation().
// A fresh cache lets us skip the permission dialog on every check-in (notably
// Safari's daily prompt); we only re-prompt when there is no usable cache.

const LOC_KEY = 'kccp-loc-cache'
const MAX_AGE_MS = 1000 * 60 * 60 * 12 // a cached fix is reusable for 12h

export interface Coords {
  lat: number | null
  lng: number | null
}

interface CachedFix {
  lat: number
  lng: number
  ts: number
}

function readCache(): CachedFix | null {
  try {
    const raw = localStorage.getItem(LOC_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as CachedFix
    if (typeof c.lat !== 'number' || typeof c.lng !== 'number' || typeof c.ts !== 'number') return null
    return c
  } catch {
    return null
  }
}

function writeCache(lat: number, lng: number): void {
  try {
    localStorage.setItem(LOC_KEY, JSON.stringify({ lat, lng, ts: Date.now() } satisfies CachedFix))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

function currentPosition(): Promise<Coords> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ lat: null, lng: null })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        writeCache(pos.coords.latitude, pos.coords.longitude)
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => {
        const c = readCache()
        resolve(c ? { lat: c.lat, lng: c.lng } : { lat: null, lng: null })
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 300000 },
    )
  })
}

async function permissionState(): Promise<PermissionState | null> {
  if (!('permissions' in navigator) || !navigator.permissions?.query) return null
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return status.state
  } catch {
    return null
  }
}

// Refresh the cache silently, but only when permission is already granted so we
// never trigger an unexpected prompt in the background.
async function backgroundRefresh(): Promise<void> {
  if ((await permissionState()) === 'granted') await currentPosition()
}

/** Best-effort coordinates, preferring a fresh cache to avoid a permission prompt. */
export async function getLocation(): Promise<Coords> {
  const cached = readCache()
  if (cached && Date.now() - cached.ts < MAX_AGE_MS) {
    void backgroundRefresh()
    return { lat: cached.lat, lng: cached.lng }
  }
  // No usable cache: don't prompt if the user already denied — let the server
  // return "location-required" instead of nagging.
  if ((await permissionState()) === 'denied') return { lat: null, lng: null }
  return currentPosition()
}
