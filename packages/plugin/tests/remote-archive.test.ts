import { describe, expect, it } from 'vitest'
import type { TypertRpcResult } from '../src/typert-gateway-contract.js'
import { archivedIdsFromBaseline, emptyArchivedCache, filterArchivedResult } from '../src/remote-archive.js'

const okList = (items: unknown[]): TypertRpcResult => ({ ok: true, value: { items } }) as TypertRpcResult

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
    expect((result as { value: { items: unknown[] } }).value.items).toHaveLength(1)
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
    const result: TypertRpcResult = { ok: false, error: { code: 'FAILED', message: '' } }
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
    expect(cache.at).toBe(0)
    expect(cache.ids.size).toBe(0)
  })
})
