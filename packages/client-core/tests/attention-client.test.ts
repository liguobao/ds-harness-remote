import {
  MAX_ATTENTION_ITEMS,
  type AttentionDigest,
  type AttentionFollowEvent,
  type AttentionItem,
  type AttentionListResult,
  type LiveActivityTokenRegistrationRequest,
  type PushTargetRegistrationRequest,
} from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  PushTargetClientError,
  RemoteAttentionClient,
  applyAttentionFollowEvent,
  createAttentionRpcTransport,
  createEmptyAttentionInboxState,
  createPushTargetClient,
  createRemoteAttentionClient,
  registerLiveActivityToken,
  registerPushTarget,
  unregisterLiveActivityToken,
  unregisterPushTarget,
  type AttentionRpcTransport,
  type PushTargetFetch,
} from '../src/index.js'

const VALID_TOKEN = '0123456789abcdef0123456789abcdef'

function makeDigest(overrides: Partial<AttentionDigest> = {}): AttentionDigest {
  return {
    revision: 1,
    pendingApprovals: 0,
    pendingQuestions: 0,
    runningSessions: 0,
    completedUnread: 0,
    urgentKind: null,
    urgency: 'silent',
    updatedAt: 1_786_000_000_000,
    ...overrides,
  }
}

function makeItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: 'harness:ses-1',
    backend: 'harness',
    mode: 'agent',
    sessionId: 'ses-1',
    sessionTitle: 'Fix login bug',
    status: 'running',
    updatedAt: 1_786_000_000_000,
    ...overrides,
  }
}

function createMockTransport(
  callImpl?: (method: string, params?: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<unknown>,
) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const call = vi.fn(async (
    method: string,
    params?: unknown,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ) => {
    if (callImpl !== undefined) return callImpl(method, params, options)
    return {}
  })

  const transport: AttentionRpcTransport = {
    call,
    onEvent(event, listener) {
      let bucket = listeners.get(event)
      if (bucket === undefined) {
        bucket = new Set()
        listeners.set(event, bucket)
      }
      bucket.add(listener)
      return () => {
        bucket?.delete(listener)
        if (bucket?.size === 0) listeners.delete(event)
      }
    },
  }

  return {
    transport,
    call,
    listeners,
    emit(event: string, payload: unknown) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener(payload)
      }
    },
    listenerCount(event: string): number {
      return listeners.get(event)?.size ?? 0
    },
  }
}

