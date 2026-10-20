import { describe, expect, it } from 'vitest'
import type { LocalTypertGateway, TypertRpcResult } from '../src/typert-gateway-contract.js'
import {
  archivedIdsFromBaseline,
  closeStream,
  emptyArchivedCache,
  filterArchivedResult,
  readArchivedSessionIds,
} from '../src/remote-archive.js'

const okList = (items: unknown[]): TypertRpcResult => ({ ok: true, value: { items } }) as TypertRpcResult

/**
 * The bridge only calls `open()`, so the rest of `LocalTypertGateway` is stubbed
 * out here; the assertion keeps that contract visible instead of casting away
 * the whole interface.
 */
function asGateway(shape: { open: LocalTypertGateway['open'] }): LocalTypertGateway {
  return {
    open: shape.open,
    dispatch: async () => ({ ok: false, error: { code: 'UNUSED', message: '', details: {} } }),
    invoke: async () => undefined,
    failure: () => ({ code: 'UNUSED', message: '', details: {} }),
    supportsCarrier: true,
  }
}

/** A `LocalTypertGateway` whose stream yields exactly one baseline frame. */
function gatewayYielding(frame: unknown, options: { onReturn?: () => void } = {}): LocalTypertGateway {
  return asGateway({
    async open() {
      let served = false
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (served) return { done: true as const, value: undefined }
              served = true
              return { done: false as const, value: frame }
            },
            async return() {
              options.onReturn?.()
              return { done: true as const, value: undefined }
            },
          }
        },
      }
    },
  })
}

/** A gateway whose stream never settles and ignores the abort signal. */
function gatewayThatIgnoresAbort(): LocalTypertGateway {
  return asGateway({
    async open() {
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<never>(() => {}),
            return: () => new Promise<never>(() => {}),
          }
        },
      }
    },
  })
}

/** A gateway whose `open()` itself never settles. */
function gatewayThatNeverOpens(): LocalTypertGateway {
  return asGateway({ open: () => new Promise<never>(() => {}) })
}

describe('archivedIdsFromBaseline', () => {
  it('reads the archive set from a baseline frame', () => {
    const ids = archivedIdsFromBaseline({
      type: 'baseline',
      value: { items: [], archivedSessionIds: ['session-a', 'b'], pinnedSessionIds: [] },
    })
    expect([...ids!]).toEqual(['session-a', 'b'])
  })

  it('returns undefined for a non-baseline frame', () => {
    expect(archivedIdsFromBaseline({ type: 'increment', value: {} })).toBeUndefined()
  })

  it('returns undefined when the field is missing or not an array', () => {
    expect(archivedIdsFromBaseline({ type: 'baseline', value: { items: [] } })).toBeUndefined()
    expect(archivedIdsFromBaseline({ type: 'baseline', value: { archivedSessionIds: 'x' } })).toBeUndefined()
  })

  it('ignores non-string entries', () => {
    expect([...archivedIdsFromBaseline({ type: 'baseline', value: { archivedSessionIds: ['a', 7, null] } })!])
      .toEqual(['a'])
  })

  it('returns undefined for junk', () => {
    expect(archivedIdsFromBaseline(undefined)).toBeUndefined()
    expect(archivedIdsFromBaseline(null)).toBeUndefined()
    expect(archivedIdsFromBaseline('baseline')).toBeUndefined()
  })
})

describe('filterArchivedResult', () => {
  const archived = new Set(['session-a', 'b'])

  it('drops archived rows that carry the prefix', () => {
    expect(filterArchivedResult('session/list', okList([{ sessionId: 'session-a' }, { sessionId: 'session-c' }]), archived))
      .toEqual({ ok: true, value: { items: [{ sessionId: 'session-c' }] } })
  })

  it('drops archived rows without the prefix', () => {
    expect(filterArchivedResult('session/list', okList([{ sessionId: 'b' }, { sessionId: 'c' }]), archived))
      .toEqual({ ok: true, value: { items: [{ sessionId: 'c' }] } })
  })

  it('matches a prefixed row against an unprefixed set entry', () => {
    expect(filterArchivedResult('session/list', okList([{ sessionId: 'session-b' }]), archived))
      .toEqual({ ok: true, value: { items: [] } })
  })

  it('matches an unprefixed row against a prefixed set entry', () => {
    expect(filterArchivedResult('session/list', okList([{ sessionId: 'a' }]), new Set(['session-a'])))
      .toEqual({ ok: true, value: { items: [] } })
  })

  it('keeps rows without a usable sessionId', () => {
    const result = filterArchivedResult('session/list', okList([{ foo: 1 }, { sessionId: 'session-a' }]), archived)
    // Both length and content: the surviving row must be the one without an id.
    expect((result as { value: { items: unknown[] } }).value.items).toEqual([{ foo: 1 }])
  })

  it('returns the same reference when nothing is archived', () => {
    const result = okList([{ sessionId: 'session-a' }])
    expect(filterArchivedResult('session/list', result, new Set())).toBe(result)
  })

  it('returns the same reference when every row is kept', () => {
    const result = okList([{ sessionId: 'x' }])
    expect(filterArchivedResult('session/list', result, archived)).toBe(result)
  })

  it('leaves other endpoints alone', () => {
    const result = okList([{ sessionId: 'session-a' }])
    expect(filterArchivedResult('workspace/follow', result, archived)).toBe(result)
  })

  it('leaves a failed result alone', () => {
    const result: TypertRpcResult = { ok: false, error: { code: 'FAILED', message: '', details: {} } }
    expect(filterArchivedResult('session/list', result, archived)).toBe(result)
  })

  it('leaves a non-array items field alone', () => {
    const result = { ok: true, value: { items: 'x' } } as TypertRpcResult
    expect(filterArchivedResult('session/list', result, archived)).toBe(result)
  })
})

