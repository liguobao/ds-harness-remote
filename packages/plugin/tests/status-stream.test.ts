import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createStatusFeed,
  type StatusStreamOptions,
  type StatusStreamSource,
} from '../src/status-stream.js'

interface FakeStatus { mode: 'local' | 'remote'; seq?: number }

const CLOSED = 2
const CONNECTING = 0

afterEach(() => {
  vi.useRealTimers()
})

describe('browser status feed', () => {
  it('pushes frames to every subscriber over one connection and never reads status', () => {
    const { feed, sources, readStatus } = stubFeed()
    const first: FakeStatus[] = []
    const second: FakeStatus[] = []

    feed.subscribe(status => first.push(status))
    feed.subscribe(status => second.push(status))

    expect(sources.urls).toEqual(['/status.events'])
    expect(feed.getSnapshot()).toBeUndefined()

    sources.latest.message(JSON.stringify({ mode: 'remote', seq: 1 }))

    expect(first).toEqual([{ mode: 'remote', seq: 1 }])
    expect(second).toEqual([{ mode: 'remote', seq: 1 }])
    // The pushed value is referentially stable between frames.
    expect(feed.getSnapshot()).toBe(first[0])
    expect(feed.getSnapshot()).toBe(feed.getSnapshot())

    sources.latest.message(JSON.stringify({ mode: 'remote', seq: 2 }))
    expect(feed.getSnapshot()).toEqual({ mode: 'remote', seq: 2 })
    expect(readStatus).not.toHaveBeenCalled()
  })

  it('replays the latest status to a late subscriber without opening a second stream', () => {
    const { feed, sources } = stubFeed()
    feed.subscribe(() => undefined)
    sources.latest.message(JSON.stringify({ mode: 'remote' }))

    const late: FakeStatus[] = []
    feed.subscribe(status => late.push(status))

    expect(late).toEqual([{ mode: 'remote' }])
    expect(sources.urls).toHaveLength(1)
  })

  it('ignores a frame that is not a JSON object', () => {
    const { feed, sources } = stubFeed()
    const seen: FakeStatus[] = []
    feed.subscribe(status => seen.push(status))

    sources.latest.message('<html>not a status</html>')
    sources.latest.message('null')
    sources.latest.message('{"mode":"remote"}')

    expect(seen).toEqual([{ mode: 'remote' }])
  })

  it('keeps the stream through a transient error and lets the browser reconnect', async () => {
    vi.useFakeTimers()
    const { feed, sources, readStatus } = stubFeed()
    feed.subscribe(() => undefined)

    sources.latest.fail(CONNECTING)
    await vi.advanceTimersByTimeAsync(500)

    expect(readStatus).not.toHaveBeenCalled()
    expect(sources.latest.closed).toBe(false)
  })

  it('polls the unary status endpoint when the host closes the stream for good', async () => {
    vi.useFakeTimers()
    let status: FakeStatus = { mode: 'remote', seq: 1 }
    const { feed, sources, readStatus } = stubFeed(async () => status)
    const seen: FakeStatus[] = []

    feed.subscribe(next => seen.push(next))
    sources.latest.fail(CLOSED)
    await flush()

    expect(readStatus).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ mode: 'remote', seq: 1 }])

    status = { mode: 'remote', seq: 2 }
    await vi.advanceTimersByTimeAsync(100)
    expect(readStatus).toHaveBeenCalledTimes(2)
    expect(seen).toEqual([{ mode: 'remote', seq: 1 }, { mode: 'remote', seq: 2 }])
  })

  it('keeps the last status while the fallback read fails', async () => {
    vi.useFakeTimers()
    const { feed, sources } = stubFeed(async () => { throw new Error('control route down') })

    feed.subscribe(() => undefined)
    sources.latest.fail(CLOSED)
    await vi.advanceTimersByTimeAsync(300)

    expect(feed.getSnapshot()).toBeUndefined()
  })

  it('polls when the stream never delivers a first frame', async () => {
    vi.useFakeTimers()
    const { feed, readStatus } = stubFeed(undefined, { openTimeoutMs: 50 })
    feed.subscribe(() => undefined)

    await vi.advanceTimersByTimeAsync(40)
    expect(readStatus).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(20)
    expect(readStatus).toHaveBeenCalledTimes(1)
  })

  it('polls when the carrier provides no EventSource', async () => {
    vi.useFakeTimers()
    const reasons: string[] = []
    const { feed, readStatus } = stubFeed(undefined, {
      createSource: () => { throw new ReferenceError('EventSource is not defined') },
      onFallback: reason => reasons.push(reason),
    })

    feed.subscribe(() => undefined)
    await flush()

    expect(reasons).toEqual(['unsupported'])
    expect(readStatus).toHaveBeenCalledTimes(1)
  })

  it('reports the fallback reason once and closes the stream with the last subscriber', async () => {
    vi.useFakeTimers()
    const reasons: string[] = []
    const { feed, sources, readStatus } = stubFeed(undefined, { onFallback: reason => reasons.push(reason) })

    const unsubscribe = feed.subscribe(() => undefined)
    sources.latest.fail(CLOSED)
    sources.latest.fail(CLOSED)
    await flush()
    expect(reasons).toEqual(['unavailable'])

    unsubscribe()
    await vi.advanceTimersByTimeAsync(300)
    expect(readStatus).toHaveBeenCalledTimes(1)

    feed.subscribe(() => undefined)
    expect(sources.urls).toHaveLength(2)
  })

  it('drops its listeners and transport on close', () => {
    const { feed, sources } = stubFeed()
    const seen: FakeStatus[] = []
    feed.subscribe(status => seen.push(status))

    feed.close()
    sources.latest.message(JSON.stringify({ mode: 'remote' }))

    expect(seen).toEqual([])
    expect(sources.latest.closed).toBe(true)
  })
})

function stubFeed(
  readStatus: (() => Promise<FakeStatus>) | undefined = async () => ({ mode: 'local' }),
  overrides: Partial<StatusStreamOptions<FakeStatus>> = {},
) {
  const sources = new FakeSourceFactory()
  const reader = vi.fn(readStatus ?? (async () => ({ mode: 'local' })))
  const feed = createStatusFeed<FakeStatus>({
    url: '/status.events',
    readStatus: reader,
    createSource: sources.create,
    pollIntervalMs: 100,
    ...overrides,
  })
  return { feed, sources, readStatus: reader }
}

class FakeSource implements StatusStreamSource {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  readyState = CONNECTING
  closed = false

  constructor(readonly url: string) {}

  close(): void {
    this.closed = true
    this.readyState = CLOSED
  }

  message(data: string): void {
    this.onmessage?.({ data } as MessageEvent)
  }

  fail(readyState: number): void {
    this.readyState = readyState
    this.onerror?.({} as Event)
  }
}

class FakeSourceFactory {
  readonly urls: string[] = []
  readonly sources: FakeSource[] = []

  readonly create = (url: string): StatusStreamSource => {
    const source = new FakeSource(url)
    this.urls.push(url)
    this.sources.push(source)
    return source
  }

  get latest(): FakeSource {
    const source = this.sources[this.sources.length - 1]
    if (source === undefined) throw new Error('no status stream source was created')
    return source
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve()
}
