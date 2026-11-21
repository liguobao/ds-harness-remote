import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { AntigravityNativeAcpClient, isLegacyAntigravityStreamJsonArgs } from '../src/acp/adapters/antigravity-acp.js'
import {
  buildAuthDiagnosticFromMetadata,
  detectUpstreamAuthFailure,
  parseInitializeMetadata,
  redactPaths,
} from '../src/acp/adapters/auth-diagnostics.js'
import { CursorAcpClient, CursorAcpError } from '../src/acp/adapters/cursor-process.js'
import { IsolatedAcpClient } from '../src/acp/adapters/isolated-process.js'
import { AcpRemoteGateway } from '../src/acp/gateway.js'
import { isValidAcpBackendId } from '../src/acp/method-policy.js'
import { AcpWorkspaceStore } from '../src/acp/workspace-store.js'
import { AcpVirtualHarness } from '../src/acp/virtual-harness.js'
import type { AcpClientLike } from '../src/acp/virtual-contract.js'
import type { SafeLogger } from '../src/logging.js'

function logger(): SafeLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as SafeLogger
}

function fakeJsonRpcProcess() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams & { killed: boolean; kill: ReturnType<typeof vi.fn> }
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  Object.assign(child, {
    stdin,
    stdout,
    stderr,
    pid: 4321,
    exitCode: null,
    killed: false,
    kill: vi.fn(() => {
      Object.defineProperty(child, 'killed', { value: true, writable: true, configurable: true })
      child.emit('exit', 0, null)
      child.emit('close', 0, null)
      return true
    }),
  })
  return { child, stdin, stdout, stderr }
}

