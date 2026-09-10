import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiProxy, RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { generateKeyPair } from '@dsh-remote/crypto'
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
import { IdentityStore } from '../src/identity-store.js'
import type { SafeLogger } from '../src/logging.js'
import type { ClientServerApi } from '../src/server-api.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('ClientModeRuntime Host account control', () => {
  it('uses a conservative compatibility profile for legacy and unknown Hosts', () => {
    expect(remoteHostFeatures()).toEqual({ commandList: false, fileViewer: false, apiProxy: true, remoteGateway: false, codex: false })
    expect(remoteHostFeatures('not-semver')).toEqual({ commandList: false, fileViewer: false, apiProxy: true, remoteGateway: false, codex: false })
    expect(remoteHostFeatures('0.3.15')).toEqual({ commandList: false, fileViewer: false, apiProxy: true, remoteGateway: false, codex: false })
    expect(remoteHostFeatures('0.3.16')).toEqual({ commandList: true, fileViewer: false, apiProxy: true, remoteGateway: false, codex: false })
    expect(remoteHostFeatures('v0.3.17')).toEqual({ commandList: true, fileViewer: true, apiProxy: true, remoteGateway: false, codex: false })
    expect(remoteHostFeatures('0.3.99-beta.1')).toEqual({ commandList: true, fileViewer: true, apiProxy: true, remoteGateway: false, codex: false })
  })

  it('prefers encrypted Host capability discovery while retaining the legacy fallback', async () => {
    const alphaClient = {
      rpc: vi.fn(async () => ({
        capabilities: ['transport.relay', 'harness.remote.v1', 'harness.remote.transfer.v1', 'codex.appserver.v1'],
      })),
    }
    await expect(probeRemoteHostFeatures(alphaClient as never, '0.3.15')).resolves.toEqual({
      commandList: true,
      fileViewer: false,
      apiProxy: false,
      remoteGateway: true,
      codex: true,
    })

    alphaClient.rpc.mockResolvedValueOnce({
      capabilities: ['transport.relay', 'harness.remote.v3', 'harness.remote.transfer.v1'],
    })
    await expect(probeRemoteHostFeatures(alphaClient as never, '0.4.11')).resolves.toEqual({
      commandList: true,
      fileViewer: false,
      apiProxy: false,
      remoteGateway: true,
      sessionFormat: 3,
      codex: false,
    })

    const legacyClient = {
      rpc: vi.fn(async () => {
        throw Object.assign(new Error('unknown method'), { code: 'METHOD_NOT_FOUND' })
      }),
    }
    await expect(probeRemoteHostFeatures(legacyClient as never, '0.3.17')).resolves.toEqual({
      commandList: true,
      fileViewer: true,
      apiProxy: true,
      remoteGateway: false,
      codex: false,
    })
  })

  it('forwards only supported QR login providers to the Server API', async () => {
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
      apiProxy(),
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
      { provider: 'unknown' },
      signal,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal', details: { remoteCode: 'INVALID_MESSAGE' } },
    })
    expect(startOAuthQrLogin).toHaveBeenCalledTimes(1)
    await runtime.close()
  })

  it('exposes Web-compatible network path details for the active Remote Client', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-network-'))
    directories.push(directory)
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      apiProxy(),
      gateway(),
      logger(),
    )
    await runtime.start()
    const deviceId = runtime.status().deviceId as string
    ;(runtime as unknown as { connectionProgress: unknown }).connectionProgress = {
      runId: 1,
      targetDeviceId: 'host-device-1',
      phase: 'probing',
      activeTransports: ['turn'],
    }
    expect(runtime.status()).toMatchObject({
      connected: false,
      connectionProgress: {
        targetDeviceId: 'host-device-1',
        phase: 'probing',
        activeTransports: ['turn'],
      },
    })
    ;(runtime as unknown as { connectionProgress: unknown }).connectionProgress = undefined
    const connectionDetails = vi.fn(async () => ({
      connectionId: 'connection-1',
      connectedAt: 1_786_000_000_000,
      controlChannelUrl: 'wss://dsh.r2049.cn/ws/v1/connect',
      controlChannelState: 'open' as const,
      preferredTransports: ['lan', 'p2p', 'turn', 'relay'] as const,
      webRtc: {
        mode: 'LAN' as const,
        connectionState: 'connected',
        iceConnectionState: 'connected',
        dataChannelState: 'open' as const,
        localCandidateType: 'host',
        remoteCandidateType: 'host',
        localAddress: '192.168.1.20:51001',
        remoteAddress: '192.168.1.30:51002',
        protocol: 'udp',
        currentRoundTripTimeMs: 12,
      },
    }))
    ;(runtime as unknown as { connected: unknown }).connected = {
      client: { getStats: () => ({ mode: 'LAN', connected: true }) },
      target: {
        deviceId: 'host-device-1',
        name: 'Workstation',
        platform: 'linux',
        publicKey: 'peer-key',
        fingerprint: 'PEER',
        trustedAt: 1,
      },
      transport: { connectionDetails },
      features: { commandList: false, fileViewer: false, apiProxy: true, remoteGateway: false, codex: false },
    }

    await expect(runtime.handleControl('status', {}, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: {
        connected: true,
        connectedTargetDeviceId: 'host-device-1',
        transport: 'LAN',
        remoteFeatures: { commandList: false, fileViewer: false, apiProxy: true, remoteGateway: false, codex: false },
        network: {
          connectionId: 'connection-1',
          local: { deviceId, platform: process.platform },
          remote: { deviceId: 'host-device-1', platform: 'linux' },
          webRtc: {
            localAddress: '192.168.1.20:51001',
            remoteAddress: '192.168.1.30:51002',
            currentRoundTripTimeMs: 12,
          },
        },
      },
    })
    expect(connectionDetails).toHaveBeenCalledOnce()
  })

  it('keeps the selected remote Workspace until the browser opens it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-workspace-selection-'))
    directories.push(directory)
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      apiProxy(),
      gateway(),
      logger(),
    )
    await runtime.start()
    const rpc = vi.fn(async (_endpoint: string, payload: unknown) => {
      const request = payload as { rpcId: string }
      return {
        rpcId: request.rpcId,
        result: {
          ok: true,
          value: {
            workspace: {
              workspaceId: 'workspace-remote-1',
              path: '/srv/project',
              title: 'project',
              sessionIds: [],
            },
            created: false,
          },
        },
      }
    })
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
      features: { commandList: true, fileViewer: true, apiProxy: true, remoteGateway: false, codex: false },
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

  it('exposes the independent Codex domain to Web through bounded loopback calls and event polling', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-codex-loopback-'))
    directories.push(directory)
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      apiProxy(),
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
      features: { commandList: true, fileViewer: false, apiProxy: true, remoteGateway: false, codex: false },
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
      apiProxy(),
      gateway(),
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
        capabilities: ['harness.api.v1', 'harness.api.transfer.v1', 'codex.appserver.v1'],
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
      features: { commandList: true, fileViewer: false, apiProxy: true, remoteGateway: false, codex: true },
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
      undefined,
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
      features: { commandList: true, fileViewer: false, apiProxy: false, remoteGateway: true, codex: false },
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

  it('rejects mixed Harness transport generations before mutating the active target', async () => {
    const alphaDirectory = await mkdtemp(join(tmpdir(), 'dsh-client-alpha-mismatch-'))
    const legacyDirectory = await mkdtemp(join(tmpdir(), 'dsh-client-legacy-mismatch-'))
    directories.push(alphaDirectory, legacyDirectory)
    const alphaGateway = gatewayWithCarrier()
    const alphaRuntime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory: alphaDirectory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      undefined,
      alphaGateway,
      logger(),
    )
    const legacyRuntime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory: legacyDirectory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      apiProxy(),
      gateway(),
      logger(),
    )
    await alphaRuntime.start()
    await legacyRuntime.start()
    const alphaClient = { rpc: vi.fn(), close: vi.fn(async () => undefined), getStats: () => ({ mode: 'Relay', connected: true }) }
    const legacyClient = { rpc: vi.fn(), close: vi.fn(async () => undefined), getStats: () => ({ mode: 'Relay', connected: true }) }
    const target = {
      deviceId: 'host-device-1', name: 'Workstation', platform: 'linux', publicKey: 'peer-key', fingerprint: 'PEER', trustedAt: 1,
    }
    ;(alphaRuntime as unknown as { connected: unknown }).connected = {
      client: alphaClient,
      target,
      transport: {},
      features: { commandList: true, fileViewer: false, apiProxy: true, remoteGateway: false, codex: false },
    }
    ;(legacyRuntime as unknown as { connected: unknown }).connected = {
      client: legacyClient,
      target,
      transport: {},
      features: { commandList: true, fileViewer: false, apiProxy: false, remoteGateway: true, codex: false },
    }

    await expect(alphaRuntime.openRemoteWorkspace('host-device-1', '/srv/project'))
      .rejects.toMatchObject({ code: 'HARNESS_VERSION_INCOMPATIBLE' })
    await expect(legacyRuntime.openRemoteWorkspace('host-device-1', '/srv/project'))
      .rejects.toMatchObject({ code: 'HARNESS_VERSION_INCOMPATIBLE' })
    expect(alphaClient.rpc).not.toHaveBeenCalled()
    expect(legacyClient.rpc).not.toHaveBeenCalled()
    expect(alphaRuntime.status()).toMatchObject({ mode: 'local' })
    expect(legacyRuntime.status()).toMatchObject({ mode: 'local' })
    await alphaRuntime.close()
    await legacyRuntime.close()
  })

  it('rejects v0.1.2 and Session V3 Typert peers before a Workspace mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-client-session-format-mismatch-'))
    directories.push(directory)
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      { bindIdentity: vi.fn() } as unknown as ClientServerApi,
      undefined,
      gatewayWithCarrier(),
      logger(),
      { localHarnessVersion: () => '0.1.5-rc.1' } as unknown as HostAuthorizationControl,
    )
    await runtime.start()
    const rpc = vi.fn()
    ;(runtime as unknown as { connected: unknown }).connected = {
      client: { rpc, close: vi.fn(async () => undefined), getStats: () => ({ mode: 'Relay', connected: true }) },
      target: {
        deviceId: 'host-device-v2', name: 'V2 Host', platform: 'linux', publicKey: 'peer-key', fingerprint: 'PEER', trustedAt: 1,
      },
      transport: {},
      features: { commandList: true, fileViewer: false, apiProxy: false, remoteGateway: true, codex: false },
    }

    await expect(runtime.openRemoteWorkspace('host-device-v2', '/srv/project'))
      .rejects.toMatchObject({ code: 'HARNESS_VERSION_INCOMPATIBLE' })
    expect(rpc).not.toHaveBeenCalled()
    await runtime.close()
  })

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
    const runtime = new ClientModeRuntime(
      config(),
      new IdentityStore({ directory }),
      {
        bindIdentity: vi.fn(),
        authenticate: vi.fn(async () => ({ accessToken: 'client-access-token', account: 'owner@example.com' })),
      } as unknown as ClientServerApi,
      apiProxy(),
      gateway(),
      logger(),
      host,
    )
    await runtime.start()

    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>) | undefined
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
    const runtime = new ClientModeRuntime(config(), identities, server, apiProxy(), gateway(), logger())
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
})

function config(): ResolvedConfig {
  return {
    enabled: true,
    role: 'both',
    serverUrl: 'https://dsh.r2049.cn',
    deviceName: 'Local Harness',
    forceRelay: false,
    logLevel: 'error',
    reconnect: { enabled: true, initialDelayMs: 100, maxDelayMs: 1_000, jitter: 0 },
    codex: { enabled: false, binary: 'codex' },
  }
}

function apiProxy(): ApiProxy {
  const empty = {}
  return {
    sessions: { list: vi.fn() },
    subagents: empty,
    host: empty,
    workspace: empty,
    skills: empty,
    agentPresets: empty,
    goals: empty,
    settings: empty,
    credentials: empty,
    llm: empty,
    events: empty,
    downloads: empty,
    respond: async () => ({ accepted: true }),
  } as unknown as ApiProxy
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
