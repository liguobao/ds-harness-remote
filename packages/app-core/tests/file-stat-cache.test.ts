import { describe, expect, it, vi } from 'vitest'
import { FileStatCache } from '../src/services/file-stat-cache'

describe('FileStatCache', () => {
  it('deduplicates concurrent lookups and caches successful stat bytes', async () => {
    const cache = new FileStatCache()
    const fetcher = vi.fn(async (_sid: string, path: string) => ({
      absolutePath: `/ws/${path}`,
      version: 'v1',
      bytes: 1_500_000,
    }))

    const [a, b] = await Promise.all([
      cache.lookup(1, 's1', 'report.pdf', fetcher),
      cache.lookup(1, 's1', 'report.pdf', fetcher),
    ])

    expect(a).toEqual({ status: 'ok', bytes: 1_500_000 })
    expect(b).toEqual({ status: 'ok', bytes: 1_500_000 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    const cached = await cache.lookup(1, 's1', 'report.pdf', fetcher)
    expect(cached).toEqual({ status: 'ok', bytes: 1_500_000 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('caches missing/failed lookups so deleted files do not spam stat RPCs', async () => {
    const cache = new FileStatCache()
    const fetcher = vi.fn(async () => {
      throw new Error('ENOENT')
    })

    expect(await cache.lookup(1, 's1', 'gone.pdf', fetcher)).toEqual({ status: 'missing' })
    expect(await cache.lookup(1, 's1', 'gone.pdf', fetcher)).toEqual({ status: 'missing' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('bounds concurrent stat calls to 3 and resolves queued entries cleanly on clear()', async () => {
    const cache = new FileStatCache()
    let active = 0
    let peak = 0
    const resolvers: Array<() => void> = []

    const fetcher = vi.fn(async (_sid: string, path: string) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>(resolve => resolvers.push(resolve))
      active -= 1
      return { absolutePath: `/ws/${path}`, version: 'v1', bytes: 42 }
    })

    const p1 = cache.lookup(1, 's1', 'f1.pdf', fetcher)
    const p2 = cache.lookup(1, 's1', 'f2.pdf', fetcher)
    const p3 = cache.lookup(1, 's1', 'f3.pdf', fetcher)
    const p4 = cache.lookup(1, 's1', 'f4.pdf', fetcher)
    const p5 = cache.lookup(1, 's1', 'f5.pdf', fetcher)
    await Promise.resolve()

    expect(peak).toBe(3)
    expect(fetcher).toHaveBeenCalledTimes(3)

    cache.clear()
    resolvers.forEach(fn => fn())

    expect(await p4).toEqual({ status: 'missing' })
    expect(await p5).toEqual({ status: 'missing' })
    expect(await p1).toEqual({ status: 'ok', bytes: 42 })
    await Promise.all([p2, p3])
    expect(cache.get(1, 's1', 'f1.pdf')).toBeUndefined()
  })

  it('does not delete a newer generation inflight entry when a stale pre-clear lookup finishes', async () => {
    const cache = new FileStatCache()
    let resolveStale!: () => void
    let resolveFresh!: () => void
    let callCount = 0

    const fetcher = vi.fn(async (_sid: string, _path: string) => {
      callCount += 1
      if (callCount === 1) {
        await new Promise<void>(resolve => { resolveStale = resolve })
        return { absolutePath: '/ws/a.pdf', version: 'v1', bytes: 111 }
      }
      await new Promise<void>(resolve => { resolveFresh = resolve })
      return { absolutePath: '/ws/a.pdf', version: 'v2', bytes: 222 }
    })

    const stalePromise = cache.lookup(1, 's1', 'a.pdf', fetcher)
    await Promise.resolve()
    cache.clear()

    const freshA = cache.lookup(1, 's1', 'a.pdf', fetcher)
    await Promise.resolve()
    resolveStale()
    await stalePromise

    const freshB = cache.lookup(1, 's1', 'a.pdf', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)

    resolveFresh()
    expect(await Promise.all([freshA, freshB])).toEqual([
      { status: 'ok', bytes: 222 },
      { status: 'ok', bytes: 222 },
    ])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
