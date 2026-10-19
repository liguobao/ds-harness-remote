import { describe, expect, it } from 'vitest'
import {
  filterArchivedResult,
  filterChatFrame,
  filterChatResult,
  filterChatRecords,
  readArchivedSessionIds,
  withDefaultTurnWindow,
} from '../src/remote-payload-trim.js'

describe('withDefaultTurnWindow', () => {
  it('injects the default window into a flat request', () => {
    expect(withDefaultTurnWindow('session/follow', { address: { kind: 'session', sessionId: 's' } }))
      .toEqual({ address: { kind: 'session', sessionId: 's' }, turnWindow: { minMessages: 1, minTurns: 1 } })
  })

  it('injects at the innermost layer and rebuilds the chain', () => {
    const out = withDefaultTurnWindow('session/page', { args: { request: { address: { kind: 'session', sessionId: 's' } } } })
    expect(out).toEqual({
      args: { request: { address: { kind: 'session', sessionId: 's' }, turnWindow: { minMessages: 1, minTurns: 1 } } },
    })
  })

  it('respects a client-supplied window at any depth', () => {
    const payload = { args: { request: { turnWindow: { minMessages: 20, minTurns: 5 } } } }
    expect(withDefaultTurnWindow('session/follow', payload)).toBe(payload)
  })

  it('leaves unrelated endpoints untouched', () => {
    const payload = { address: { kind: 'session', sessionId: 's' } }
    expect(withDefaultTurnWindow('workspace/follow', payload)).toBe(payload)
  })

  it('leaves non-object payloads untouched', () => {
    expect(withDefaultTurnWindow('session/follow', undefined)).toBeUndefined()
    expect(withDefaultTurnWindow('session/follow', 'x')).toBe('x')
  })
})

describe('filterChatRecords', () => {
  it('keeps chat events and drops tool events', () => {
    const records = [
      { event: { type: 'user/message', data: {} } },
      { event: { type: 'tool/call', data: {} } },
      { event: { type: 'assistant/message', data: { stream: [{ type: 'text-chunks' }] } } },
      { event: { type: 'turn/start', data: {} } },
    ]
    expect(filterChatRecords(records)).toEqual([
      { event: { type: 'user/message', data: {} } },
      { event: { type: 'assistant/message', data: { stream: [{ type: 'text-chunks' }] } } },
      { event: { type: 'turn/start', data: {} } },
    ])
  })

  it('strips tool-call chunks but keeps reasoning and text', () => {
    const data = {
      stream: [
        { type: 'reasoning-chunks', texts: ['think'] },
        { type: 'tool-call-chunks', id: 't1', args: ['{}'] },
        { type: 'text-chunks', texts: ['hello'] },
        { chunk: { type: 'block-start', blockType: 'tool-call' } },
        { chunk: { type: 'finish', replayState: { huge: true } } },
      ],
    }
    const out: any = filterChatRecords([{ event: { type: 'assistant/message', data } }])
    expect(out[0].event.data.stream).toEqual([
      { type: 'reasoning-chunks', texts: ['think'] },
      { type: 'text-chunks', texts: ['hello'] },
    ])
  })

  it('keeps records that carry no event wrapper', () => {
    const records = [{ kind: 'placeholder' }, { event: { type: 'tool/call', data: {} } }]
    expect(filterChatRecords(records)).toEqual([{ kind: 'placeholder' }])
  })

  it('returns the input unchanged for non-arrays', () => {
    expect(filterChatRecords(undefined)).toBeUndefined()
  })
})

describe('filterChatResult', () => {
  it('filters records for history endpoints', () => {
    const result = { ok: true, value: { records: [{ event: { type: 'tool/call', data: {} } }, { event: { type: 'turn/end', data: {} } }] } }
    expect(filterChatResult('session/follow', result)).toEqual({ ok: true, value: { records: [{ event: { type: 'turn/end', data: {} } }] } })
  })

  it('ignores other endpoints', () => {
    const result = { ok: true, value: { records: [{ event: { type: 'tool/call', data: {} } }] } }
    expect(filterChatResult('session/list', result)).toBe(result)
  })
})

describe('filterChatFrame', () => {
  it('filters records inside a snapshot frame', () => {
    const frame = { type: 'snapshot', records: [{ event: { type: 'tool/call', data: {} } }, { event: { type: 'turn/start', data: {} } }] }
    expect(filterChatFrame(frame)).toEqual({ type: 'snapshot', records: [{ event: { type: 'turn/start', data: {} } }] })
  })

  it('leaves event frames and other frames untouched', () => {
    const event: any = { type: 'event', event: { type: 'tool/call' } }
    expect(filterChatFrame(event)).toBe(event)
    const other: any = { type: 'snapshot' }
    expect(filterChatFrame(other)).toBe(other)
  })
})

describe('filterArchivedResult', () => {
  const archived = new Set(['session-a', 'b'])

  it('drops archived rows regardless of prefix', () => {
    const result = {
      ok: true,
      value: { items: [{ sessionId: 'session-a' }, { sessionId: 'b' }, { sessionId: 'session-c' }] },
    }
    expect(filterArchivedResult('session/list', result, archived)).toEqual({
      ok: true,
      value: { items: [{ sessionId: 'session-c' }] },
    })
  })

  it('tolerates rows written with the session- prefix in the store', () => {
    const result = { ok: true, value: { items: [{ sessionId: 'session-b' }] } }
    expect(filterArchivedResult('session/list', result, archived)).toEqual({ ok: true, value: { items: [] } })
  })

  it('is a no-op for other endpoints and for an empty archive set', () => {
    const result = { ok: true, value: { items: [{ sessionId: 'session-a' }] } }
    expect(filterArchivedResult('workspace/list', result, archived)).toBe(result)
    expect(filterArchivedResult('session/list', result, new Set())).toBe(result)
  })
})

describe('readArchivedSessionIds', () => {
  it('returns an empty set when the store is missing', () => {
    expect(readArchivedSessionIds('C:/definitely/missing').size).toBe(0)
  })
})
