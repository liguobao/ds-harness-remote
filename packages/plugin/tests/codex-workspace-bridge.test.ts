import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CodexWorkspaceBridge, subprocessTerminalSpawner, type RemoteTerminalProcess, type RemoteTerminalSpawner } from '../src/codex-workspace-bridge.js'

const signal = new AbortController().signal

/** Pull frames as the Host publishes them, so ordering is observable. */
class FakeOutput implements AsyncIterable<string> {
  private values: string[] = []
  private waiters: Array<(value: IteratorResult<string>) => void> = []
  private ends: Array<() => void> = []
  private ended = false
  push(value: string): void {
    const waiter = this.waiters.shift()
    if (waiter) waiter({ done: false, value })
    else this.values.push(value)
  }
  onEnd(listener: () => void): void {
    if (this.ended) listener()
    else this.ends.push(listener)
  }
  end(): void {
    this.ended = true
    while (this.waiters.length) this.waiters.shift()!({ done: true, value: undefined as never })
    for (const listener of this.ends) listener()
    this.ends = []
  }
  next(): Promise<IteratorResult<string>> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.ended) return Promise.resolve({ done: true, value: undefined as never })
    return new Promise(resolve => this.waiters.push(resolve))
  }
  [Symbol.asyncIterator](): AsyncIterator<string> { return this }
}

function fakeSpawner() {
  const writes: string[] = []
  const outputs: FakeOutput[] = []
  const spawn: RemoteTerminalSpawner = async (): Promise<RemoteTerminalProcess> => {
    const output = new FakeOutput()
    outputs.push(output)
    // A real process reports its exit when the output stream closes.
    const completed = new Promise<{ exitCode: number | null }>(resolve => { output.onEnd(() => resolve({ exitCode: 0 })) })
    return {
      output,
      write: (data: string) => { writes.push(data) },
      resize: () => undefined,
      terminate: () => { output.end() },
      completed,
    }
  }
  return {
    spawn,
    writes,
    emit: (data: string) => outputs.at(-1)?.push(data),
    latest: () => outputs.at(-1),
  }
}

async function frame(stream: AsyncIterable<unknown> | undefined): Promise<Record<string, unknown>> {
  if (stream === undefined) throw new Error('stream was not opened')
  const next = await stream[Symbol.asyncIterator]().next()
  return next.value as Record<string, unknown>
}

