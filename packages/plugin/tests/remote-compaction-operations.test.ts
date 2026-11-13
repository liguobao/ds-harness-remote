import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readCompactionConfirmation,
  RemoteCompactionOperations,
  type RemoteCompactionConfirmation,
  type RemoteCompactionOwner,
} from '../src/remote-compaction-operations.js'
import type { TypertRpcResult } from '../src/typert-gateway-contract.js'

const owner: RemoteCompactionOwner = { deviceId: 'device-a', connectionId: 'conn-a' }
const other: RemoteCompactionOwner = { deviceId: 'device-b', connectionId: 'conn-b' }
const success: TypertRpcResult = { ok: true, value: { commandId: 'cmd-1', result: { kind: 'success', text: 'Compacted 42 messages.' } } }

async function statusOf(
  ops: RemoteCompactionOperations,
  operationId: string,
  sessionId = 'session-1',
  who = owner,
) {
  return await ops.status({ sessionId, operationId }, who)
}

describe('RemoteCompactionOperations', () => {
  afterEach(() => { vi.useRealTimers() })

  it('accepts immediately, then reports the Host call result', async () => {
    let finish: (value: TypertRpcResult) => void = () => {}
    const runner = vi.fn(() => new Promise<TypertRpcResult>(resolve => { finish = resolve }))
    const ops = new RemoteCompactionOperations(runner)

    const submitted = ops.submit({ sessionId: 'session-1', requestId: 'request-1' }, owner)
    expect(submitted.state).toBe('accepted')
    expect(runner).toHaveBeenCalledTimes(1)

    finish(success)
    await vi.waitFor(async () => expect((await statusOf(ops, submitted.operationId)).state).toBe('succeeded'))
    expect(await statusOf(ops, submitted.operationId)).toMatchObject({
      sessionId: 'session-1',
      state: 'succeeded',
      message: 'Compacted 42 messages.',
    })
  })

  it('turns a non-success Host command result into a failure, never a success', async () => {
    const ops = new RemoteCompactionOperations(async () => ({
      ok: true,
      value: { commandId: 'cmd-2', result: { kind: 'error', text: 'Nothing to compact.' } },
    }))
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-2' }, owner)
    await vi.waitFor(async () => expect((await statusOf(ops, operationId)).state).toBe('failed'))
    expect((await statusOf(ops, operationId)).message).toBe('Nothing to compact.')
  })

  it('deduplicates retries by requestId so a lost response cannot start twice', async () => {
    let finish: (value: TypertRpcResult) => void = () => {}
    const runner = vi.fn(() => new Promise<TypertRpcResult>(resolve => { finish = resolve }))
    const ops = new RemoteCompactionOperations(runner)
    const first = ops.submit({ sessionId: 'session-1', requestId: 'same' }, owner)
    const second = ops.submit({ sessionId: 'session-1', requestId: 'same' }, owner)
    expect(second.operationId).toBe(first.operationId)
    // A new request id while the same Session is still compacting must not stack.
    expect(() => ops.submit({ sessionId: 'session-1', requestId: 'other' }, owner))
      .toThrowError(expect.objectContaining({ code: 'AGENT_BUSY' }))
    finish(success)
    await vi.waitFor(async () => expect((await statusOf(ops, first.operationId)).state).toBe('succeeded'))
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('refuses a second unfinished compaction for the same Session', async () => {
    const ops = new RemoteCompactionOperations(() => new Promise<TypertRpcResult>(() => {}))
    ops.submit({ sessionId: 'session-1', requestId: 'first' }, owner)
    expect(() => ops.submit({ sessionId: 'session-1', requestId: 'second' }, owner))
      .toThrowError(expect.objectContaining({ code: 'AGENT_BUSY' }))
  })

  it('refuses status and cancel from another device', async () => {
    const ops = new RemoteCompactionOperations(() => new Promise<TypertRpcResult>(() => {}))
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-3' }, owner)
    for (const action of [
      () => ops.status({ sessionId: 'session-1', operationId }, other),
      () => ops.cancel({ sessionId: 'session-1', operationId }, other),
    ]) {
      try {
        await action()
        throw new Error('expected a permission failure')
      } catch (error) {
        expect(error).toMatchObject({ code: 'PERMISSION_DENIED' })
      }
    }
  })

  it('keeps `cancelling` until the compaction lifecycle confirms the run stopped', async () => {
    let confirmation: RemoteCompactionConfirmation = { kind: 'not-yet' }
    const runner = vi.fn((_sessionId: string, signal: AbortSignal) => new Promise<TypertRpcResult>((_, reject) => {
      // Faithful `withAbort`: the command call rejects as soon as the signal
      // aborts, while the handler is still running.
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const ops = new RemoteCompactionOperations(runner, {
      confirm: async () => confirmation,
    })
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-4' }, owner)
    await vi.waitFor(async () => expect((await statusOf(ops, operationId)).state).toBe('running'))

    expect((await ops.cancel({ sessionId: 'session-1', operationId }, owner)).state).toBe('cancelling')
    expect((await statusOf(ops, operationId)).state).toBe('cancelling')

    confirmation = { kind: 'finished', error: 'aborted' }
    await vi.waitFor(async () => expect((await statusOf(ops, operationId)).state).toBe('cancelled'))
  })

  it('keeps the trustworthy success when cancellation races the compaction', async () => {
    let finish: (value: TypertRpcResult) => void = () => {}
    const ops = new RemoteCompactionOperations(() => new Promise<TypertRpcResult>(resolve => { finish = resolve }), {
      confirm: async () => ({ kind: 'not-yet' }),
    })
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-5' }, owner)
    await vi.waitFor(async () => expect((await statusOf(ops, operationId)).state).toBe('running'))
    const cancelling = ops.cancel({ sessionId: 'session-1', operationId }, owner)
    finish(success)
    expect((await cancelling).state).toBe('succeeded')
    expect((await statusOf(ops, operationId)).state).toBe('succeeded')
  })

  it('treats a committed run with unobservable persistence as unconfirmed, not success', async () => {
    const runner = vi.fn((_sessionId: string, signal: AbortSignal) => new Promise<TypertRpcResult>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const ops = new RemoteCompactionOperations(runner, {
      confirm: async () => ({ kind: 'finished' }),
    })
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-6' }, owner)
    await vi.waitFor(async () => expect((await statusOf(ops, operationId)).state).toBe('running'))
    const cancelled = await ops.cancel({ sessionId: 'session-1', operationId }, owner)
    expect(cancelled.state).toBe('unconfirmed')
    expect(cancelled.message).toContain('persistence')
  })

  it('applies the same confirmation rule to a budget timeout', async () => {
    vi.useFakeTimers()
    let confirmation: RemoteCompactionConfirmation = { kind: 'not-yet' }
    const runner = vi.fn((_sessionId: string, signal: AbortSignal) => new Promise<TypertRpcResult>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const ops = new RemoteCompactionOperations(runner, { confirm: async () => confirmation })
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-7', budgetMs: 60_000 }, owner)
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(async () => expect((await statusOf(ops, operationId)).state).toBe('cancelling'))

    confirmation = { kind: 'finished', error: 'aborted by timeout' }
    await vi.waitFor(async () => expect((await statusOf(ops, operationId)).state).toBe('failed'))
  })

  it('reports an unknown operation as interrupted after a Host restart', async () => {
    const ops = new RemoteCompactionOperations(async () => success)
    expect(await ops.status({ sessionId: 'session-1', operationId: '00000000-0000-4000-8000-000000000000' }, owner))
      .toMatchObject({ state: 'interrupted' })
  })

  it('stops and reports unfinished operations as interrupted on shutdown', async () => {
    const ops = new RemoteCompactionOperations(() => new Promise<TypertRpcResult>(() => {}))
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-8' }, owner)
    ops.closeAll()
    expect((await statusOf(ops, operationId)).state).toBe('interrupted')
    expect(() => ops.submit({ sessionId: 'session-1', requestId: 'request-9' }, owner))
      .toThrowError(expect.objectContaining({ code: 'HARNESS_UNAVAILABLE' }))
  })

  it('reads the compaction lifecycle from session/events records', () => {
    const result: TypertRpcResult = {
      ok: true,
      value: {
        records: [
          { type: 'event', event: { type: 'command/run', seq: 10, time: 1_000, data: { commandId: 'cmd-9', name: 'compact' } } },
          { type: 'event', event: { type: 'compaction/start', seq: 11, time: 1_001, data: { compactionId: 'c1', sourceCommandId: 'cmd-9' } } },
        ],
      },
    }
    expect(readCompactionConfirmation(result, 900, undefined)).toEqual({ kind: 'not-yet' })
    const finished: TypertRpcResult = {
      ok: true,
      value: { records: [ ...(result.value as { records: unknown[] }).records,
        { type: 'event', event: { type: 'compaction/end', seq: 12, time: 1_002, data: { compactionId: 'c1', sourceCommandId: 'cmd-9', error: { message: 'cancelled' } } } } ] },
    }
    expect(readCompactionConfirmation(finished, 900, undefined)).toEqual({ kind: 'finished', error: 'cancelled' })
  })
})
