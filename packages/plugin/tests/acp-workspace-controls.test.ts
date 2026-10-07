import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { AcpRemoteGateway } from '../src/acp/gateway.js'
import { AntigravityAcpClient } from '../src/acp/adapters/antigravity-process.js'
import { parseAgyModels } from '../src/acp/adapters/antigravity/models.js'
import { parseAcpCall } from '../src/acp/method-policy.js'
import type { SafeLogger } from '../src/logging.js'

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger

it('ACP tools enforce session authority, containment, terminal ownership and stream closure', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'acp-tools-'))
  const cwd = await realpath(temp)
  await writeFile(join(cwd, 'a.txt'), 'shared workspace')
  await symlink(tmpdir(), join(cwd, 'outside'))
  let enabled = true
  const writes: string[] = []
  const acp = { start: async () => {}, isReady: () => true, call: async () => ({ sessionId: 'native-1' }),
    respond: async () => {}, respondError: async () => {}, onInbound: () => () => {}, onUnavailable: () => () => {}, close: async () => {} }
  const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'antigravity', enabled: true, command: 'agy', args: [] }] },
    logger, () => acp, undefined, () => enabled, async () => ({ output: (async function* () {})(),
      write: data => { writes.push(data) }, resize: () => {}, terminate: () => {}, completed: new Promise(() => {}) }))
  const frames: Array<{ event: string; data: unknown }> = []
  try {
    await gateway.start()
    const peer = gateway.createPeer({ connectionId: 'peer-1', peerDeviceId: 'device-1' }, async (event, data) => { frames.push({ event, data }) })!
    const other = gateway.createPeer({ connectionId: 'peer-2', peerDeviceId: 'device-2' }, async () => {})!
    await peer.call({ method: 'session/new', params: { backend: 'antigravity', cwd } })
    const call = (endpoint: string, args: Record<string, unknown>) => peer.call({ method: 'dsh/toolCall', params: { backend: 'antigravity', sessionId: 'native-1', endpoint, args } })
    await expect(call('workspaceFiles/list', { workspaceFileScopeId: 'acp:native-1', path: '.' })).resolves.toMatchObject({ path: '.', entries: expect.arrayContaining([expect.objectContaining({ name: 'a.txt' })]) })
    for (const path of ['..', 'outside']) await expect(call('workspaceFiles/list', { workspaceFileScopeId: 'acp:native-1', path })).rejects.toMatchObject({ code: 'ACP_WORKSPACE_PATH_DENIED' })
    await expect(call('workspaceFiles/list', { workspaceFileScopeId: 'acp:other' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(other.call({ method: 'dsh/toolCall', params: { backend: 'antigravity', sessionId: 'native-1', endpoint: 'terminal/list', args: { sessionId: 'acp:native-1' } } })).rejects.toMatchObject({ code: 'CURSOR_SESSION_OWNED' })
    await peer.openStream({ streamId: 'files-1', sessionId: 'native-1', tool: { backend: 'antigravity', endpoint: 'workspaceFiles/changes', args: { workspaceFileScopeId: 'acp:native-1' } } })
    await writeFile(join(cwd, 'a.txt'), 'changed')
    await vi.waitFor(() => expect(frames).toContainEqual({ event: 'agent.acp.frame', data: expect.objectContaining({ streamId: 'files-1', frame: { method: 'dsh/workspaceTool', params: { value: expect.objectContaining({ kind: 'change' }) } } }) }))
    peer.closeStream({ streamId: 'files-1' })
    const termArgs = { agentId: 'acp:native-1', id: 'term-1', attachmentId: 'attachment-1' }
    await call('terminal/create', { agentId: 'acp:native-1', request: { id: 'term-1', cols: 80, rows: 24 } })
    await peer.openStream({ streamId: 'tool-1', sessionId: 'native-1', tool: { backend: 'antigravity', endpoint: 'terminal/follow', args: termArgs } })
    await vi.waitFor(() => expect(frames).toContainEqual({ event: 'agent.acp.frame', data: expect.objectContaining({ streamId: 'tool-1', frame: expect.objectContaining({ method: 'dsh/workspaceTool' }) }) }))
    await expect(call('terminal/write', { ...termArgs, attachmentId: 'wrong', data: 'must not write' })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await call('terminal/write', { ...termArgs, data: 'echo shared\n' })
    expect(writes).toEqual(['echo shared\n'])
    peer.closeStream({ streamId: 'tool-1' })
    enabled = false
    await expect(call('terminal/environment', { agentId: 'acp:native-1' })).rejects.toMatchObject({ code: 'TERMINAL_DISABLED' })
    await expect(call('workspaceFiles/list', { workspaceFileScopeId: 'acp:native-1' })).resolves.toBeTruthy()
    for (const endpoint of ['workspaceFiles/write', 'terminal/exec']) expect(() => parseAcpCall('dsh/toolCall', { sessionId: 'native-1', backend: 'antigravity', endpoint, args: {} })).toThrow()
  } finally { await gateway.close(); await rm(temp, { recursive: true, force: true }) }
})

it('AGY model acknowledgement follows CLI resume with validated live model and effort flags', async () => {
  const children: Array<{ child: ChildProcessWithoutNullStreams; args: string[]; cwd?: string }> = []
  let next = 0
  const catalog = parseAgyModels('gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\nclaude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)\n')
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
  }, { cwd: tmpdir(), readModels: async () => catalog })
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
  } finally { await client.close() }
})
