import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { AcpRemoteGateway } from '../src/acp/gateway.js'
import { AntigravityAcpClient } from '../src/acp/adapters/antigravity-process.js'
import { cachedAgyModels, parseAgyModels } from '../src/acp/adapters/antigravity/models.js'
import { parseAcpCall } from '../src/acp/method-policy.js'
import type { SafeLogger } from '../src/logging.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import type { RemoteTerminalSpawner } from '../src/remote-terminal-provider.js'

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger

it('ACP reconfiguration stops changed backends despite failed cleanup and retries identical settings', async () => {
  await runScenarios(['terminal', 'backend'].flatMap(failure => ['command', 'disable'].map(action => ({ name: `${action}: ${failure} cleanup fails`, run: async () => {
    const temp = await mkdtemp(join(tmpdir(), 'acp-reconfigure-'))
    const cwd = await realpath(temp)
    const makeClient = () => ({ start: vi.fn(async () => {}), isReady: () => true,
      call: vi.fn(async () => ({ sessionId: 'native-1' })), respond: async () => {}, respondError: async () => {},
      onInbound: () => () => {}, onUnavailable: () => () => {}, close: vi.fn(async () => {}) })
    const old = makeClient(), replacement = makeClient(), other = makeClient()
    const factory = vi.fn((_binary, _logger, backend) => backend.id === 'antigravity' ? other : backend.command === 'old-cursor' ? old : replacement)
    let cleanupFails = true
    const terminalStop = vi.fn(async () => {
      if (failure === 'terminal' && cleanupFails) throw new Error('PTY cleanup unavailable')
    })
    old.close.mockImplementation(async () => {
      if (failure === 'backend' && cleanupFails) throw new Error('ACP cleanup unavailable')
    })
    const spawn: RemoteTerminalSpawner = Object.assign(async () => ({ output: (async function* () {})(),
      write: async () => {}, resize: async () => {}, terminate: terminalStop, completed: new Promise<{ exitCode: number | null }>(() => {}) }),
      { shells: async () => [{ path: '/verified/sh', args: ['-i'], name: 'sh' }] })
    const initial = { enabled: true, backends: [
      { id: 'cursor', enabled: true, command: 'old-cursor', args: ['acp'] },
      { id: 'antigravity', enabled: true, command: 'agy', args: [] },
    ] }
    const updated = { ...initial, backends: initial.backends.map(backend => backend.id === 'cursor'
      ? { ...backend, command: action === 'command' ? 'new-cursor' : backend.command, enabled: action !== 'disable' } : backend) }
    const gateway = new AcpRemoteGateway(initial, logger, factory, undefined, () => true, spawn)
    try {
      await gateway.start()
      const peer = gateway.createPeer({ connectionId: 'peer', peerDeviceId: 'device' }, async () => {})!
      await peer.call({ method: 'session/new', params: { backend: 'cursor', cwd } })
      await peer.call({ method: 'dsh/toolCall', params: { backend: 'cursor', sessionId: 'native-1',
        endpoint: 'terminal/create', args: { agentId: 'cursor:native-1', request: { id: 'term' } } } })
      await expect(gateway.reconfigure(updated)).rejects.toMatchObject({ code: failure === 'terminal' ? 'TERMINAL_CLEANUP_FAILED' : 'ACP_RECONFIGURE_FAILED' })
      expect(old.close).toHaveBeenCalledTimes(1)
      expect(other.close).not.toHaveBeenCalled()
      expect(gateway.availableBackends()).toEqual(['antigravity'])
      await expect(peer.call({ method: 'initialize', params: { backend: 'cursor' } })).rejects.toMatchObject({ code: 'CURSOR_UNAVAILABLE' })
      await expect(peer.call({ method: 'initialize', params: { backend: 'antigravity' } })).resolves.toMatchObject({ backend: 'antigravity' })
      // Startup while cleanup remains pending cannot resurrect the old backend
      // or launch its replacement ahead of successful process cleanup.
      await gateway.start()
      expect(factory).toHaveBeenCalledTimes(2)
      cleanupFails = false
      await gateway.reconfigure(updated)
      expect(terminalStop).toHaveBeenCalledTimes(failure === 'terminal' ? 2 : 1)
      expect(old.close).toHaveBeenCalledTimes(failure === 'backend' ? 2 : 1)
      expect(other.close).not.toHaveBeenCalled()
      expect(gateway.availableBackends().sort()).toEqual(action === 'command' ? ['antigravity', 'cursor'] : ['antigravity'])
      expect(factory).toHaveBeenCalledTimes(action === 'command' ? 3 : 2)
      await gateway.reconfigure(updated)
      expect(old.close).toHaveBeenCalledTimes(failure === 'backend' ? 2 : 1)
      expect(factory).toHaveBeenCalledTimes(action === 'command' ? 3 : 2)
    } finally {
      cleanupFails = false
      try { await gateway.close() } finally { await rm(temp, { recursive: true, force: true }) }
    }
  } }))))
})

