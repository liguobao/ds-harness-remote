import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HarnessRemoteBridge } from '../src/harness-remote-bridge.js'
import { CodexWorkspaceBridge, type RemoteTerminalProcess, type RemoteTerminalSpawner } from '../src/codex-workspace-bridge.js'
import { TerminalPolicy } from '../src/terminal-policy.js'
import { RpcError } from '../src/rpc-router.js'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'

describe('HarnessRemoteBridge', () => {
  it('forwards only the fixed alpha Gateway endpoint allowlist', async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, value: [{ id: 'session-1' }] }))
    const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined))

    await expect(bridge.call({ endpoint: 'session/list', payload: { args: {} } })).resolves.toEqual({
      ok: true,
      value: [{ id: 'session-1' }],
    })
    await expect(bridge.call({ endpoint: 'session/canOpenWorkspacePath', payload: { args: {} } })).resolves.toEqual({
      ok: true,
      value: true,
    })
    expect(dispatch).toHaveBeenCalledWith('session/list', { args: {} }, expect.any(AbortSignal))

    await expect(bridge.call({ endpoint: 'directoryPicker/pick', payload: { args: {} } }))
      .rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    await expect(bridge.call({ endpoint: 'session/openWorkspacePath', payload: { args: {} } }))
      .rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    await expect(bridge.call({ endpoint: 'settings/openConfigFile', payload: { args: {} } }))
      .rejects.toBeInstanceOf(RpcError)
    await expect(bridge.call({ endpoint: 'permissionPresets/catalog', payload: { args: {} } })).resolves.toMatchObject({ ok: true })
    expect(dispatch).toHaveBeenCalledWith('permissionPresets/catalog', { args: {} }, expect.any(AbortSignal))
    await expect(bridge.call({ endpoint: 'permissionPresets/select', payload: { args: {} } })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('falls back to Host directory metadata for the v0.1.2-rc.1 native-only picker failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-remote-alpha-directory-'))
    await mkdir(join(root, 'project'))
    const dispatch = vi.fn(async (endpoint: string) => {
      if (endpoint === 'directoryPicker/list') {
        return {
          ok: false as const,
          error: {
            code: 'directory-picker/unavailable',
            message: 'directoryPicker.list needs the browse capability; the composed picker serves "native"',
            details: { capability: 'native' },
          },
        }
      }
      return { ok: true as const }
    })
    const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined))

    try {
      await expect(bridge.call({
        endpoint: 'directoryPicker/list',
        payload: { args: { path: root } },
      })).resolves.toMatchObject({
        ok: true,
        value: {
          path: root,
          entries: [{ name: 'project', path: join(root, 'project') }],
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('selects the renamed command attachment field for a 0.1.5 Host', async () => {
    const dispatch = vi.fn(async (_endpoint: string, payload: { args: Record<string, unknown> }) => {
      expect(payload.args).toEqual({ agentId: 'session-1', line: '/goal complete', submittedAttachments: [] })
      return { ok: true as const, value: { commandId: 'cmd-0.1.5' } }
    })
    const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined), undefined, '0.1.5-rc.1')

    await expect(bridge.call({
      endpoint: 'commands/execute',
      payload: { args: { agentId: 'session-1', line: '/goal complete', images: [] } },
    })).resolves.toEqual({ ok: true, value: { commandId: 'cmd-0.1.5' } })
    expect(dispatch).toHaveBeenCalledWith('commands/execute', {
      args: { agentId: 'session-1', line: '/goal complete', submittedAttachments: [] },
    }, expect.any(AbortSignal))
    expect(dispatch).toHaveBeenCalledOnce()
  })

  it('publishes alpha stream frames and an explicit terminal event', async () => {
    const publish = vi.fn(async () => undefined)
    const open = vi.fn(async () => (async function* () {
      yield { type: 'baseline', value: { items: [] } }
      yield { type: 'upsert', value: { id: 'workspace-1' } }
      yield undefined
    })())
    const bridge = new HarnessRemoteBridge(gateway({ open }), publish)

    await expect(bridge.openStream({
      streamId: 'workspace-stream-1',
      endpoint: 'workspace/follow',
      payload: { args: {} },
    })).resolves.toEqual({ opened: true, streamId: 'workspace-stream-1' })

    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(4))
    expect(open).toHaveBeenCalledWith('workspace/follow', { args: {} }, expect.any(AbortSignal))
    expect(publish.mock.calls[0]).toEqual([
      'harness.remote.frame',
      { streamId: 'workspace-stream-1', hasValue: true, value: { type: 'baseline', value: { items: [] } } },
    ])
    expect(publish.mock.calls[2]).toEqual([
      'harness.remote.frame',
      { streamId: 'workspace-stream-1', hasValue: true },
    ])
    expect(publish.mock.calls[3]).toEqual([
      'harness.remote.stream.closed',
      { streamId: 'workspace-stream-1', reason: 'completed' },
    ])
  })

  it('adds the 0.1.7 workspace root to legacy file-change subscriptions', async () => {
    const open = vi.fn(async () => (async function* () {
      yield { kind: 'ready' }
    })())
    const bridge = new HarnessRemoteBridge(
      gateway({ open }),
      vi.fn(async () => undefined),
      undefined,
      '0.1.7-rc.1',
    )

    await expect(bridge.openStream({
      streamId: 'file-changes-017',
      endpoint: 'workspaceFiles/changes',
      payload: { args: { workspaceFileScopeId: 'session-1' } },
    })).resolves.toEqual({ opened: true, streamId: 'file-changes-017' })
    expect(open).toHaveBeenCalledWith(
      'workspaceFiles/changes',
      { args: { workspaceFileScopeId: 'session-1', path: '.' } },
      expect.any(AbortSignal),
    )
  })

  it('does not add the 0.1.7 path field to legacy Hosts', async () => {
    const open = vi.fn(async () => (async function* () {
      yield { kind: 'ready' }
    })())
    const bridge = new HarnessRemoteBridge(
      gateway({ open }),
      vi.fn(async () => undefined),
      undefined,
      '0.1.6-alpha.2',
    )

    await bridge.openStream({
      streamId: 'file-changes-016',
      endpoint: 'workspaceFiles/changes',
      payload: { args: { workspaceFileScopeId: 'session-1' } },
    })
    expect(open).toHaveBeenCalledWith(
      'workspaceFiles/changes',
      { args: { workspaceFileScopeId: 'session-1' } },
      expect.any(AbortSignal),
    )
  })

  it('nests readBytes ranges for a 0.1.7 Host', async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, value: { bytes: '' } }))
    const bridge = new HarnessRemoteBridge(
      gateway({ dispatch }),
      vi.fn(async () => undefined),
      undefined,
      '0.1.7-rc.1',
    )

    await bridge.call({
      endpoint: 'workspaceFiles/readBytes',
      payload: {
        args: {
          workspaceFileScopeId: 'session-1',
          path: '/tmp/a.bin',
          range: { offset: 0, length: 1024 },
        },
      },
    })
    expect(dispatch).toHaveBeenCalledWith('workspaceFiles/readBytes', {
      args: {
        workspaceFileScopeId: 'session-1',
        path: '/tmp/a.bin',
        options: { range: { offset: 0, length: 1024 } },
      },
    }, expect.any(AbortSignal))
  })

  it('keeps the legacy readBytes range shape for older Hosts', async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, value: { bytes: '' } }))
    const bridge = new HarnessRemoteBridge(
      gateway({ dispatch }),
      vi.fn(async () => undefined),
      undefined,
      '0.1.6-alpha.2',
    )
    const payload = {
      args: {
        workspaceFileScopeId: 'session-1',
        path: '/tmp/a.bin',
        range: { offset: 0, length: 1024 },
      },
    }

    await bridge.call({ endpoint: 'workspaceFiles/readBytes', payload })
    expect(dispatch).toHaveBeenCalledWith('workspaceFiles/readBytes', payload, expect.any(AbortSignal))
  })

  it('normalizes alpha stream failures without exposing the original error', async () => {
    const publish = vi.fn(async () => undefined)
    const bridge = new HarnessRemoteBridge(gateway({
      open: async () => (async function* () {
        throw Object.assign(new Error('sensitive local failure'), { code: 'gateway-failed' })
      })(),
      failure: () => ({ code: 'gateway-failed', message: 'Request failed.', details: {} }),
    }), publish)

    await bridge.openStream({ streamId: 'events-stream-1', endpoint: '$events', payload: { args: {} } })

    await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce())
    expect(publish).toHaveBeenCalledWith('harness.remote.stream.closed', {
      streamId: 'events-stream-1',
      reason: 'failed',
      failure: { code: 'gateway-failed', message: 'Request failed.', details: {} },
    })
  })

  it('routes CodeX terminal calls to the CodeX carrier and keeps device ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-remote-codex-terminal-'))
    const dispatch = vi.fn(async () => ({ ok: true as const }))
    const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined), undefined, undefined,
      new TerminalPolicy(() => true, 'device-a', new Map()),
      new CodexWorkspaceBridge(async () => root, () => true, undefined, stubTerminalSpawner()))

    await expect(bridge.call({ endpoint: 'terminal/environment', payload: { args: { agentId: 'codex:one' } } }))
      .resolves.toMatchObject({ ok: true, value: { cwd: await realpath(root), scrollback: expect.any(Number) } })
    await expect(bridge.call({ endpoint: 'terminal/create', payload: { args: { agentId: 'codex:one', request: { id: 't1', cols: 80, rows: 24 } } } }))
      .resolves.toMatchObject({ ok: true, value: { id: 't1', shell: { path: expect.any(String) } } })
    expect(dispatch).not.toHaveBeenCalled()

    // A Harness session still reaches the official Gateway.
    await bridge.call({ endpoint: 'terminal/environment', payload: { args: { agentId: 'session-1' } } })
    expect(dispatch).toHaveBeenCalledWith('terminal/environment', { args: { agentId: 'session-1' } }, expect.any(AbortSignal))

    // The terminal belongs to the creating device only.
    const other = new HarnessRemoteBridge(gateway(), vi.fn(async () => undefined), undefined, undefined,
      new TerminalPolicy(() => true, 'device-b', new Map()),
      new CodexWorkspaceBridge(async () => root, () => true, undefined, stubTerminalSpawner()))
    await expect(other.call({ endpoint: 'terminal/list', payload: { args: { sessionId: 'codex:one' } } }))
      .resolves.toEqual({ ok: true, value: [] })
    await bridge.closeAll(); await other.closeAll(); await rm(root, { recursive: true, force: true })
  })

  it('releases the device reservation when a CodeX terminal cannot start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-remote-codex-terminal-'))
    const owners = new Map<string, string>()
    const failing = new HarnessRemoteBridge(gateway(), vi.fn(async () => undefined), undefined, undefined,
      new TerminalPolicy(() => true, 'device-a', owners),
      new CodexWorkspaceBridge(async () => root, () => true, undefined, async () => { throw new Error('no terminal provider') }))
    await expect(failing.call({ endpoint: 'terminal/create', payload: { args: { agentId: 'codex:one', request: { id: 't1', cols: 80, rows: 24 } } } }))
      .rejects.toMatchObject({ code: 'CODEX_TERMINAL_UNAVAILABLE' })

    // Another device can still claim that id because the failed attempt released it.
    const other = new HarnessRemoteBridge(gateway(), vi.fn(async () => undefined), undefined, undefined,
      new TerminalPolicy(() => true, 'device-b', owners),
      new CodexWorkspaceBridge(async () => root, () => true, undefined, stubTerminalSpawner()))
    await expect(other.call({ endpoint: 'terminal/create', payload: { args: { agentId: 'codex:one', request: { id: 't1', cols: 80, rows: 24 } } } }))
      .resolves.toMatchObject({ ok: true, value: { id: 't1' } })
    await failing.closeAll(); await other.closeAll(); await rm(root, { recursive: true, force: true })
  })
})

function stubTerminalSpawner(): RemoteTerminalSpawner {
  return async (): Promise<RemoteTerminalProcess> => ({
    output: (async function* () { return })(),
    write: () => undefined,
    resize: () => undefined,
    terminate: () => undefined,
    completed: Promise.resolve({ exitCode: 0 }),
  })
}

function gateway(overrides: Partial<LocalTypertGateway> = {}): LocalTypertGateway {
  return {
    invoke: async () => undefined,
    dispatch: async () => ({ ok: true }),
    open: async () => (async function* () { return })(),
    failure: () => ({ code: 'internal', message: 'Request failed.', details: {} }),
    supportsCarrier: true,
    ...overrides,
  }
}
