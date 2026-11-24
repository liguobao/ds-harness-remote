import { generateKeyPairSync } from 'node:crypto'
import {
  ATTENTION_INBOX_CAPABILITY,
  ATTENTION_SIGNAL_CAPABILITY,
  ATTENTION_TOKEN_PATTERN,
  MAX_ATTENTION_ITEMS,
  MAX_ATTENTION_SUMMARY_CHARS,
  MAX_ATTENTION_TITLE_CHARS,
  attentionDigestSchema,
  createControlFrame,
  createRpcRequest,
  type AttentionDigest,
  type AttentionFollowEvent,
  type RemoteMessage,
  type RpcResponsePayload,
} from '@dsh-remote/protocol'
import { createRemoteAttentionClient } from '@dsh-remote/client-core'
import { describe, expect, it, vi } from 'vitest'
import {
  HostAttentionTracker,
  NORMAL_TURN_COMPLETED_MIN_MS,
} from '../src/attention-tracker.js'
import { resolveConfig } from '../src/config.js'
import { ConnectionController } from '../src/connection-controller.js'
import type { HostIdentity, IdentityStore } from '../src/identity-store.js'
import type { SafeLogger } from '../src/logging.js'
import { createOwnerPeerFactory, ownerPeerConstructor } from '../src/owner-peer.js'
import { HarnessRemoteBridge } from '../src/harness-remote-bridge.js'
import { PluginRouteBridge } from '../src/plugin-route-bridge.js'
import { RpcRouter } from '../src/rpc-router.js'
import { HostServerConnection } from '../src/server-connection.js'
import type { HostServerApi } from '../src/server-api.js'
import { HostPluginRuntime } from '../src/service.js'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'
import type { AuthenticatedPeerChannel } from '../src/types.js'

function silentLogger(): SafeLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as SafeLogger
}

function createManualEventStream() {
  const queue: unknown[] = []
  let waiting: ((result: IteratorResult<unknown>) => void) | undefined
  let ended = false
  let returned = false
  const stream: AsyncIterable<unknown> = {
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      return {
        next() {
          if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift() })
          if (ended) return Promise.resolve({ done: true, value: undefined })
          return new Promise(resolve => { waiting = resolve })
        },
        return() {
          returned = true
          ended = true
          waiting?.({ done: true, value: undefined })
          waiting = undefined
          return Promise.resolve({ done: true, value: undefined })
        },
      }
    },
  }
  return {
    stream,
    push(frame: unknown) {
      if (ended) return
      if (waiting !== undefined) {
        const resolve = waiting
        waiting = undefined
        resolve({ done: false, value: frame })
      } else {
        queue.push(frame)
      }
    },
    end() {
      ended = true
      waiting?.({ done: true, value: undefined })
      waiting = undefined
    },
    wasReturned: () => returned,
  }
}

