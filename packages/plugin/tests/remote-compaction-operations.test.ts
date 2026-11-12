import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteCompactionOperations, type RemoteCompactionOwner } from '../src/remote-compaction-operations.js'
import type { TypertRpcResult } from '../src/typert-gateway-contract.js'

const owner: RemoteCompactionOwner = { deviceId: 'device-a', connectionId: 'conn-a' }
const other: RemoteCompactionOwner = { deviceId: 'device-b', connectionId: 'conn-b' }
const success: TypertRpcResult = { ok: true, value: { result: { kind: 'success', text: 'Compacted 42 messages.' } } }

function statusOf(ops: RemoteCompactionOperations, operationId: string, sessionId = 'session-1', who = owner) {
  return ops.status({ sessionId, operationId }, who)
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
    await vi.waitFor(() => expect(statusOf(ops, submitted.operationId).state).toBe('succeeded'))
    expect(statusOf(ops, submitted.operationId)).toMatchObject({
      sessionId: 'session-1',
      state: 'succeeded',
      message: 'Compacted 42 messages.',
    })
    expect(statusOf(ops, submitted.operationId).finishedAt).toBeTypeOf('number')
  })

  it('turns a non-success Host command result into a failure, never a success', async () => {
    const ops = new RemoteCompactionOperations(async () => ({
      ok: true,
      value: { result: { kind: 'error', text: 'Nothing to compact.' } },
    }))
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-2' }, owner)
    await vi.waitFor(() => expect(statusOf(ops, operationId).state).toBe('failed'))
    expect(statusOf(ops, operationId).message).toBe('Nothing to compact.')
  })

  it('deduplicates retries by requestId so a lost response cannot start twice', async () => {
    const runner = vi.fn(async () => success)
    const ops = new RemoteCompactionOperations(runner)
    const first = ops.submit({ sessionId: 'session-1', requestId: 'same' }, owner)
    const second = ops.submit({ sessionId: 'session-1', requestId: 'same' }, owner)
    const different = ops.submit({ sessionId: 'session-1', requestId: 'other' }, owner)

    expect(second.operationId).toBe(first.operationId)
    expect(different.operationId).not.toBe(first.operationId)
    await vi.waitFor(() => expect(statusOf(ops, first.operationId).state).toBe('succeeded'))
    expect(runner).toHaveBeenCalledTimes(2)
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

  it('cancels by aborting the Host call and waits for its settlement', async () => {
    const runner = vi.fn((_sessionId: string, signal: AbortSignal) => new Promise<TypertRpcResult>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const ops = new RemoteCompactionOperations(runner)
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-4' }, owner)
    await vi.waitFor(() => expect(statusOf(ops, operationId).state).toBe('running'))

    const cancelled = await ops.cancel({ sessionId: 'session-1', operationId }, owner)
    expect(cancelled.state).toBe('cancelled')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('fails a run that exceeds its own budget instead of hanging forever', async () => {
    vi.useFakeTimers()
    const runner = vi.fn((_sessionId: string, signal: AbortSignal) => new Promise<TypertRpcResult>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const ops = new RemoteCompactionOperations(runner)
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-5', budgetMs: 60_000 }, owner)
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(statusOf(ops, operationId).state).toBe('failed'))
    expect(statusOf(ops, operationId).message).toContain('budget')
  })

  it('reports an unknown operation as interrupted after a Host restart', () => {
    const ops = new RemoteCompactionOperations(async () => success)
    expect(ops.status({ sessionId: 'session-1', operationId: '00000000-0000-4000-8000-000000000000' }, owner))
      .toMatchObject({ state: 'interrupted' })
  })

  it('stops and reports unfinished operations as interrupted on shutdown', async () => {
    const ops = new RemoteCompactionOperations(() => new Promise<TypertRpcResult>(() => {}))
    const { operationId } = ops.submit({ sessionId: 'session-1', requestId: 'request-6' }, owner)
    ops.closeAll()
    expect(statusOf(ops, operationId).state).toBe('interrupted')
    expect(() => ops.submit({ sessionId: 'session-1', requestId: 'request-7' }, owner))
      .toThrowError(expect.objectContaining({ code: 'HARNESS_UNAVAILABLE' }))
  })
})