describe('CodeX workspace and terminal bridge', () => {
  it('maps file calls to each thread cwd and rejects traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-'))
    const other = await mkdtemp(join(tmpdir(), 'dsh-codex-other-'))
    await writeFile(join(root, 'hello.txt'), 'hello')
    await writeFile(join(other, 'secret.txt'), 'secret')
    const resolvedRoot = await realpath(root)
    const bridge = new CodexWorkspaceBridge(async thread => thread === 'one' ? root : other, () => true)
    await expect(bridge.call('workspaceFiles/list', { args: { workspaceFileScopeId: 'codex:one', path: '.' } }, signal)).resolves.toMatchObject({ ok: true, value: { entries: [{ name: 'hello.txt' }] } })
    await expect(bridge.call('workspaceFiles/read', { args: { workspaceFileScopeId: 'codex:one', path: 'hello.txt', range: { offset: 0, limit: 5 } } }, signal)).resolves.toMatchObject({ ok: true, value: { text: 'hello' } })
    await expect(bridge.call('workspaceFiles/stat', { args: { workspaceFileScopeId: 'codex:one', path: 'hello.txt' } }, signal)).resolves.toMatchObject({ ok: true, value: { absolutePath: join(resolvedRoot, 'hello.txt'), version: expect.any(String), bytes: 5 } })
    await expect(bridge.call('workspaceFiles/readBytes', { args: { workspaceFileScopeId: 'codex:one', path: 'hello.txt', range: { offset: 1, length: 3 } } }, signal)).resolves.toMatchObject({ ok: true, value: { absolutePath: join(resolvedRoot, 'hello.txt'), version: expect.any(String), bytes: 5, offset: 1, data: 'ZWxs', eof: false } })
    await expect(bridge.call('workspaceFiles/readBytes', { args: { workspaceFileScopeId: 'codex:one', path: '../secret.txt' } }, signal)).rejects.toMatchObject({ code: 'CODEX_WORKSPACE_PATH_DENIED' })
    await bridge.closeAll(); await rm(root, { recursive: true, force: true }); await rm(other, { recursive: true, force: true })
  })

  it('returns stable errors for invalid or cwd-less threads', async () => {
    const bridge = new CodexWorkspaceBridge(async thread => thread === 'missing' ? undefined : '/does/not/exist', () => true)
    await expect(bridge.call('workspaceFiles/list', { args: { workspaceFileScopeId: 'codex:missing', path: '.' } }, signal)).rejects.toMatchObject({ code: 'CODEX_WORKSPACE_UNAVAILABLE' })
    await expect(bridge.call('workspaceFiles/list', { args: { workspaceFileScopeId: 'codex:', path: '.' } }, signal)).rejects.toMatchObject({ code: 'CODEX_SESSION_INVALID' })
    await bridge.closeAll()
  })

  it('answers the official terminal environment, shells and info shapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-'))
    const resolved = await realpath(root)
    const bridge = new CodexWorkspaceBridge(async () => root, () => true, undefined, fakeSpawner().spawn)
    const environment = await bridge.call('terminal/environment', { args: { agentId: 'codex:one' } }, signal)
    expect(environment).toMatchObject({ ok: true, value: { cwd: resolved, maxInputBytes: expect.any(Number), maxCols: expect.any(Number), maxRows: expect.any(Number), scrollback: expect.any(Number) } })
    const shells = await bridge.call('terminal/shells', { args: { agentId: 'codex:one' } }, signal)
    expect(shells?.ok && shells.value).toEqual([{ path: expect.any(String), args: expect.any(Array), name: expect.any(String) }])
    const created = await bridge.call('terminal/create', { args: { agentId: 'codex:one', request: { id: 't1', cols: 80, rows: 24 } } }, signal)
    expect(created).toMatchObject({
      ok: true,
      value: {
        id: 't1', title: expect.any(String), cwd: resolved, cols: 80, rows: 24, state: 'running', exitCode: null,
        shell: { path: expect.any(String), args: expect.any(Array), name: expect.any(String) },
      },
    })
    expect(created?.ok ? (created.value as Record<string, unknown>).controllerId : undefined).toBeUndefined()
    await bridge.closeAll(); await rm(root, { recursive: true, force: true })
  })

  it('keeps terminal contexts isolated per CodeX thread and returns void mutations', async () => {
    const one = await mkdtemp(join(tmpdir(), 'dsh-codex-one-'))
    const two = await mkdtemp(join(tmpdir(), 'dsh-codex-two-'))
    const provider = fakeSpawner()
    const bridge = new CodexWorkspaceBridge(async thread => thread === 'one' ? one : two, () => true, undefined, provider.spawn)
    await bridge.call('terminal/create', { args: { agentId: 'codex:one', request: { id: 't1', cols: 80, rows: 24 } } }, signal)
    await expect(bridge.call('terminal/list', { args: { sessionId: 'codex:two' } }, signal)).resolves.toMatchObject({ ok: true, value: [] })
    await expect(bridge.call('terminal/write', { args: { agentId: 'codex:two', id: 't1', attachmentId: 'a1', data: 'x' } }, signal)).rejects.toMatchObject({ code: 'CODEX_TERMINAL_NOT_FOUND' })
    // Mutations resolve to void, and the stored title still changes.
    await expect(bridge.call('terminal/rename', { args: { agentId: 'codex:one', id: 't1', title: 'renamed' } }, signal)).resolves.toEqual({ ok: true })
    await expect(bridge.call('terminal/resize', { args: { agentId: 'codex:one', id: 't1', attachmentId: 'a1', cols: 100, rows: 30 } }, signal)).resolves.toEqual({ ok: true })
    await expect(bridge.call('terminal/write', { args: { agentId: 'codex:one', id: 't1', attachmentId: 'a1', data: 'ls\n' } }, signal)).resolves.toEqual({ ok: true })
    expect(provider.writes).toEqual(['ls\n'])
    await expect(bridge.call('terminal/list', { args: { sessionId: 'codex:one' } }, signal)).resolves.toMatchObject({ ok: true, value: [{ id: 't1', title: 'renamed', cols: 100, rows: 30 }] })
    await expect(bridge.call('terminal/close', { args: { agentId: 'codex:one', id: 't1' } }, signal)).resolves.toEqual({ ok: true })
    await expect(bridge.call('terminal/list', { args: { sessionId: 'codex:one' } }, signal)).resolves.toMatchObject({ ok: true, value: [] })
    await bridge.closeAll(); await rm(one, { recursive: true, force: true }); await rm(two, { recursive: true, force: true })
  })

  it('acknowledges retention, then replays a snapshot and ordered output to the new controller', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-'))
    const provider = fakeSpawner()
    const bridge = new CodexWorkspaceBridge(async () => root, () => true, undefined, provider.spawn)
    await bridge.call('terminal/create', { args: { agentId: 'codex:one', request: { id: 't1', cols: 80, rows: 24 } } }, signal)

    const retention = await bridge.open('terminal/retain', { args: { sessionId: 'codex:one', id: 't1' } }, signal)
    await expect(frame(retention)).resolves.toEqual({ type: 'retained' })

    const first = await bridge.open('terminal/follow', { args: { agentId: 'codex:one', id: 't1', attachmentId: 'a1' } }, signal)
    const snapshot = await frame(first)
    expect(snapshot).toMatchObject({ type: 'snapshot', sequence: 0, screen: '', info: { id: 't1', controllerId: 'a1', state: 'running' } })

    provider.emit('one')
    await expect(frame(first)).resolves.toEqual({ type: 'output', sequence: 1, data: 'one' })
    provider.emit('two')
    await expect(frame(first)).resolves.toEqual({ type: 'output', sequence: 2, data: 'two' })

    // A second attachment takes input ownership and recovers from the journal.
    const second = await bridge.open('terminal/follow', { args: { agentId: 'codex:one', id: 't1', attachmentId: 'a2' } }, signal)
    await expect(frame(second)).resolves.toMatchObject({ type: 'snapshot', sequence: 2, screen: 'onetwo', info: { controllerId: 'a2' } })
    await expect(frame(first)).resolves.toMatchObject({ type: 'state', info: { controllerId: 'a2' } })

    await bridge.closeAll(); await rm(root, { recursive: true, force: true })
  })

  it('reports the exit state once the process ends', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-'))
    const provider = fakeSpawner()
    const bridge = new CodexWorkspaceBridge(async () => root, () => true, undefined, provider.spawn)
    await bridge.call('terminal/create', { args: { agentId: 'codex:one', request: { id: 't1', cols: 80, rows: 24 } } }, signal)
    const stream = await bridge.open('terminal/follow', { args: { agentId: 'codex:one', id: 't1', attachmentId: 'a1' } }, signal)
    await frame(stream)
    provider.latest()?.end()
    await expect(frame(stream)).resolves.toMatchObject({ type: 'state', info: { state: 'exited', exitCode: 0 } })
    await bridge.closeAll(); await rm(root, { recursive: true, force: true })
  })

  it('drives a Host subprocess terminal through the PTY adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-codex-pty-'))
    const spawns: Record<string, unknown>[] = []
    const writes: string[] = []
    const resizes: number[][] = []
    const output = new PassThrough()
    let settle: (value: { exitCode: number | null }) => void = () => undefined
    const done = new Promise<{ exitCode: number | null }>(resolve => { settle = resolve })
    const handle = {
      output,
      write: async (data: string) => { writes.push(data) },
      resize: async (cols: number, rows: number) => { resizes.push([cols, rows]) },
      terminate: async () => { output.end(); settle({ exitCode: 0 }) },
      done,
    }
    const bridge = new CodexWorkspaceBridge(async () => root, () => true, undefined,
      subprocessTerminalSpawner({ spawnTerminal: async spec => { spawns.push(spec); return handle } }))

    await expect(bridge.call('terminal/create', { args: { agentId: 'codex:one', request: { id: 't1', cols: 90, rows: 30 } } }, signal))
      .resolves.toMatchObject({ ok: true, value: { id: 't1', cols: 90, rows: 30 } })
    expect(spawns).toEqual([{
      argv: [expect.any(String)],
      cwd: await realpath(root),
      cols: 90,
      rows: 30,
      terminalType: 'xterm-256color',
      env: { DSH_SESSION_ID: 'codex:one' },
    }])

    const stream = await bridge.open('terminal/follow', { args: { agentId: 'codex:one', id: 't1', attachmentId: 'a1' } }, signal)
    await expect(frame(stream)).resolves.toMatchObject({ type: 'snapshot', sequence: 0, info: { controllerId: 'a1' } })
    output.write('ready\n')
    await expect(frame(stream)).resolves.toEqual({ type: 'output', sequence: 1, data: 'ready\n' })

    await bridge.call('terminal/write', { args: { agentId: 'codex:one', id: 't1', attachmentId: 'a1', data: 'ls\n' } }, signal)
    await bridge.call('terminal/resize', { args: { agentId: 'codex:one', id: 't1', attachmentId: 'a1', cols: 100, rows: 40 } }, signal)
    expect(writes).toEqual(['ls\n'])
    expect(resizes).toEqual([[100, 40]])
    await bridge.call('terminal/close', { args: { agentId: 'codex:one', id: 't1' } }, signal)
    await expect(frame(stream)).resolves.toMatchObject({ type: 'state', info: { state: 'exited' } })
    await bridge.closeAll(); await rm(root, { recursive: true, force: true })
  })
})