describe('Issue #469 ACP parity (plugin)', () => {
  it('supports native agy acp JSON-RPC handshake, modes, configOptions, usage_update, and image blocks', async () => {
    expect(isLegacyAntigravityStreamJsonArgs(['--input-format', 'stream-json'])).toBe(true)
    expect(isLegacyAntigravityStreamJsonArgs(['acp'])).toBe(false)

    const fake = fakeJsonRpcProcess()
    const outbound: Array<Record<string, unknown>> = []
    const inbound: Array<{ method?: string; params?: unknown }> = []

    fake.stdin.on('data', chunk => {
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue
        const msg = JSON.parse(line) as Record<string, unknown>
        outbound.push(msg)
        const id = msg.id
        if (id === undefined) continue
        if (msg.method === 'initialize') {
          fake.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: 1,
              agentCapabilities: {
                loadSession: true,
                promptCapabilities: { image: true },
                sessionCapabilities: { list: {}, fork: {} },
              },
              authMethods: [{ id: 'google-oauth', name: 'Google OAuth', description: 'Run agy acp' }],
              agentInfo: { name: 'antigravity', version: '1.5.10' },
            },
          })}\n`)
        } else if (msg.method === 'session/new') {
          fake.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: {
              sessionId: 'agy-native-1',
              modes: {
                currentModeId: 'default',
                availableModes: [
                  { id: 'default', name: 'Default' },
                  { id: 'plan', name: 'Planning' },
                ],
              },
              configOptions: [
                {
                  id: 'model',
                  type: 'select',
                  category: 'model',
                  currentValue: 'gemini-3.1-pro',
                  options: [{ value: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro' }],
                },
                {
                  id: 'thought_level',
                  type: 'select',
                  category: 'thought_level',
                  currentValue: 'high',
                  options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
                },
              ],
            },
          })}\n`)
        } else if (msg.method === 'session/set_mode') {
          fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: {} })}\n`)
          fake.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: { sessionId: 'agy-native-1', update: { sessionUpdate: 'current_mode_update', currentModeId: 'plan' } },
          })}\n`)
        } else if (msg.method === 'session/prompt') {
          fake.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'agy-native-1',
              update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact context' }] },
            },
          })}\n`)
          fake.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: { sessionId: 'agy-native-1', update: { sessionUpdate: 'usage_update', used: 1200, size: 100000 } },
          })}\n`)
          fake.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: { sessionId: 'agy-native-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done' } } },
          })}\n`)
          fake.stdout.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id,
            result: { stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 25, cachedReadTokens: 40, thoughtTokens: 10, totalTokens: 135 } },
          })}\n`)
        }
      }
    })

    const client = new AntigravityNativeAcpClient('agy', logger(), () => fake.child, { args: ['acp'] })
    client.onInbound(msg => inbound.push(msg))
    await client.start()

    const created = await client.call('session/new', { cwd: '/tmp/proj', mcpServers: [] }) as Record<string, unknown>
    expect(created.sessionId).toBe('agy-native-1')

    await client.call('session/set_mode', { sessionId: 'agy-native-1', modeId: 'plan' })
    const modes = await client.call('dsh/sessionModes', { sessionId: 'agy-native-1', backend: 'antigravity' }) as { currentModeId?: string }
    expect(modes.currentModeId).toBe('plan')

    const models = await client.call('dsh/sessionModels', { sessionId: 'agy-native-1', backend: 'antigravity' }) as { current: { model: string; reasoningEffort?: string } }
    expect(models.current).toMatchObject({ provider: 'antigravity', model: 'gemini-3.1-pro', reasoningEffort: 'high' })

    const promptRes = await client.call('session/prompt', {
      sessionId: 'agy-native-1',
      prompt: [
        { type: 'text', text: 'Describe image' },
        { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
      ],
    }) as Record<string, unknown>
    expect(promptRes.stopReason).toBe('end_turn')
    expect(promptRes.usage).toMatchObject({ inputTokens: 100, outputTokens: 25, cachedReadTokens: 40, thoughtTokens: 10 })

    const commands = await client.call('dsh/sessionCommands', { sessionId: 'agy-native-1', backend: 'antigravity' })
    expect(commands).toEqual({ commands: [{ name: 'compact', description: 'Compact context' }] })
    expect(inbound.some(frame => frame.method === 'session/update' && (frame.params as Record<string, unknown> & { update?: { sessionUpdate?: string } }).update?.sessionUpdate === 'usage_update')).toBe(true)

    const { acpHistoryEvents } = await import('../src/acp/history-events.js')
    const replayed = acpHistoryEvents([{
      kind: 'notification',
      method: 'session/update',
      params: {
        sessionId: 'agy-native-1',
        update: {
          sessionUpdate: 'user_message_chunk',
          content: {
            type: 'image',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          },
        },
      },
    }], 'agy-native-1', 'antigravity') as Array<{ event: { type: string; data: { content: Array<Record<string, unknown>> } } }>
    const userMsg = replayed.find(entry => entry.event.type === 'user/message')
    expect(userMsg?.event.data.content[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      mediaType: 'image/png',
      attachment: { attachmentId: expect.stringMatching(/^agy-image:/) },
    })

    await client.close()
  })

  it('detects headless ACP auth failures and redacts sensitive local paths', () => {
    const diagBrowser = detectUpstreamAuthFailure('antigravity', {
      code: -32602,
      message: 'Failed to open browser for login using /home/alice/.config/agy/token.json',
    })
    expect(diagBrowser).toMatchObject({
      authStatus: 'auth_required',
      loginCommand: 'agy acp --login',
    })
    expect(diagBrowser?.guidance).not.toContain('/home/alice')

    const diagUnauth = detectUpstreamAuthFailure('cursor', {
      code: -32000,
      message: 'Authentication required for C:\\Users\\Alice\\secrets',
    }, [{ id: 'cursor_login', name: 'Cursor Login', description: 'Run agent login', type: 'terminal', args: ['login'] }])
    expect(diagUnauth).toMatchObject({
      authStatus: 'auth_required',
      loginCommand: 'agent login',
    })
    expect(redactPaths('failed at /Users/bob/.ssh/id_ed25519')).not.toContain('/Users/bob')

    const initMeta = parseInitializeMetadata({
      agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
      authMethods: [{ id: 'pi_terminal_login', name: 'Pi Terminal Login', type: 'terminal' }],
    })
    expect(initMeta.agentCapabilities.sessionCapabilities?.fork).toBe(true)
    const piAuth = detectUpstreamAuthFailure('pi', { code: -32000, message: 'Authentication required' }, initMeta.authMethods)
    const built = buildAuthDiagnosticFromMetadata('pi', initMeta, piAuth, false)
    expect(built.authStatus).toBe('auth_required')
    expect(built.loginCommand).toBe('pi')
  })

  it('persists ACP workspaces, delete tombstones, pinned sessions, and permission presets across store reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-acp-store-'))
    try {
      const store1 = AcpWorkspaceStore.inDirectory(dir)
      await store1.upsertWorkspace('cursor', '/srv/app-a', 'App A')
      await store1.upsertWorkspace('cursor', '/srv/app-b', 'App B')
      await store1.renameWorkspace('cursor', '/srv/app-b', 'Renamed B')
      await store1.reorderWorkspaces('cursor', ['/srv/app-b', '/srv/app-a'])
      await store1.pinSession('cursor', 'sess-1')
      await store1.setSessionPermission('sess-1', 'danger-full-access')
      await store1.deleteWorkspace('cursor', '/srv/app-a')

      const store2 = AcpWorkspaceStore.inDirectory(dir)
      const list = await store2.listWorkspaces('cursor')
      expect(list.workspaces.map(w => ({ path: w.path, title: w.title }))).toEqual([
        { path: '/srv/app-b', title: 'Renamed B' },
      ])
      expect(list.deletedPaths.has('/srv/app-a')).toBe(true)
      expect(await store2.getPinnedSessions('cursor')).toEqual(['sess-1'])
      expect(await store2.getSessionPermission('sess-1')).toBe('danger-full-access')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('handles cursor session discovery, workspace CRUD/pin, mode switch, ask_question, todos, usage, and custom backends in AcpVirtualHarness', async () => {
    let streamHandler: ((frame: { streamId: string; frame: { method: string; params: unknown } }) => void) | undefined
    const client: AcpClientLike & {
      createWorkspace: ReturnType<typeof vi.fn>
      renameWorkspace: ReturnType<typeof vi.fn>
      deleteWorkspace: ReturnType<typeof vi.fn>
      reorderWorkspaces: ReturnType<typeof vi.fn>
      pinSession: ReturnType<typeof vi.fn>
      unpinSession: ReturnType<typeof vi.fn>
      sessionModes: ReturnType<typeof vi.fn>
      setMode: ReturnType<typeof vi.fn>
      forkSession: ReturnType<typeof vi.fn>
    } = {
      listSessions: vi.fn(async () => [{ conversationId: 'cur-1', title: 'Cursor Old', createdAt: 1, updatedAt: 100, pinned: true }]),
      loadSessionDetails: vi.fn(async () => ({
        events: [],
        modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }] },
        availableCommands: [{ name: 'compact', description: 'Compact' }],
        permissionPreset: 'workspace-write',
      })),
      createSession: vi.fn(async () => ({ sessionId: 'cur-new' })),
      forkSession: vi.fn(async () => ({ sessionId: 'cur-fork' })),
      prompt: vi.fn(async () => ({ stopReason: 'in_progress' })),
      cancel: vi.fn(async () => ({})),
      listDirectory: vi.fn(async () => ({ path: '/srv/repo', home: '/srv', crumbs: [], entries: [], truncated: false })),
      createWorkspace: vi.fn(async (path, _backend, title) => ({ path, title })),
      renameWorkspace: vi.fn(async (path, _backend, title) => ({ path, title })),
      deleteWorkspace: vi.fn(async () => undefined),
      reorderWorkspaces: vi.fn(async (_backend, paths) => paths),
      pinSession: vi.fn(async (sid) => [sid]),
      unpinSession: vi.fn(async () => []),
      sessionModes: vi.fn(async () => ({
        currentModeId: 'default',
        availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }],
      })),
      setMode: vi.fn(async (_sid, _b, modeId) => ({ currentModeId: modeId })),
      respond: vi.fn(async () => ({})),
      openStream: vi.fn(async (_sid, onFrame) => {
        streamHandler = onFrame
        return { close: async () => undefined }
      }),
    }

    const harness = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'cursor')
    const signal = new AbortController().signal
    try {
      const ws = await harness.selectOrCreateWorkspace('/srv/repo', 'Repo')
      expect(client.listSessions).toHaveBeenCalled()
      expect(ws.sessionIds).toContain('cursor:cur-1')

      // Mode presets & switch
      const presets = await harness.dispatch('agentPresets/list', { args: {} }, signal)
      expect(presets).toMatchObject({ ok: true, value: { presets: [{ id: 'default' }, { id: 'plan' }] } })
      const switched = await harness.dispatch('agentPresets/select', { args: { agentId: 'cursor:cur-1', agentPreset: 'plan' } }, signal)
      expect(switched).toEqual({ ok: true, value: 'plan' })

      // Follow live stream -> todos, contextPressure, live non-pi tool delta, usage, and ask_question
      const eventStream = await harness.open('$events', { args: {} }, signal)
      const eventIter = eventStream[Symbol.asyncIterator]()
      expect((await eventIter.next()).value).toMatchObject({ type: 'ready' })
      const followStream = await harness.open('session/follow', { args: { request: { sessionId: 'cursor:cur-1' } } }, signal)
      const followIter = followStream[Symbol.asyncIterator]()
      await followIter.next() // initial snapshot

      streamHandler?.({ streamId: 's', frame: { method: 'session/update', params: { sessionId: 'cur-1', update: { sessionUpdate: 'usage_update', used: 200, size: 1000 } } } })
      streamHandler?.({ streamId: 's', frame: { method: 'session/update', params: { sessionId: 'cur-1', update: { sessionUpdate: 'plan', entries: [{ content: 'Step 1', status: 'in_progress' }] } } } })
      streamHandler?.({ streamId: 's', frame: { method: 'cursor/ask_question', params: { requestHandle: 'q-1', title: 'Confirm', questions: [{ id: 'q1', prompt: 'Continue?' }] } } })

      const firstEv = await eventIter.next()
      expect(firstEv.value).toMatchObject({ event: 'approval/request', eventId: 'q-1', request: { method: 'cursor/ask_question' } })

      const answered = await harness.dispatch('$events/result', {
        args: { eventId: 'q-1', outcome: { kind: 'result', value: { answers: [{ id: 'q1', selected: ['Yes'] }] } } },
      }, signal)
      expect(answered.ok).toBe(true)
      expect(client.respond).toHaveBeenCalledWith('q-1', 'allow-once', {
        outcome: { outcome: 'answered', answers: [{ id: 'q1', selected: ['Yes'] }] },
      }, signal)

      // Session pin / unpin / fork / search / commands
      expect(await harness.dispatch('workspace/pinSession', { args: { request: { sessionId: 'cursor:cur-1' } } }, signal))
        .toEqual({ ok: true, value: { pinnedSessionIds: ['cursor:cur-1'] } })
      expect(await harness.dispatch('session/fork', { args: { request: { sessionId: 'cursor:cur-1' } } }, signal))
        .toEqual({ ok: true, value: { sessionId: 'cursor:cur-fork' } })
      expect(await harness.dispatch('session/search', { args: { query: 'Cursor Old' } }, signal))
        .toMatchObject({ ok: true, value: { items: expect.arrayContaining([expect.objectContaining({ sessionId: 'cursor:cur-1' })]) } })

      // Workspace rename & delete
      expect(await harness.dispatch('workspace/rename', { args: { request: { workspaceId: ws.workspaceId, title: 'Updated' } } }, signal))
        .toMatchObject({ ok: true, value: { workspace: { title: 'Updated' } } })
      expect(await harness.dispatch('workspace/delete', { args: { request: { workspaceId: ws.workspaceId } } }, signal))
        .toEqual({ ok: true, value: { workspaceIds: [] } })
    } finally {
      await harness.close()
    }
  })

  it('switches modes for IsolatedAcpClient + CursorAcpClient after session/load config_option_update replay', async () => {
    const client = new IsolatedAcpClient(
      'pi',
      logger(),
      { backend: 'pi' },
      () => new CursorAcpClient('pi', logger(), () => {
        const fake = fakeJsonRpcProcess()
        let currentMode = 'default'
        fake.stdin.on('data', chunk => {
          for (const line of String(chunk).split('\n')) {
            const trimmed = line.trim()
            if (!trimmed) continue
            const msg = JSON.parse(trimmed) as { id?: number; method: string; params?: any }
            if (msg.method === 'initialize') {
              fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1 } })}\n`)
            } else if (msg.method === 'session/load') {
              fake.stdout.write(`${JSON.stringify({
                jsonrpc: '2.0',
                method: 'session/update',
                params: {
                  sessionId: msg.params.sessionId,
                  update: {
                    sessionUpdate: 'config_option_update',
                    configOptions: [{
                      id: 'mode',
                      category: 'mode',
                      type: 'select',
                      currentValue: currentMode,
                      options: [
                        { value: 'default', name: 'Default' },
                        { value: 'plan', name: 'Plan' },
                      ],
                    }],
                  },
                },
              })}\n`)
              fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: msg.params.sessionId } })}\n`)
            } else if (msg.method === 'session/set_config_option') {
              currentMode = msg.params.value
              fake.stdout.write(`${JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  configOptions: [{
                    id: 'mode',
                    category: 'mode',
                    type: 'select',
                    currentValue: currentMode,
                    options: [
                      { value: 'default', name: 'Default' },
                      { value: 'plan', name: 'Plan' },
                    ],
                  }],
                },
              })}\n`)
            }
          }
        })
        return fake.child
      }, { backend: 'pi', authenticationMethod: null }),
    )

    await client.start()
    try {
      await client.call('session/load', { sessionId: 'pi-replay-1', cwd: '/tmp', mcpServers: [] })
      expect(await client.call('dsh/sessionModes', { sessionId: 'pi-replay-1' })).toMatchObject({
        currentModeId: 'default',
        availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }],
      })
      expect(await client.call('session/set_mode', { sessionId: 'pi-replay-1', modeId: 'plan' })).toEqual({
        currentModeId: 'plan',
      })
      expect(await client.call('dsh/sessionModes', { sessionId: 'pi-replay-1' })).toMatchObject({
        currentModeId: 'plan',
      })
    } finally {
      await client.close()
    }
  })

  it('rejects prototype/dot backend IDs, redacts spaced user paths/args, and recovers AcpWorkspaceStore writeChain after failure', async () => {
    expect(isValidAcpBackendId('constructor')).toBe(false)
    expect(isValidAcpBackendId('toString')).toBe(false)
    expect(isValidAcpBackendId('__proto__')).toBe(false)
    expect(isValidAcpBackendId('my.agent')).toBe(false)
    expect(isValidAcpBackendId('my-agent_1')).toBe(true)

    expect(redactPaths('Auth failed at "C:\\Users\\First Last\\.agy\\credentials.json" and C:\\Users\\Alice Bob\\.agy\\token')).not.toContain('First Last')
    expect(redactPaths('Failed at C:\\Users\\Alice Bob\\.agy\\token.json')).toBe('Failed at <host-path>')
    const meta = parseInitializeMetadata({
      authMethods: [{ id: 'term', name: 'CLI Login', type: 'terminal', args: ['--config', '/home/alice/.cfg'] }],
    })
    expect(meta.authMethods[0]?.args).toEqual(['--config', '<host-path>'])
    const authDiag = detectUpstreamAuthFailure('my-custom', { code: -32000, message: 'unauthorized' }, [
      { id: 'term', name: 'CLI', type: 'terminal', args: ['login', '--file', '/Users/Alice/.token'] },
    ])
    expect(authDiag?.loginCommand).toBe('my-custom login --file <host-path>')

    const root = await mkdtemp(join(tmpdir(), 'dsh-acp-store-fail-'))
    const storeFile = join(root, 'acp-state.json')
    try {
      // Creating a directory at storeFile causes rename(tmp, storeFile) to fail cleanly on first persist().
      await mkdir(storeFile, { recursive: true })
      const store = new AcpWorkspaceStore(storeFile)
      await expect(store.pinSession('constructor', 's1')).rejects.toThrow(/Reserved ACP backend/)
      await expect(store.upsertWorkspace('antigravity', '/repo/a', 'Repo A')).rejects.toThrow()
      await rm(storeFile, { recursive: true, force: true })
      await expect(store.upsertWorkspace('antigravity', '/repo/b', 'Repo B')).resolves.toMatchObject({ path: '/repo/b' })
      const reloaded = new AcpWorkspaceStore(storeFile)
      const list = await reloaded.listWorkspaces('antigravity')
      expect(list.workspaces.map(w => w.path)).toEqual(['/repo/a', '/repo/b'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('restores permission preset on session/load after restart, prioritizes bypassPermissions, forks without cached cwd, and propagates Cursor list auth errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-acp-gw-'))
    const repo = await realpath(join(root, 'repo')).catch(async () => {
      await mkdir(join(root, 'repo'), { recursive: true })
      return realpath(join(root, 'repo'))
    })
    const storeDir = join(root, 'store')
    await mkdir(storeDir, { recursive: true })

    const makeMockClient = (backendId: string, calls: Array<{ method: string; params: unknown }>) => {
      const inboundHandlers = new Set<(msg: any) => void>()
      const modeCalls: string[] = []
      const client = {
        start: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        isReady: () => true,
        capabilities: () => ({
          loadSession: true,
          sessionCapabilities: { list: true, fork: true },
        }),
        authMethods: () => [],
        diagnostics: () => ({ authStatus: 'authenticated' as const }),
        respond: vi.fn(async () => undefined),
        respondError: vi.fn(async () => undefined),
        onInbound: (h: (msg: any) => void) => { inboundHandlers.add(h); return () => inboundHandlers.delete(h) },
        onUnavailable: () => () => undefined,
        emitPermission: (requestId: string, sessionId: string) => {
          for (const h of inboundHandlers) {
            h({
              kind: 'request',
              id: requestId,
              method: 'session/request_permission',
              params: {
                sessionId,
                options: [{ optionId: 'once', kind: 'allow_once' }, { optionId: 'deny', kind: 'reject_once' }],
              },
            })
          }
        },
        call: vi.fn(async (method: string, params: any) => {
          calls.push({ method, params })
          if (backendId === 'cursor' && method === 'session/list') {
            throw new CursorAcpError('CURSOR_UPSTREAM_ERROR', 'Login required', {
              authDiagnostic: { authStatus: 'auth_required', errorCode: 'ACP_HEADLESS_BROWSER_LOGIN_FAILED' },
            })
          }
          if (method === 'session/list') {
            return { sessions: [{ sessionId: 'sess-1', cwd: repo, title: 'Restored', updatedAt: '2026-11-18T00:00:00Z' }] }
          }
          if (method === 'session/load') return { sessionId: params.sessionId }
          if (method === 'session/fork') return { sessionId: 'sess-forked' }
          if (method === 'dsh/sessionModes') {
            return {
              currentModeId: 'default',
              availableModes: [
                { id: 'default', name: 'Default' },
                { id: 'acceptEdits', name: 'Accept edits' },
                { id: 'bypassPermissions', name: 'Bypass' },
              ],
            }
          }
          if (method === 'session/set_mode') {
            modeCalls.push(params.modeId)
            return { currentModeId: params.modeId }
          }
          return {}
        }),
        modeCalls,
      }
      return client
    }

    const calls1: Array<{ method: string; params: unknown }> = []
    const client1 = makeMockClient('antigravity', calls1)
    const cursorClient = makeMockClient('cursor', [])
    const gateway1 = new AcpRemoteGateway(
      {
        enabled: true,
        backends: [
          { id: 'antigravity', enabled: true, command: 'agy', args: ['acp'] },
          { id: 'cursor', enabled: true, command: 'agent', args: ['acp'] },
        ],
      },
      logger(),
      (_bin, _log, cfg) => (cfg.id === 'cursor' ? cursorClient : client1),
      [100],
      () => false,
      undefined,
      AcpWorkspaceStore.inDirectory(storeDir),
    )

    try {
      await gateway1.start()
      await gateway1.call('c1', { method: 'session/load', params: { backend: 'antigravity', sessionId: 'sess-1' } })
      await gateway1.call('c1', { method: 'dsh/selectPermission', params: { backend: 'antigravity', sessionId: 'sess-1', preset: 'danger-full-access' } })
      expect(client1.modeCalls).toEqual(['bypassPermissions'])
      await gateway1.call('c1', { method: 'dsh/workspaceCreate', params: { backend: 'antigravity', path: repo, title: 'Created Repo' } })
      await gateway1.call('c1', { method: 'dsh/sessionPin', params: { backend: 'antigravity', sessionId: 'sess-1' } })
      await expect(gateway1.call('c1', { method: 'dsh/workspaceList', params: { backend: 'cursor' } })).rejects.toMatchObject({ code: 'CURSOR_UPSTREAM_ERROR' })
    } finally {
      await gateway1.close()
    }

    // Simulated Host restart sharing storeDir
    const calls2: Array<{ method: string; params: unknown }> = []
    const client2 = makeMockClient('antigravity', calls2)
    const gateway2 = new AcpRemoteGateway(
      {
        enabled: true,
        backends: [{ id: 'antigravity', enabled: true, command: 'agy', args: ['acp'] }],
      },
      logger(),
      () => client2,
      [100],
      () => false,
      undefined,
      AcpWorkspaceStore.inDirectory(storeDir),
    )
    try {
      await gateway2.start()
      gateway2.createPeer({ connectionId: 'c2', peerDeviceId: 'p2' }, async () => undefined)
      const wsList = await gateway2.call('c2', { method: 'dsh/workspaceList', params: { backend: 'antigravity' } }) as Array<{ title?: string }>
      expect(wsList[0]?.title).toBe('Created Repo')
      await gateway2.call('c2', { method: 'session/load', params: { backend: 'antigravity', sessionId: 'sess-1' } })
      client2.emitPermission('req-perm-1', 'sess-1')
      await vi.waitFor(() => expect(client2.respond).toHaveBeenCalledWith('req-perm-1', { outcome: { outcome: 'selected', optionId: 'once' } }))

      // Fork before dsh/sessionList populates sessionCwds -> must still resolve cwd and register forked session.
      const forked = await gateway2.call('c2', { method: 'session/fork', params: { backend: 'antigravity', sessionId: 'sess-1' } })
      expect(forked).toEqual({ sessionId: 'sess-forked' })
      expect(await gateway2.call('c2', { method: 'dsh/sessionModes', params: { backend: 'antigravity', sessionId: 'sess-forked' } })).toMatchObject({ currentModeId: 'default' })
      expect(await gateway2.call('c2', { method: 'session/set_mode', params: { sessionId: 'sess-forked', modeId: 'default' } })).toEqual({ currentModeId: 'default' })
    } finally {
      await gateway2.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