describe('applyAttentionFollowEvent', () => {
  it('enforces revision ordering, deterministic priority sorting, immutability, and MAX_ATTENTION_ITEMS cap', () => {
    const q1 = makeItem({ id: 'q-1', status: 'waiting_question', updatedAt: 100 })
    const a1 = makeItem({ id: 'a-1', status: 'waiting_approval', updatedAt: 500 })
    const rOld = makeItem({ id: 'r-a', status: 'running', updatedAt: 200 })
    const rNew = makeItem({ id: 'r-b', status: 'running', updatedAt: 300 })
    const rTieA = makeItem({ id: 'r-tie-a', status: 'running', updatedAt: 300 })
    const f1 = makeItem({ id: 'f-1', status: 'failed_unread', updatedAt: 900 })
    const c1 = makeItem({ id: 'c-1', status: 'completed_unread', updatedAt: 999 })

    let state = createEmptyAttentionInboxState()
    const snapshotEvent: AttentionFollowEvent = {
      type: 'snapshot',
      revision: 5,
      digest: makeDigest({ revision: 5, pendingQuestions: 1, pendingApprovals: 1, runningSessions: 3, completedUnread: 2 }),
      items: [c1, rOld, f1, a1, rNew, q1, rTieA],
    }
    state = applyAttentionFollowEvent(state, snapshotEvent)
    expect(state.revision).toBe(5)
    expect(state.items.map(item => item.id)).toEqual([
      'q-1',
      'a-1',
      'r-b',
      'r-tie-a',
      'r-a',
      'f-1',
      'c-1',
    ])

    // Same-revision snapshot is accepted; strictly stale snapshot is ignored.
    const sameRevSnapshot: AttentionFollowEvent = {
      type: 'snapshot',
      revision: 5,
      digest: makeDigest({ revision: 5, pendingApprovals: 1 }),
      items: [a1, c1],
    }
    state = applyAttentionFollowEvent(state, sameRevSnapshot)
    expect(state.items.map(item => item.id)).toEqual(['a-1', 'c-1'])

    const staleSnapshot: AttentionFollowEvent = {
      type: 'snapshot',
      revision: 4,
      digest: makeDigest({ revision: 4 }),
      items: [],
    }
    expect(applyAttentionFollowEvent(state, staleSnapshot)).toBe(state)

    // Stale upsert / remove (revision < current.revision) are ignored.
    const staleUpsert: AttentionFollowEvent = {
      type: 'upsert',
      revision: 4,
      digest: makeDigest({ revision: 4 }),
      item: q1,
    }
    expect(applyAttentionFollowEvent(state, staleUpsert)).toBe(state)

    const staleRemove: AttentionFollowEvent = {
      type: 'remove',
      revision: 4,
      digest: makeDigest({ revision: 4 }),
      itemId: 'a-1',
    }
    expect(applyAttentionFollowEvent(state, staleRemove)).toBe(state)

    // Upsert inserts & replaces without mutating prior state array, re-sorting deterministically.
    const priorItems = state.items
    const upgraded = makeItem({ id: 'c-1', status: 'waiting_question', updatedAt: 1_000 })
    state = applyAttentionFollowEvent(state, {
      type: 'upsert',
      revision: 6,
      digest: makeDigest({ revision: 6, pendingQuestions: 1, pendingApprovals: 1 }),
      item: upgraded,
    })
    expect(priorItems.map(item => item.id)).toEqual(['a-1', 'c-1'])
    expect(state.revision).toBe(6)
    expect(state.items.map(item => item.id)).toEqual(['c-1', 'a-1'])

    // Remove deletes target item.
    state = applyAttentionFollowEvent(state, {
      type: 'remove',
      revision: 7,
      digest: makeDigest({ revision: 7, pendingQuestions: 1 }),
      itemId: 'a-1',
    })
    expect(state.revision).toBe(7)
    expect(state.items.map(item => item.id)).toEqual(['c-1'])

    // Caps at MAX_ATTENTION_ITEMS, evicting the lowest-priority item.
    const fullItems: AttentionItem[] = Array.from({ length: MAX_ATTENTION_ITEMS }, (_, index) =>
      makeItem({
        id: `item-${String(index).padStart(3, '0')}`,
        status: 'completed_unread',
        updatedAt: 10_000 - index,
      }),
    )
    let capped = applyAttentionFollowEvent(createEmptyAttentionInboxState(), {
      type: 'snapshot',
      revision: 10,
      digest: makeDigest({ revision: 10 }),
      items: fullItems,
    })
    expect(capped.items).toHaveLength(MAX_ATTENTION_ITEMS)

    capped = applyAttentionFollowEvent(capped, {
      type: 'upsert',
      revision: 11,
      digest: makeDigest({ revision: 11, pendingQuestions: 1 }),
      item: makeItem({ id: 'urgent-top', status: 'waiting_question', updatedAt: 1 }),
    })
    expect(capped.items).toHaveLength(MAX_ATTENTION_ITEMS)
    expect(capped.items[0]?.id).toBe('urgent-top')
    expect(capped.items.some(item => item.id === `item-${String(MAX_ATTENTION_ITEMS - 1).padStart(3, '0')}`)).toBe(false)
  })
})

