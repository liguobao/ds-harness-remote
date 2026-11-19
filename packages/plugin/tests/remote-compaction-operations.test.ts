import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  readCompactionConfirmation,
  RemoteCompactionOperations,
  type RemoteCompactionConfirmation,
  type RemoteCompactionOwner,
} from '../src/remote-compaction-operations.js'
import { RpcError } from '../src/safe-error.js'
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
    const commandOnly: TypertRpcResult = {
      ok: true,
      value: {
        records: [
          { type: 'event', event: { type: 'command/run', seq: 10, time: 1_000, data: { commandId: 'cmd-9', name: 'compact' } } },
        ],
      },
    }
    expect(readCompactionConfirmation(commandOnly, 900, undefined)).toEqual({ kind: 'not-yet', commandRecorded: true })

    const result: TypertRpcResult = {
      ok: true,
      value: {
        records: [
          { type: 'event', event: { type: 'command/run', seq: 10, time: 1_000, data: { commandId: 'cmd-9', name: 'compact' } } },
          { type: 'event', event: { type: 'compaction/start', seq: 11, time: 1_001, data: { compactionId: 'c1', sourceCommandId: 'cmd-9' } } },
        ],
      },
    }
    expect(readCompactionConfirmation(result, 900, undefined)).toEqual({ kind: 'not-yet', started: true })
    const finished: TypertRpcResult = {
      ok: true,
      value: { records: [ ...(result.value as { records: unknown[] }).records,
        { type: 'event', event: { type: 'compaction/end', seq: 12, time: 1_002, data: { compactionId: 'c1', sourceCommandId: 'cmd-9', error: { message: 'cancelled' } } } } ] },
    }
    expect(readCompactionConfirmation(finished, 900, undefined)).toEqual({ kind: 'finished', error: 'cancelled' })
  })

  it('settles deterministic non-abort failures during cancel or timeout instead of deadlocking in cancelling', async () => {
    type Scenario = {
      name: string
      stopBy: 'cancel' | 'timeout'
      confirmation: RemoteCompactionConfirmation
      failRunner: (resolve: (value: TypertRpcResult) => void, reject: (error: unknown) => void) => void
      expectedState: 'failed' | 'unconfirmed'
      expectedMessage?: string
    }
    const scenarios: Scenario[] = [
      {
        name: 'cancel + rpc ok:false error + not-yet',
        stopBy: 'cancel',
        confirmation: { kind: 'not-yet' },
        failRunner: resolve => resolve({
          ok: false,
          error: { code: 'gateway/arguments-invalid', message: 'Invalid session.', details: {} },
        }),
        expectedState: 'failed',
        expectedMessage: 'Invalid session.',
      },
      {
        name: 'cancel + command kind:error + not-yet',
        stopBy: 'cancel',
        confirmation: { kind: 'not-yet' },
        failRunner: resolve => resolve({
          ok: true,
          value: { commandId: 'cmd-err', result: { kind: 'error', text: 'Nothing to compact.' } },
        }),
        expectedState: 'failed',
        expectedMessage: 'Nothing to compact.',
      },
      {
        name: 'cancel + command kind:error + commandRecorded without compaction/start',
        stopBy: 'cancel',
        confirmation: { kind: 'not-yet', commandRecorded: true },
        failRunner: resolve => resolve({
          ok: true,
          value: { commandId: 'cmd-err', result: { kind: 'error', text: 'Nothing to compact.' } },
        }),
        expectedState: 'failed',
        expectedMessage: 'Nothing to compact.',
      },
      {
        name: 'timeout + non-abort RpcError throw + not-yet',
        stopBy: 'timeout',
        confirmation: { kind: 'not-yet' },
        failRunner: (_resolve, reject) => reject(new RpcError('HARNESS_UNAVAILABLE', 'The Host Harness gateway is unavailable.')),
        expectedState: 'failed',
        expectedMessage: 'The Host Harness gateway is unavailable.',
      },
      {
        name: 'cancel + rpc ok:false error + unknown confirmation',
        stopBy: 'cancel',
        confirmation: { kind: 'unknown' },
        failRunner: resolve => resolve({
          ok: false,
          error: { code: 'session/not-found', message: 'Session not found.', details: {} },
        }),
        expectedState: 'unconfirmed',
      },
      {
        name: 'cancel + non-abort failure + committed compaction/end stays unconfirmed',
        stopBy: 'cancel',
        confirmation: { kind: 'finished' },
        failRunner: resolve => resolve({
          ok: false,
          error: { code: 'internal', message: 'Post-compaction failure.', details: {} },
        }),
        expectedState: 'unconfirmed',
      },
    ]

    await runScenarios(scenarios.map(scenario => ({
      name: scenario.name,
      run: async () => {
        try {
          if (scenario.stopBy === 'timeout') vi.useFakeTimers()
          let call = 0
          let resolveFirst: (value: TypertRpcResult) => void = () => {}
          let rejectFirst: (error: unknown) => void = () => {}
          const ops = new RemoteCompactionOperations(
            () => {
              call += 1
              if (call === 1) {
                return new Promise<TypertRpcResult>((resolve, reject) => {
                  resolveFirst = resolve
                  rejectFirst = reject
                })
              }
              return Promise.resolve(success)
            },
            { confirm: async () => scenario.confirmation },
          )

          const first = ops.submit({
            sessionId: 'session-1',
            requestId: `req-first-${scenario.name}`,
            budgetMs: 60_000,
          }, owner)

          let settled
          if (scenario.stopBy === 'cancel') {
            const cancelling = ops.cancel({ sessionId: 'session-1', operationId: first.operationId }, owner)
            scenario.failRunner(resolveFirst, rejectFirst)
            settled = await cancelling
          } else {
            await vi.advanceTimersByTimeAsync(60_000)
            scenario.failRunner(resolveFirst, rejectFirst)
            await vi.waitFor(async () => expect((await statusOf(ops, first.operationId)).finishedAt).toBeDefined())
            settled = await statusOf(ops, first.operationId)
          }

          expect(settled.state).toBe(scenario.expectedState)
          expect(settled.finishedAt).toBeTypeOf('number')
          if (scenario.expectedMessage !== undefined) {
            expect(settled.message).toBe(scenario.expectedMessage)
          }

          const second = ops.submit({ sessionId: 'session-1', requestId: `req-next-${scenario.name}` }, owner)
          expect(second.state).toBe('accepted')
          await vi.waitFor(async () => expect((await statusOf(ops, second.operationId)).state).toBe('succeeded'))
        } finally {
          vi.useRealTimers()
        }
      },
    })))
  })

  it('keeps cancelling grace window for prefixed and cause-wrapped cancel or budget timeout errors', async () => {
    const cases = [
      {
        name: 'timeout + prefixed budget message thrown',
        stopBy: 'timeout' as const,
        onAbort: (signal: AbortSignal, _resolve: (v: TypertRpcResult) => void, reject: (e: unknown) => void) => {
          reject(new Error(`typert gateway: commands/execute: ${(signal.reason as Error).message}`))
        },
      },
      {
        name: 'timeout + Error.cause wrapping signal.reason',
        stopBy: 'timeout' as const,
        onAbort: (signal: AbortSignal, _resolve: (v: TypertRpcResult) => void, reject: (e: unknown) => void) => {
          reject(new Error('gateway dispatch failed', { cause: signal.reason }))
        },
      },
      {
        name: 'cancel + Error.cause wrapping signal.reason',
        stopBy: 'cancel' as const,
        onAbort: (signal: AbortSignal, _resolve: (v: TypertRpcResult) => void, reject: (e: unknown) => void) => {
          reject(new Error('transport interrupted', { cause: signal.reason }))
        },
      },
      {
        name: 'timeout + ok:false prefixed budget message',
        stopBy: 'timeout' as const,
        onAbort: (signal: AbortSignal, resolve: (v: TypertRpcResult) => void) => {
          resolve({
            ok: false,
            error: {
              code: 'gateway/error',
              message: `typert gateway: commands/execute: ${(signal.reason as Error).message}`,
              details: {},
            },
          })
        },
      },
    ]

    await runScenarios(cases.map(item => ({
      name: item.name,
      run: async () => {
        try {
          vi.useFakeTimers()
          let call = 0
          const ops = new RemoteCompactionOperations(
            (_sessionId, signal) => {
              call += 1
              if (call === 1) {
                return new Promise<TypertRpcResult>((resolve, reject) => {
                  signal.addEventListener('abort', () => item.onAbort(signal, resolve, reject), { once: true })
                })
              }
              return Promise.resolve(success)
            },
            { confirm: async () => ({ kind: 'not-yet' }), cancellingGraceMs: 20_000 },
          )

          const first = ops.submit({ sessionId: 'session-1', requestId: `wrap-${item.name}`, budgetMs: 60_000 }, owner)
          if (item.stopBy === 'cancel') {
            expect((await ops.cancel({ sessionId: 'session-1', operationId: first.operationId }, owner)).state).toBe('cancelling')
          } else {
            await vi.advanceTimersByTimeAsync(60_000)
            expect((await statusOf(ops, first.operationId)).state).toBe('cancelling')
          }

          await vi.advanceTimersByTimeAsync(19_999)
          expect((await statusOf(ops, first.operationId)).state).toBe('cancelling')
          expect(() => ops.submit({ sessionId: 'session-1', requestId: `wrap-busy-${item.name}` }, owner))
            .toThrowError(expect.objectContaining({ code: 'AGENT_BUSY' }))

          await vi.advanceTimersByTimeAsync(1)
          await vi.waitFor(async () => expect((await statusOf(ops, first.operationId)).state).toBe('unconfirmed'))
          expect((await statusOf(ops, first.operationId)).finishedAt).toBeTypeOf('number')
        } finally {
          vi.useRealTimers()
        }
      },
    })))
  })

  it('keeps cancelling grace window when session log already shows compaction/start or command/run on non-abort failure', async () => {
    const cases = [
      {
        name: 'compaction/start observed + non-abort ok:false',
        eventsResult: {
          ok: true as const,
          value: {
            records: [
              { type: 'event', event: { type: 'command/run', seq: 10, time: 1_000, data: { commandId: 'cmd-10', name: 'compact' } } },
              { type: 'event', event: { type: 'compaction/start', seq: 11, time: 1_001, data: { compactionId: 'c10', sourceCommandId: 'cmd-10' } } },
            ],
          },
        },
        failRunner: (resolve: (v: TypertRpcResult) => void) => resolve({
          ok: false,
          error: { code: 'internal', message: 'IPC channel dropped.', details: {} },
        }),
      },
      {
        name: 'command/run observed + non-abort thrown error',
        eventsResult: {
          ok: true as const,
          value: {
            records: [
              { type: 'event', event: { type: 'command/run', seq: 10, time: 1_000, data: { commandId: 'cmd-11', name: 'compact' } } },
            ],
          },
        },
        failRunner: (_resolve: (v: TypertRpcResult) => void, reject: (e: unknown) => void) => {
          reject(new Error('local peer disconnected'))
        },
      },
    ]

    await runScenarios(cases.map(item => ({
      name: item.name,
      run: async () => {
        try {
          vi.useFakeTimers({ now: 1_000 })
          let resolveFirst: (value: TypertRpcResult) => void = () => {}
          let rejectFirst: (error: unknown) => void = () => {}
          const ops = new RemoteCompactionOperations(
            () => new Promise<TypertRpcResult>((resolve, reject) => {
              resolveFirst = resolve
              rejectFirst = reject
            }),
            {
              confirm: async (_sessionId, acceptedAt, commandId) =>
                readCompactionConfirmation(item.eventsResult, acceptedAt, commandId),
              cancellingGraceMs: 25_000,
            },
          )

          const first = ops.submit({ sessionId: 'session-1', requestId: `started-${item.name}` }, owner)
          const cancelling = ops.cancel({ sessionId: 'session-1', operationId: first.operationId }, owner)
          item.failRunner(resolveFirst, rejectFirst)
          expect((await cancelling).state).toBe('cancelling')

          await vi.advanceTimersByTimeAsync(24_999)
          expect((await statusOf(ops, first.operationId)).state).toBe('cancelling')
          expect(() => ops.submit({ sessionId: 'session-1', requestId: `started-busy-${item.name}` }, owner))
            .toThrowError(expect.objectContaining({ code: 'AGENT_BUSY' }))

          await vi.advanceTimersByTimeAsync(1)
          await vi.waitFor(async () => expect((await statusOf(ops, first.operationId)).state).toBe('unconfirmed'))
          expect((await statusOf(ops, first.operationId)).finishedAt).toBeTypeOf('number')
        } finally {
          vi.useRealTimers()
        }
      },
    })))
  })

  it('settles unobservable RPC errors to unconfirmed when no confirmer is configured', async () => {
    await runScenarios([
      {
        name: 'confirm undefined + ok:false -> unconfirmed',
        run: async () => {
          let resolveFirst: (value: TypertRpcResult) => void = () => {}
          const ops = new RemoteCompactionOperations(
            () => new Promise<TypertRpcResult>(resolve => { resolveFirst = resolve }),
          )
          const first = ops.submit({ sessionId: 'session-1', requestId: 'no-confirm-rpc' }, owner)
          const cancelling = ops.cancel({ sessionId: 'session-1', operationId: first.operationId }, owner)
          resolveFirst({
            ok: false,
            error: { code: 'session/not-found', message: 'Session not found.', details: {} },
          })
          const settled = await cancelling
          expect(settled.state).toBe('unconfirmed')
          expect(settled.finishedAt).toBeTypeOf('number')
        },
      },
      {
        name: 'confirm undefined + command kind:error -> failed',
        run: async () => {
          let resolveFirst: (value: TypertRpcResult) => void = () => {}
          const ops = new RemoteCompactionOperations(
            () => new Promise<TypertRpcResult>(resolve => { resolveFirst = resolve }),
          )
          const first = ops.submit({ sessionId: 'session-1', requestId: 'no-confirm-cmd-err' }, owner)
          const cancelling = ops.cancel({ sessionId: 'session-1', operationId: first.operationId }, owner)
          resolveFirst({
            ok: true,
            value: { commandId: 'cmd-12', result: { kind: 'error', text: 'Nothing to compact.' } },
          })
          const settled = await cancelling
          expect(settled.state).toBe('failed')
          expect(settled.message).toBe('Nothing to compact.')
          expect(settled.finishedAt).toBeTypeOf('number')
        },
      },
    ])
  })

  it('bounds cancelling by grace window for withAbort runs while preserving in-window concurrency protection and late confirmation', async () => {
    vi.useFakeTimers()
    let confirmation: RemoteCompactionConfirmation = { kind: 'not-yet' }
    let call = 0
    const ops = new RemoteCompactionOperations(
      (_sessionId, signal) => {
        call += 1
        if (call === 1) {
          return new Promise<TypertRpcResult>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        }
        if (call === 2) {
          return new Promise<TypertRpcResult>(resolve => {
            signal.addEventListener('abort', () => resolve({
              ok: false,
              error: { code: 'gateway/aborted', message: 'Request aborted.', details: {} },
            }), { once: true })
          })
        }
        return Promise.resolve(success)
      },
      { confirm: async () => confirmation, cancellingGraceMs: 30_000 },
    )

    // Case 1: stays cancelling during grace window, then honors late `finished`.
    const first = ops.submit({ sessionId: 'session-1', requestId: 'grace-1' }, owner)
    expect((await ops.cancel({ sessionId: 'session-1', operationId: first.operationId }, owner)).state).toBe('cancelling')
    await vi.advanceTimersByTimeAsync(29_000)
    expect((await statusOf(ops, first.operationId)).state).toBe('cancelling')
    expect((await statusOf(ops, first.operationId)).finishedAt).toBeUndefined()
    expect(() => ops.submit({ sessionId: 'session-1', requestId: 'grace-blocked' }, owner))
      .toThrowError(expect.objectContaining({ code: 'AGENT_BUSY' }))

    confirmation = { kind: 'finished', error: 'aborted' }
    expect((await statusOf(ops, first.operationId)).state).toBe('cancelled')

    // Case 2: persistent `not-yet` past grace window settles to `unconfirmed` and unlocks the session.
    confirmation = { kind: 'not-yet' }
    const second = ops.submit({ sessionId: 'session-1', requestId: 'grace-2' }, owner)
    expect((await ops.cancel({ sessionId: 'session-1', operationId: second.operationId }, owner)).state).toBe('cancelling')
    await vi.advanceTimersByTimeAsync(29_999)
    expect((await statusOf(ops, second.operationId)).state).toBe('cancelling')
    expect(() => ops.submit({ sessionId: 'session-1', requestId: 'grace-still-busy' }, owner))
      .toThrowError(expect.objectContaining({ code: 'AGENT_BUSY' }))

    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(async () => expect((await statusOf(ops, second.operationId)).state).toBe('unconfirmed'))
    const expired = await statusOf(ops, second.operationId)
    expect(expired.finishedAt).toBeTypeOf('number')

    const third = ops.submit({ sessionId: 'session-1', requestId: 'grace-3' }, owner)
    expect(third.state).toBe('accepted')
    await vi.waitFor(async () => expect((await statusOf(ops, third.operationId)).state).toBe('succeeded'))
  })

  it('reclaims global slots via prune() after cancelling operations expire into unconfirmed', async () => {
    vi.useFakeTimers()
    const ops = new RemoteCompactionOperations(
      (_sessionId, signal) => new Promise<TypertRpcResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      }),
      {
        confirm: async () => { throw new Error('session/events unavailable') },
        cancellingGraceMs: 10_000,
      },
    )

    const ids: Array<{ sessionId: string; operationId: string }> = []
    for (let i = 0; i < 32; i += 1) {
      const sessionId = `session-${i}`
      const submitted = ops.submit({ sessionId, requestId: `req-${i}` }, owner)
      ids.push({ sessionId, operationId: submitted.operationId })
      expect((await ops.cancel({ sessionId, operationId: submitted.operationId }, owner)).state).toBe('cancelling')
    }

    expect(() => ops.submit({ sessionId: 'session-overflow', requestId: 'req-overflow' }, owner))
      .toThrowError(expect.objectContaining({ code: 'RATE_LIMITED' }))

    // Expire the cancelling grace window without polling status().
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(async () => expect((await statusOf(ops, ids[0]!.operationId, ids[0]!.sessionId)).state).toBe('unconfirmed'))

    // Advance past RETENTION_MS (600s) so prune() clears all 32 settled operations.
    await vi.advanceTimersByTimeAsync(600_000)
    const fresh = ops.submit({ sessionId: 'session-overflow', requestId: 'req-overflow' }, owner)
    expect(fresh.state).toBe('accepted')
    expect((await statusOf(ops, ids[0]!.operationId, ids[0]!.sessionId)).state).toBe('interrupted')
    ops.closeAll()
  })

  it('expires budget-timed-out withAbort operations into unconfirmed even when status is never polled', async () => {
    vi.useFakeTimers()
    let call = 0
    const ops = new RemoteCompactionOperations(
      (_sessionId, signal) => {
        call += 1
        if (call === 1) {
          return new Promise<TypertRpcResult>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
        }
        return Promise.resolve(success)
      },
      { confirm: async () => ({ kind: 'not-yet' }), cancellingGraceMs: 15_000 },
    )

    const first = ops.submit({ sessionId: 'session-1', requestId: 'timeout-1', budgetMs: 60_000 }, owner)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(() => ops.submit({ sessionId: 'session-1', requestId: 'timeout-2' }, owner))
      .toThrowError(expect.objectContaining({ code: 'AGENT_BUSY' }))

    await vi.advanceTimersByTimeAsync(15_000)
    const next = ops.submit({ sessionId: 'session-1', requestId: 'timeout-2' }, owner)
    expect(next.state).toBe('accepted')
    const prior = await statusOf(ops, first.operationId)
    expect(prior.state).toBe('unconfirmed')
    expect(prior.finishedAt).toBeTypeOf('number')
    await vi.waitFor(async () => expect((await statusOf(ops, next.operationId)).state).toBe('succeeded'))
  })
})
