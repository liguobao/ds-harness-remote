import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HARNESS_API_TRANSFER_CHUNK_BYTES } from '@dsh-remote/protocol'
import { HarnessApiBridge } from '../src/harness-api-bridge.js'
import type { SafeLogger } from '../src/logging.js'
import { RpcError } from '../src/rpc-router.js'

describe('HarnessApiBridge', () => {
  it('falls back to read-only Host directory browsing when Harness only serves a native picker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-remote-directory-'))
    await mkdir(join(root, 'project'))
    const listDirectory = vi.fn(async (request: { rpcId: string }) => ({
      rpcId: request.rpcId,
      result: { ok: false, error: { code: 'directory-picker-unavailable', message: 'native only', details: {} } },
    }))
    const bridge = new HarnessApiBridge(api({ host: { listDirectory } }), vi.fn(async () => undefined))
    try {
      await expect(bridge.call({ method: 'host.listDirectory', rpcId: 'native-fallback', payload: { path: root } }))
        .resolves.toMatchObject({
          rpcId: 'native-fallback',
          result: { ok: true, value: { path: root, entries: [{ name: 'project', path: join(root, 'project') }] } },
        })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serves read-only Host directory browsing when Harness has no native browser picker method', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-remote-directory-missing-'))
    await mkdir(join(root, 'project'))
    const bridge = new HarnessApiBridge(api({}), vi.fn(async () => undefined), 8, undefined, undefined, '0.1.1-rc.2')
    try {
      await expect(bridge.call({ method: 'host.listDirectory', rpcId: 'native-fallback-missing', payload: { path: root } }))
        .resolves.toMatchObject({
          rpcId: 'native-fallback-missing',
          result: { ok: true, value: { path: root, entries: [{ name: 'project', path: join(root, 'project') }] } },
        })
      await expect(bridge.call({ method: 'host.describe', rpcId: 'native-describe-missing', payload: {} }))
        .resolves.toMatchObject({
          rpcId: 'native-describe-missing',
          result: { ok: true, value: { version: '0.1.1-rc.2', canOpenPath: true } },
        })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('forwards allowlisted native methods and read-only directory browsing while denying privileged methods', async () => {
    const list = vi.fn(async (request: { rpcId: string }) => ({ rpcId: request.rpcId, result: { ok: true, value: [] } }))
    const attachment = vi.fn(async (request: { rpcId: string }) => ({
      rpcId: request.rpcId,
      result: { ok: true, value: { mediaType: 'image/png', data: 'aW1hZ2U=' } },
    }))
    const listDirectory = vi.fn(async (request: { rpcId: string }) => ({
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: { path: '/home/user', home: '/home/user', crumbs: [], entries: [], truncated: false },
      },
    }))
    const bridge = new HarnessApiBridge(api({ sessions: { list, attachment }, host: { listDirectory } }), vi.fn(async () => undefined))

    await expect(bridge.call({ method: 'session.list', rpcId: 'native-1', payload: {} })).resolves.toMatchObject({
      rpcId: 'native-1',
      result: { ok: true },
    })
    await expect(bridge.call({ method: 'host.listDirectory', rpcId: 'native-2', payload: {} })).resolves.toMatchObject({
      rpcId: 'native-2',
      result: { ok: true, value: { path: '/home/user' } },
    })
    expect(listDirectory).toHaveBeenCalledWith(
      { rpcId: 'native-2', payload: {} },
      expect.any(AbortSignal),
    )
    await expect(bridge.call({
      method: 'session.attachment',
      rpcId: 'native-image',
      payload: { sessionId: 'session-1', attachmentId: 'attachment-1' },
    })).resolves.toMatchObject({ result: { ok: true, value: { mediaType: 'image/png', data: 'aW1hZ2U=' } } })
    expect(attachment).toHaveBeenCalledOnce()
    await expect(bridge.call({ method: 'credentials.describe', rpcId: 'native-3', payload: {} })).rejects.toMatchObject({
      code: 'METHOD_NOT_ALLOWED',
    })
    await expect(bridge.call({ method: 'host.createDirectory', rpcId: 'native-4', payload: {} })).rejects.toBeInstanceOf(RpcError)
  })

  it('replaces the legacy host.describe placeholder with the discovered Harness version', async () => {
    const describe = vi.fn(async (request: { rpcId: string }) => ({
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          version: '0.0.1',
          cwd: '/home/user',
          home: '/home/user',
          attachedSessions: 0,
        },
      },
    }))
    const listDirectory = vi.fn(async (request: { rpcId: string }) => ({
      rpcId: request.rpcId,
      result: { ok: true, value: { path: '/home/user', home: '/home/user', crumbs: [], entries: [], truncated: false } },
    }))
    const bridge = new HarnessApiBridge(
      api({ host: { describe, listDirectory } }),
      vi.fn(async () => undefined),
      8,
      undefined,
      undefined,
      '0.1.1-rc.2',
    )

    await expect(bridge.call({ method: 'host.describe', rpcId: 'native-describe', payload: {} }))
      .resolves.toMatchObject({
        rpcId: 'native-describe',
        result: { ok: true, value: { version: '0.1.1-rc.2', cwd: '/home/user', canOpenPath: true } },
      })
  })

  it('reassembles native image calls and chunks oversized attachment responses per peer', async () => {
    const imageData = 'A'.repeat(2 * 1024 * 1024)
    const attachment = vi.fn(async (request: { rpcId: string }) => ({
      rpcId: request.rpcId,
      result: { ok: true, value: { mediaType: 'image/png', data: imageData } },
    }))
    const bridge = new HarnessApiBridge(api({ sessions: { attachment } }), vi.fn(async () => undefined))
    const request = new TextEncoder().encode(JSON.stringify({
      method: 'session.attachment',
      rpcId: 'native-large-image',
      payload: { sessionId: 'session-1', attachmentId: 'attachment-1' },
    }))
    const transferId = 'transfer-image-1'
    const totalChunks = Math.ceil(request.byteLength / HARNESS_API_TRANSFER_CHUNK_BYTES)
    expect(bridge.openTransfer({ transferId, totalBytes: request.byteLength, totalChunks })).toEqual({
      opened: true,
      transferId,
    })
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * HARNESS_API_TRANSFER_CHUNK_BYTES
      bridge.appendTransfer({
        transferId,
        index,
        data: Buffer.from(request.subarray(start, start + HARNESS_API_TRANSFER_CHUNK_BYTES)).toString('base64'),
      })
    }
    const committed = await bridge.commitTransfer({ transferId })
    expect(committed).toMatchObject({ kind: 'chunked', transferId })
    if (committed.kind !== 'chunked') throw new Error('Expected a chunked attachment response.')
    const chunks: Uint8Array[] = []
    for (let index = 0; index < committed.totalChunks; index += 1) {
      const result = bridge.readTransfer({ transferId, index })
      chunks.push(Buffer.from(result.data, 'base64'))
    }
    const response = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    expect(response).toMatchObject({
      rpcId: 'native-large-image',
      result: { ok: true, value: { mediaType: 'image/png', data: imageData } },
    })
    expect(bridge.closeTransfer({ transferId })).toEqual({ closed: true, transferId })
  })

  it('fails closed on replayed or out-of-order image transfer chunks', () => {
    const bridge = new HarnessApiBridge(api({}), vi.fn(async () => undefined))
    bridge.openTransfer({ transferId: 'bad-order', totalBytes: 3, totalChunks: 1 })
    expect(() => bridge.appendTransfer({ transferId: 'bad-order', index: 1, data: 'YWJj' }))
      .toThrow('exactly once and in order')
    expect(() => bridge.appendTransfer({ transferId: 'bad-order', index: 0, data: 'YWJj' }))
      .toThrow('not active')
  })

  it('forwards the Host command registry through the Typert gateway with strict payload limits', async () => {
    const denied = new HarnessApiBridge(api({}), vi.fn(async () => undefined))
    await expect(denied.call({ method: 'commands.execute', rpcId: 'cmd-denied', payload: { agentId: 'session-1', line: '/goal complete', images: [] } }))
      .rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    await expect(denied.call({ method: 'commands.list', rpcId: 'list-denied', payload: { agentId: 'session-1' } }))
      .rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })

    const invoke = vi.fn(async (request: { namespace: string; method: string }) => {
      if (request.method === 'execute') return { commandId: 'cmd-1', result: { kind: 'success' as const, text: 'ok' } }
      return [
        { name: 'goal', description: 'Manage goals' },
        { name: 'plan', description: 'Enter or leave plan mode' },
        { name: 'plugin-command', description: 'Command registered by a Host plugin' },
      ]
    })
    const bridged = new HarnessApiBridge(api({}), vi.fn(async () => undefined), 3, undefined, { invoke })

    // Commands are resolved by the Host registry, matching the local UI.
    await expect(bridged.call({ method: 'commands.execute', rpcId: 'cmd-goal', payload: { agentId: 'session-1', line: '/goal complete' } }))
      .resolves.toMatchObject({ rpcId: 'cmd-goal', result: { ok: true, value: { commandId: 'cmd-1' } } })
    await expect(bridged.call({ method: 'commands.execute', rpcId: 'cmd-plan', payload: { agentId: 'session-1', line: '/plan off' } }))
      .resolves.toMatchObject({ rpcId: 'cmd-plan', result: { ok: true } })
    await expect(bridged.call({ method: 'commands.execute', rpcId: 'cmd-plugin', payload: { agentId: 'session-1', line: '/plugin-command payload' } }))
      .resolves.toMatchObject({ rpcId: 'cmd-plugin', result: { ok: true } })
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke).toHaveBeenCalledWith({
      namespace: 'commands',
      method: 'execute',
      args: { agentId: 'session-1', line: '/goal complete', images: [] },
      signal: expect.any(AbortSignal),
    })

    // The bridge still rejects malformed envelopes and oversized input before
    // they reach the Host. Command syntax and availability belong to the Host.
    await expect(bridged.call({ method: 'commands.execute', rpcId: 'cmd-extra', payload: { agentId: 'session-1', line: '/goal complete', extra: true } }))
      .rejects.toBeDefined()
    await expect(bridged.call({ method: 'commands.execute', rpcId: 'cmd-images', payload: { agentId: 'session-1', line: '/goal complete', images: [{ mediaType: 'image/png', data: 'aW1hZ2U=' }] } }))
      .rejects.toBeDefined()
    await expect(bridged.call({ method: 'commands.execute', rpcId: 'cmd-empty', payload: { agentId: 'session-1', line: '' } }))
      .rejects.toBeDefined()
    await expect(bridged.call({ method: 'commands.execute', rpcId: 'cmd-long', payload: { agentId: 'session-1', line: `/${'x'.repeat(2048)}` } }))
      .rejects.toBeDefined()
    expect(invoke).toHaveBeenCalledTimes(3)

    // The remote command catalog comes from the Host, not the local machine.
    await expect(bridged.call({ method: 'commands.list', rpcId: 'list-ok', payload: { agentId: 'session-1' } }))
      .resolves.toMatchObject({
        rpcId: 'list-ok',
        result: { ok: true, value: [{ name: 'goal' }, { name: 'plan' }, { name: 'plugin-command' }] },
      })
    expect(invoke).toHaveBeenCalledWith({
      namespace: 'commands',
      method: 'list',
      args: { agentId: 'session-1' },
      signal: expect.any(AbortSignal),
    })
    expect(invoke).toHaveBeenCalledTimes(4)
  })

  it('selects submittedAttachments for a 0.1.5 Host descriptor', async () => {
    const invoke = vi.fn(async () => ({ commandId: 'cmd-0.1.5', result: { kind: 'success' as const, text: 'ok' } }))
    const bridged = new HarnessApiBridge(api({}), vi.fn(async () => undefined), 3, undefined, { invoke }, '0.1.5-rc.1')

    await expect(bridged.call({
      method: 'commands.execute',
      rpcId: 'cmd-current-descriptor',
      payload: { agentId: 'session-1', line: '/goal complete', images: [] },
    })).resolves.toMatchObject({
      rpcId: 'cmd-current-descriptor',
      result: { ok: true, value: { commandId: 'cmd-0.1.5' } },
    })
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      args: { agentId: 'session-1', line: '/goal complete', submittedAttachments: [] },
    }))
  })

  it('publishes native stream frames and an explicit terminal event', async () => {
    const publish = vi.fn(async () => undefined)
    const bridge = new HarnessApiBridge(api({
      events: {
        mux: async function* () { yield { rpcId: 'frame-1', payload: { type: 'session/subscribed', sessionId: 's1', lastSeq: 0 } } },
        host: async function* () { return },
      },
    }), publish)

    expect(bridge.openStream({ streamId: 'stream-1', stream: 'mux', rpcId: 'open-1', payload: {} })).toEqual({
      opened: true,
      streamId: 'stream-1',
    })
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2))
    expect(publish.mock.calls[0]).toMatchObject(['harness.api.frame', { streamId: 'stream-1' }])
    expect(publish.mock.calls[1]).toEqual(['harness.api.stream.closed', { streamId: 'stream-1', reason: 'completed' }])
  })

  it('does not block peer replacement when a native stream ignores abort', async () => {
    let streamSignal: AbortSignal | undefined
    const stalled = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<never>>(() => undefined),
      }),
    }
    const bridge = new HarnessApiBridge(api({
      events: {
        mux: (_request: unknown, signal: AbortSignal) => {
          streamSignal = signal
          return stalled
        },
        host: async function* () { return },
      },
    }), vi.fn(async () => undefined), 1)

    bridge.openStream({ streamId: 'stalled-stream', stream: 'mux', rpcId: 'open-1', payload: {} })
    await expect(bridge.closeAll()).resolves.toBeUndefined()
    expect(streamSignal?.aborted).toBe(true)
    expect(bridge.openStream({ streamId: 'replacement-stream', stream: 'host', rpcId: 'open-2', payload: {} })).toEqual({
      opened: true,
      streamId: 'replacement-stream',
    })
  })

  it('frees the stream slot synchronously on close even when the native stream stalls', () => {
    const stalled = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<never>>(() => undefined),
      }),
    }
    const bridge = new HarnessApiBridge(api({
      events: {
        mux: (_request: unknown, signal: AbortSignal) => {
          signal.addEventListener('abort', () => undefined)
          return stalled
        },
        host: async function* () { return },
      },
    }), vi.fn(async () => undefined), 2)

    bridge.openStream({ streamId: 'mux-a', stream: 'mux', rpcId: 'open-1', payload: { sessionId: 'session-a' } })
    bridge.openStream({ streamId: 'host-b', stream: 'host', rpcId: 'open-2', payload: {} })
    bridge.closeStream({ streamId: 'mux-a' })
    // The client's close-then-reopen session switch must not hit RATE_LIMITED
    // even though the aborted native stream has not yielded its slot yet.
    expect(bridge.openStream({ streamId: 'mux-c', stream: 'mux', rpcId: 'open-3', payload: { sessionId: 'session-b' } })).toEqual({
      opened: true,
      streamId: 'mux-c',
    })
  })

  it('allows reconnect generations to overlap while keeping a bounded per-peer limit', () => {
    const stalled = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<never>>(() => undefined),
      }),
    }
    const streamApi = api({
      events: {
        mux: () => stalled,
        host: () => stalled,
      },
    })
    const firstPeer = new HarnessApiBridge(streamApi, vi.fn(async () => undefined))
    const secondPeer = new HarnessApiBridge(streamApi, vi.fn(async () => undefined))

    for (let index = 1; index <= 8; index += 1) {
      const streamId = `overlap-${index}`
      expect(firstPeer.openStream({ streamId, stream: index % 2 === 0 ? 'host' : 'mux', rpcId: `open-${index}`, payload: {} }))
        .toEqual({ opened: true, streamId })
    }
    expect(() => firstPeer.openStream({ streamId: 'ninth', stream: 'mux', rpcId: 'open-9', payload: {} }))
      .toThrow('Too many Harness event streams are open.')

    expect(secondPeer.openStream({ streamId: 'independent', stream: 'host', rpcId: 'open-10', payload: {} })).toEqual({
      opened: true,
      streamId: 'independent',
    })
  })

  it('allows responses only for answerable requests emitted on the same peer bridge', async () => {
    const respond = vi.fn(async () => ({ accepted: true as const }))
    const streamApi = api({
      events: {
        mux: async function* () {
          yield {
            rpcId: 'approval-rpc-1',
            payload: {
              type: 'approval/requested',
              sessionId: 'session-1',
              approvalId: 'approval-1',
              toolName: 'test-tool',
            },
          }
        },
        host: async function* () { return },
      },
      respond,
    })
    const publish = vi.fn(async () => undefined)
    const subscribed = new HarnessApiBridge(streamApi, publish)
    const otherPeer = new HarnessApiBridge(streamApi, vi.fn(async () => undefined))
    subscribed.openStream({ streamId: 'mux-1', stream: 'mux', rpcId: 'open-1', payload: {} })
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith(
      'harness.api.frame',
      expect.objectContaining({ streamId: 'mux-1' }),
    ))

    const response = {
      message: {
        type: 'client-response',
        rpcId: 'approval-rpc-1',
        result: { ok: true, value: { outcome: 'allowed-once' } },
      },
    }
    await expect(otherPeer.respond(response)).rejects.toMatchObject({ code: 'PERMISSION_NOT_PENDING' })
    await expect(subscribed.respond(response)).resolves.toEqual({ accepted: true })
    expect(respond).toHaveBeenCalledOnce()
  })
})

