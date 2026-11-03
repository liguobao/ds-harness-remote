import { runScenarios, scenarioName } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { HarnessRemoteBridge } from '../src/harness-remote-bridge.js'
import { CodexWorkspaceBridge, type RemoteTerminalProcess, type RemoteTerminalSpawner } from '../src/codex-workspace-bridge.js'
import { TerminalPolicy } from '../src/terminal-policy.js'
import { RpcError } from '../src/rpc-router.js'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'
import { MAX_SECURE_MESSAGE_BYTES } from '@dsh-remote/protocol'

describe('HarnessRemoteBridge', () => {
  it('forwards official plugin configuration and enablement with native outcomes', async () => {
    await runScenarios([
      { endpoint: 'pluginManager/listPlugins', args: {} },
      { endpoint: 'pluginManager/listBundles', args: {} },
      { endpoint: 'pluginManager/setPluginEnabled', args: { id: 'search-entry', enabled: false } },
      { endpoint: 'pluginManager/setBundleEnabled', args: { name: 'search-bundle', enabled: true } },
      { endpoint: 'settings/update', args: { ns: 'web-search', patch: { provider: 'example' } } },
    ].map(({ endpoint, args }) => ({ name: endpoint, run: async () => {
      const outcome = { ok: true as const, value: { status: 'restart-required' } }
      const dispatch = vi.fn(async (method: string) => method === endpoint ? outcome : {
        ok: true as const, value: [{ entryId: 'search-entry', moduleName: 'search', name: 'search-bundle', rows: [] }],
      })
      const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn())
      await expect(bridge.call({ endpoint, payload: { args } })).resolves.toEqual(outcome)
      expect(dispatch).toHaveBeenLastCalledWith(endpoint, { args }, expect.any(AbortSignal))
    } })))
  })

  it('rejects plugin-management bypasses before native mutation', async () => {
    await runScenarios([
      { name: 'Remote entry', endpoint: 'pluginManager/setPluginEnabled', args: { id: 'remote', enabled: false }, rows: [{ entryId: 'remote', moduleName: 'ds-harness-remote' }] },
      { name: 'Remote bundle', endpoint: 'pluginManager/setBundleEnabled', args: { name: 'ds-harness-remote', enabled: false }, rows: [{ name: 'ds-harness-remote', rows: [] }] },
      { name: 'bundle contains Remote', endpoint: 'pluginManager/setBundleEnabled', args: { name: 'bundle', enabled: true }, rows: [{ name: 'bundle', rows: [{ moduleName: 'ds-harness-remote/client' }] }] },
      { name: 'protected entry', endpoint: 'pluginManager/setPluginEnabled', args: { id: 'core', enabled: false }, rows: [{ entryId: 'core', moduleName: 'core', readOnlyReason: 'management-required' }] },
      { name: 'unknown entry', endpoint: 'pluginManager/setPluginEnabled', args: { id: 'missing', enabled: true }, rows: [] },
      { name: 'invalid boolean', endpoint: 'pluginManager/setPluginEnabled', args: { id: 'entry', enabled: 'false' }, rows: [] },
      { name: 'nested alias', endpoint: 'pluginManager/setPluginEnabled', args: { request: { id: 'entry', enabled: true } }, rows: [] },
      { name: 'install', endpoint: 'pluginManager/installBundle', args: { spec: 'package' }, rows: [] },
      { name: 'remove', endpoint: 'pluginManager/removeBundle', args: { name: 'package' }, rows: [] },
    ].map(({ name, endpoint, args, rows }) => ({ name, run: async () => {
      const dispatch = vi.fn(async (_method: string) => ({ ok: true as const, value: rows }))
      const open = vi.fn()
      const bridge = new HarnessRemoteBridge(gateway({ dispatch, open }), vi.fn())
      await expect(bridge.call({ endpoint, payload: { args } })).rejects.toBeInstanceOf(Error)
      expect(dispatch.mock.calls.every(([method]) => String(method).startsWith('pluginManager/list'))).toBe(true)
      await expect(bridge.openStream({ streamId: 'plugins', endpoint, payload: { args } })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
      expect(open).not.toHaveBeenCalled()
    } })))
  })

  it('filters oversized or unknown third-party projections from session/list', async () => {
    const rawSessions = [
      {
        id: 's1',
        title: 'Session 1',
        projections: {
          asOfSeq: 1,
          values: {
            permissions: { currentValue: 'default' },
            remoteStatusKnown: true,
            codexStatus: 'idle',
            inbox: { 'next-turn': [] },
            agentTeam: ['lead', 'helper'],
            turnOutline: 'x'.repeat(5000), // whitelist key > 4KB, kept!
            imageLimits: { maxBytes: 1024 },
            turn: { id: 'turn-1' },
            turnState: 'running',
            model: 'gpt-5',
            status: 'active',
            activeTurnId: 'turn-1',
            smallUnknown: { data: 'third-party' }, // unknown key <= 4KB, kept!
            contextLens: 'x'.repeat(100 * 1024), // unknown key > 4KB, dropped!
            oversizedPlugin: { data: 'y'.repeat(5000) }, // unknown key > 4KB, dropped!
          },
        },
      },
    ]
    const dispatch = vi.fn(async () => ({ ok: true as const, value: { items: rawSessions } }))
    const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined))

    const result = await bridge.call({ endpoint: 'session/list', payload: { args: {} } })
    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [
          {
            id: 's1',
            projections: {
              asOfSeq: 1,
              values: {
                permissions: { currentValue: 'default' },
                remoteStatusKnown: true,
                codexStatus: 'idle',
                inbox: { 'next-turn': [] },
                agentTeam: ['lead', 'helper'],
                turnOutline: 'x'.repeat(5000),
                imageLimits: { maxBytes: 1024 },
                turn: { id: 'turn-1' },
                turnState: 'running',
                model: 'gpt-5',
                status: 'active',
                activeTurnId: 'turn-1',
                smallUnknown: { data: 'third-party' },
              },
            },
          },
        ],
      },
    })
    const filteredSession = (result as { ok: boolean; value: { items: Array<{ projections: { values: Record<string, unknown> } }> } }).value.items[0]
    expect(filteredSession.projections.values.contextLens).toBeUndefined()
    expect(filteredSession.projections.values.oversizedPlugin).toBeUndefined()
    expect(filteredSession.projections.values.smallUnknown).toEqual({ data: 'third-party' })
    expect(filteredSession.projections.values.turnOutline).toBe('x'.repeat(5000))

    // Also verify direct array format
    dispatch.mockResolvedValueOnce({ ok: true as const, value: rawSessions as any })
    const arrayResult = await bridge.call({ endpoint: 'session/list', payload: { args: {} } })
    const arraySession = (arrayResult as { ok: boolean; value: Array<{ projections: { values: Record<string, unknown> } }> }).value[0]
    expect(arraySession.projections.values.contextLens).toBeUndefined()
    expect(arraySession.projections.values.oversizedPlugin).toBeUndefined()
    expect(arraySession.projections.values.smallUnknown).toEqual({ data: 'third-party' })
    expect(arraySession.projections.values.turnOutline).toBe('x'.repeat(5000))
  })

  it('prunes session catalog projections on list and search without changing detail responses', async () => {
    const session = { id: 's1', projections: { asOfSeq: 1, values: {
      permissions: { currentValue: 'default' },
      contextLens: '界'.repeat(2_000), // UTF-8 bytes, rather than JS string length.
    } } }
    await runScenarios(['session/list', 'session/search'].flatMap(endpoint => [
      { name: `${endpoint}: items`, value: { items: [session], nextCursor: 'next' } },
      { name: `${endpoint}: sessions`, value: { sessions: [session], nextCursor: 'next' } },
      { name: `${endpoint}: array`, value: [session] },
    ].map(({ name, value }) => ({ name, run: async () => {
      const dispatch = vi.fn(async () => ({ ok: true as const, value }))
      const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn())
      const result = await bridge.call({ endpoint, payload: { args: {} } })
      const text = JSON.stringify(result)
      expect(text).not.toContain('contextLens')
      expect(text).toContain('permissions')
      if (!Array.isArray(value)) expect(text).toContain('nextCursor')
      expect(session.projections.values.contextLens).toHaveLength(2_000)
    } }))))
    const original = { ok: true as const, value: session }
    const bridge = new HarnessRemoteBridge(gateway({ dispatch: vi.fn(async () => original) }), vi.fn())
    await expect(bridge.call({ endpoint: 'session/projections', payload: { args: {} } })).resolves.toEqual(original)
  })

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
    for (const endpoint of ['session/projections', 'session/initializeDefaultModel', 'workspace/pinSession', 'workspace/unpinSession', 'userQuestions/answer', 'claudeCodeMods/pressBand', 'schedule/list', 'schedule/catalog']) {
      const payload = { args: { request: { sessionId: 'session-1' } } }
      await expect(bridge.call({ endpoint, payload })).resolves.toMatchObject({ ok: true })
      expect(dispatch).toHaveBeenLastCalledWith(endpoint, payload, expect.any(AbortSignal))
    }
    for (const endpoint of ['schedule/create', 'schedule/arbitrary', 'schedule/updateAll']) {
      await expect(bridge.call({ endpoint, payload: { args: {} } })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    }
  })

  it('preserves official schedule management requests, conflicts and missing-task results', async () => {
    await runScenarios([
      { endpoint: 'schedule/history', request: { sessionId: 'session-1', id: 'task-1', limit: 20, before: 'message-1' }, value: { id: 'task-1', records: [], earlierRecordsUnavailable: false, earlierRecordsPruned: false, retention: { days: 30, records: 100 } } },
      { endpoint: 'schedule/update', request: { sessionId: 'session-1', id: 'task-1', expected: { id: 'task-1', kind: 'at', title: 'Old', prompt: 'Check build', scheduledAt: '2026-10-23T00:00:00.000Z' }, title: 'New' }, value: { id: 'task-1', updated: false, code: 'schedule_conflict' } },
      { endpoint: 'schedule/delete', request: { sessionId: 'session-1', id: 'task-1' }, value: { id: 'task-1', deleted: false, code: 'schedule_not_found' } },
    ].map(({ endpoint, request, value }) => ({
      name: endpoint,
      run: async () => {
        const result = { ok: true as const, value }
        const dispatch = vi.fn(async () => result)
        const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined))
        const payload = { args: { request } }
        await expect(bridge.call({ endpoint, payload })).resolves.toEqual(result)
        expect(dispatch).toHaveBeenCalledTimes(1)
        expect(dispatch).toHaveBeenCalledWith(endpoint, payload, expect.any(AbortSignal))
      },
    })))
  })

  it('forwards the background-job roster and observation streams', async () => {
    await runScenarios(['job/list', 'job/follow'].map(endpoint => ({
      name: endpoint,
      run: async () => {
        const open = vi.fn(async () => (async function* () { yield { type: 'rows', jobs: [] } })())
        const publish = vi.fn(async () => undefined)
        const bridge = new HarnessRemoteBridge(gateway({ open }), publish)
        const payload = { args: { request: { sessionId: 'session-1' } } }
        await bridge.openStream({ streamId: 'jobs1', endpoint, payload } )
        expect(open).toHaveBeenCalledWith(endpoint, payload, expect.any(AbortSignal))
        await vi.waitFor(() => expect(publish).toHaveBeenCalledWith('harness.remote.stream.closed', { streamId: 'jobs1', reason: 'completed' }))
        await expect(bridge.call({ endpoint: endpoint.split('/')[0] + '/arbitrary', payload })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
      },
    })))
  })

  it('forwards the background-job kill command', async () => {
    const result = { ok: true as const, value: { outcome: 'requested' } }
    const dispatch = vi.fn(async () => result)
    const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined))
    const payload = { args: { request: { sessionId: 'session-1', jobId: 'job-1' } } }
    const callResult = await bridge.call({ endpoint: 'job/kill', payload })
    expect(dispatch).toHaveBeenCalledWith('job/kill', payload, expect.any(AbortSignal))
    expect(callResult).toEqual(result)
  })

  it('forwards only fixed v0.2.1 question and Mods streams', async () => {
    await runScenarios(['userQuestions/attachWait', 'claudeCodeMods/watchBand'].map(endpoint => ({
      name: endpoint,
      run: async () => {
        const open = vi.fn(async () => (async function* () { yield { remainingMs: 1000 } })())
        const publish = vi.fn(async () => undefined)
        const bridge = new HarnessRemoteBridge(gateway({ open }), publish)
        const payload = { args: { agentId: 's1', callId: 'c1' } }
        await bridge.openStream({ streamId: 'claim1', endpoint, payload })
        expect(open).toHaveBeenCalledWith(endpoint, payload, expect.any(AbortSignal))
        await vi.waitFor(() => expect(publish).toHaveBeenCalledWith('harness.remote.stream.closed', { streamId: 'claim1', reason: 'completed' }))
        await expect(bridge.call({ endpoint: endpoint.split('/')[0] + '/arbitrary', payload })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
      },
    })))
  })

  it('rejects invalid workspace creation paths before filesystem writes or native dispatch', async () => {
    await runScenarios([
      ['missing', undefined], ['blank', '  '], ['relative', 'relative/project'],
      ['root', parse(tmpdir()).root], ['NUL', join(tmpdir(), 'bad\0path')],
    ].map(([name, path]) => ({
      name: String(name),
      run: async () => {
        const dispatch = vi.fn()
        const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined))
        await expect(bridge.call({ endpoint: 'workspace/create', payload: { args: { request: { path } } } }))
          .rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
        expect(dispatch).not.toHaveBeenCalled()
      },
    })))
  })

  it('creates missing Host folders before forwarding workspace/create', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-remote-workspace-create-'))
    // Windows normalizes trailing spaces; use an ordinary spaced name there.
    const name = process.platform === 'win32' ? 'admin folder' : 'admin '
    const folder = join(root, 'MarcoAgent', name)
    const dispatch = vi.fn(async (endpoint: string, payload: { args: Record<string, unknown> }) => {
      expect(endpoint).toBe('workspace/create')
      expect(payload.args).toEqual({ request: { path: folder } })
      const resolved = await realpath(folder)
      expect(resolved.endsWith(name)).toBe(true)
      return {
        ok: true as const,
        value: {
          workspace: {
            workspaceId: 'ws-admin',
            path: folder,
            title: 'admin',
            sessionIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          created: true,
        },
      }
    })
    const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined))
    try {
      await expect(bridge.call({
        endpoint: 'workspace/create',
        payload: { args: { request: { path: folder } } },
      })).resolves.toMatchObject({
        ok: true,
        value: { workspace: { workspaceId: 'ws-admin' }, created: true },
      })
      expect(dispatch).toHaveBeenCalledTimes(1)
      // Registration failure must not delete directories on the Host.
      dispatch.mockResolvedValueOnce({ ok: false, error: { code: 'FAILED' } } as never)
      await expect(bridge.call({ endpoint: 'workspace/create', payload: { args: { request: { path: folder } } } }))
        .resolves.toMatchObject({ ok: false })
      expect((await stat(folder)).isDirectory()).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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

  it('selects command attachment fields for modern Host versions', async () => {
    const rows = ['0.1.5-rc.1', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.1-alpha.1', '0.2.2-rc.1'] as const
    await runScenarios(
      rows.map((row, index) => {
        const version = row
        return {
          name: scenarioName('selects the renamed command attachment field for a %s Host', row, index),
          run: async () => {
            const dispatch = vi.fn(async (_endpoint: string, payload: { args: Record<string, unknown> }) => {
              expect(payload.args).toEqual({
                agentId: 'session-1',
                line: '/goal complete',
                submittedAttachments: [],
              })
              return { ok: true as const, value: { commandId: 'cmd-0.1.5' } }
            })
            const bridge = new HarnessRemoteBridge(
              gateway({ dispatch }),
              vi.fn(async () => undefined),
              undefined,
              version,
            )

            await expect(
              bridge.call({
                endpoint: 'commands/execute',
                payload: { args: { agentId: 'session-1', line: '/goal complete', images: [] } },
              }),
            ).resolves.toEqual({ ok: true, value: { commandId: 'cmd-0.1.5' } })
            expect(dispatch).toHaveBeenCalledWith(
              'commands/execute',
              {
                args: { agentId: 'session-1', line: '/goal complete', submittedAttachments: [] },
              },
              expect.any(AbortSignal),
            )
            expect(dispatch).toHaveBeenCalledOnce()
          },
        }
      }),
    )
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

  it('closes an oversized stream frame without dropping the peer connection', async () => {
    const publish = vi.fn(async () => undefined)
    const open = vi.fn(async () => (async function* () {
      yield { type: 'event', value: 'x'.repeat(MAX_SECURE_MESSAGE_BYTES) }
    })())
    const bridge = new HarnessRemoteBridge(gateway({ open }), publish)

    await expect(bridge.openStream({
      streamId: 'oversized-stream-1',
      endpoint: '$events',
      payload: { args: {} },
    })).resolves.toEqual({ opened: true, streamId: 'oversized-stream-1' })

    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith('harness.remote.stream.closed', {
      streamId: 'oversized-stream-1',
      reason: 'failed',
      failure: { code: 'internal', message: 'Request failed.', details: {} },
    }))
    expect(publish).not.toHaveBeenCalledWith('harness.remote.frame', expect.anything())
  })

  it('adds the workspace root to legacy file-change subscriptions on compatible Hosts', async () => {
    const rows = ['0.1.7-rc.1', '0.2.0-rc.1'] as const
    await runScenarios(
      rows.map((row, index) => {
        const version = row
        return {
          name: scenarioName('adds the workspace root to legacy file-change subscriptions on %s', row, index),
          run: async () => {
            const open = vi.fn(async () =>
              (async function* () {
                yield { kind: 'ready' }
              })(),
            )
            const bridge = new HarnessRemoteBridge(
              gateway({ open }),
              vi.fn(async () => undefined),
              undefined,
              version,
            )

            await expect(
              bridge.openStream({
                streamId: 'file-changes-017',
                endpoint: 'workspaceFiles/changes',
                payload: { args: { workspaceFileScopeId: 'session-1' } },
              }),
            ).resolves.toEqual({ opened: true, streamId: 'file-changes-017' })
            expect(open).toHaveBeenCalledWith(
              'workspaceFiles/changes',
              { args: { workspaceFileScopeId: 'session-1', path: '.' } },
              expect.any(AbortSignal),
            )
          },
        }
      }),
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

  it('nests readBytes ranges for modern Host versions', async () => {
    const rows = ['0.1.7-rc.1', '0.2.0-rc.1'] as const
    await runScenarios(
      rows.map((row, index) => {
        const version = row
        return {
          name: scenarioName('nests readBytes ranges for a %s Host', row, index),
          run: async () => {
            const dispatch = vi.fn(async () => ({ ok: true as const, value: { bytes: '' } }))
            const bridge = new HarnessRemoteBridge(
              gateway({ dispatch }),
              vi.fn(async () => undefined),
              undefined,
              version,
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
            expect(dispatch).toHaveBeenCalledWith(
              'workspaceFiles/readBytes',
              {
                args: {
                  workspaceFileScopeId: 'session-1',
                  path: '/tmp/a.bin',
                  options: { range: { offset: 0, length: 1024 } },
                },
              },
              expect.any(AbortSignal),
            )
          },
        }
      }),
    )
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

  it('encodes native binary workspace responses for the JSON remote carrier', async () => {
    const dispatch = vi.fn(async (endpoint: string) => ({
      ok: true as const,
      value: endpoint === 'workspaceFiles/readBytes'
        ? { absolutePath: '/tmp/a.png', version: 'v1', bytes: 3, offset: 0, data: new Uint8Array([0, 255, 16]), eof: true }
        : { absolutePath: '/tmp/a.docx', version: 'v1', bytes: 3, offset: 0, data: new Uint8Array([37, 80, 68]), eof: true, generation: 'g1', missingFonts: [] },
    }))
    const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined), undefined, '0.2.1-alpha.1')

    await expect(bridge.call({ endpoint: 'workspaceFiles/readBytes', payload: { args: { path: '/tmp/a.png', range: { offset: 0, length: 3 } } } }))
      .resolves.toMatchObject({ ok: true, value: { data: 'AP8Q' } })
    await expect(bridge.call({ endpoint: 'officeToPdf/render', payload: { args: { path: '/tmp/a.docx' } } }))
      .resolves.toMatchObject({ ok: true, value: { data: 'JVBE' } })
  })

  it('materializes official Gateway binary attachments before crossing the JSON carrier', async () => {
    const dispatch = vi.fn(async () => ({
      ok: true as const,
      value: { absolutePath: '/tmp/a.png', version: 'v1', bytes: 3, offset: 0, data: null, eof: true },
      attachments: [{ path: ['data'], bytes: new Uint8Array([0, 255, 16]) }],
    }))
    const bridge = new HarnessRemoteBridge(gateway({ dispatch }), vi.fn(async () => undefined), undefined, '0.2.1-alpha.1')

    await expect(bridge.call({ endpoint: 'workspaceFiles/readBytes', payload: { args: { path: '/tmp/a.png', range: { offset: 0, length: 3 } } } }))
      .resolves.toMatchObject({ ok: true, value: { data: 'AP8Q' } })
    const result = await bridge.call({ endpoint: 'workspaceFiles/readBytes', payload: { args: { path: '/tmp/a.png', range: { offset: 0, length: 3 } } } })
    expect(result).not.toHaveProperty('attachments')
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