describe('HostAttentionTracker', () => {
  function createRealisticGateway(options: {
    controlStream?: AsyncIterable<unknown>
    eventsStream?: AsyncIterable<unknown> | (() => AsyncIterable<unknown>)
    onControlOpen?: (signal: AbortSignal) => void
    onDispose?: (interactions: 'answer' | 'none') => void
    onDispatch?: (endpoint: string, payload: unknown, interactions: 'answer' | 'none') => { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
  } = {}) {
    const openedEndpoints: Array<{ endpoint: string; interactions: 'answer' | 'none' }> = []
    const createdPeers: Array<{ interactions: 'answer' | 'none'; gateway: LocalTypertGateway }> = []
    const rootDispatch = vi.fn()
    const rootOpen = vi.fn()

    const makePeerGateway = (interactions: 'answer' | 'none'): LocalTypertGateway => {
      const peerGateway: LocalTypertGateway = {
        supportsCarrier: true,
        invoke: vi.fn(),
        dispatch: vi.fn(async (endpoint, payload) => {
          if (options.onDispatch !== undefined) return options.onDispatch(endpoint, payload, interactions)
          if (endpoint === '$events/result') {
            // Mirrors real Gateway: accepts result without sending `cancel` back to the answering client.
            return { ok: true as const, value: undefined }
          }
          return { ok: true as const, value: undefined }
        }),
        open: vi.fn(async (endpoint, _payload, signal) => {
          openedEndpoints.push({ endpoint, interactions })
          // Mirrors @deepseek-ai/dsh-api-gateway requireInteractions(peer, endpoint)
          if (endpoint === '$events' && interactions !== 'answer') {
            throw Object.assign(
              new Error('forwarded Remote events require interactions=answer'),
              { code: 'gateway/interactions-forbidden' },
            )
          }
          if (endpoint === 'session/control') {
            options.onControlOpen?.(signal)
            if (options.controlStream === undefined) {
              throw Object.assign(new Error('not found'), { code: 'gateway/not-found' })
            }
            return options.controlStream
          }
          if (endpoint === '$events') {
            const stream = typeof options.eventsStream === 'function' ? options.eventsStream() : options.eventsStream
            if (stream === undefined) {
              throw Object.assign(new Error('service unavailable'), { code: 'gateway/service-unavailable' })
            }
            return stream
          }
          throw Object.assign(new Error(`unexpected endpoint ${endpoint}`), { code: 'gateway/not-found' })
        }),
        failure: error => ({
          code: error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'internal',
          message: error instanceof Error ? error.message : 'fail',
          details: {},
        }),
        dispose: vi.fn(async () => {
          options.onDispose?.(interactions)
        }),
      }
      createdPeers.push({ interactions, gateway: peerGateway })
      return peerGateway
    }

    const rootGateway: LocalTypertGateway = {
      supportsCarrier: true,
      invoke: vi.fn(),
      dispatch: rootDispatch,
      open: rootOpen,
      failure: error => ({
        code: error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'internal',
        message: error instanceof Error ? error.message : 'fail',
        details: {},
      }),
      createPeer: vi.fn((peerOptions?: { interactions?: 'answer' | 'none' }) => (
        makePeerGateway(peerOptions?.interactions ?? 'answer')
      )),
    }

    return { rootGateway, openedEndpoints, createdPeers, rootDispatch, rootOpen }
  }

  it('opens passive session/control (never $events) on interactions:"none", tracks title + userQuestions, and cleans up abort -> iterator.return -> peer.dispose', async () => {
    const lifecycle: string[] = []
    const manual = createManualEventStream()
    let observedSignal: AbortSignal | undefined

    const wrappedControlStream: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        const inner = manual.stream[Symbol.asyncIterator]()
        return {
          next: () => inner.next(),
          return: async () => {
            lifecycle.push('iterator.return')
            return inner.return!()
          },
        }
      },
    }

    const realistic = createRealisticGateway({
      controlStream: wrappedControlStream,
      onControlOpen: signal => {
        observedSignal = signal
        signal.addEventListener('abort', () => { lifecycle.push('abort') }, { once: true })
      },
      onDispose: interactions => {
        if (interactions === 'none') lifecycle.push('peer.dispose')
      },
    })

    const digests: AttentionDigest[] = []
    const tracker = new HostAttentionTracker({
      localGateway: realistic.rootGateway,
      onDigest: digest => { digests.push(digest) },
      logger: silentLogger(),
      debounceMs: 50,
    })

    tracker.start('0.2.2')
    await vi.waitFor(() => { expect(realistic.openedEndpoints).toHaveLength(1) })
    expect(realistic.openedEndpoints).toEqual([{ endpoint: 'session/control', interactions: 'none' }])
    // Never reuse rootGateway/fallbackPeer and never scan session/list!
    expect(realistic.rootOpen).not.toHaveBeenCalled()
    expect(realistic.rootDispatch).not.toHaveBeenCalled()
    expect(realistic.createdPeers[0]!.gateway.dispatch).not.toHaveBeenCalled()

    // Baseline populates title metadata and an active durable userQuestion
    manual.push({
      type: 'baseline',
      value: {
        projections: {
          'sess-1': {
            asOfSeq: 10,
            values: {
              title: 'Release Pipeline',
              userQuestions: {
                active: [{
                  callId: 'call-1',
                  state: 'open',
                  questions: [{ question: 'Deploy to staging?' }],
                }],
                settled: [],
              },
            },
          },
        },
      },
    })
    await vi.waitFor(() => {
      expect(tracker.list().items).toHaveLength(1)
    })
    expect(tracker.list().items[0]).toMatchObject({
      backend: 'harness',
      mode: 'agent',
      sessionId: 'sess-1',
      sessionTitle: 'Release Pipeline',
      status: 'waiting_question',
      summary: 'Deploy to staging?',
    })
    const qDigest = digests.find(d => d.urgentKind === 'question_needed')!
    expect(qDigest).toBeDefined()
    expect(attentionDigestSchema.parse(qDigest)).toEqual(qDigest)
    expect(qDigest.urgency).toBe('critical')
    expect(qDigest.pendingQuestions).toBe(1)
    expect(qDigest.attentionToken).toMatch(ATTENTION_TOKEN_PATTERN)
    expect(JSON.stringify(qDigest)).not.toContain('sess-1')
    expect(JSON.stringify(qDigest)).not.toContain('Release Pipeline')

    // Projection `changes[]` format updates title + resolves settled question -> emits clear
    manual.push({
      type: 'projection',
      sessionId: 'sess-1',
      seq: 11,
      changes: [
        { key: 'title', val: 'Release Pipeline v2' },
        {
          key: 'userQuestions',
          val: {
            active: [],
            settled: [{ callId: 'call-1' }],
          },
        },
      ],
    })
    await vi.waitFor(() => {
      expect(tracker.list().items).toHaveLength(0)
    })
    const clearDigest = digests.find(d => d.urgentKind === 'clear')!
    expect(clearDigest).toMatchObject({
      pendingQuestions: 0,
      pendingApprovals: 0,
      urgency: 'silent',
    })

    // Projection `{ key, value }` single-field format also adds and clears a question
    manual.push({
      type: 'projection',
      sessionId: 'sess-1',
      seq: 12,
      key: 'userQuestions',
      value: {
        active: [{
          callId: 'call-2',
          state: 'continued',
          questions: [{ header: 'Approve rollout window?' }],
        }],
        settled: [],
      },
    })
    await vi.waitFor(() => {
      expect(tracker.list().items).toHaveLength(1)
    })
    expect(tracker.list().items[0]).toMatchObject({
      sessionId: 'sess-1',
      sessionTitle: 'Release Pipeline v2',
      status: 'waiting_question',
      summary: 'Approve rollout window?',
    })

    manual.push({
      type: 'projection',
      sessionId: 'sess-1',
      seq: 13,
      key: 'userQuestions',
      value: null,
    })
    await vi.waitFor(() => {
      expect(tracker.list().items).toHaveLength(0)
    })

    await tracker.close()
    expect(observedSignal?.aborted).toBe(true)
    expect(manual.wasReturned()).toBe(true)
    expect(realistic.createdPeers[0]!.gateway.dispose).toHaveBeenCalledTimes(1)
    expect(lifecycle.indexOf('abort')).toBeLessThan(lifecycle.indexOf('peer.dispose'))
    expect(lifecycle.indexOf('iterator.return')).toBeLessThan(lifecycle.indexOf('peer.dispose'))
  })

  it.each([
    'gateway/interactions-forbidden',
    'gateway/not-found',
    'gateway/invocation-unavailable',
  ])('exits immediately and disposes observer peer without retrying on terminal error %s', async terminalCode => {
    const logger = silentLogger()
    let openAttempts = 0
    const observerPeer: LocalTypertGateway = {
      supportsCarrier: true,
      invoke: vi.fn(),
      dispatch: vi.fn(),
      open: vi.fn(async () => {
        openAttempts += 1
        throw Object.assign(new Error(terminalCode), { code: terminalCode })
      }),
      failure: error => ({ code: (error as { code?: string }).code ?? 'internal', message: terminalCode, details: {} }),
      dispose: vi.fn(async () => undefined),
    }
    const rootGateway: LocalTypertGateway = {
      supportsCarrier: true,
      invoke: vi.fn(),
      dispatch: vi.fn(),
      open: vi.fn(),
      failure: () => ({ code: 'internal', message: 'fail', details: {} }),
      createPeer: () => observerPeer,
    }
    const tracker = new HostAttentionTracker({
      localGateway: rootGateway,
      logger,
      observerBackoffMs: [5, 5, 5],
    })
    tracker.start('0.2.2')
    await vi.waitFor(() => { expect(observerPeer.dispose).toHaveBeenCalledTimes(1) })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(openAttempts).toBe(1)
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    await tracker.close()
    // Must not double-dispose on close after terminal exit
    expect(observerPeer.dispose).toHaveBeenCalledTimes(1)
  })

  it('live-taps authenticated client $events frames through HarnessRemoteBridge into HostAttentionTracker', async () => {
    const eventsStream = createManualEventStream()
    const controlStream = createManualEventStream()
    let rejectNextResult = false
    const realistic = createRealisticGateway({
      controlStream: controlStream.stream,
      eventsStream: eventsStream.stream,
      onDispatch: endpoint => {
        if (endpoint === '$events/result' && rejectNextResult) {
          rejectNextResult = false
          return { ok: false, error: { code: 'gateway/interactions-forbidden', message: 'denied', details: {} } }
        }
        return { ok: true, value: undefined }
      },
    })

    let now = 1_000_000
    const digests: AttentionDigest[] = []
    const tracker = new HostAttentionTracker({
      localGateway: realistic.rootGateway,
      onDigest: digest => { digests.push(digest) },
      logger: silentLogger(),
      now: () => now,
      debounceMs: 50,
    })
    tracker.start('0.2.2')

    // Authenticated remote client receives its own legitimate `interactions: 'answer'` peer
    const clientPeer = realistic.rootGateway.createPeer!({ interactions: 'answer' })!
    const forwardedFrames: unknown[] = []
    const bridge = new HarnessRemoteBridge(
      clientPeer,
      async (event, data) => {
        if (event === 'harness.remote.frame') forwardedFrames.push(data)
      },
      silentLogger(),
      '0.2.2',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tracker.createHarnessBridgeObserver(),
    )

    try {
      await bridge.openStream({ streamId: 'ev-1', endpoint: '$events', payload: { args: {} } })
      expect(realistic.openedEndpoints).toContainEqual({ endpoint: '$events', interactions: 'answer' })

      eventsStream.push({ type: 'ready', clientId: 'cli-1', host: { home: '/home/dev' } })
      eventsStream.push({
        type: 'emit',
        event: 'api-session/added',
        args: [{ sessionId: 'sess-1', title: 'Build API', workspaceId: 'ws-1', workspaceLabel: 'repo' }],
      })
      eventsStream.push({ type: 'emit', event: 'api-session/status', args: ['sess-1', true] })
      await vi.waitFor(() => { expect(tracker.list().items).toHaveLength(1) })
      expect(tracker.list().items[0]).toMatchObject({
        backend: 'harness',
        mode: 'agent',
        sessionId: 'sess-1',
        sessionTitle: 'Build API',
        workspaceId: 'ws-1',
        workspaceLabel: 'repo',
        status: 'running',
      })

      // Approval waterfall emits immediate critical digest with opaque token
      eventsStream.push({
        type: 'waterfall',
        event: 'approval/request',
        eventId: 'ev-apr-1',
        agentId: 'sess-1',
        request: { toolName: 'bash', reason: 'Run tests' },
      })
      await vi.waitFor(() => {
        expect(digests.some(d => d.urgentKind === 'approval_needed')).toBe(true)
      })
      const approvalDigest = digests.find(d => d.urgentKind === 'approval_needed')!
      expect(approvalDigest).toMatchObject({ urgency: 'critical', pendingApprovals: 1 })
      expect(approvalDigest.attentionToken).toMatch(ATTENTION_TOKEN_PATTERN)

      // Question waterfall
      eventsStream.push({
        type: 'waterfall',
        event: 'user-questions/request',
        eventId: 'ev-q-1',
        agentId: 'sess-1',
        request: { questions: [{ question: 'Deploy to staging?' }] },
      })
      await vi.waitFor(() => {
        expect(digests.some(d => d.urgentKind === 'question_needed')).toBe(true)
      })
      expect(tracker.list().items.map(i => i.status)).toEqual(['waiting_question', 'waiting_approval', 'running'])

      // Realistic Gateway semantics: answering via `$events/result` does NOT push `cancel`
      // back to the answering client; the bridge must settle the item on `{ ok: true }`.
      const aprResult = await bridge.call({
        endpoint: '$events/result',
        payload: {
          args: {
            clientId: 'cli-1',
            eventId: 'ev-apr-1',
            outcome: { kind: 'result', value: { decision: 'allow_once' } },
          },
        },
      })
      expect(aprResult.ok).toBe(true)
      expect(tracker.list().items.map(i => i.status)).toEqual(['waiting_question', 'running'])

      // A failed `$events/result` must NOT clear the pending interaction.
      rejectNextResult = true
      const failedQ = await bridge.call({
        endpoint: '$events/result',
        payload: {
          args: {
            clientId: 'cli-1',
            eventId: 'ev-q-1',
            outcome: { kind: 'result', value: { answers: {} } },
          },
        },
      })
      expect(failedQ.ok).toBe(false)
      expect(tracker.list().items.map(i => i.status)).toEqual(['waiting_question', 'running'])

      // Settling the last blocking item via `$events/result` (without `cancel`) emits immediate `clear`.
      const qResult = await bridge.call({
        endpoint: '$events/result',
        payload: {
          args: {
            clientId: 'cli-1',
            eventId: 'ev-q-1',
            outcome: { kind: 'rejected', error: { message: 'dismissed' } },
          },
        },
      })
      expect(qResult.ok).toBe(true)
      expect(digests.some(d => d.urgentKind === 'clear')).toBe(true)
      expect(digests.find(d => d.urgentKind === 'clear')).toMatchObject({
        pendingApprovals: 0,
        pendingQuestions: 0,
        urgency: 'silent',
      })

      // Long turn (>= 15s) completion emits immediate normal turn_completed
      now += NORMAL_TURN_COMPLETED_MIN_MS + 1_000
      eventsStream.push({ type: 'emit', event: 'api-session/status', args: ['sess-1', false] })
      await vi.waitFor(() => {
        expect(digests.some(d => d.urgentKind === 'turn_completed' && d.urgency === 'normal')).toBe(true)
      })

      // Error event produces failed_unread and immediate turn_failed
      eventsStream.push({ type: 'emit', event: 'api-session/error', args: ['sess-2', 'Model quota exceeded'] })
      await vi.waitFor(() => {
        expect(digests.some(d => d.urgentKind === 'turn_failed' && d.urgency === 'normal')).toBe(true)
      })
      expect(forwardedFrames.length).toBeGreaterThanOrEqual(6)
    } finally {
      await bridge.closeAll()
      await tracker.close()
    }
  })

  it('purges transient $events approvals, non-projected questions, and running items only when the last forwarded stream closes', async () => {
    const controlStream = createManualEventStream()
    const streamA = createManualEventStream()
    const streamB = createManualEventStream()
    const streamC = createManualEventStream()
    const streamQueue = [streamA.stream, streamB.stream, streamC.stream]
    const realistic = createRealisticGateway({
      controlStream: controlStream.stream,
      eventsStream: () => streamQueue.shift()!,
    })

    const digests: AttentionDigest[] = []
    const tracker = new HostAttentionTracker({
      localGateway: realistic.rootGateway,
      onDigest: digest => { digests.push(digest) },
      logger: silentLogger(),
      debounceMs: 50,
    })
    tracker.start('0.2.2')

    const makeBridge = () => new HarnessRemoteBridge(
      realistic.rootGateway.createPeer!({ interactions: 'answer' })!,
      async () => undefined,
      silentLogger(),
      '0.2.2',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tracker.createHarnessBridgeObserver(),
    )

    const bridgeA = makeBridge()
    const bridgeB = makeBridge()
    const bridgeC = makeBridge()
    try {
      await vi.waitFor(() => { expect(realistic.openedEndpoints).toHaveLength(1) })
      // Durable projected userQuestion via passive session/control must survive $events disconnects.
      controlStream.push({
        type: 'projection',
        sessionId: 'sess-proj',
        seq: 1,
        key: 'userQuestions',
        value: {
          active: [{ callId: 'call-keep', state: 'open', questions: [{ question: 'Persist across disconnect?' }] }],
          settled: [],
        },
      })
      await vi.waitFor(() => {
        expect(tracker.list().items.some(i => i.id === 'harness:question:sess-proj:call-keep')).toBe(true)
      })

      await bridgeA.openStream({ streamId: 'ev-a', endpoint: '$events', payload: { args: {} } })
      await bridgeB.openStream({ streamId: 'ev-b', endpoint: '$events', payload: { args: {} } })

      streamA.push({ type: 'emit', event: 'api-session/status', args: ['sess-run', true] })
      streamA.push({ type: 'emit', event: 'api-session/error', args: ['sess-err', 'Tool failed'] })
      streamA.push({
        type: 'waterfall',
        event: 'approval/request',
        eventId: 'ev-apr-transient',
        agentId: 'sess-run',
        request: { toolName: 'bash', reason: 'Deploy' },
      })
      streamA.push({
        type: 'waterfall',
        event: 'user-questions/request',
        eventId: 'ev-q-transient',
        agentId: 'sess-run',
        request: { questions: [{ question: 'Transient prompt?' }] },
      })
      await vi.waitFor(() => {
        expect(tracker.list().items.map(i => i.id)).toEqual(expect.arrayContaining([
          'harness:question:sess-proj:call-keep',
          'harness:question:ev-q-transient',
          'harness:approval:ev-apr-transient',
          'harness:session:sess-run',
          'harness:session:sess-err',
        ]))
      })

      // Returning `outcome: { kind: 'next' }` on bridgeA while bridgeB still holds `$events` must NOT clear the approval.
      await bridgeA.call({
        endpoint: '$events/result',
        payload: { args: { clientId: 'cli-a', eventId: 'ev-apr-transient', outcome: { kind: 'next' } } },
      })
      expect(tracker.list().items.some(i => i.id === 'harness:approval:ev-apr-transient')).toBe(true)

      // Closing bridgeA while bridgeB remains open keeps transient items alive.
      await bridgeA.closeAll()
      expect(tracker.list().items.map(i => i.id)).toEqual(expect.arrayContaining([
        'harness:approval:ev-apr-transient',
        'harness:question:ev-q-transient',
        'harness:session:sess-run',
      ]))

      // Closing the last `$events` bridge purges transient approval/question/running items,
      // while preserving durable session/control userQuestions and unread completions.
      await bridgeB.closeAll()
      const remainingIds = tracker.list().items.map(i => i.id)
      expect(remainingIds).not.toContain('harness:approval:ev-apr-transient')
      expect(remainingIds).not.toContain('harness:question:ev-q-transient')
      expect(remainingIds).not.toContain('harness:session:sess-run')
      expect(remainingIds).toContain('harness:question:sess-proj:call-keep')
      expect(remainingIds).toContain('harness:session:sess-err')
      expect(tracker.list().digest).toMatchObject({
        pendingApprovals: 0,
        pendingQuestions: 1,
        runningSessions: 0,
        completedUnread: 1,
      })

      // Reconnecting a client re-delivers a still-pending waterfall with the same eventId cleanly.
      const beforeApprovalCount = digests.filter(d => d.urgentKind === 'approval_needed').length
      await bridgeC.openStream({ streamId: 'ev-c', endpoint: '$events', payload: { args: {} } })
      streamC.push({
        type: 'waterfall',
        event: 'approval/request',
        eventId: 'ev-apr-transient',
        agentId: 'sess-run',
        request: { toolName: 'bash', reason: 'Deploy' },
      })
      await vi.waitFor(() => {
        expect(tracker.list().items.some(i => i.id === 'harness:approval:ev-apr-transient')).toBe(true)
      })
      expect(digests.filter(d => d.urgentKind === 'approval_needed').length).toBe(beforeApprovalCount + 1)
    } finally {
      await bridgeA.closeAll()
      await bridgeB.closeAll()
      await bridgeC.closeAll()
      await tracker.close()
    }
  })

  it('deduplicates timed userQuestions observed on both session/control and live $events', async () => {
    const controlStream = createManualEventStream()
    const realistic = createRealisticGateway({ controlStream: controlStream.stream })
    const digests: AttentionDigest[] = []
    const tracker = new HostAttentionTracker({
      localGateway: realistic.rootGateway,
      onDigest: digest => { digests.push(digest) },
      logger: silentLogger(),
      debounceMs: 50,
    })
    tracker.start('0.2.2')
    try {
      await vi.waitFor(() => { expect(realistic.openedEndpoints).toHaveLength(1) })
      controlStream.push({
        type: 'projection',
        sessionId: 'sess-timed',
        seq: 1,
        key: 'userQuestions',
        value: {
          active: [{ callId: 'call-9', state: 'open', questions: [{ question: 'Continue?' }] }],
          settled: [],
        },
      })
      await vi.waitFor(() => { expect(tracker.list().items).toHaveLength(1) })

      // Matching $events waterfall for the same callId must NOT create a duplicate item or second critical push
      tracker.observeHarnessEventFrame({
        type: 'waterfall',
        event: 'user-questions/request',
        eventId: 'ev-timed-1',
        agentId: 'sess-timed',
        request: { wait: { timed: true, callId: 'call-9' }, questions: [{ question: 'Continue?' }] },
      })
      expect(tracker.list().items).toHaveLength(1)
      expect(digests.filter(d => d.urgency === 'critical')).toHaveLength(1)

      // Foreground $events cancel while question stays active (`continued`) in projection keeps the item alive
      tracker.observeHarnessEventFrame({ type: 'cancel', eventId: 'ev-timed-1' })
      expect(tracker.list().items).toHaveLength(1)

      // Settling via session/control clears it
      controlStream.push({
        type: 'projection',
        sessionId: 'sess-timed',
        seq: 2,
        key: 'userQuestions',
        value: { active: [], settled: [{ callId: 'call-9' }] },
      })
      await vi.waitFor(() => { expect(tracker.list().items).toHaveLength(0) })
    } finally {
      await tracker.close()
    }
  })

  it('never starts Harness observer when createPeer returns undefined/fallback or version < 0.2, and degrades silently on service-unavailable', async () => {
    const openRoot = vi.fn()
    const fallbackOnly: LocalTypertGateway = {
      supportsCarrier: true,
      invoke: vi.fn(),
      dispatch: vi.fn(),
      open: openRoot,
      failure: () => ({ code: 'internal', message: 'fail', details: {} }),
      createPeer: vi.fn(() => undefined),
    }
    const t1 = new HostAttentionTracker({ localGateway: fallbackOnly })
    t1.start('0.2.2')
    expect(openRoot).not.toHaveBeenCalled()
    await t1.close()

    const legacyGateway: LocalTypertGateway = {
      supportsCarrier: true,
      invoke: vi.fn(),
      dispatch: vi.fn(),
      open: openRoot,
      failure: () => ({ code: 'internal', message: 'fail', details: {} }),
      createPeer: vi.fn(),
    }
    const t2 = new HostAttentionTracker({ localGateway: legacyGateway })
    t2.start('0.1.7')
    expect(legacyGateway.createPeer).not.toHaveBeenCalled()
    await t2.close()

    // Bounded backoff on gateway/service-unavailable without warn spam
    const logger = silentLogger()
    let openAttempts = 0
    const unavailableObserver: LocalTypertGateway = {
      supportsCarrier: true,
      invoke: vi.fn(),
      dispatch: vi.fn(),
      open: vi.fn(async () => {
        openAttempts += 1
        throw Object.assign(new Error('unavailable'), { code: 'gateway/service-unavailable' })
      }),
      failure: error => ({ code: (error as { code?: string }).code ?? 'internal', message: 'unavailable', details: {} }),
      dispose: vi.fn(async () => undefined),
    }
    const gatewayWithUnavailable: LocalTypertGateway = {
      supportsCarrier: true,
      invoke: vi.fn(),
      dispatch: vi.fn(),
      open: vi.fn(),
      failure: () => ({ code: 'internal', message: 'fail', details: {} }),
      createPeer: () => unavailableObserver,
    }
    const t3 = new HostAttentionTracker({
      localGateway: gatewayWithUnavailable,
      logger,
      observerBackoffMs: [5, 5],
    })
    t3.start('0.2.2')
    await vi.waitFor(() => { expect(openAttempts).toBe(3) })
    expect(logger.warn).not.toHaveBeenCalled()
    expect(logger.error).not.toHaveBeenCalled()
    await t3.close()
    expect(unavailableObserver.dispose).toHaveBeenCalledTimes(1)
  })

  it('observes DS-Bot PluginRouteBridge responses with zero idle polling', async () => {
    const tracker = new HostAttentionTracker({ logger: silentLogger(), debounceMs: 50 })
    const dispatch = vi.fn(async (_route: string, body: unknown) => {
      const endpoint = (body as { endpoint: string }).endpoint
      if (endpoint === 'state') {
        return {
          status: 200,
          json: {
            ok: true,
            value: {
              workspaceId: 'bot-ws',
              bots: [{ id: 'b1', sessionId: 'bot-sess-1', name: 'Ops Bot' }],
              rooms: [],
              work: {
                bots: { b1: { active: true } },
                rooms: {},
                approvals: [{ id: 'apr-1', botId: 'b1', tool: 'shell', reason: 'Restart worker' }],
              },
              questions: {
                'bot-sess-1': { id: 'q-1', question: 'Confirm rollout?' },
              },
            },
          },
        }
      }
      return { status: 200, json: { ok: true, value: { resolved: true } } }
    })

    const bridge = new PluginRouteBridge(dispatch, silentLogger(), (route, body, result) => {
      tracker.observeBotResponse(route, body, result)
    })

    // Zero polling until a real client call traverses PluginRouteBridge.
    expect(dispatch).not.toHaveBeenCalled()
    expect(tracker.list().items).toEqual([])

    await bridge.call({ route: 'api/bot', body: { endpoint: 'state', payload: null } })
    expect(tracker.list().items.map(item => [item.backend, item.mode, item.status])).toEqual([
      ['ds-bot', 'bot', 'waiting_question'],
      ['ds-bot', 'bot', 'waiting_approval'],
      ['ds-bot', 'bot', 'running'],
    ])

    await bridge.call({ route: 'api/bot', body: { endpoint: 'approval-answer', payload: { id: 'apr-1', choice: 'allow' } } })
    expect(tracker.list().items.some(item => item.status === 'waiting_approval')).toBe(false)

    await bridge.call({ route: 'api/bot', body: { endpoint: 'answer-question', payload: { sessionId: 'bot-sess-1', questionId: 'q-1', answer: 'yes' } } })
    expect(tracker.list().items.some(item => item.status === 'waiting_question')).toBe(false)

    await tracker.close()
  })

  it('enforces priority ordering, truncation, 64-item cap, opaque token TTL/resolve/LRU, ackUnread, and digest debounce/dedupe', async () => {
    vi.useFakeTimers()
    try {
      let now = 10_000
      const digests: AttentionDigest[] = []
      const tracker = new HostAttentionTracker({
        onDigest: digest => { digests.push(digest) },
        now: () => now,
        tokenTtlMs: 5_000,
        maxTokens: 3,
        debounceMs: 1_500,
        normalTurnMinMs: 15_000,
      })

      // Truncation checks
      tracker.onInteractionPending({
        id: 'codex:approval:long',
        backend: 'codex',
        mode: 'agent',
        sessionId: 'codex:thr-1',
        sessionTitle: 'A'.repeat(240),
        status: 'waiting_approval',
        summary: 'B'.repeat(200),
      })
      const item = tracker.list().items[0]!
      expect(item.sessionTitle.length).toBe(MAX_ATTENTION_TITLE_CHARS)
      expect(item.summary?.length).toBe(MAX_ATTENTION_SUMMARY_CHARS)

      // Per-item dedupe: updating detachedExpiresAt must NOT emit critical a second time
      expect(digests.filter(d => d.urgency === 'critical')).toHaveLength(1)
      const token = digests[0]!.attentionToken!
      expect(token).toMatch(ATTENTION_TOKEN_PATTERN)
      expect(tracker.resolveToken(token)).toEqual({
        kind: 'session',
        backend: 'codex',
        mode: 'agent',
        sessionId: 'codex:thr-1',
        itemId: 'codex:approval:long',
      })
      tracker.onInteractionDetached('codex:approval:long', now + 60_000)
      expect(digests.filter(d => d.urgency === 'critical')).toHaveLength(1)

      // Resolving the approval invalidates its token -> fallback to inbox
      tracker.onInteractionResolved('codex:approval:long')
      expect(tracker.resolveToken(token)).toEqual({ kind: 'inbox' })

      // Short turn (< 15s) emits debounced silent turn_completed; running churn is debounced 1500ms
      digests.length = 0
      tracker.onSessionRunning({ backend: 'codex', mode: 'agent', sessionId: 'codex:s1', sessionTitle: 'S1' })
      now += 2_000
      tracker.onSessionCompleted({ backend: 'codex', mode: 'agent', sessionId: 'codex:s1', sessionTitle: 'S1' })
      expect(digests).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1_500)
      expect(digests).toHaveLength(1)
      expect(digests[0]).toMatchObject({ urgentKind: 'turn_completed', urgency: 'silent', completedUnread: 1 })
      const completedToken = digests[0]!.attentionToken!
      expect(tracker.resolveToken(completedToken)).toMatchObject({ kind: 'session', sessionId: 'codex:s1' })

      // Token TTL expiry falls back to inbox
      now += 6_000
      expect(tracker.resolveToken(completedToken)).toEqual({ kind: 'inbox' })

      // New turn replaces completed_unread with running
      tracker.onSessionRunning({ backend: 'codex', mode: 'agent', sessionId: 'codex:s1', sessionTitle: 'S1' })
      expect(tracker.list().items.find(i => i.sessionId === 'codex:s1')?.status).toBe('running')

      // ackUnread only clears completed_unread / failed_unread, not running
      tracker.onSessionCompleted({ backend: 'codex', mode: 'agent', sessionId: 'codex:s2', sessionTitle: 'S2', failed: true })
      const runningId = tracker.list().items.find(i => i.sessionId === 'codex:s1')!.id
      const failedId = tracker.list().items.find(i => i.sessionId === 'codex:s2')!.id
      tracker.ackUnread([runningId, failedId])
      expect(tracker.list().items.some(i => i.id === runningId)).toBe(true)
      expect(tracker.list().items.some(i => i.id === failedId)).toBe(false)

      // 64-item cap keeps highest-priority items
      for (let i = 0; i < MAX_ATTENTION_ITEMS + 10; i += 1) {
        now += 1
        tracker.onSessionCompleted({
          backend: 'acp',
          acpAdapter: 'cursor',
          mode: 'agent',
          sessionId: `cursor:s-${i}`,
          sessionTitle: `Session ${i}`,
        })
      }
      expect(tracker.list().items).toHaveLength(MAX_ATTENTION_ITEMS)

      // Unknown token falls back to inbox
      expect(tracker.resolveToken('0'.repeat(32))).toEqual({ kind: 'inbox' })

      await tracker.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('wires Noise attention.* RPCs, attention.follow.event streaming, disconnect cleanup, and capability advertisement', async () => {
    const tracker = new HostAttentionTracker({ debounceMs: 50 })
    const sentA: AttentionFollowEvent[] = []
    const routerA = new RpcRouter(
      undefined,
      silentLogger(),
      undefined,
      undefined,
      () => ['harness.remote.v3'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined, // workspaceGit
      tracker.createPeerRoute('conn-a', async event => { sentA.push(event) }),
    )

    const describe = await routerA.handle(createRpcRequest('harness.transport.describe', {}))
    expect((describe.payload as RpcResponsePayload).result).toMatchObject({
      capabilities: expect.arrayContaining([ATTENTION_INBOX_CAPABILITY]),
    })

    const followRes = await routerA.handle(createRpcRequest('attention.follow', { enabled: true }))
    expect(followRes.type).toBe('rpc.response')
    await vi.waitFor(() => { expect(sentA).toHaveLength(1) })
    expect(sentA[0]!.type).toBe('snapshot')

    tracker.onInteractionPending({
      id: 'codex:approval:h1',
      backend: 'codex',
      mode: 'agent',
      sessionId: 'codex:thr-9',
      sessionTitle: 'Fix bug',
      status: 'waiting_approval',
    })
    await vi.waitFor(() => { expect(sentA).toHaveLength(2) })
    expect(sentA[1]).toMatchObject({ type: 'upsert', item: { id: 'codex:approval:h1' } })

    const listRes = await routerA.handle(createRpcRequest('attention.list', {}))
    expect(((listRes.payload as RpcResponsePayload).result as { items: unknown[] }).items).toHaveLength(1)

    const token = tracker.currentDigest().attentionToken!
    const resolveRes = await routerA.handle(createRpcRequest('attention.resolveToken', { token }))
    expect((resolveRes.payload as RpcResponsePayload).result).toMatchObject({
      kind: 'session',
      backend: 'codex',
      sessionId: 'codex:thr-9',
    })

    // Invalid token format fails closed
    const badToken = await routerA.handle(createRpcRequest('attention.resolveToken', { token: 'not-a-32-hex-token' }))
    expect(badToken).toMatchObject({ type: 'rpc.error', payload: { code: 'INVALID_MESSAGE' } })

    // Disconnect cleans up follower
    await routerA.closePeerStreams()
    tracker.onInteractionResolved('codex:approval:h1')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(sentA).toHaveLength(2)

    await tracker.close()
  })

  it('gates HostServerConnection.publishAttentionDigest strictly on negotiated attention.signal.v1', async () => {
    const keys = generateKeyPairSync('x25519')
    const identity: HostIdentity = {
      schemaVersion: 1,
      deviceId: 'host-att-1',
      name: 'Host',
      publicKey: Buffer.from(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)).toString('base64url'),
      privateKey: Buffer.from(keys.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32)).toString('base64url'),
      fingerprint: 'fp',
    }
    const makeSocket = () => {
      const sent: string[] = []
      const socket = {
        readyState: 0,
        onopen: null as ((e: unknown) => void) | null,
        onmessage: null as ((e: { data: unknown }) => void) | null,
        onerror: null as ((e: unknown) => void) | null,
        onclose: null as ((e: { code: number; reason: string }) => void) | null,
        send(data: string) { sent.push(data) },
        close(code = 1000, reason = '') {
          socket.readyState = 3
          socket.onclose?.({ code, reason })
        },
        open() {
          socket.readyState = 1
          socket.onopen?.({})
        },
        receive(frame: unknown) {
          socket.onmessage?.({ data: JSON.stringify(frame) })
        },
        sent,
      }
      return socket
    }

    const digest: AttentionDigest = {
      revision: 1,
      pendingApprovals: 1,
      pendingQuestions: 0,
      runningSessions: 1,
      completedUnread: 0,
      urgentKind: 'approval_needed',
      urgency: 'critical',
      attentionToken: 'a'.repeat(32),
      updatedAt: Date.now(),
    }

    const api = {
      baseUrl: 'https://server.example',
      authenticate: vi.fn(async () => ({ accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 60_000 })),
      deviceFor: vi.fn(),
      refreshCredentials: vi.fn(),
      clearAuthorization: vi.fn(),
    } as unknown as HostServerApi
    const identities = { isTrusted: () => true, trustedPeer: () => undefined } as unknown as IdentityStore
    const connections = new ConnectionController(identities, () => new RpcRouter())

    // Case 1: Server does NOT negotiate attention.signal.v1 -> must NOT send host.attention.signal
    const legacySocket = makeSocket()
    const legacyConn = new HostServerConnection(
      resolveConfig({ serverUrl: 'https://server.example', forceRelay: true, reconnect: false }),
      identity,
      identities,
      api,
      connections,
      silentLogger(),
      () => legacySocket,
    )
    legacyConn.start()
    await vi.waitFor(() => { expect(api.authenticate).toHaveBeenCalledTimes(1) })
    legacySocket.open()
    expect(JSON.parse(legacySocket.sent[0]!).payload.capabilities).toContain(ATTENTION_SIGNAL_CAPABILITY)
    legacySocket.receive(createControlFrame('hello.ack', {
      protocol: 1,
      serverVersion: '0.5.0',
      connectionSessionId: 'legacy-1',
      heartbeatIntervalMs: 25_000,
      maxControlFrameBytes: 65_536,
      maxRelayFrameBytes: 1_048_576,
      capabilities: ['transport.relay'],
    }))
    await vi.waitFor(() => { expect(legacyConn.isOnline()).toBe(true) })
    legacyConn.publishAttentionDigest(digest)
    expect(legacySocket.sent.filter(raw => JSON.parse(raw).type === 'host.attention.signal')).toHaveLength(0)
    await legacyConn.stop()

    // Case 2: Server negotiates attention.signal.v1 -> sends strict zero-plaintext frame
    const modernSocket = makeSocket()
    const modernConn = new HostServerConnection(
      resolveConfig({ serverUrl: 'https://server.example', forceRelay: true, reconnect: false }),
      identity,
      identities,
      api,
      connections,
      silentLogger(),
      () => modernSocket,
    )
    modernConn.start()
    await vi.waitFor(() => { expect(api.authenticate).toHaveBeenCalledTimes(2) })
    modernSocket.open()
    modernSocket.receive(createControlFrame('hello.ack', {
      protocol: 1,
      serverVersion: '0.6.6',
      connectionSessionId: 'modern-1',
      heartbeatIntervalMs: 25_000,
      maxControlFrameBytes: 65_536,
      maxRelayFrameBytes: 1_048_576,
      capabilities: ['transport.relay', ATTENTION_SIGNAL_CAPABILITY],
    }))
    await vi.waitFor(() => { expect(modernConn.isOnline()).toBe(true) })
    modernConn.publishAttentionDigest(digest)
    const signalFrames = modernSocket.sent.map(raw => JSON.parse(raw)).filter(f => f.type === 'host.attention.signal')
    expect(signalFrames).toHaveLength(1)
    expect(signalFrames[0]!.payload).toEqual({ digest })

    // Extra plaintext field fails closed
    expect(() => modernConn.publishAttentionDigest({ ...digest, sessionId: 'leak' } as unknown as AttentionDigest)).toThrow()
    await modernConn.stop()
  })

  it('ownerPeerFactory passes interactions:"none" when requested for read-only observers', () => {
    const Peer = vi.fn(function (this: Record<string, unknown>, _ctx: unknown, options: { principal: unknown; interactions?: string }) {
      this.options = options
      this.dispose = vi.fn()
    })
    const factory = createOwnerPeerFactory({}, ownerPeerConstructor({ Peer }), undefined)
    const readOnly = factory({ interactions: 'none' }) as { options?: { principal: unknown; interactions?: string } }
    expect(readOnly.options).toEqual({ principal: { kind: 'owner' }, interactions: 'none' })
  })

  it('exposes attention.inbox.v1 on HostPluginRuntime authenticated channels', async () => {
    const runtime = new HostPluginRuntime(
      resolveConfig({ codex: { enabled: false }, acp: { enabled: false } }),
      {
        directory: '/tmp/dsh-attention-runtime-test',
        loadOrCreate: vi.fn(async () => ({
          deviceId: 'host-1', name: 'Host', role: 'host', publicKey: 'pk', privateKey: 'sk', fingerprint: 'fp', createdAt: 1,
        })),
        isTrusted: () => true,
        trustedPeer: () => undefined,
        listTrustedPeers: () => [],
      } as unknown as IdentityStore,
      silentLogger(),
    )
    const handlers = new Set<(message: RemoteMessage) => void>()
    const sent: RemoteMessage[] = []
    const channel: AuthenticatedPeerChannel = {
      security: { protocol: 'Noise_IK_25519_ChaChaPoly_SHA256', connectionId: 'conn-rt-1', membershipId: 'mem-1' },
      peerDeviceId: 'client-1',
      peerIdentityKey: 'client-pk',
      mode: 'Relay',
      send: async message => { sent.push(message) },
      onMessage: handler => { handlers.add(handler); return () => { handlers.delete(handler) } },
      close: async () => undefined,
    }
    try {
      await runtime.start()
      await runtime.acceptAuthenticatedPeer(channel)
      const req = createRpcRequest('harness.transport.describe', {})
      for (const h of handlers) h(req)
      await vi.waitFor(() => {
        expect(sent.some(m => m.type === 'rpc.response' && (m.payload as RpcResponsePayload).requestId === req.id)).toBe(true)
      })
      const desc = sent.find(m => m.type === 'rpc.response' && (m.payload as RpcResponsePayload).requestId === req.id)!
      expect(((desc.payload as RpcResponsePayload).result as { capabilities: string[] }).capabilities).toContain(ATTENTION_INBOX_CAPABILITY)
    } finally {
      await runtime.close()
    }
  })

  it('interoperates end-to-end with @dsh-remote/client-core RemoteAttentionClient over RpcRouter', async () => {
    const tracker = new HostAttentionTracker({ debounceMs: 20 })
    const eventListeners = new Set<(payload: unknown) => void>()
    const router = new RpcRouter(
      undefined,
      silentLogger(),
      undefined,
      undefined,
      () => ['harness.remote.v3'],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined, // workspaceGit
      tracker.createPeerRoute('conn-interop', async event => {
        for (const listener of eventListeners) listener(event)
      }),
    )
    tracker.onInteractionPending({
      id: 'harness:approval:ap-interop',
      backend: 'harness',
      mode: 'agent',
      sessionId: 'sess-interop',
      sessionTitle: 'Interop Session',
      status: 'waiting_approval',
      summary: 'run_command: vitest',
    })
    const client = createRemoteAttentionClient({
      async call(method, params) {
        const res = await router.handle(createRpcRequest(method as never, params ?? {}))
        if (res.type === 'rpc.error') throw new Error(String((res.payload as { message?: string }).message ?? 'rpc error'))
        return (res.payload as RpcResponsePayload).result
      },
      onEvent(event, listener) {
        if (event !== 'attention.follow.event') return () => undefined
        eventListeners.add(listener)
        return () => { eventListeners.delete(listener) }
      },
    })
    const received: AttentionFollowEvent[] = []
    const sub = await client.follow({ onEvent: event => received.push(event) })
    expect(sub.initial.items).toHaveLength(1)
    expect(sub.initial.items[0]!.sessionId).toBe('sess-interop')
    const token = sub.initial.digest.attentionToken
    expect(token).toMatch(ATTENTION_TOKEN_PATTERN)
    expect(await client.resolveToken(token!)).toMatchObject({ kind: 'session', sessionId: 'sess-interop' })
    tracker.onInteractionResolved('harness:approval:ap-interop')
    await vi.waitFor(() => {
      expect(received.some(e => e.type === 'remove' && e.itemId === 'harness:approval:ap-interop')).toBe(true)
    })
    await sub.stop()
    await tracker.close()
  })
})