describe('HarnessApiBridge remote settings scope', () => {
  const ok = (rpcId: string, value: unknown) => ({ rpcId, result: { ok: true as const, value } })

  function providerApi() {
    const providers = vi.fn(async (request: { rpcId: string }) => ok(request.rpcId, {
      providers: [
        { provider: 'deepseek', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [], active: false },
        { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-openai', settingsPath: ['profiles', 'main'], active: true },
        { provider: 'unconfigured', displayName: 'No settings', settingsNs: '', settingsPath: [], active: false },
      ],
    }))
    return {
      api: api({
        llm: {
          providers,
          models: async (request: { rpcId: string }) => ok(request.rpcId, { groups: [], failures: [] }),
          discoverModels: vi.fn(async (request: { rpcId: string }) => ok(request.rpcId, { models: [{ id: 'deepseek-chat' }] })),
        },
        settings: {
          describe: vi.fn(async (request: { rpcId: string }) => ok(request.rpcId, {
            writable: true,
            hasDocument: true,
            namespaces: [
              {
                ns: 'llm-deepseek',
                schema: {},
                value: { apiKeyEnv: 'DSH_DEEPSEEK_API_KEY' },
                base: { apiKeyEnv: 'DSH_DEEPSEEK_API_KEY' },
                applies: 'live',
                secrets: [],
                revision: 1,
              },
              {
                ns: 'llm-openai',
                schema: {},
                value: { profiles: { main: { apiKeyEnv: 'DSH_OPENAI_API_KEY' } } },
                applies: 'live',
                secrets: [],
                revision: 2,
              },
              { ns: 'ds-harness-remote', schema: {}, value: {}, applies: 'restart', secrets: [], revision: 3 },
            ],
          })),
          update: vi.fn(async (request: { rpcId: string }) => ok(request.rpcId, { ns: 'llm-deepseek', revision: 2 })),
          replace: vi.fn(async (request: { rpcId: string }) => ok(request.rpcId, { ns: 'llm-deepseek', revision: 3 })),
          mutate: vi.fn(async (request: { rpcId: string }) => ok(request.rpcId, { ns: 'llm-deepseek', revision: 4 })),
        },
        credentials: {
          describe: vi.fn(async (request: { rpcId: string }) => ok(request.rpcId, { credentials: {} })),
          set: vi.fn(async (request: { rpcId: string }) => ok(request.rpcId, {})),
          unset: vi.fn(async (request: { rpcId: string }) => ok(request.rpcId, {})),
        },
      }),
      providers,
    }
  }

  it('allows settings writes only for namespaces the live settings directory declares', async () => {
    const { api: harnessApi } = providerApi()
    const bridge = new HarnessApiBridge(harnessApi, vi.fn(async () => undefined))

    await expect(bridge.call({
      method: 'settings.mutate',
      rpcId: 'config-1',
      payload: { ns: 'llm-deepseek', ops: [{ op: 'set', path: ['apiKeyEnv'], value: 'DSH_DEEPSEEK_API_KEY' }] },
    })).resolves.toMatchObject({ rpcId: 'config-1', result: { ok: true } })

    await expect(bridge.call({
      method: 'settings.update',
      rpcId: 'config-2',
      payload: { ns: 'llm-openai', patch: { enabled: true }, expectedRevision: 2 },
    })).resolves.toMatchObject({ rpcId: 'config-2', result: { ok: true } })

    await expect(bridge.call({
      method: 'settings.replace',
      rpcId: 'config-3',
      payload: { ns: 'llm-deepseek', section: {} },
    })).resolves.toMatchObject({ rpcId: 'config-3', result: { ok: true } })

    await expect(bridge.call({
      method: 'settings.mutate',
      rpcId: 'config-4',
      payload: { ns: 'ds-harness-remote', ops: [{ op: 'set', path: ['serverUrl'], value: 'https://evil.example' }] },
    })).resolves.toMatchObject({ rpcId: 'config-4', result: { ok: true } })

    await expect(bridge.call({
      method: 'settings.update',
      rpcId: 'config-5',
      payload: { ns: 'unknown-ns', patch: {} },
    })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
  })

  it('fails closed without a native settings directory or on oversized writes', async () => {
    const bare = new HarnessApiBridge(api({ settings: { mutate: vi.fn(async () => ok('x', {})) } }), vi.fn(async () => undefined))
    await expect(bare.call({
      method: 'settings.mutate',
      rpcId: 'config-bare',
      payload: { ns: 'llm-deepseek', ops: [{ op: 'set', path: ['a'], value: 1 }] },
    })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })

    const { api: harnessApi } = providerApi()
    const bridge = new HarnessApiBridge(harnessApi, vi.fn(async () => undefined))
    await expect(bridge.call({
      method: 'settings.update',
      rpcId: 'config-big',
      payload: { ns: 'llm-deepseek', patch: { blob: 'x'.repeat(70 * 1024) } },
    })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })

    await expect(bridge.call({
      method: 'settings.mutate',
      rpcId: 'config-ops',
      payload: { ns: 'llm-deepseek', ops: Array.from({ length: 65 }, (_, i) => ({ op: 'set' as const, path: [`k${i}`], value: i })) },
    })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
  })

  it('returns all registered namespaces while hiding the local document capability', async () => {
    const { api: harnessApi } = providerApi()
    const bridge = new HarnessApiBridge(harnessApi, vi.fn(async () => undefined))

    const response = await bridge.call({ method: 'settings.describe', rpcId: 'config-describe', payload: {} })
    expect(response.result).toMatchObject({ ok: true })
    const value = response.result as { ok: boolean; value: { namespaces: Array<{ ns: string }> } }
    expect(value.value.namespaces.map(item => item.ns)).toEqual(['llm-deepseek', 'llm-openai', 'ds-harness-remote'])
    expect(value.value).toMatchObject({ hasDocument: false })
  })

  it('bounds credential refs and values while preserving official global reference semantics', async () => {
    const { api: harnessApi } = providerApi()
    const bridge = new HarnessApiBridge(harnessApi, vi.fn(async () => undefined))

    await expect(bridge.call({
      method: 'credentials.set',
      rpcId: 'cred-1',
      payload: { ref: 'DSH_DEEPSEEK_API_KEY', value: 'sk-abc' },
    })).resolves.toMatchObject({ rpcId: 'cred-1', result: { ok: true } })

    await expect(bridge.call({
      method: 'credentials.unset',
      rpcId: 'cred-2',
      payload: { ref: 'DSH_OPENAI_API_KEY' },
    })).resolves.toMatchObject({ rpcId: 'cred-2', result: { ok: true } })

    await expect(bridge.call({
      method: 'credentials.describe',
      rpcId: 'cred-3',
      payload: { refs: ['DSH_DEEPSEEK_API_KEY'] },
    })).resolves.toMatchObject({ rpcId: 'cred-3', result: { ok: true } })

    await expect(bridge.call({
      method: 'credentials.set',
      rpcId: 'cred-bad-ref',
      payload: { ref: 'BAD-REF!', value: 'sk-abc' },
    })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })

    await expect(bridge.call({
      method: 'credentials.set',
      rpcId: 'cred-big',
      payload: { ref: 'DSH_DEEPSEEK_API_KEY', value: 'x'.repeat(9 * 1024) },
    })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })

    await expect(bridge.call({
      method: 'credentials.describe',
      rpcId: 'cred-unrelated-read',
      payload: { refs: ['GITHUB_TOKEN'] },
    })).resolves.toMatchObject({ rpcId: 'cred-unrelated-read', result: { ok: true } })

    await expect(bridge.call({
      method: 'credentials.set',
      rpcId: 'cred-unrelated-write',
      payload: { ref: 'GITHUB_TOKEN', value: 'poisoned' },
    })).resolves.toMatchObject({ rpcId: 'cred-unrelated-write', result: { ok: true } })

    await expect(bridge.call({
      method: 'settings.mutate',
      rpcId: 'cred-introduce-ref',
      payload: { ns: 'llm-deepseek', ops: [{ op: 'set', path: ['apiKeyEnv'], value: 'GITHUB_TOKEN' }] },
    })).resolves.toMatchObject({ rpcId: 'cred-introduce-ref', result: { ok: true } })

    await expect(bridge.call({
      method: 'settings.update',
      rpcId: 'cred-introduce-nested-ref',
      payload: { ns: 'llm-openai', patch: { profiles: { hostile: { apiKeyEnv: 'GITHUB_TOKEN' } } } },
    })).resolves.toMatchObject({ rpcId: 'cred-introduce-nested-ref', result: { ok: true } })
  })

  it('restricts llm.discoverModels endpoints to HTTPS or localhost HTTP', async () => {
    const { api: harnessApi } = providerApi()
    const bridge = new HarnessApiBridge(harnessApi, vi.fn(async () => undefined))

    await expect(bridge.call({
      method: 'llm.discoverModels',
      rpcId: 'discover-1',
      payload: { settingsNs: 'llm-deepseek', baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-abc' },
    })).resolves.toMatchObject({ rpcId: 'discover-1', result: { ok: true } })

    await expect(bridge.call({
      method: 'llm.discoverModels',
      rpcId: 'discover-2',
      payload: { settingsNs: 'llm-deepseek', baseURL: 'http://127.0.0.1:8080/v1' },
    })).resolves.toMatchObject({ rpcId: 'discover-2', result: { ok: true } })

    await expect(bridge.call({
      method: 'llm.discoverModels',
      rpcId: 'discover-http',
      payload: { settingsNs: 'llm-deepseek', baseURL: 'http://api.example.com/v1' },
    })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })

    await expect(bridge.call({
      method: 'llm.discoverModels',
      rpcId: 'discover-creds',
      payload: { settingsNs: 'llm-deepseek', baseURL: 'https://user:pass@api.example.com/v1' },
    })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })

    await expect(bridge.call({
      method: 'llm.discoverModels',
      rpcId: 'discover-big-key',
      payload: { settingsNs: 'llm-deepseek', baseURL: 'https://api.example.com/v1', apiKey: 'x'.repeat(9 * 1024) },
    })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
  })

  it('normalizes model-discovery failures without returning adapter messages or credentials', async () => {
    const { api: harnessApi } = providerApi()
    harnessApi.llm.discoverModels = vi.fn(async (request: { rpcId: string }) => ({
      rpcId: request.rpcId,
      result: {
        ok: false as const,
        error: {
          code: 'model-discovery-failed',
          message: 'provider rejected sk-secret',
          details: { settingsNs: 'llm-deepseek', baseURL: 'https://api.example.com/v1?key=sk-secret' },
        },
      },
    })) as never
    const bridge = new HarnessApiBridge(harnessApi, vi.fn(async () => undefined))

    const response = await bridge.call({
      method: 'llm.discoverModels',
      rpcId: 'discover-failed',
      payload: { settingsNs: 'llm-deepseek', baseURL: 'https://api.example.com/v1', apiKey: 'sk-secret' },
    })

    expect(response).toEqual({
      rpcId: 'discover-failed',
      result: {
        ok: false,
        error: {
          code: 'model-discovery-failed',
          message: 'Model discovery failed.',
          details: { settingsNs: 'llm-deepseek' },
        },
      },
    })
    expect(JSON.stringify(response)).not.toContain('sk-secret')

    harnessApi.llm.discoverModels = vi.fn(async () => {
      throw new Error('transport exposed sk-thrown')
    }) as never
    const throwingBridge = new HarnessApiBridge(harnessApi, vi.fn(async () => undefined))
    const thrownResponse = await throwingBridge.call({
      method: 'llm.discoverModels',
      rpcId: 'discover-thrown',
      payload: { settingsNs: 'llm-deepseek', baseURL: 'https://api.example.com/v1', apiKey: 'sk-thrown' },
    })
    expect(JSON.stringify(thrownResponse)).not.toContain('sk-thrown')
    expect(thrownResponse).toMatchObject({
      rpcId: 'discover-thrown',
      result: { ok: false, error: { code: 'model-discovery-failed', message: 'Model discovery failed.' } },
    })
  })

  it('keeps settings.openDocument and unlisted methods denied', async () => {
    const { api: harnessApi } = providerApi()
    const bridge = new HarnessApiBridge(harnessApi, vi.fn(async () => undefined))

    await expect(bridge.call({ method: 'settings.openDocument', rpcId: 'open-doc', payload: {} }))
      .rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    await expect(bridge.call({ method: 'settings.mutate2', rpcId: 'unknown', payload: {} }))
      .rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
  })

  it('does not log native Harness error messages', async () => {
    const secret = 'prompt=/home/user/private.ts token=sk-secret'
    const failure = new Error(secret)
    const list = vi.fn(async () => { throw failure })
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as SafeLogger
    const bridge = new HarnessApiBridge(
      api({ sessions: { list } }),
      vi.fn(async () => undefined),
      8,
      logger,
    )

    await expect(bridge.call({ method: 'session.list', rpcId: 'native-secret', payload: {} }))
      .rejects.toBe(failure)
    expect(logger.warn).toHaveBeenCalledWith('harness api call failed', expect.objectContaining({
      method: 'session.list',
      timedOut: false,
      code: 'INTERNAL_ERROR',
    }))
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(secret)
  })
})

function api(overrides: Record<string, unknown>): ApiProxy {
  return {
    sessions: {}, subagents: {}, host: {}, workspace: {}, skills: {}, agentPresets: {}, goals: {}, settings: {}, credentials: {}, llm: {},
    events: { mux: async function* () { return }, host: async function* () { return } },
    downloads: {},
    respond: async () => ({ accepted: true }),
    ...overrides,
  } as unknown as ApiProxy
}
