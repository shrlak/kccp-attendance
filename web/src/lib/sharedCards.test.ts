import { describe, it, expect, beforeEach, vi } from 'vitest'
import { stashSharedCards, readSharedCards, clearSharedCards, SHARED_CARD_CACHE } from './sharedCards'

// jsdom has no Cache API, so stand one up: a Map of URL → Response per cache name. It
// only needs the four methods sharedCards touches (put/keys/match/delete).
class FakeCache {
  store = new Map<string, Response>()
  async put(request: Request, response: Response) {
    this.store.set(request.url, response)
  }
  async keys() {
    return [...this.store.keys()].map((url) => new Request(url))
  }
  async match(request: Request) {
    // The real Cache API rebuilds a Response from the stored bytes on every match, so a
    // second read is fine — a clone reproduces that, where handing back the same object
    // would give a spuriously consumed body.
    return this.store.get(request.url)?.clone()
  }
  async delete(request: Request) {
    return this.store.delete(request.url)
  }
}

const caches = new Map<string, FakeCache>()

beforeEach(() => {
  caches.clear()
  vi.stubGlobal('caches', {
    open: async (name: string) => {
      const existing = caches.get(name)
      if (existing) return existing
      const created = new FakeCache()
      caches.set(name, created)
      return created
    },
    delete: async (name: string) => caches.delete(name),
  })
})

const jpeg = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

describe('sharedCards', () => {
  it('round-trips shared photos from the worker to the app, in order', async () => {
    const kept = await stashSharedCards([jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')])
    expect(kept).toBe(3)

    const files = await readSharedCards()
    expect(files.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(files[0].type).toBe('image/jpeg')
    expect(await files[0].text()).toHaveLength(3)
  })

  it('reads non-destructively so a share survives the login it lands on', async () => {
    await stashSharedCards([jpeg('card.jpg')])
    expect(await readSharedCards()).toHaveLength(1)
    // A Google sign-in reloads the page — the second read stands in for that reload.
    expect(await readSharedCards()).toHaveLength(1)

    await clearSharedCards()
    expect(await readSharedCards()).toHaveLength(0)
  })

  it('replaces a previous hand-off rather than appending to it', async () => {
    await stashSharedCards([jpeg('old-1.jpg'), jpeg('old-2.jpg')])
    await stashSharedCards([jpeg('new.jpg')])
    expect((await readSharedCards()).map((f) => f.name)).toEqual(['new.jpg'])
  })

  it('drops non-image attachments the share sheet may include', async () => {
    const kept = await stashSharedCards([
      jpeg('card.jpg'),
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
      // Some Android share sheets hand a HEIC over with no usable type — kept, and left
      // for the scan dialog's decoder to judge.
      new File([new Uint8Array([9])], 'IMG_0001.heic', { type: 'application/octet-stream' }),
    ])
    expect(kept).toBe(2)
    expect((await readSharedCards()).map((f) => f.name)).toEqual(['card.jpg', 'IMG_0001.heic'])
  })

  it('discards a stale hand-off instead of replaying it', async () => {
    await stashSharedCards([jpeg('yesterday.jpg')])
    // Push the wall clock past the 30-minute freshness window.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000)
    expect(await readSharedCards()).toHaveLength(0)
    vi.restoreAllMocks()
    // …and the entries are gone, not merely hidden.
    expect(caches.get(SHARED_CARD_CACHE)).toBeUndefined()
  })

  it('degrades quietly when storage is unavailable (private mode)', async () => {
    vi.stubGlobal('caches', {
      open: async () => {
        throw new Error('denied')
      },
      delete: async () => false,
    })
    await expect(readSharedCards()).resolves.toEqual([])
    await expect(clearSharedCards()).resolves.toBeUndefined()
  })
})
