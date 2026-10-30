import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ControlResult } from '../src/control-result.js'
import { unwrapControlResult } from '../src/client/control-result.js'
import { generateKeyPair, NoiseIkSession, createNoisePrologue, fromBase64Url, toBase64Url } from '@dsh-remote/crypto'
import { createControlFrame } from '@dsh-remote/protocol'
import { RemoteClientCore } from '@dsh-remote/client-core'
import type { RtcPeerConnectionFactory } from '@dsh-remote/webrtc'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ClientModeRuntime,
  probeRemoteHostFeatures,
  remoteHostFeatures,
  type HostAuthorizationControl,
  type HostConnectionHandle,
} from '../src/client-runtime.js'
import type { ResolvedConfig } from '../src/config.js'
import { CONTROL_RPC_PREFIX } from '../src/control-route.js'
import { AcpVirtualHarness } from '../src/acp/virtual-harness.js'
import { CodexVirtualHarness, paginateCodexNativeHistory, projectCodexNativeHistory } from '../src/codex/virtual-harness.js'
import { IdentityStore } from '../src/identity-store.js'
import type { SafeLogger } from '../src/logging.js'
import type { ClientServerApi } from '../src/server-api.js'

const directories: string[] = []

const cleanupScenario1 = async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
}
afterEach(cleanupScenario1)