describe('emptyArchivedCache', () => {
  it('starts empty and never filters', () => {
    const cache = emptyArchivedCache()
    expect(cache.value.at).toBe(0)
    expect(cache.value.ids.size).toBe(0)
  })
})

describe('readArchivedSessionIds', () => {
  it('reads the archive set and closes the stream', async () => {
    let returned = false
    const gateway = gatewayYielding(
      { type: 'baseline', value: { archivedSessionIds: ['session-x'] } },
      { onReturn: () => { returned = true } },
    )
    const cache = emptyArchivedCache()
    expect([...await readArchivedSessionIds(gateway, cache)]).toEqual(['session-x'])
    expect(returned).toBe(true)
    expect(cache.value.ids.has('session-x')).toBe(true)
  })

  it('serves the cached set inside the TTL without opening a stream', async () => {
    let opened = 0
    const inner = gatewayYielding({ type: 'baseline', value: { archivedSessionIds: ['x'] } })
    const gateway = asGateway({
      open: async (endpoint, payload, signal, uplink) => {
        opened += 1
        return inner.open(endpoint, payload, signal, uplink)
      },
    })
    const cache = { value: { at: Date.now(), ids: new Set(['cached']) } }
    expect([...await readArchivedSessionIds(gateway, cache)]).toEqual(['cached'])
    expect(opened).toBe(0)
  })

  it('falls back to the cached set when the frame is not a baseline', async () => {
    const cache = { value: { at: 0, ids: new Set(['previous']) } }
    const ids = await readArchivedSessionIds(gatewayYielding({ type: 'increment', value: {} }), cache)
    expect([...ids]).toEqual(['previous'])
    expect(cache.value.at).toBe(0)
  })

  it('returns the cached set when open() rejects', async () => {
    const cache = { value: { at: 0, ids: new Set(['previous']) } }
    const gateway = asGateway({ open: async () => { throw new Error('host refused') } })
    expect([...await readArchivedSessionIds(gateway, cache)]).toEqual(['previous'])
  })

  it('stays bounded when open() never settles and ignores the signal', async () => {
    const cache = emptyArchivedCache()
    const startedAt = Date.now()
    const ids = await readArchivedSessionIds(gatewayThatNeverOpens(), cache)
    expect(ids.size).toBe(0)
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })

  it('stays bounded when the stream never settles and ignores the signal', async () => {
    const cache = emptyArchivedCache()
    const startedAt = Date.now()
    const ids = await readArchivedSessionIds(gatewayThatIgnoresAbort(), cache)
    expect(ids.size).toBe(0)
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })
})

describe('closeStream', () => {
  it('aborts the lifetime and closes the iterator', async () => {
    let closed = false
    const lifetime = new AbortController()
    const iterator = {
      next: async () => ({ done: true as const, value: undefined }),
      return: async () => {
        expect(lifetime.signal.aborted).toBe(true)
        closed = true
        return { done: true as const, value: undefined }
      },
    }
    await closeStream(iterator, lifetime)
    expect(closed).toBe(true)
    expect(lifetime.signal.aborted).toBe(true)
  })

  it('tolerates a missing iterator', async () => {
    const lifetime = new AbortController()
    await expect(closeStream(undefined, lifetime)).resolves.toBeUndefined()
    expect(lifetime.signal.aborted).toBe(true)
  })

  it('stays bounded when return() never settles', async () => {
    const startedAt = Date.now()
    await closeStream({ next: async () => ({ done: true as const, value: undefined }), return: () => new Promise<never>(() => {}) }, new AbortController())
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })

  it('swallows a rejecting return()', async () => {
    const iterator = {
      next: async () => ({ done: true as const, value: undefined }),
      return: async () => { throw new Error('close failed') },
    }
    await expect(closeStream(iterator, new AbortController())).resolves.toBeUndefined()
  })
})
