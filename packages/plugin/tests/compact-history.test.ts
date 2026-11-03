import { describe, expect, it, vi } from 'vitest'
import { createRpcRequest } from '@dsh-remote/protocol'
import { compactHistory } from '../src/compact-history.js'
import { RpcRouter } from '../src/rpc-router.js'
import { CodexPeerBridge } from '../src/codex/peer-bridge.js'

const output = 'sensitive tool output '.repeat(4000)
const page = () => ({ cursor: 91, throughSeq: 91, hasMore: true, activeTurnId: 'turn-2', records: [
  { type: 'event', event: { type: 'user/message', seq: 40, data: { content: [{ type: 'text', text: output }] } } },
  { type: 'event', event: { type: 'tool/result', seq: 41, data: { callId: 'tool-1', turn: 2, failed: true, message: { source: { callId: 'tool-1' }, content: [{ type: 'tool-result', toolCallId: 'tool-1', isError: true, content: [{ type: 'text', text: output }] }] } } }, view: { for: 'result', view: { title: 'Read', output } } },
  { type: 'event', event: { type: 'turn/end', seq: 91, data: { reason: { kind: 'failed' } } } },
] })

describe('compact history recovery contract', () => {
  it('preserves cursors, correlation, errors, text and lifecycle without mutating stored history', () => {
    const original = page(), snapshot = structuredClone(original)
    const result = compactHistory(original)
    expect(result).toMatchObject({ cursor: 91, throughSeq: 91, hasMore: true, activeTurnId: 'turn-2' })
    expect(result.records.map(row => row.event.seq)).toEqual([40, 41, 91])
    expect(result.records[0]).toEqual(original.records[0])
    expect(result.records[2]).toEqual(original.records[2])
    expect(result.records[1]).toMatchObject({ event: { data: { callId: 'tool-1', failed: true, message: { source: { callId: 'tool-1' }, content: [{ toolCallId: 'tool-1', isError: true }] } } } })
    expect(JSON.stringify(result.records[1]).length).toBeLessThan(2000)
    expect(original).toEqual(snapshot)
    const hiddenError = compactHistory({ type: 'tool/result', data: { message: { content: [
      { type: 'text', text: output }, { type: 'text', text: output },
      { type: 'text', text: output, isError: true },
      { type: 'tool-result', toolCallId: 'other-tool', isError: true, content: [{ type: 'text', text: output }] },
    ] } } })
    expect(hiddenError.data.message.content[0]).toMatchObject({ isError: true })
    expect(hiddenError.data.message.content.at(-1)).toMatchObject({ toolCallId: 'other-tool', isError: true })
  })

  it('never cuts an emoji in half when it shortens a value', () => {
    // 511 ASCII characters put the 512-code-unit cut between the two halves of the emoji.
    const value = `${'a'.repeat(511)}${'😀'.repeat(8)}`
    const result = compactHistory({ type: 'tool/result', data: { output: value, message: { content: [{ type: 'text', text: value }] } } })
    const expected = `${'a'.repeat(511)}\n[Compact history: output omitted]`
    expect(result.data.output).toBe(expected)
    expect(result.data.message.content[0]).toEqual({ type: 'text', text: expected })
    expect(compactHistory({ type: 'tool/result', data: { output: `${'a'.repeat(510)}${'😀'.repeat(8)}` } }).data.output)
      .toBe(`${'a'.repeat(510)}😀\n[Compact history: output omitted]`)
  })

  it('isolates authenticated peer modes and restores complete responses when disabled', async () => {
    const source = page(), call = vi.fn(async () => source)
    const domain = { call, detachPeer: vi.fn(async () => undefined) }
    const a = new CodexPeerBridge(domain as never, { connectionId: 'a' } as never, async () => undefined)
    const b = new CodexPeerBridge(domain as never, { connectionId: 'b' } as never, async () => undefined)
    const router = new RpcRouter(128, undefined, undefined, undefined, undefined, a)
    const request = { method: 'dsh/sessionHistory', params: { threadId: 'thread' } }
    expect(await router.handle(createRpcRequest('remote.history.configure', { compact: true }))).toMatchObject({ type: 'rpc.response' })
    expect(await a.call(request)).toEqual(compactHistory(source))
    expect(await b.call(request)).toEqual(source)
    await router.handle(createRpcRequest('remote.history.configure', { compact: false }))
    expect(await a.call(request)).toEqual(source)
    expect(await router.handle(createRpcRequest('remote.history.configure', { compact: 'yes' }))).toMatchObject({ type: 'rpc.error' })
    expect(a.compactHistoryEnabled).toBe(false)
    expect(await a.call({ method: 'thread/read', params: { threadId: 'thread' } })).toEqual(source)
    await a.closeAll(); await b.closeAll()
  })
})

it('compacts Harness snapshots and older pages while forwarding live events unchanged', async () => {
  const { HarnessRemoteBridge } = await import('../src/harness-remote-bridge.js')
  const snapshot = { type: 'snapshot', ...page() }
  const live = page().records[1]
  const publish = vi.fn(async () => undefined)
  const gateway = {
    dispatch: vi.fn(async () => ({ ok: true, value: page() })),
    open: vi.fn(async () => (async function* () { yield snapshot; yield live })()),
    failure: () => ({ code: 'FAILED', message: '', details: {} }),
    supportsCarrier: true,
  }
  const bridge = new HarnessRemoteBridge(gateway as never, publish)
  bridge.compactHistoryEnabled = true
  expect(await bridge.call({ endpoint: 'session/page', payload: { args: {} } })).toEqual({ ok: true, value: compactHistory(page()) })
  await bridge.openStream({ streamId: 'follow', endpoint: 'session/follow', payload: { args: {} } })
  await vi.waitFor(() => expect(publish).toHaveBeenCalledWith('harness.remote.stream.closed', { streamId: 'follow', reason: 'completed' }))
  expect(publish.mock.calls[0]).toEqual(['harness.remote.frame', { streamId: 'follow', hasValue: true, value: compactHistory(snapshot) }])
  expect(publish.mock.calls[1]).toEqual(['harness.remote.frame', { streamId: 'follow', hasValue: true, value: live }])
  await bridge.closeAll()
})