describe('RemoteAttentionClient', () => {
  it('lists attention items and fails closed on malformed attention.list responses', async () => {
    const validList: AttentionListResult = {
      revision: 3,
      digest: makeDigest({ revision: 3, pendingApprovals: 1, urgentKind: 'approval_needed', urgency: 'critical' }),
      items: [makeItem({ id: 'codex:thr-1', backend: 'codex', sessionId: 'thr-1', status: 'waiting_approval' })],
    }
    const mock = createMockTransport(async () => validList)
    const client = createRemoteAttentionClient(mock.transport)
    const controller = new AbortController()

    await expect(client.list({ signal: controller.signal, timeoutMs: 5_000 })).resolves.toEqual(validList)
    expect(mock.call).toHaveBeenCalledWith('attention.list', {}, { signal: controller.signal, timeoutMs: 5_000 })

    mock.call.mockResolvedValueOnce({ revision: -1, digest: {}, items: [] })
    await expect(client.list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('buffers events during attention.follow handshake, replays only revision > initial.revision, and cleanly unfollows on stop()', async () => {
    let resolveFollow!: (value: unknown) => void
    let subscribedBeforeRpc = false
    const mock = createMockTransport(async (method) => {
      if (method === 'attention.follow') {
        subscribedBeforeRpc = mock.listenerCount('attention.follow.event') === 1
        return new Promise(resolve => {
          resolveFollow = resolve
        })
      }
      if (method === 'attention.unfollow') {
        return { ok: true }
      }
      return {}
    })
    const client = new RemoteAttentionClient(mock.transport)
    const received: AttentionFollowEvent[] = []
    const errors: unknown[] = []

    const followPromise = client.follow({
      onEvent: event => received.push(event),
      onError: err => errors.push(err),
    })

    expect(subscribedBeforeRpc).toBe(true)
    expect(mock.call).toHaveBeenCalledWith('attention.follow', { enabled: true }, undefined)

    // Events arriving while attention.follow RPC is still in-flight:
    const staleEvent: AttentionFollowEvent = {
      type: 'upsert',
      revision: 4,
      digest: makeDigest({ revision: 4 }),
      item: makeItem({ id: 'stale-4' }),
    }
    const equalEvent: AttentionFollowEvent = {
      type: 'upsert',
      revision: 5,
      digest: makeDigest({ revision: 5 }),
      item: makeItem({ id: 'equal-5' }),
    }
    const newerEvent6: AttentionFollowEvent = {
      type: 'upsert',
      revision: 6,
      digest: makeDigest({ revision: 6, pendingApprovals: 1 }),
      item: makeItem({ id: 'newer-6', status: 'waiting_approval' }),
    }
    const newerEvent7: AttentionFollowEvent = {
      type: 'remove',
      revision: 7,
      digest: makeDigest({ revision: 7 }),
      itemId: 'base-item',
    }

    mock.emit('attention.follow.event', staleEvent)
    mock.emit('attention.follow.event', equalEvent)
    mock.emit('attention.follow.event', { type: 'upsert', revision: 'bad' }) // malformed
    mock.emit('attention.follow.event', newerEvent6)
    mock.emit('attention.follow.event', newerEvent7)

    // Nothing delivered before handshake settles.
    expect(received).toEqual([])
    expect(errors).toHaveLength(1)

    const initialPayload: AttentionListResult = {
      revision: 5,
      digest: makeDigest({ revision: 5, runningSessions: 1 }),
      items: [makeItem({ id: 'base-item', status: 'running' })],
    }
    resolveFollow(initialPayload)

    const subscription = await followPromise
    expect(subscription.initial).toEqual(initialPayload)
    // Only events with revision > 5 replayed in arrival order.
    expect(received).toEqual([newerEvent6, newerEvent7])

    // Live post-handshake event flows directly and reduces cleanly.
    const liveEvent8: AttentionFollowEvent = {
      type: 'upsert',
      revision: 8,
      digest: makeDigest({ revision: 8, pendingQuestions: 1 }),
      item: makeItem({ id: 'live-8', status: 'waiting_question' }),
    }
    mock.emit('attention.follow.event', liveEvent8)
    expect(received).toEqual([newerEvent6, newerEvent7, liveEvent8])

    let state = applyAttentionFollowEvent(createEmptyAttentionInboxState(), {
      type: 'snapshot',
      ...subscription.initial,
    })
    for (const event of received) {
      state = applyAttentionFollowEvent(state, event)
    }
    expect(state.revision).toBe(8)
    expect(state.items.map(item => item.id)).toEqual(['live-8', 'newer-6'])

    // stop() unsubscribes, calls attention.unfollow once (idempotent), and drops further events.
    await subscription.stop()
    await subscription.stop()
    expect(mock.listenerCount('attention.follow.event')).toBe(0)
    expect(mock.call.mock.calls.filter(([method]) => method === 'attention.unfollow')).toEqual([
      ['attention.unfollow', {}],
    ])

    mock.emit('attention.follow.event', {
      type: 'upsert',
      revision: 9,
      digest: makeDigest({ revision: 9 }),
      item: makeItem({ id: 'after-stop' }),
    })
    expect(received).toHaveLength(3)
  })

  it('handles follow failures, best-effort unfollow errors, abort teardown, and RemoteClientCore adapter', async () => {
    await runScenarios([
      {
        name: 'cleans up listener if attention.follow RPC rejects',
        run: async () => {
          const mock = createMockTransport(async () => {
            throw new Error('CAPABILITY_NOT_SUPPORTED')
          })
          const client = createRemoteAttentionClient(mock.transport)
          await expect(client.follow({ onEvent: () => undefined })).rejects.toThrow('CAPABILITY_NOT_SUPPORTED')
          expect(mock.listenerCount('attention.follow.event')).toBe(0)
        },
      },
      {
        name: 'cleans up and fails closed on invalid attention.follow response',
        run: async () => {
          for (const badResponse of [{ unexpected: true }, { ok: true }, { following: true }]) {
            const mock = createMockTransport(async method => method === 'attention.follow' ? badResponse : {})
            const client = createRemoteAttentionClient(mock.transport)
            await expect(client.follow({ onEvent: () => undefined })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
            expect(mock.listenerCount('attention.follow.event')).toBe(0)
            expect(mock.call).toHaveBeenCalledWith('attention.unfollow', {})
          }
        },
      },
      {
        name: 'stop() swallows attention.unfollow transport errors',
        run: async () => {
          const mock = createMockTransport(async method => {
            if (method === 'attention.follow') {
              return { revision: 1, digest: makeDigest({ revision: 1 }), items: [] }
            }
            throw new Error('TRANSPORT_CLOSED')
          })
          const client = createRemoteAttentionClient(mock.transport)
          const sub = await client.follow({ onEvent: () => undefined })
          await expect(sub.stop()).resolves.toBeUndefined()
          expect(mock.listenerCount('attention.follow.event')).toBe(0)
        },
      },
      {
        name: 'post-open AbortSignal unsubscribes and triggers attention.unfollow',
        run: async () => {
          const mock = createMockTransport(async method => {
            if (method === 'attention.follow') {
              return { revision: 1, digest: makeDigest({ revision: 1 }), items: [] }
            }
            return {}
          })
          const controller = new AbortController()
          const client = createRemoteAttentionClient(mock.transport)
          await client.follow({ onEvent: () => undefined }, { signal: controller.signal })
          controller.abort()
          await Promise.resolve()
          expect(mock.listenerCount('attention.follow.event')).toBe(0)
          expect(mock.call).toHaveBeenCalledWith('attention.unfollow', {})
        },
      },
      {
        name: 'createAttentionRpcTransport adapts RemoteClientCore rpc/onEvent',
        run: async () => {
          const handlers = new Set<(event: { event: string; data: unknown }) => void>()
          const core = {
            rpc: vi.fn(async () => ({ revision: 2, digest: makeDigest({ revision: 2 }), items: [] })),
            onEvent(handler: (event: { event: string; data: unknown }) => void) {
              handlers.add(handler)
              return () => handlers.delete(handler)
            },
          }
          const client = createRemoteAttentionClient(createAttentionRpcTransport(core as never))
          const received: AttentionFollowEvent[] = []
          const sub = await client.follow({ onEvent: event => received.push(event) }, { timeoutMs: 4_000 })
          expect(core.rpc).toHaveBeenCalledWith('attention.follow', { enabled: true }, undefined, { timeoutMs: 4_000 })
          for (const h of handlers) {
            h({ event: 'other.event', data: { ignored: true } })
            h({
              event: 'attention.follow.event',
              data: { type: 'remove', revision: 3, digest: makeDigest({ revision: 3 }), itemId: 'gone' },
            })
          }
          expect(received).toHaveLength(1)
          await sub.stop()
          expect(handlers.size).toBe(0)
        },
      },
    ])
  })

  it('validates resolveToken before RPC and parses session/inbox targets', async () => {
    const mock = createMockTransport(async () => ({
      kind: 'session',
      backend: 'acp',
      acpAdapter: 'cursor',
      mode: 'agent',
      workspaceId: 'cursor:cwd:/repo',
      sessionId: 'ses-42',
      itemId: 'acp:cursor:ses-42',
    }))
    const client = createRemoteAttentionClient(mock.transport)

    // Pre-RPC rejection for invalid tokens (must not call transport and must not echo raw token).
    const invalidTokens = [
      '',
      'not-hex',
      '0123456789ABCDEF0123456789ABCDEF', // uppercase
      '0123456789abcdef0123456789abcde', // 31 chars
      '0123456789abcdef0123456789abcdef0', // 33 chars
      'session-secret-id-12345678901234',
    ]
    for (const badToken of invalidTokens) {
      let caught: unknown
      try {
        await client.resolveToken(badToken)
      } catch (err) {
        caught = err
      }
      expect(caught).toMatchObject({ code: 'INVALID_MESSAGE' })
      if (badToken.length > 0) {
        expect((caught as Error).message).not.toContain(badToken)
      }
    }
    expect(mock.call).not.toHaveBeenCalled()

    // Valid session target
    await expect(client.resolveToken(VALID_TOKEN)).resolves.toEqual({
      kind: 'session',
      backend: 'acp',
      acpAdapter: 'cursor',
      mode: 'agent',
      workspaceId: 'cursor:cwd:/repo',
      sessionId: 'ses-42',
      itemId: 'acp:cursor:ses-42',
    })
    expect(mock.call).toHaveBeenCalledWith('attention.resolveToken', { token: VALID_TOKEN }, undefined)

    // Safe fallback inbox target
    mock.call.mockResolvedValueOnce({ kind: 'inbox' })
    await expect(client.resolveToken(VALID_TOKEN)).resolves.toEqual({ kind: 'inbox' })

    // Malformed target rejected fail-closed
    mock.call.mockResolvedValueOnce({ kind: 'session', backend: 'unknown-backend', mode: 'agent', sessionId: 'x' })
    await expect(client.resolveToken(VALID_TOKEN)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('validates ackUnread requests pre-RPC and parses results', async () => {
    const mock = createMockTransport(async () => ({ ok: true, revision: 12 }))
    const client = createRemoteAttentionClient(mock.transport)

    await expect(client.ackUnread([''])).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    await expect(
      client.ackUnread(Array.from({ length: MAX_ATTENTION_ITEMS + 1 }, (_, index) => `item-${index}`)),
    ).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    expect(mock.call).not.toHaveBeenCalled()

    await expect(client.ackUnread(['harness:ses-1', 'codex:thr-2'])).resolves.toEqual({ ok: true, revision: 12 })
    expect(mock.call).toHaveBeenCalledWith('attention.ackUnread', { itemIds: ['harness:ses-1', 'codex:thr-2'] }, undefined)

    mock.call.mockResolvedValueOnce({ ok: false, revision: 12 })
    await expect(client.ackUnread(['harness:ses-1'])).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('PushTargetClient (push.wake.v1 REST helpers)', () => {
  const accessToken = 'secret-bearer-access-token-xyz987'
  const pushPayload: PushTargetRegistrationRequest = {
    platform: 'ios',
    pushToken: 'secret-apns-device-token-abc123',
    environment: 'production',
    appId: 'com.deepseek.dshremote',
    locale: 'zh-CN',
  }
  const liveActivityPayload: LiveActivityTokenRegistrationRequest = {
    activityPushToken: 'secret-live-activity-token-def456',
    pushToStartToken: 'secret-push-to-start-token-ghi789',
    environment: 'sandbox',
    activityId: 'act-1',
  }

  it('sends expected methods, paths, authorization headers, and validated JSON bodies', async () => {
    const fetchMock = vi.fn<PushTargetFetch>(async () => ({ ok: true, status: 204 }))

    await expect(
      registerPushTarget('https://remote.example.com/', accessToken, pushPayload, fetchMock),
    ).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://remote.example.com/api/v1/devices/self/push-target',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(pushPayload),
      }),
    )

    await expect(
      unregisterPushTarget('https://remote.example.com/prefix/', accessToken, fetchMock),
    ).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://remote.example.com/prefix/api/v1/devices/self/push-target',
      expect.objectContaining({
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }),
    )

    const client = createPushTargetClient('http://127.0.0.1:8787', () => accessToken, fetchMock)
    await expect(client.registerLiveActivityToken('host/dev:1', liveActivityPayload)).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8787/api/v1/devices/self/live-activities/host%2Fdev%3A1',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(liveActivityPayload),
      }),
    )

    await expect(client.unregisterLiveActivityToken('host/dev:1')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8787/api/v1/devices/self/live-activities/host%2Fdev%3A1',
      expect.objectContaining({
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }),
    )
  })

  it('enforces URL scheme/loopback policy and Zod payload validation before calling fetch', async () => {
    const allowedUrls = [
      'https://push.example.com',
      'http://127.0.0.1:3000',
      'http://localhost:3000',
      'http://[::1]:3000',
    ]
    for (const url of allowedUrls) {
      const fetchMock = vi.fn<PushTargetFetch>(async () => ({ ok: true, status: 200 }))
      await expect(unregisterPushTarget(url, accessToken, fetchMock)).resolves.toEqual({ ok: true })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }

    await runScenarios([
      {
        name: 'rejects non-loopback http URLs',
        run: async () => {
          const fetchMock = vi.fn<PushTargetFetch>()
          for (const badUrl of ['http://remote.example.com', 'http://192.168.1.2:8080', 'ftp://remote.example.com']) {
            await expect(registerPushTarget(badUrl, accessToken, pushPayload, fetchMock)).rejects.toMatchObject({
              code: 'INSECURE_BASE_URL',
            })
          }
          expect(fetchMock).not.toHaveBeenCalled()
        },
      },
      {
        name: 'rejects malformed URLs, credentials, or query/hash in baseUrl',
        run: async () => {
          const fetchMock = vi.fn<PushTargetFetch>()
          for (const badUrl of [
            'not-a-url',
            'https://user:pass@remote.example.com',
            'https://remote.example.com?token=1',
            'https://remote.example.com#frag',
          ]) {
            await expect(unregisterPushTarget(badUrl, accessToken, fetchMock)).rejects.toMatchObject({
              code: 'INVALID_BASE_URL',
            })
          }
          expect(fetchMock).not.toHaveBeenCalled()
        },
      },
      {
        name: 'rejects invalid push-target and live-activity payloads pre-network',
        run: async () => {
          const fetchMock = vi.fn<PushTargetFetch>()
          await expect(
            registerPushTarget(
              'https://remote.example.com',
              accessToken,
              { ...pushPayload, platform: 'web' as never },
              fetchMock,
            ),
          ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })

          await expect(
            registerPushTarget(
              'https://remote.example.com',
              accessToken,
              { ...pushPayload, extra: 'forbidden' } as never,
              fetchMock,
            ),
          ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })

          await expect(
            registerLiveActivityToken(
              'https://remote.example.com',
              accessToken,
              'host-1',
              { activityPushToken: '' },
              fetchMock,
            ),
          ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })

          await expect(
            unregisterLiveActivityToken('https://remote.example.com', accessToken, '   ', fetchMock),
          ).rejects.toMatchObject({ code: 'INVALID_HOST_ID' })

          expect(fetchMock).not.toHaveBeenCalled()
        },
      },
    ])
  })

  it('returns { ok: false, unsupported: true } cleanly on HTTP 404 and 501', async () => {
    for (const status of [404, 501]) {
      const cancel = vi.fn(async () => undefined)
      const fetchMock = vi.fn<PushTargetFetch>(async () => ({
        ok: false,
        status,
        body: { cancel },
      }))

      await expect(registerPushTarget('https://remote.example.com', accessToken, pushPayload, fetchMock)).resolves.toEqual({
        ok: false,
        unsupported: true,
      })
      await expect(unregisterPushTarget('https://remote.example.com', accessToken, fetchMock)).resolves.toEqual({
        ok: false,
        unsupported: true,
      })
      await expect(
        registerLiveActivityToken('https://remote.example.com', accessToken, 'host-1', liveActivityPayload, fetchMock),
      ).resolves.toEqual({
        ok: false,
        unsupported: true,
      })
      await expect(
        unregisterLiveActivityToken('https://remote.example.com', accessToken, 'host-1', fetchMock),
      ).resolves.toEqual({
        ok: false,
        unsupported: true,
      })
      expect(cancel).toHaveBeenCalledTimes(4)
    }
  })

  it('never leaks accessToken, pushToken, activityPushToken, or pushToStartToken in thrown errors', async () => {
    const secrets = [
      accessToken,
      pushPayload.pushToken,
      liveActivityPayload.activityPushToken,
      liveActivityPayload.pushToStartToken!,
    ]

    function assertNoSecretsInError(err: unknown): void {
      expect(err).toBeInstanceOf(PushTargetClientError)
      const error = err as PushTargetClientError
      const serialized = [
        error.name,
        error.code,
        error.message,
        String(error.cause ?? ''),
        JSON.stringify(error),
      ].join('\n')
      for (const secret of secrets) {
        expect(serialized).not.toContain(secret)
      }
    }

    // 1. HTTP 500 with server body echoing secrets
    const httpErrorFetch = vi.fn<PushTargetFetch>(async () => new Response(
      JSON.stringify({ error: `failed for ${secrets.join(' ')}` }),
      { status: 500 },
    ))
    await expect(
      registerPushTarget('https://remote.example.com', accessToken, pushPayload, httpErrorFetch).catch(err => {
        assertNoSecretsInError(err)
        throw err
      }),
    ).rejects.toMatchObject({ code: 'HTTP_ERROR', status: 500 })

    // 2. HTTP 401 unauthorized
    const authErrorFetch = vi.fn<PushTargetFetch>(async () => new Response(`invalid ${accessToken}`, { status: 401 }))
    await expect(
      registerLiveActivityToken('https://remote.example.com', accessToken, 'host-1', liveActivityPayload, authErrorFetch).catch(err => {
        assertNoSecretsInError(err)
        throw err
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 })

    // 3. Network error whose raw message includes secrets
    const networkErrorFetch = vi.fn<PushTargetFetch>(async () => {
      throw new Error(`socket reset while sending ${secrets.join(' ')}`)
    })
    await expect(
      registerPushTarget('https://remote.example.com', accessToken, pushPayload, networkErrorFetch).catch(err => {
        assertNoSecretsInError(err)
        throw err
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' })

    // 4. Schema validation failure with real pushToken present
    await expect(
      registerPushTarget(
        'https://remote.example.com',
        accessToken,
        { ...pushPayload, locale: 'INVALID LOCALE WITH SPACES!' },
        networkErrorFetch,
      ).catch(err => {
        assertNoSecretsInError(err)
        throw err
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })

    // 5. Invalid access token with control characters
    await expect(
      unregisterPushTarget('https://remote.example.com', `${accessToken}\r\nX-Injected: 1`, networkErrorFetch).catch(err => {
        assertNoSecretsInError(err)
        throw err
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ACCESS_TOKEN' })
  })
})