it('ACP tools enforce session authority, containment, terminal ownership and stream closure', async () => {
  await runScenarios((['cursor', 'antigravity', 'pi', 'opencode', 'claude', 'hermes'] as const).map(backend => ({ name: backend, run: async () => {
    const prefix = backend === 'antigravity' ? 'acp' : backend
    const scope = `${prefix}:native-1`
    const otherScope = `${prefix}:other`
    const wrongBackendScope = `${backend === 'cursor' ? 'opencode' : 'cursor'}:native-1`
    const temp = await mkdtemp(join(tmpdir(), 'acp-tools-'))
    const cwd = await realpath(temp)
    await writeFile(join(cwd, 'a.txt'), 'shared workspace')
    await symlink(tmpdir(), join(cwd, 'outside'))
    let enabled = true
    const writes: string[] = []
    const acp = { start: async () => {}, isReady: () => true, call: async () => ({ sessionId: 'native-1' }),
      respond: async () => {}, respondError: async () => {}, onInbound: () => () => {}, onUnavailable: () => () => {}, close: async () => {} }
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: backend, enabled: true, command: 'agy', args: [] }] },
      logger, () => acp, undefined, () => enabled, async () => ({ output: (async function* () {})(),
        write: data => { writes.push(data) }, resize: () => {}, terminate: () => {}, completed: new Promise(() => {}) }))
    const frames: Array<{ event: string; data: unknown }> = []
    try {
      await gateway.start()
      const peer = gateway.createPeer({ connectionId: 'peer-1', peerDeviceId: 'device-1' }, async (event, data) => { frames.push({ event, data }) })!
      const other = gateway.createPeer({ connectionId: 'peer-2', peerDeviceId: 'device-2' }, async () => {})!
      await peer.call({ method: 'session/new', params: { backend, cwd } })
      const call = (endpoint: string, args: Record<string, unknown>) => peer.call({ method: 'dsh/toolCall', params: { backend, sessionId: 'native-1', endpoint, args } })
      await expect(call('workspaceFiles/list', { workspaceFileScopeId: scope, path: '.' })).resolves.toMatchObject({ path: '.', entries: expect.arrayContaining([expect.objectContaining({ name: 'a.txt' })]) })
      for (const path of ['..', 'outside']) await expect(call('workspaceFiles/list', { workspaceFileScopeId: scope, path })).rejects.toMatchObject({ code: 'ACP_WORKSPACE_PATH_DENIED' })
      await expect(call('workspaceFiles/list', { workspaceFileScopeId: otherScope })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
      for (const args of [{}, { workspaceFileScopeId: wrongBackendScope }, { workspaceFileScopeId: scope, agentId: otherScope }]) {
        await expect(call('workspaceFiles/list', args)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
      }
      await expect(peer.openStream({ streamId: 'wrong-scope', sessionId: 'native-1', tool: { backend, endpoint: 'workspaceFiles/changes', args: { workspaceFileScopeId: wrongBackendScope } } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
      await expect(other.call({ method: 'dsh/toolCall', params: { backend, sessionId: 'native-1', endpoint: 'terminal/list', args: { sessionId: scope } } })).rejects.toMatchObject({ code: 'CURSOR_SESSION_OWNED' })
      await peer.openStream({ streamId: 'files-1', sessionId: 'native-1', tool: { backend, endpoint: 'workspaceFiles/changes', args: { workspaceFileScopeId: scope } } })
      await writeFile(join(cwd, 'a.txt'), 'changed')
      await vi.waitFor(() => expect(frames).toContainEqual({ event: 'agent.acp.frame', data: expect.objectContaining({ streamId: 'files-1', frame: { method: 'dsh/workspaceTool', params: { value: expect.objectContaining({ kind: 'change' }) } } }) }))
      peer.closeStream({ streamId: 'files-1' })
      const termArgs = { agentId: scope, id: 'term-1', attachmentId: 'attachment-1' }
      await call('terminal/create', { agentId: scope, request: { id: 'term-1', cols: 80, rows: 24 } })
      await peer.openStream({ streamId: 'tool-1', sessionId: 'native-1', tool: { backend, endpoint: 'terminal/follow', args: termArgs } })
      await vi.waitFor(() => expect(frames).toContainEqual({ event: 'agent.acp.frame', data: expect.objectContaining({ streamId: 'tool-1', frame: expect.objectContaining({ method: 'dsh/workspaceTool' }) }) }))
      await expect(call('terminal/write', { ...termArgs, attachmentId: 'wrong', data: 'must not write' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
      await call('terminal/write', { ...termArgs, data: 'echo shared\n' })
      expect(writes).toEqual(['echo shared\n'])
      peer.closeStream({ streamId: 'tool-1' })
      enabled = false
      await expect(call('terminal/environment', { agentId: scope })).rejects.toMatchObject({ code: 'TERMINAL_DISABLED' })
      await expect(call('workspaceFiles/list', { workspaceFileScopeId: scope })).resolves.toBeTruthy()
      for (const endpoint of ['workspaceFiles/write', 'terminal/exec']) expect(() => parseAcpCall('dsh/toolCall', { sessionId: 'native-1', backend, endpoint, args: {} })).toThrow()
    } finally { await gateway.close(); await rm(temp, { recursive: true, force: true }) }
  } })))
})

it('AGY model acknowledgement follows CLI resume with validated live model and effort flags', async () => {
  const children: Array<{ child: ChildProcessWithoutNullStreams; args: string[]; cwd?: string }> = []
  let next = 0
  const catalog = parseAgyModels('gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n')
  const readModels = vi.fn(async () => catalog)
  const client = new AntigravityAcpClient('agy', logger, (_bin, args, cwd) => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
    child.kill = vi.fn(() => { Object.assign(child, { killed: true }); child.emit('exit', 0, null); return true })
    Object.assign(child, { exitCode: null, killed: false })
    const id = args.includes('--conversation') ? args[args.indexOf('--conversation') + 1] : `conv-${++next}`
    children.push({ child, args, cwd })
    queueMicrotask(() => (child.stdout as PassThrough).write(`${JSON.stringify({ event: 'init', conversation_id: id })}\n`))
    child.stdin.on('data', () => (child.stdout as PassThrough).write(`${JSON.stringify({ event: 'result', result: { status: 'SUCCESS', conversation_id: id } })}\n`))
    return child
  }, { cwd: tmpdir(), readModels })
  try {
    await client.start()
    const created = await client.call('session/new', { cwd: tmpdir() }) as { sessionId: string }
    await expect(client.call('dsh/selectModel', { ...created, model: 'gemini-3.8-flash', reasoningEffort: 'wrong' })).rejects.toThrow('unavailable')
    const result = await client.call('dsh/selectModel', { ...created, model: 'gemini-3.8-flash', reasoningEffort: 'low' })
    expect(result).toMatchObject({ selected: { model: 'gemini-3.8-flash', reasoningEffort: 'low' } })
    const worker = children.find(item => item.args.includes('--model'))!
    expect(worker.args).toEqual(expect.arrayContaining(['--model', 'gemini-3.8-flash-low', '--effort', 'low', '--conversation', created.sessionId]))
    expect(worker.cwd).toBe(tmpdir())
    await expect(client.call('dsh/sessionModels', created)).resolves.toMatchObject({ current: { model: 'gemini-3.8-flash', reasoningEffort: 'low' }, groups: catalog.groups })
    await client.call('session/prompt', { ...created, prompt: [{ type: 'text', text: 'hello' }] })
    const second = await client.call('dsh/selectModel', { ...created, model: 'claude-opus-4-6', reasoningEffort: 'thinking' })
    expect(second).toMatchObject({ selected: { model: 'claude-opus-4-6', reasoningEffort: 'thinking' } })
    const thinking = children.at(-1)!.args
    expect(thinking).toEqual(expect.arrayContaining(['--model', 'claude-opus-4-6-thinking']))
    expect(thinking).not.toContain('--effort')
    const starts = children.length
    await client.call('dsh/selectModel', { ...created, model: 'claude-opus-4-6', reasoningEffort: 'thinking' })
    expect(children).toHaveLength(starts)
    // A Host-discovered session resumes once, directly in the target model.
    await client.call('dsh/selectModel', { sessionId: 'discovered', cwd: tmpdir(), model: 'gemini-3.8-flash', reasoningEffort: 'low' })
    expect(children).toHaveLength(starts + 1)
    expect(children.at(-1)!.args).toEqual(expect.arrayContaining(['--conversation', 'discovered', '--model', 'gemini-3.8-flash-low']))
    expect(readModels).toHaveBeenCalledTimes(1)
  } finally { await client.close() }
})

it('AGY model catalog coalesces concurrent reads and retries failed discovery', async () => {
  const catalog = parseAgyModels('live-model\tLive model\n')
  let complete!: (value: typeof catalog) => void
  const load = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const read = cachedAgyModels(load)
  await expect(read()).rejects.toThrow('Unavailable')
  const first = read()
  const second = read()
  expect(first).toBe(second)
  complete(catalog)
  expect(await first).toBe(catalog)
  expect(await read()).toBe(catalog)
  expect(load).toHaveBeenCalledTimes(2)
})