describe('ClientModeRuntime Host account control', () => {
  it('reuses the prepared device connection for tools without replacing or closing it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-shared-'))
    directories.push(directory)
    const runtime = new ClientModeRuntime(config(), new IdentityStore({ directory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi, gatewayWithCarrier(), logger())
    await runtime.start()
    const state = runtime as any
    const close = vi.fn(async () => undefined)
    const remote = { target: { deviceId: 'host-1' }, client: { close } }
    state.connected = remote
    const connect = vi.spyOn(state.connection, 'connect')
    try {
      expect(await state.withToolRemote('host-1', new AbortController().signal,
        async (value: unknown) => { expect(value).toBe(remote); return 'accepted' })).toBe('accepted')
      await expect(state.withToolRemote('host-1', new AbortController().signal,
        async () => { throw new Error('request failed') })).rejects.toThrow('request failed')
      expect(connect).not.toHaveBeenCalled()
      expect(close).not.toHaveBeenCalled()
      await expect(state.withToolRemote('host-1', new AbortController().signal,
        async () => { state.connected = undefined; return 'late'; })).rejects.toMatchObject({ code: 'CANCELLED' })
    } finally { state.connected = undefined; await runtime.close() }
  })

  it('retires pending connections on explicit exit, account sign-out and runtime shutdown', async () => {
    await runScenarios((['exit', 'sign-out', 'shutdown'] as const).flatMap(action =>
      (['mode', 'directory'] as const).map(request => ({ name: `${action}: pending ${request}`, run: async () => {
        const directory = await mkdtemp(join(tmpdir(), 'dsh-client-exit-'))
        directories.push(directory)
        const runtime = new ClientModeRuntime(config(), new IdentityStore({ directory }),
          { bindIdentity: vi.fn(), revokeCurrentDevice: vi.fn(async () => undefined) } as unknown as ClientServerApi,
          gatewayWithCarrier(), logger())
        await runtime.start()
        let resolve!: (remote: unknown) => void
        const state = runtime as unknown as { connection: { connect: (id: string) => Promise<unknown> } }
        vi.spyOn(state.connection, 'connect').mockImplementation(() => new Promise(yes => { resolve = yes }))
        const client = { close: vi.fn(async () => undefined), getStats: () => ({ mode: 'Relay', connected: true }) }
        const pending = request === 'mode' ? runtime.setMode('remote', 'host-1') : runtime.listRemoteDirectory('host-1')
        const rejected = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
        if (action === 'exit') await runtime.setMode('local')
        else if (action === 'sign-out') await runtime.clearClientAuthorization()
        else await runtime.close()
        resolve({ client, target: { deviceId: 'host-1', name: 'Host' }, features: {}, progressRunId: 1 })
        await rejected
        expect(client.close).toHaveBeenCalledOnce()
        expect(runtime.status()).toMatchObject({ mode: 'local', connected: false })
        await runtime.close()
      } }))), cleanupScenario1)
  })

  it('completes carrier teardown and local sign-out when an independent cleanup fails', async () => {
    await runScenarios((['stream', 'preview', 'carrier', 'revocation'] as const).map(failure => ({ name: failure, run: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dsh-client-exit-failure-'))
      directories.push(directory)
      const revoke = vi.fn(async () => { if (failure === 'revocation') throw new Error('revocation failed') })
      const runtime = new ClientModeRuntime(config(), new IdentityStore({ directory }),
        { bindIdentity: vi.fn(), revokeCurrentDevice: revoke } as unknown as ClientServerApi,
        gatewayWithCarrier(), logger())
      await runtime.start()
      const previousIdentity = runtime.status().deviceId
      const close = vi.fn(async () => { if (failure === 'carrier') throw new Error('carrier failed') })
      const client = { close, getStats: () => ({ mode: 'Relay', connected: true }) }
      const streamClose = vi.fn(async () => { if (failure === 'stream') throw new Error('stream failed') })
      const previewClose = vi.fn(async () => { if (failure === 'preview') throw new Error('preview failed') })
      const state = runtime as unknown as {
        connected: unknown; preview: unknown; codexStreams: Map<string, unknown>
      }
      state.connected = { client, target: { deviceId: 'host-1', name: 'Host' }, features: {} }
      state.preview = { close: previewClose }
      state.codexStreams.set('stream', {
        target: { kind: 'remote', client }, close: streamClose, unsubscribe: vi.fn(), wake: vi.fn(),
      })
      await expect(runtime.clearClientAuthorization()).rejects.toThrow(`${failure} failed`)
      expect(close).toHaveBeenCalledOnce()
      expect(streamClose).toHaveBeenCalledOnce()
      expect(previewClose).toHaveBeenCalledOnce()
      expect(revoke).toHaveBeenCalledOnce()
      expect(state.codexStreams.size).toBe(0)
      expect(runtime.status()).toMatchObject({ mode: 'local', connected: false })
      expect(runtime.status().deviceId).not.toBe(previousIdentity)
      await runtime.close()
    } })), cleanupScenario1)
  })

  it('completes direct then TURN then Relay startup with a twenty-second Server budget', async () => {
    vi.useFakeTimers()
    const clientKeys = generateKeyPair(new Uint8Array(32).fill(41))
    const hostKeys = generateKeyPair(new Uint8Array(32).fill(42))
    const identity = { schemaVersion: 1, deviceId: 'client-1', name: 'Client', fingerprint: 'CLIENT', ...clientKeys }
    const host = { deviceId: 'host-1', name: 'Host', role: 'host', platform: 'linux', membershipId: 'member', identityKey: hostKeys.publicKey }
    const sockets: Socket[] = []
    class Socket {
      static OPEN = 1
      readyState = 0
      binaryType = ''
      sent: { type: string; payload: Record<string, unknown> }[] = []
      onopen?: () => void
      onmessage?: (event: { data: string }) => void
      onclose?: (event: { code: number; reason: string }) => void
      readonly id = `connection-${sockets.length + 1}`
      constructor() { sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
      receive(type: Parameters<typeof createControlFrame>[0], payload: unknown) {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(createControlFrame(type, payload)) }))
      }
      send(raw: string) {
        const frame = JSON.parse(raw)
        this.sent.push(frame)
        if (frame.type === 'hello') this.receive('hello.ack', {
          protocol: 1, serverVersion: 'test', connectionSessionId: this.id, heartbeatIntervalMs: 25000,
          maxControlFrameBytes: 65536, maxRelayFrameBytes: 1048576,
          capabilities: ['transport.lan', 'transport.p2p', 'transport.turn', 'transport.relay'], webrtcFallbackTimeoutMs: 20000,
        })
        if (frame.type === 'connect.request') this.receive('connect.accepted', { connectionId: this.id })
        if (frame.type === 'secure.handshake') {
          const noise = new NoiseIkSession({ role: 'responder', localPrivateKey: hostKeys.privateKey,
            localPublicKey: hostKeys.publicKey, remotePublicKey: clientKeys.publicKey,
            prologue: createNoisePrologue(this.id, 'host-1', 'client-1') })
          noise.readHandshake(fromBase64Url(frame.payload.data))
          this.receive('secure.handshake', { connectionId: this.id, targetDeviceId: 'client-1', step: 2, data: toBase64Url(noise.writeHandshake()) })
          noise.destroy()
        }
      }
      close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }) }
    }
    vi.stubGlobal('WebSocket', Socket)
    const create = vi.fn(() => ({
      connectionState: 'new', iceConnectionState: 'new', iceGatheringState: 'new',
      createDataChannel: () => ({ label: 'dsh', ordered: true, readyState: 'connecting', bufferedAmount: 0, close() {} }),
      createOffer: async () => ({ type: 'offer', sdp: 'offer' }), setLocalDescription: async () => {},
      getStats: async () => [], close() {},
    }))
    const identities = {
      loadOrCreate: async () => identity, trustedPeer: () => undefined,
      trustPeer: async (input: unknown) => ({ ...input as object, trustedAt: 1, fingerprint: 'HOST' }),
    } as unknown as IdentityStore
    const server = { baseUrl: 'https://remote.test', bindIdentity() {}, listDevices: async () => [host],
      deviceFor: async () => host, presenceFor: async () => ({ online: true }),
      authenticate: async () => ({ accessToken: 'test-token' }), turnCredentials: async () => [],
    } as unknown as ClientServerApi
    vi.spyOn(RemoteClientCore.prototype, 'rpc').mockResolvedValue({ capabilities: ['harness.remote.v3'] })
    const runtime = new ClientModeRuntime(config(), identities, server, gateway(), logger(), undefined,
      async () => ({ create }) as unknown as RtcPeerConnectionFactory)
    let connected: { client: RemoteClientCore } | undefined
    try {
      await runtime.start()
      const connecting = (runtime as unknown as { connect(id: string): Promise<{ client: RemoteClientCore }> }).connect('host-1')
      await vi.advanceTimersByTimeAsync(41000)
      connected = await connecting
      expect(sockets).toHaveLength(3)
      expect(sockets.map(socket => socket.sent.find(frame => frame.type === 'connect.request')?.payload.preferredTransports)).toEqual([
        ['lan', 'p2p', 'relay'], ['turn', 'relay'], ['relay'],
      ])
      expect(create).toHaveBeenCalledTimes(2)
      expect(sockets.slice(0, 2).every(socket => socket.readyState === 3)).toBe(true)
      expect(connected.client.getStats().mode).toBe('Relay')
      // Agent discovery uses the same real handshake/fallback path without
      // replacing the UI's connection or its progress state.
      const state = runtime as unknown as {
        connection: import('../src/client-connection.js').ClientConnection
        connected: unknown
        connectionProgress: unknown
        connectionProgressRun: number
      }
      state.connected = connected
      const progress = state.connectionProgress
      const run = state.connectionProgressRun
      const background = state.connection.connect('host-1', undefined, { background: true })
      await vi.advanceTimersByTimeAsync(41000)
      const candidate = await background
      expect(state.connectionProgress).toBe(progress)
      expect(state.connectionProgressRun).toBe(run)
      expect(state.connected).toBe(connected)
      await candidate.client.close()
      expect(state.connected).toBe(connected)
      expect(connected.client.getStats().mode).toBe('Relay')
      state.connected = undefined
    } finally {
      await connected?.client.close()
      await runtime.close()
      vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
    }
  })

  it('discovers Host capabilities conservatively without inferring backend readiness', async () => {
    await runScenarios(
      [
        {
          name: 'uses a conservative compatibility profile for legacy and unknown Hosts',
          run: () => {
            expect(remoteHostFeatures()).toEqual({
              commandList: false,
              fileViewer: false,
              terminal: false,

              remoteGateway: false,
              codex: false,
              pluginRoute: false,
              cursor: false,
              antigravity: false,
              opencode: false,
            })





          },
        },
        {
          name: 'requires authenticated capability discovery',
          run: async () => {
            const alphaClient = {
              rpc: vi.fn(async () => ({
                capabilities: [
                  'transport.relay',
                  'harness.remote.v1',
                  'harness.remote.transfer.v1',
                  'codex.appserver.v1',
                ],
              })),
            }
            await expect(probeRemoteHostFeatures(alphaClient as never, '0.3.15')).resolves.toEqual({
              commandList: true,
              fileViewer: false,
              terminal: false,

              remoteGateway: true,
              codex: true,
              pluginRoute: false,
              cursor: false,
              antigravity: false,
              opencode: false,
              claude: false,
            })

            alphaClient.rpc.mockResolvedValueOnce({
              capabilities: ['transport.relay', 'harness.remote.v3', 'harness.remote.transfer.v1'],
            })
            await expect(probeRemoteHostFeatures(alphaClient as never, '0.4.11')).resolves.toEqual({
              commandList: true,
              fileViewer: false,
              terminal: false,

              remoteGateway: true,
              sessionFormat: 3,
              codex: false,
              pluginRoute: false,
              cursor: false,
              antigravity: false,
              opencode: false,
              claude: false,
            })

            alphaClient.rpc.mockResolvedValueOnce({
              capabilities: ['transport.relay', 'codex.appserver.v1', 'codex.appserver.transfer.v1'],
            })
            await expect(probeRemoteHostFeatures(alphaClient as never, '0.4.19')).resolves.toEqual({
              commandList: false,
              fileViewer: false,
              terminal: false,

              remoteGateway: false,
              codex: true,
              pluginRoute: false,
              cursor: false,
              antigravity: false,
              opencode: false,
              claude: false,
            })

            const legacyClient = {
              rpc: vi.fn(async () => {
                throw Object.assign(new Error('unknown method'), { code: 'METHOD_NOT_FOUND' })
              }),
            }
            await expect(probeRemoteHostFeatures(legacyClient as never, '0.3.17')).rejects.toMatchObject({ code: 'FEATURE_NOT_SUPPORTED' })
          },
        },
        {
          name: 'does not infer a backend from the legacy generic ACP capability',
          run: async () => {
            const client = { rpc: vi.fn(async () => ({ capabilities: ['agent.acp.v1'] })) }
            await expect(probeRemoteHostFeatures(client as never)).rejects.toMatchObject({
              code: 'FEATURE_NOT_SUPPORTED',
            })
            client.rpc.mockResolvedValueOnce({ capabilities: ['agent.acp.v1', 'agent.acp.antigravity.v1'] })
            expect(await probeRemoteHostFeatures(client as never)).toMatchObject({
              cursor: false,
              antigravity: true,
              opencode: false,
            })
            client.rpc.mockResolvedValueOnce({ capabilities: ['agent.acp.v1', 'agent.acp.opencode.v1'] })
            expect(await probeRemoteHostFeatures(client as never)).toMatchObject({
              cursor: false,
              antigravity: false,
              opencode: true,
            })
          },
        },
        {
          name: 'probes workspaceTypes from remote Host and safely tolerates malformed values',
          run: async () => {
            const client = {
              rpc: vi.fn(async () => ({
                capabilities: ['transport.relay', 'codex.appserver.v1'],
                workspaceTypes: [
                  { id: 'codex', name: 'CodeX', capability: 'codex.appserver.v1', available: true },
                  { id: 456, invalid: true },
                ],
              })),
            }
            await expect(probeRemoteHostFeatures(client as never, '0.4.19')).resolves.toMatchObject({
              codex: true,
              pluginRoute: false,
              workspaceTypes: [
                { id: 'codex', name: 'CodeX', capability: 'codex.appserver.v1', available: true },
              ],
            })
          },
        },
      ],
      async () => {
        await cleanupScenario1()
      },
    )
  }, 20000)

  it('requires workspace readiness alongside each independent backend capability', async () => {
    const rows = ['cursor', 'antigravity', 'claude'] as const
    await runScenarios(
      rows.map((row, index) => {
        const backend = row
        return {
          name: scenarioName('uses %s workspace readiness alongside its independent capability', row, index),
          run: async () => {
            const capability = `agent.acp.${backend}.v1`
            const client = {
              rpc: vi.fn(async () => ({
                capabilities: ['harness.remote.v1', capability],
                workspaceTypes: [{ id: backend, name: backend, capability, available: false }],
              })),
            }
            expect(await probeRemoteHostFeatures(client as never)).toMatchObject({ [backend]: false })
            client.rpc.mockResolvedValueOnce({
              capabilities: ['harness.remote.v1', capability],
              workspaceTypes: [{ id: backend, name: backend, capability, available: true }],
            })
            expect(await probeRemoteHostFeatures(client as never)).toMatchObject({ [backend]: true })
          },
        }
      }),
      async () => {
        await cleanupScenario1()
      },
    )
  })

  it('forwards opaque QR provider IDs and rejects malformed control input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-qr-provider-'))
    directories.push(directory)
    const startOAuthQrLogin = vi.fn(async (provider: string) => ({
      qrId: `${provider}-qr-session-1234567890`,
      scanUrl: `https://dsh.r2049.cn/api/v1/auth/q/${provider}-qr-session-1234567890`,
      expiresIn: 600,
    }))
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      { bindIdentity: vi.fn(), startOAuthQrLogin } as unknown as ClientServerApi,
      gateway(),
      logger(),
    )
    await runtime.start()
    const signal = new AbortController().signal

    await expect(runtime.handleControl(
      'client.account.qr.start',
      { provider: 'github' },
      signal,
    )).resolves.toMatchObject({ ok: true, value: { expiresIn: 600 } })
    expect(startOAuthQrLogin).toHaveBeenCalledWith('github')

    await expect(runtime.handleControl(
      'client.account.qr.start',
      { provider: 'future-provider' },
      signal,
    )).resolves.toMatchObject({ ok: true })
    expect(startOAuthQrLogin).toHaveBeenCalledWith('future-provider')
    await expect(runtime.handleControl(
      'client.account.qr.start',
      { provider: { id: 'github' } },
      signal,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', details: { remoteCode: 'INVALID_MESSAGE' } },
    })
    expect(startOAuthQrLogin).toHaveBeenCalledTimes(2)
    await runtime.close()
  })

  it('keeps the selected remote Workspace until the browser opens it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-workspace-selection-'))
    directories.push(directory)
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      gatewayWithCarrier(),
      logger(),
    )
    await runtime.start()
    const rpc = vi.fn(async () => ({
      ok: true, value: { workspace: { workspaceId: 'workspace-remote-1', path: '/srv/project', title: 'project', sessionIds: [] }, created: false },
    }))
    const close = vi.fn(async () => undefined)
    ;(runtime as unknown as { connected: unknown }).connected = {
      client: { rpc, close, getStats: () => ({ mode: 'Relay', connected: true }) },
      target: {
        deviceId: 'host-device-1',
        name: 'Workstation',
        platform: 'linux',
        publicKey: 'peer-key',
        fingerprint: 'PEER',
        trustedAt: 1,
      },
      transport: {},
      features: { commandList: true, fileViewer: true, remoteGateway: true, codex: false },
    }

    await expect(runtime.openRemoteWorkspace('host-device-1', '/srv/project')).resolves.toMatchObject({
      workspaceSelection: { targetDeviceId: 'host-device-1', workspaceId: 'workspace-remote-1' },
    })
    expect(runtime.status()).toMatchObject({
      workspaceSelection: { targetDeviceId: 'host-device-1', workspaceId: 'workspace-remote-1' },
    })

    const signal = new AbortController().signal
    await runtime.handleControl('workspace.selection.consume', {
      targetDeviceId: 'host-device-1', workspaceId: 'another-workspace',
    }, signal)
    expect(runtime.status()).toHaveProperty('workspaceSelection')

    await runtime.handleControl('workspace.selection.consume', {
      targetDeviceId: 'host-device-1', workspaceId: 'workspace-remote-1',
    }, signal)
    expect(runtime.status()).not.toHaveProperty('workspaceSelection')
    await runtime.close()
  })

  it('restores Codex navigation across detached connections without leaking Host or workspace memory', async () => {
    await runScenarios([
      { name: 'replacement connection on the same Host and workspace', host: 'host-1', workspace: 'repo', expected: 'codex:older' },
      { name: 'another Host with identical workspace and thread IDs', host: 'host-2', workspace: 'repo', expected: 'codex:latest' },
      { name: 'another workspace on the same Host', host: 'host-1', workspace: 'other', expected: 'codex:other-latest' },
      { name: 'remembered thread no longer in the Host catalog', host: 'host-1', workspace: 'repo', missing: true, expected: 'codex:latest' },
      { name: 'native navigation remembers each actual workspace', host: 'host-1', workspace: 'other', nativeNavigation: true, expected: 'codex:other-older' },
      { name: 'account sign-out clears all navigation memory', host: 'host-1', workspace: 'repo', signOut: true, expected: 'codex:latest' },
      { name: 'late catalog cannot overwrite a newer workspace open', host: 'host-1', workspace: 'other', race: 'newer', expected: 'codex:other-latest' },
      { name: 'late catalog cannot reinstall a disconnected carrier', host: 'host-1', workspace: 'repo', race: 'disconnect', expected: 'codex:older' },
      { name: 'late catalog after sign-out cannot restore old memory', host: 'host-1', workspace: 'repo', race: 'logout', expected: 'codex:latest' },
      { name: 'late old Host connection cannot close the newer Host', host: 'host-new', workspace: 'repo', race: 'connect-newer', expected: 'codex:latest' },
      { name: 'late Host connection after sign-out never regains authority', host: 'host-1', workspace: 'repo', race: 'connect-logout', expected: 'codex:latest' },
      { name: 'late CodeX teardown preserves the successor Cursor carrier', host: 'host-1', workspace: 'repo', successor: 'cursor' as const, expected: 'codex:older' },
      { name: 'late CodeX teardown preserves the successor AGY carrier', host: 'host-1', workspace: 'repo', successor: 'antigravity' as const, expected: 'codex:older' },
    ].map(scenario => ({
      name: scenario.name,
      run: async () => {
        const directory = await mkdtemp(join(tmpdir(), 'dsh-client-codex-recovery-'))
        directories.push(directory)
        const runtime = new ClientModeRuntime(config(), new IdentityStore({ directory }),
          { bindIdentity: vi.fn(), revokeCurrentDevice: vi.fn(async () => undefined) } as unknown as ClientServerApi, gatewayWithCarrier(), logger())
        const threads = [
          { id: 'latest', cwd: '/srv/repo', name: 'Latest', updatedAt: 30, turns: [] },
          { id: 'older', cwd: '/srv/repo', name: 'Older', updatedAt: 10, turns: [] },
          { id: 'other-latest', cwd: '/srv/other', name: 'Other', updatedAt: 40, turns: [] },
          { id: 'other-older', cwd: '/srv/other', name: 'Older other', updatedAt: 5, turns: [] },
        ]
        let releaseCatalog!: () => void
        let catalogStarted!: () => void
        const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve })
        const catalogWaiting = new Promise<void>(resolve => { catalogStarted = resolve })
        let deferCatalog = false
        let deferStreamClose = false
        let acpRemoteSpy: { mockRestore(): void } | undefined
        let missing = false
        const transfers = new Map<string, Buffer[]>()
        const rpc = vi.fn(async (method: string, params: unknown): Promise<unknown> => {
          if (method === 'codex.app.transfer.open') {
            transfers.set((params as { transferId: string }).transferId, [])
            return { opened: true }
          }
          if (method === 'codex.app.transfer.chunk') {
            const chunk = params as { transferId: string; data: string }
            transfers.get(chunk.transferId)!.push(Buffer.from(chunk.data, 'base64'))
            return { accepted: true }
          }
          if (method === 'codex.app.transfer.commit') {
            const id = (params as { transferId: string }).transferId
            return { kind: 'inline', response: await rpc('codex.app.call', JSON.parse(Buffer.concat(transfers.get(id)!).toString())) }
          }
          if (method === 'codex.app.transfer.close') {
            transfers.delete((params as { transferId: string }).transferId)
            return { closed: true }
          }
          if (method === 'harness.transport.describe') return { capabilities: ['harness.remote.v1', 'codex.appserver.v1',
            ...(scenario.successor === undefined ? [] : [`agent.acp.${scenario.successor}.v1`]),
          ] }
          if (method === 'codex.app.call') {
            const call = params as { method: string; params: Record<string, unknown> }
            if (call.method === 'project/list') return { data: [
              { id: 'repo', name: 'Repo', roots: [{ path: '/srv/repo' }] },
              { id: 'other', name: 'Other', roots: [{ path: '/srv/other' }] },
            ] }
            if (call.method === 'thread/list') {
              if (deferCatalog) {
                deferCatalog = false
                catalogStarted()
                await catalogGate
              }
              return { data: threads.filter(thread => !missing || thread.id !== 'older') }
            }
            if (call.method === 'model/list') return { data: [] }
            if (call.method === 'dsh/sessionHistory') {
              const thread = threads.find(thread => thread.id === call.params.threadId)!
              return paginateCodexNativeHistory(projectCodexNativeHistory(thread, `codex:${thread.id}`), {})
            }
          }
          if (method === 'codex.app.stream.open') return { opened: true }
          if (method === 'codex.app.stream.close') {
            if (deferStreamClose) {
              deferStreamClose = false
              catalogStarted()
              await catalogGate
            }
            return { closed: true }
          }
          throw new Error(`unexpected method: ${method}`)
        })
        const state = runtime as unknown as { connected: unknown; codexVirtual: CodexVirtualHarness; closeCodexVirtual(): Promise<void> }
        const makeConnection = (host: string) => ({
          client: { rpc, close: vi.fn(async () => undefined), getStats: () => ({ mode: 'Relay', connected: true }), onEvent: () => () => undefined },
          target: { deviceId: host, name: 'Host', platform: 'linux', publicKey: 'peer-key', fingerprint: 'PEER', trustedAt: 1 },
          transport: {}, features: remoteHostFeatures(),
        })
        const connect = (host: string) => { state.connected = makeConnection(host) }
        try {
          await runtime.start()
          connect('host-1')
          const workspaces = await runtime.listCodexWorkspaces('host-1')
          const repo = workspaces.find(workspace => workspace.path === '/srv/repo')!
          await runtime.openCodexWorkspace('host-1', repo.workspaceId)
          const history = await state.codexVirtual.dispatch('session/history', { args: { request: { sessionId: 'codex:older' as never } } }, new AbortController().signal)
          expect(history.ok).toBe(true)
          await state.codexVirtual.open('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'codex:older' } } } }, new AbortController().signal)
          if (scenario.nativeNavigation) {
            const otherHistory = await state.codexVirtual.dispatch('session/history', { args: { request: { sessionId: 'codex:other-older' as never } } }, new AbortController().signal)
            expect(otherHistory.ok).toBe(true)
          }
          if (scenario.successor !== undefined) {
            const workspace = { workspaceId: `${scenario.successor}:cwd:/srv/repo`, path: '/srv/repo', title: 'Repo', sessionIds: ['acp-successor'] }
            const successor = {
              close: vi.fn(async () => undefined),
              selectWorkspace: vi.fn(async () => workspace),
              preferredSessionId: vi.fn(async () => 'acp-successor'),
            }
            acpRemoteSpy = vi.spyOn(AcpVirtualHarness, 'remote').mockReturnValue(successor as unknown as AcpVirtualHarness)
            deferStreamClose = true
            const lateOpen = runtime.openCodexWorkspace('host-1', repo.workspaceId)
            const rejected = expect(lateOpen).rejects.toMatchObject({ code: 'CANCELLED' })
            await catalogWaiting
            const selection = { targetDeviceId: 'host-1', workspaceId: workspace.workspaceId, backend: scenario.successor, sessionId: 'acp-successor' }
            await expect(runtime.openCursorWorkspace('host-1', workspace.workspaceId, undefined, scenario.successor)).resolves.toMatchObject({ workspaceSelection: selection })
            expect(successor.close).not.toHaveBeenCalled()
            releaseCatalog()
            await rejected
            expect(successor.close).not.toHaveBeenCalled()
            expect((runtime as unknown as { cursorVirtual: unknown }).cursorVirtual).toBe(successor)
            expect(runtime.status()).toMatchObject({ workspaceSelection: selection })
          } else if (scenario.race?.startsWith('connect-')) {
            state.connected = undefined
            await state.closeCodexVirtual()
            const staleConnection = makeConnection('host-stale')
            const newerConnection = makeConnection('host-new')
            vi.spyOn(runtime as unknown as { connect(host: string): Promise<unknown> }, 'connect').mockImplementation(async host => {
              if (host === 'host-stale') {
                catalogStarted()
                await catalogGate
                return staleConnection
              }
              return newerConnection
            })
            const lateOpen = runtime.openCodexWorkspace('host-stale', repo.workspaceId)
            const rejected = expect(lateOpen).rejects.toMatchObject({ code: 'CANCELLED' })
            await catalogWaiting
            if (scenario.race === 'connect-newer') {
              await runtime.openCodexWorkspace('host-new', repo.workspaceId)
            } else {
              await runtime.clearClientAuthorization()
            }
            releaseCatalog()
            await rejected
            expect(staleConnection.client.close).toHaveBeenCalledTimes(1)
            if (scenario.race === 'connect-newer') {
              expect(state.connected).toBe(newerConnection)
              expect(newerConnection.client.close).not.toHaveBeenCalled()
              expect(runtime.status()).toMatchObject({ workspaceSelection: { targetDeviceId: 'host-new', sessionId: 'codex:latest' } })
            } else {
              expect(state.connected).toBeUndefined()
              expect(state.codexVirtual).toBeUndefined()
            }
          } else if (scenario.race) {
            deferCatalog = true
            const lateOpen = runtime.openCodexWorkspace('host-1', repo.workspaceId)
            const rejected = expect(lateOpen).rejects.toMatchObject({ code: 'CANCELLED' })
            await catalogWaiting
            if (scenario.race === 'newer') {
              const other = workspaces.find(workspace => workspace.path === '/srv/other')!
              await runtime.openCodexWorkspace('host-1', other.workspaceId)
            } else if (scenario.race === 'logout') {
              await runtime.clearClientAuthorization()
            } else {
              state.connected = undefined
              await state.closeCodexVirtual()
            }
            releaseCatalog()
            await rejected
            if (scenario.race === 'newer') {
              expect(runtime.status()).toMatchObject({ workspaceSelection: { sessionId: 'codex:other-latest' } })
            } else {
              expect(state.codexVirtual).toBeUndefined()
            }
          }
          if (scenario.signOut) await runtime.clearClientAuthorization()
          // Mirror transport-close ordering: authority is detached before the
          // virtual carrier closes, so recovery must not depend on connected.
          state.connected = undefined
          await state.closeCodexVirtual()
          missing = scenario.missing === true
          connect(scenario.host)
          const workspace = workspaces.find(item => item.path === `/srv/${scenario.workspace}`)!
          await expect(runtime.openCodexWorkspace(scenario.host, workspace.workspaceId)).resolves.toMatchObject({
            workspaceSelection: { targetDeviceId: scenario.host, workspaceId: workspace.workspaceId, backend: 'codex', sessionId: scenario.expected },
          })
          if (scenario.nativeNavigation) {
            await expect(runtime.openCodexWorkspace(scenario.host, repo.workspaceId)).resolves.toMatchObject({
              workspaceSelection: { sessionId: 'codex:older' },
            })
          }
          expect(rpc.mock.calls.some(([method, params]) => method === 'codex.app.call'
            && ['thread/start', 'thread/resume', 'turn/start'].includes((params as { method: string }).method))).toBe(false)
        } finally {
          releaseCatalog()
          try { await runtime.close() } finally { acpRemoteSpy?.mockRestore() }
        }
      },
    })), cleanupScenario1)
  }, 10000)

  it('exposes the independent Codex domain to Web through bounded loopback calls and event polling', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-codex-loopback-'))
    directories.push(directory)
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      gateway(),
      logger(),
    )
    await runtime.start()
    let eventHandler: ((event: { event: string; data: unknown }) => void) | undefined
    const rpc = vi.fn(async (method: string, params: unknown) => {
      if (method === 'harness.transport.describe') return {
        capabilities: ['harness.api.v1', 'harness.api.transfer.v1', 'codex.appserver.v1'],
      }
      if (method === 'codex.app.call') return { data: [{ id: 'thr_1', cwd: '/srv/project' }] }
      if (method === 'codex.app.stream.open') {
        const streamId = (params as { streamId: string }).streamId
        eventHandler?.({
          event: 'codex.app.frame',
          data: { streamId, frame: { method: 'item/agentMessage/delta', params: { delta: 'hello' } } },
        })
        return { opened: true }
      }
      if (method === 'codex.app.respond') return { resolved: true }
      if (method === 'codex.app.stream.close') return { closed: true }
      throw new Error(`unexpected method: ${method} ${JSON.stringify(params)}`)
    })
    const client = {
      rpc,
      close: vi.fn(async () => undefined),
      getStats: () => ({ mode: 'Relay', connected: true }),
      onEvent: (handler: typeof eventHandler) => { eventHandler = handler; return () => { eventHandler = undefined } },
    }
    ;(runtime as unknown as { connected: unknown }).connected = {
      client,
      target: {
        deviceId: 'host-device-1', name: 'Workstation', platform: 'linux', publicKey: 'peer-key', fingerprint: 'PEER', trustedAt: 1,
      },
      transport: {},
      features: { commandList: true, fileViewer: false, remoteGateway: false, codex: false },
    }
    const signal = new AbortController().signal

    await expect(runtime.handleControl('codex.probe', {}, signal)).resolves.toMatchObject({
      ok: true,
      value: { supported: true },
    })
    expect(runtime.status()).toMatchObject({ remoteFeatures: { codex: true } })
    await expect(runtime.handleControl('codex.call', {
      method: 'thread/list', params: {},
    }, signal)).resolves.toMatchObject({ ok: true, value: { data: [{ id: 'thr_1' }] } })
    await expect(runtime.handleControl('codex.stream.open', {
      streamId: 'web-stream-1', threadId: 'thr_1',
    }, signal)).resolves.toMatchObject({ ok: true, value: { opened: true, streamId: 'web-stream-1' } })
    await expect(runtime.handleControl('codex.stream.next', {
      streamId: 'web-stream-1',
    }, signal)).resolves.toMatchObject({
      ok: true,
      value: { frames: [{ method: 'item/agentMessage/delta', params: { delta: 'hello' } }], closed: false },
    })
    await runtime.handleControl('codex.respond', { requestHandle: 'handle-1', decision: 'decline' }, signal)
    expect(rpc).toHaveBeenCalledWith('codex.app.respond', { requestHandle: 'handle-1', decision: 'decline' }, signal)
    await runtime.handleControl('codex.stream.close', { streamId: 'web-stream-1' }, signal)
    await runtime.close()
  })

  it('creates a CodeX project and selects its virtual Workspace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-codex-project-'))
    directories.push(directory)
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      gatewayWithCarrier(),
      logger(),
    )
    await runtime.start()
    const project = {
      id: 'created-project',
      name: 'project',
      roots: [{ path: '/srv/project' }],
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const rpc = vi.fn(async (method: string, params: unknown) => {
      if (method === 'harness.transport.describe') return {
        capabilities: ['codex.appserver.v1', 'codex.appserver.transfer.v1'],
      }
      if (method === 'codex.app.call') {
        const request = params as { method: string; params: Record<string, unknown> }
        if (request.method === 'project/create') return { project }
        if (request.method === 'project/list') return { data: [project], nextCursor: null }
        if (request.method === 'thread/list') return { data: [], nextCursor: null }
      }
      throw new Error(`unexpected method: ${method} ${JSON.stringify(params)}`)
    })
    const client = {
      rpc,
      close: vi.fn(async () => undefined),
      getStats: () => ({ mode: 'Relay', connected: true }),
      onEvent: () => () => undefined,
    }
    ;(runtime as unknown as { connected: unknown }).connected = {
      client,
      target: {
        deviceId: 'host-device-1', name: 'Workstation', platform: 'linux', publicKey: 'peer-key', fingerprint: 'PEER', trustedAt: 1,
      },
      transport: {},
      features: { commandList: false, fileViewer: false, remoteGateway: false, codex: true },
    }

    await expect(runtime.createCodexWorkspace('host-device-1', '/srv/project')).resolves.toMatchObject({
      mode: 'remote',
      backend: 'codex',
      workspaceSelection: {
        targetDeviceId: 'host-device-1',
        workspaceId: 'codex-workspace:project:created-project',
        backend: 'codex',
      },
      workspace: {
        workspaceId: 'codex-workspace:project:created-project',
        path: '/srv/project',
        title: 'project',
      },
    })
    expect(rpc).toHaveBeenCalledWith('codex.app.call', {
      method: 'project/create',
      params: {
        name: 'project',
        roots: [{ path: '/srv/project' }],
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      },
    }, undefined)
    await runtime.close()
  })

  it('uses alpha Gateway directory and Workspace contracts before switching the native UI', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-alpha-workspace-'))
    directories.push(directory)
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      gatewayWithCarrier(),
      logger(),
    )
    await runtime.start()
    let eventHandler: ((event: { event: string; data: unknown }) => void) | undefined
    const rpc = vi.fn(async (method: string, params: unknown) => {
      if (method === 'harness.remote.call') {
        const request = params as { endpoint: string; payload: unknown }
        if (request.endpoint === 'directoryPicker/list') {
          return { ok: true, value: { path: '/srv', home: '/home/remote', crumbs: [], entries: [], truncated: false } }
        }
        if (request.endpoint === 'workspace/create') {
          return {
            ok: true,
            value: {
              workspace: { workspaceId: 'workspace-alpha-1', path: '/srv/project', title: 'project' },
              created: true,
            },
          }
        }
      }
      if (method === 'harness.remote.stream.open') {
        const streamId = (params as { streamId: string }).streamId
        queueMicrotask(() => {
          eventHandler?.({
            event: 'harness.remote.frame',
            data: {
              streamId,
              hasValue: true,
              value: {
                type: 'baseline',
                value: { items: [{ workspaceId: 'workspace-alpha-1', path: '/srv/project', title: 'project' }] },
              },
            },
          })
          eventHandler?.({ event: 'harness.remote.stream.closed', data: { streamId, reason: 'completed' } })
        })
        return { opened: true, streamId }
      }
      return { closed: true }
    })
    const client = {
      rpc,
      close: vi.fn(async () => undefined),
      getStats: () => ({ mode: 'Relay', connected: true }),
      onEvent: (handler: typeof eventHandler) => { eventHandler = handler; return () => undefined },
      onClose: () => () => undefined,
    }
    ;(runtime as unknown as { connected: unknown }).connected = {
      client,
      target: {
        deviceId: 'host-device-1', name: 'Workstation', platform: 'linux', publicKey: 'peer-key', fingerprint: 'PEER', trustedAt: 1,
      },
      transport: {},
      features: { commandList: true, fileViewer: false, remoteGateway: true, codex: false },
    }

    await expect(runtime.listRemoteDirectory('host-device-1', '/srv')).resolves.toMatchObject({ path: '/srv' })
    await expect(runtime.listRemoteWorkspaces('host-device-1')).resolves.toEqual([
      { workspaceId: 'workspace-alpha-1', path: '/srv/project', title: 'project' },
    ])
    await expect(runtime.openRemoteWorkspace('host-device-1', '/srv/project')).resolves.toMatchObject({
      mode: 'remote',
      workspace: { created: true, workspace: { workspaceId: 'workspace-alpha-1' } },
    })
    expect(rpc).toHaveBeenCalledWith('harness.remote.call', {
      endpoint: 'directoryPicker/list',
      payload: { args: { path: '/srv' } },
    }, expect.any(AbortSignal))
    expect(rpc).toHaveBeenCalledWith('harness.remote.stream.open', expect.objectContaining({
      endpoint: 'workspace/follow', payload: { args: {} },
    }), expect.any(AbortSignal))
    expect(rpc).toHaveBeenCalledWith('harness.remote.call', {
      endpoint: 'workspace/create',
      payload: { args: { request: { path: '/srv/project' } } },
    }, expect.any(AbortSignal))
    await runtime.close()
  })

  it('rejects incompatible carriers and selects compatible session generations', async () => {
    await runScenarios(
      [
        {
          name: 'rejects Hosts without a transport compatible with the local Harness carrier',
          run: async () => {
            const alphaDirectory = await mkdtemp(join(tmpdir(), 'dsh-client-alpha-mismatch-'))
            const legacyDirectory = await mkdtemp(join(tmpdir(), 'dsh-client-legacy-mismatch-'))
            directories.push(alphaDirectory, legacyDirectory)
            const alphaGateway = gatewayWithCarrier()
            const alphaRuntime = new ClientModeRuntime(
              config(),
              new IdentityStore({ directory: alphaDirectory }),
              { bindIdentity: vi.fn() } as unknown as ClientServerApi,
              alphaGateway,
              logger(),
            )
            const legacyRuntime = new ClientModeRuntime(
              config(),
              new IdentityStore({ directory: legacyDirectory }),
              { bindIdentity: vi.fn() } as unknown as ClientServerApi,
              gateway(),
              logger(),
            )
            await alphaRuntime.start()
            await legacyRuntime.start()
            const alphaClient = {
              rpc: vi.fn(),
              close: vi.fn(async () => undefined),
              getStats: () => ({ mode: 'Relay', connected: true }),
            }
            const legacyClient = {
              rpc: vi.fn(),
              close: vi.fn(async () => undefined),
              getStats: () => ({ mode: 'Relay', connected: true }),
            }
            const target = {
              deviceId: 'host-device-1',
              name: 'Workstation',
              platform: 'linux',
              publicKey: 'peer-key',
              fingerprint: 'PEER',
              trustedAt: 1,
            }
            ;(alphaRuntime as unknown as { connected: unknown }).connected = {
              client: alphaClient,
              target,
              transport: {},
              features: {
                commandList: true,
                fileViewer: false,

                remoteGateway: false,
                codex: false,
                pluginRoute: false,
              },
            }
            ;(legacyRuntime as unknown as { connected: unknown }).connected = {
              client: legacyClient,
              target,
              transport: {},
              features: {
                commandList: true,
                fileViewer: false,

                remoteGateway: true,
                codex: false,
                pluginRoute: false,
              },
            }

            await expect(
              alphaRuntime.openRemoteWorkspace('host-device-1', '/srv/project'),
            ).rejects.toMatchObject({ code: 'HARNESS_VERSION_INCOMPATIBLE' })
            await expect(
              legacyRuntime.openRemoteWorkspace('host-device-1', '/srv/project'),
            ).rejects.toMatchObject({ code: 'HARNESS_VERSION_INCOMPATIBLE' })
            expect(alphaClient.rpc).not.toHaveBeenCalled()
            expect(legacyClient.rpc).not.toHaveBeenCalled()
            expect(alphaRuntime.status()).toMatchObject({ mode: 'local' })
            expect(legacyRuntime.status()).toMatchObject({ mode: 'local' })
            await alphaRuntime.close()
            await legacyRuntime.close()
          },
        },
        {
          name: 'rejects Session V3 Hosts when the local Typert carrier still uses the legacy session format',
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-client-v3-mismatch-'))
            directories.push(directory)
            const runtime = new ClientModeRuntime(
              config(),
              new IdentityStore({ directory }),
              { bindIdentity: vi.fn() } as unknown as ClientServerApi,
              gatewayWithCarrier(),
              logger(),
              {
                localHarnessVersion: () => '0.1.2-rc.1',
                hostStatus: () => ({
                  configured: true,
                  online: false,
                  reconnecting: false,
                  authorized: false,
                  accountRequired: false,
                }),
              } as unknown as HostAuthorizationControl,
            )
            await runtime.start()
            const rpc = vi.fn()
            ;(runtime as unknown as { connected: unknown }).connected = {
              client: {
                rpc,
                close: vi.fn(async () => undefined),
                getStats: () => ({ mode: 'Relay', connected: true }),
              },
              target: {
                deviceId: 'host-device-v3',
                name: 'V3 Host',
                platform: 'linux',
                publicKey: 'peer-key',
                fingerprint: 'PEER',
                trustedAt: 1,
              },
              transport: {},
              features: {
                commandList: true,
                fileViewer: false,

                remoteGateway: true,
                sessionFormat: 3,
                codex: false,
                pluginRoute: false,
              },
            }

            await expect(runtime.openRemoteWorkspace('host-device-v3', '/srv/project')).rejects.toMatchObject({
              code: 'HARNESS_VERSION_INCOMPATIBLE',
            })
            expect(rpc).not.toHaveBeenCalled()
            await runtime.close()
          },
        },
        {
          name: 'rejects rc.2 Hosts even when the local Typert carrier exists',
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-client-dual-carrier-'))
            directories.push(directory)
            const runtime = new ClientModeRuntime(
              config(),
              new IdentityStore({ directory }),
              { bindIdentity: vi.fn() } as unknown as ClientServerApi,
              gatewayWithCarrier(),
              logger(),
            )
            await runtime.start()
            const rpc = vi.fn(async (method: string, params: unknown) => {
              if (
                method === 'harness.api.call' &&
                (params as { method?: string }).method === 'workspace.create'
              ) {
                return {
                  rpcId: (params as { rpcId: string }).rpcId,
                  result: {
                    ok: true,
                    value: { workspace: { workspaceId: 'workspace-rc2-1' }, created: true },
                  },
                }
              }
              throw new Error(`unexpected method: ${method} ${JSON.stringify(params)}`)
            })
            ;(runtime as unknown as { connected: unknown }).connected = {
              client: {
                rpc,
                close: vi.fn(async () => undefined),
                getStats: () => ({ mode: 'Relay', connected: true }),
              },
              target: {
                deviceId: 'host-device-rc2',
                name: 'RC2 Host',
                platform: 'linux',
                publicKey: 'peer-key',
                fingerprint: 'PEER',
                trustedAt: 1,
              },
              transport: {},
              features: {
                commandList: true,
                fileViewer: false,

                remoteGateway: false,
                codex: false,
                pluginRoute: false,
              },
            }

            await expect(runtime.openRemoteWorkspace('host-device-rc2', '/srv/project')).rejects.toMatchObject({ code: 'HARNESS_VERSION_INCOMPATIBLE' })
            expect(rpc).not.toHaveBeenCalled()
            await runtime.close()
          },
        },
        {
          name: 'allows Session V3 clients to open legacy Typert Remote Host workspaces',
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-client-v3-legacy-remote-'))
            directories.push(directory)
            const runtime = new ClientModeRuntime(
              config(),
              new IdentityStore({ directory }),
              { bindIdentity: vi.fn() } as unknown as ClientServerApi,
              gatewayWithCarrier(),
              logger(),
              {
                localHarnessVersion: () => '0.1.5-rc.1',
                hostStatus: () => ({
                  configured: true,
                  online: false,
                  reconnecting: false,
                  authorized: false,
                  accountRequired: false,
                }),
              } as unknown as HostAuthorizationControl,
            )
            await runtime.start()
            const rpc = vi.fn(async (method: string, params: unknown) => {
              if (
                method === 'harness.remote.call' &&
                (params as { endpoint?: string }).endpoint === 'workspace/create'
              ) {
                return { ok: true, value: { workspace: { workspaceId: 'workspace-v2-1' }, created: true } }
              }
              return { ok: true, value: undefined }
            })
            ;(runtime as unknown as { connected: unknown }).connected = {
              client: {
                rpc,
                close: vi.fn(async () => undefined),
                getStats: () => ({ mode: 'Relay', connected: true }),
              },
              target: {
                deviceId: 'host-device-v2',
                name: 'V2 Host',
                platform: 'linux',
                publicKey: 'peer-key',
                fingerprint: 'PEER',
                trustedAt: 1,
              },
              transport: {},
              features: {
                commandList: true,
                fileViewer: false,

                remoteGateway: true,
                codex: false,
                pluginRoute: false,
              },
            }

            await expect(runtime.openRemoteWorkspace('host-device-v2', '/srv/project')).resolves.toMatchObject({
              mode: 'remote',
              workspace: { created: true, workspace: { workspaceId: 'workspace-v2-1' } },
            })
            expect(rpc).toHaveBeenCalledWith(
              'harness.remote.call',
              {
                endpoint: 'workspace/create',
                payload: { args: { request: { path: '/srv/project' } } },
              },
              expect.any(AbortSignal),
            )
            await runtime.close()
          },
        },
      ],
      async () => {
        await cleanupScenario1()
      },
    )
  }, 20000)

  it('exposes Host authorization status and forwards login only through loopback control', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-runtime-'))
    directories.push(directory)
    const host = {
      hostStatus: vi.fn(() => ({
        configured: true,
        online: false,
        reconnecting: false,
        error: 'ACCOUNT_AUTH_REQUIRED',
        authorized: false,
        accountRequired: true,
      })),
      reconnectHost: vi.fn(),
      clearHostAuthorization: vi.fn(),
      authorizeHostAsOwned: vi.fn(),
      authorizeHostWithAccount: vi.fn(async (email: string) => ({ account: email, expiresAt: Date.now() + 60_000, isAdmin: false })),
      authorizeHostWithCode: vi.fn(async () => ({ method: 'host_registration_code' })),
    } satisfies HostAuthorizationControl
    const hasStoredAuthorization = vi.fn(async () => false)
    const authenticate = vi.fn(async () => ({ accessToken: 'client-access-token', account: 'owner@example.com' }))
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      {
        bindIdentity: vi.fn(),
        hasStoredAuthorization,
        authenticate,
      } as unknown as ClientServerApi,
      gateway(),
      logger(),
      host,
    )
    await runtime.start()

    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ControlResult<unknown>>) | undefined
    const connection = {
      rpc: {
        handle: vi.fn((_channel, next) => {
          handler = next
          return async () => undefined
        }),
      },
    } as unknown as HostConnectionHandle
    const dispose = runtime.registerControl(connection)
    expect(connection.rpc.handle).toHaveBeenCalledWith(CONTROL_RPC_PREFIX, expect.any(Function), {
      authority: 'loopback',
    })
    const signal = new AbortController().signal

    authenticate.mockClear()
    await expect(handler?.('client.authorization.status', {}, signal)).resolves.toMatchObject({
      ok: true, value: { hasCredentials: false },
    })
    hasStoredAuthorization.mockResolvedValueOnce(true)
    await expect(handler?.('client.authorization.status', {}, signal)).resolves.toMatchObject({
      ok: true, value: { hasCredentials: true },
    })
    hasStoredAuthorization.mockRejectedValueOnce(new Error('credential store unavailable'))
    await expect(handler?.('client.authorization.status', {}, signal)).resolves.toMatchObject({ ok: false })
    expect(authenticate).not.toHaveBeenCalled()

    await expect(handler?.('status', {}, signal)).resolves.toMatchObject({
      ok: true,
      value: { host: { accountRequired: true, error: 'ACCOUNT_AUTH_REQUIRED' } },
    })
    await expect(handler?.('host.account.login', {
      email: 'host@example.com', password: 'correct horse battery staple',
    }, signal)).resolves.toMatchObject({ ok: true, value: { account: 'host@example.com' } })
    expect(host.authorizeHostWithAccount).toHaveBeenCalledWith('host@example.com', 'correct horse battery staple')
    await expect(handler?.('host.authorization.set', { enabled: true }, signal)).resolves.toMatchObject({ ok: true })
    expect(host.authorizeHostAsOwned).toHaveBeenCalledWith('client-access-token', 'owner@example.com')
    await expect(handler?.('host.authorization.set', { enabled: false }, signal)).resolves.toMatchObject({ ok: true })
    expect(host.clearHostAuthorization).toHaveBeenCalledOnce()

    await dispose()
    await runtime.close()
  })

  it('re-authorizes a Host whose stored credential the Server no longer accepts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-host-repair-'))
    directories.push(directory)
    // The Server revoked the token family, but this process still holds the
    // credential in memory and the file is still on disk, so both local checks
    // keep claiming the Host is authorized while every credential_refresh fails
    // with AUTH_INVALID. Signing in again must repair the Host instead of
    // silently skipping it until the process restarts.
    const host = {
      hostStatus: vi.fn(() => ({
        configured: true,
        online: false,
        reconnecting: false,
        error: 'AUTH_INVALID',
        authorized: true,
        accountRequired: true,
      })),
      hasStoredAuthorization: vi.fn(async () => true),
      reconnectHost: vi.fn(),
      clearHostAuthorization: vi.fn(),
      authorizeHostAsOwned: vi.fn(),
      authorizeHostWithAccount: vi.fn(),
      authorizeHostWithCode: vi.fn(),
    } satisfies HostAuthorizationControl
    const authenticate = vi.fn(async () => ({ accessToken: 'fresh-access-token', account: 'owner@example.com' }))
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      {
        bindIdentity: vi.fn(),
        hasStoredAuthorization: vi.fn(async () => true),
        authenticate,
        pollOAuthQrLogin: vi.fn(async () => ({ status: 'complete' })),
      } as unknown as ClientServerApi,
      gateway(),
      logger(),
      host,
    )
    await runtime.start()
    expect(host.authorizeHostAsOwned).not.toHaveBeenCalled()

    await runtime.pollClientOAuthQrLogin('qr-session-identifier-0001')

    expect(authenticate).toHaveBeenCalledOnce()
    expect(host.authorizeHostAsOwned).toHaveBeenCalledWith('fresh-access-token', 'owner@example.com')
    await runtime.close()
  })

  it('leaves a working Host authorization untouched after signing in', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-host-keep-'))
    directories.push(directory)
    const host = {
      hostStatus: vi.fn(() => ({
        configured: true,
        online: true,
        reconnecting: false,
        authorized: true,
        accountRequired: false,
      })),
      hasStoredAuthorization: vi.fn(async () => true),
      reconnectHost: vi.fn(),
      clearHostAuthorization: vi.fn(),
      authorizeHostAsOwned: vi.fn(),
      authorizeHostWithAccount: vi.fn(),
      authorizeHostWithCode: vi.fn(),
    } satisfies HostAuthorizationControl
    const authenticate = vi.fn(async () => ({ accessToken: 'fresh-access-token', account: 'owner@example.com' }))
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      {
        bindIdentity: vi.fn(),
        hasStoredAuthorization: vi.fn(async () => true),
        authenticate,
        pollOAuthQrLogin: vi.fn(async () => ({ status: 'complete' })),
      } as unknown as ClientServerApi,
      gateway(),
      logger(),
      host,
    )
    await runtime.start()

    await runtime.pollClientOAuthQrLogin('qr-session-identifier-0002')

    expect(authenticate).not.toHaveBeenCalled()
    expect(host.authorizeHostAsOwned).not.toHaveBeenCalled()
    await runtime.close()
  })

  it('requires local Host authorization before listing devices', async () => {
    const rows = ['ACCOUNT_AUTH_REQUIRED', 'DEVICE_OWNERSHIP_REQUIRED', 'DEVICE_REVOKED', 'AUTH_INVALID', 'TOKEN_EXPIRED'] as const
    await runScenarios(
      rows.map((row, index) => {
        const error = row
        return {
          name: scenarioName('does not list devices when the local Host authorization is %s', row, index),
          run: async () => {
            const directory = await mkdtemp(join(tmpdir(), 'dsh-client-host-auth-'))
            directories.push(directory)
            const listDevices = vi.fn(async () => [])
            const host = {
              hostStatus: vi.fn(() => ({
                configured: true,
                online: false,
                reconnecting: false,
                error,
                authorized: true,
                accountRequired: true,
              })),
            } as unknown as HostAuthorizationControl
            const runtime = new ClientModeRuntime(
              config(),
              new IdentityStore({ directory }),
              { bindIdentity: vi.fn(), listDevices } as unknown as ClientServerApi,
              gateway(),
              logger(),
              host,
            )
            await runtime.start()

            await expect(runtime.devices()).rejects.toMatchObject({ code: error })
            // The browser must receive the domain code, not the envelope's
            // generic "internal" code, to return to account authorization.
            const result = await runtime.handleControl('devices', {}, new AbortController().signal)
            expect(() => unwrapControlResult(result, 'Request failed')).toThrow(expect.objectContaining({ code: error }))
            expect(listDevices).not.toHaveBeenCalled()
            await runtime.close()
          },
        }
      }),
      async () => {
        await cleanupScenario1()
      },
    )
  })

  it('pins Host identity from an account-authorized device detail and rejects key replacement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-trust-'))
    directories.push(directory)
    const identities = new IdentityStore({ directory })
    const first = generateKeyPair(new Uint8Array(32).fill(21))
    const replacement = generateKeyPair(new Uint8Array(32).fill(22))
    let identityKey = first.publicKey
    const server = {
      baseUrl: 'https://dsh.r2049.cn',
      bindIdentity: vi.fn(),
      listDevices: vi.fn(async () => [{
        deviceId: 'host-device-1',
        name: 'Workstation',
        platform: 'linux',
        membershipId: 'membership-1',
      }]),
      deviceFor: vi.fn(async () => ({
        deviceId: 'host-device-1',
        name: 'Workstation',
        role: 'host' as const,
        platform: 'linux',
        identityKey,
        membershipId: 'membership-1',
      })),
      presenceFor: vi.fn(async () => ({ online: true })),
    } as unknown as ClientServerApi
    const runtime = new ClientModeRuntime(config(), identities, server, gateway(), logger())
    await runtime.start()

    await expect(runtime.devices()).resolves.toMatchObject([{ deviceId: 'host-device-1', online: true }])
    expect(identities.trustedPeer('host-device-1')).toMatchObject({
      publicKey: first.publicKey,
      membershipId: 'membership-1',
    })

    identityKey = replacement.publicKey
    await expect(runtime.devices()).rejects.toMatchObject({ code: 'PEER_IDENTITY_MISMATCH' })
    expect(identities.trustedPeer('host-device-1')?.publicKey).toBe(first.publicKey)
    await runtime.close()
  })

  it('fails plugin.route control calls closed when no Remote Host is connected', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-plugin-route-'))
    directories.push(directory)
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      gateway(),
      logger(),
    )
    await runtime.start()
    const signal = new AbortController().signal

    await expect(runtime.handleControl('plugin.route', { route: 'api/bot', body: {} }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', details: { remoteCode: 'REMOTE_NOT_CONNECTED' } },
    })
    await expect(runtime.handleControl('plugin.route', { route: 'http://evil', body: {} }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', details: { remoteCode: 'INVALID_MESSAGE' } },
    })
    await expect(runtime.handleControl('plugin.route', { route: 'api/bot', body: 'not-an-object' }, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', details: { remoteCode: 'INVALID_MESSAGE' } },
    })
    await runtime.close()
  })
})

function config(): ResolvedConfig {
  return {
    terminal: { enabled: false },
    loopback: { ports: [] },
    enabled: true,
    role: 'both',
    serverUrl: 'https://dsh.r2049.cn',
    deviceName: 'Local Harness',
    forceRelay: false,
    rotatePinnedPeerKey: false,
    logLevel: 'error',
    reconnect: { enabled: true, initialDelayMs: 100, maxDelayMs: 1_000, jitter: 0 },
    codex: { enabled: false, binary: 'codex' },
    cursor: { enabled: false, binary: 'agent' },
  }
}

function logger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
}

function gateway(): { invoke(request: unknown): Promise<unknown> } {
  return { invoke: vi.fn(async () => undefined) }
}

function gatewayWithCarrier() {
  const open = vi.fn(async () => (async function* () {})())
  return {
    invoke: vi.fn(async () => undefined),
    stream: vi.fn(async () => (async function* () {})()),
    dispatchRpc: vi.fn(async () => ({ ok: true as const })),
    openWireStream: open,
    wireStream: {
      open,
      failure: () => ({ code: 'internal', message: 'failed', details: {} }),
    },
  }
}
