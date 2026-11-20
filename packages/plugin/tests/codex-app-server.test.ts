import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import {
  CODEX_THREAD_UNMATERIALIZED,
  CODEX_UNMATERIALIZED_THREAD_MESSAGE,
  CodexAppServerClient,
} from '../src/codex/app-server.js'
import type { SafeLogger } from '../src/logging.js'

const tempDirs: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('CodexAppServerClient', () => {
  it('distinguishes unsupported Goal reads from transient failures without exposing upstream details', async () => {
    await runScenarios([
      { name: 'disabled', method: 'thread/goal/get', error: { code: -32600, message: 'goals feature is disabled' }, expected: 'CODEX_GOALS_UNAVAILABLE' },
      { name: 'missing-method', method: 'thread/goal/get', error: { code: -32601, message: 'Method not found' }, expected: 'CODEX_GOALS_UNAVAILABLE' },
      { name: 'old-protocol', method: 'thread/goal/get', error: { code: -32600, message: 'unknown variant `thread/goal/get`, expected `initialize`' }, expected: 'CODEX_GOALS_UNAVAILABLE' },
      { name: 'ephemeral', method: 'thread/goal/get', error: { code: -32600, message: 'ephemeral thread does not support goals: private-thread' }, expected: 'CODEX_GOALS_UNAVAILABLE' },
      { name: 'database-failure', method: 'thread/goal/get', error: { code: -32603, message: 'sqlite state db unavailable: private-path' }, expected: 'CODEX_UPSTREAM_ERROR' },
      { name: 'other-method', method: 'thread/read', error: { code: -32601, message: 'Method not found' }, expected: 'CODEX_UPSTREAM_ERROR' },
    ].map(scenario => ({
      name: scenario.name,
      run: async () => {
        const fake = fakeProcess()
        fake.child.stdin.on('data', chunk => {
          for (const line of String(chunk).trim().split('\n')) {
            const message = JSON.parse(line)
            if (message.method === 'initialize') fake.stdout.write(`${JSON.stringify({ id: message.id, result: {} })}\n`)
            else if (message.method === scenario.method) fake.stdout.write(`${JSON.stringify({ id: message.id, error: scenario.error })}\n`)
          }
        })
        const client = new CodexAppServerClient('codex', logger(), () => fake.child)
        try {
          await client.start()
          const result = client.call(scenario.method, { threadId: 'private-thread' })
          await expect(result).rejects.toMatchObject({ code: scenario.expected })
          await expect(result).rejects.not.toThrow(/private-thread|private-path/)
        } finally { await client.close() }
      },
    })))
  })

  it('initializes once, correlates responses, and separates inbound events from requests', async () => {
    const fake = fakeProcess()
    const outbound: Array<Record<string, unknown>> = []
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line) as Record<string, unknown>
        outbound.push(message)
        if (message.method === 'initialize') {
          fake.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex' } })}\n`)
        }
      }
    })
    const client = new CodexAppServerClient('codex-custom', logger(), binary => {
      expect(binary).toBe('codex-custom')
      return fake.child
    })
    const inbound = vi.fn()
    client.onInbound(inbound)

    await client.start()

    expect(outbound.map(message => message.method)).toEqual(['initialize', 'initialized'])
    const pending = client.call('thread/list', {})
    await flush()
    const request = outbound.find(message => message.method === 'thread/list')!
    fake.stdout.write(`${JSON.stringify({ id: 999_999, result: { ignored: true } })}\n`)
    fake.stdout.write(`${JSON.stringify({ id: request.id, result: { data: [] } })}\n`)
    await expect(pending).resolves.toEqual({ data: [] })

    fake.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { threadId: 'thr_1' } })}\n`)
    fake.stdout.write(`${JSON.stringify({ id: 'approval-1', method: 'item/fileChange/requestApproval', params: { threadId: 'thr_1' } })}\n`)
    await flush()
    expect(inbound).toHaveBeenNthCalledWith(1, {
      kind: 'notification', method: 'turn/completed', params: { threadId: 'thr_1' },
    })
    expect(inbound).toHaveBeenNthCalledWith(2, {
      kind: 'request', id: 'approval-1', method: 'item/fileChange/requestApproval', params: { threadId: 'thr_1' },
    })

    await client.respond('approval-1', { decision: 'decline' })
    expect(outbound.at(-1)).toEqual({ id: 'approval-1', result: { decision: 'decline' } })
    await client.close()
    expect(fake.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('notifies the supervisor once when the child exits unexpectedly', async () => {
    const fake = fakeProcess()
    fake.child.stdin.on('data', chunk => {
      const message = JSON.parse(String(chunk).trim()) as Record<string, unknown>
      if (message.method === 'initialize') {
        fake.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex' } })}\n`)
      }
    })
    const client = new CodexAppServerClient('codex', logger(), () => fake.child)
    const unavailable = vi.fn()
    client.onUnavailable(unavailable)
    await client.start()

    fake.child.emit('exit', 9, null)
    fake.child.emit('exit', 9, null)
    await flush()

    expect(client.isReady()).toBe(false)
    expect(unavailable).toHaveBeenCalledOnce()
    expect(unavailable).toHaveBeenCalledWith('CODEX_APP_SERVER_EXITED')
    await client.close()
  })

  it('keeps active-writer upstream errors specific without exposing the thread id', async () => {
    const fake = fakeProcess()
    const outbound: Array<Record<string, unknown>> = []
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line) as Record<string, unknown>
        outbound.push(message)
        if (message.method === 'initialize') {
          fake.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex' } })}\n`)
        } else if (message.method === 'turn/start') {
          fake.stdout.write(`${JSON.stringify({
            id: message.id,
            error: { code: -32600, message: 'thread 01a05bd0-8d55-7e23-bc95-97fec98aa8f4 already has an active writer' },
          })}\n`)
        }
      }
    })
    const client = new CodexAppServerClient('codex', logger(), () => fake.child)
    await client.start()

    await expect(client.call('turn/start', { threadId: 'redacted' }))
      .rejects.toMatchObject({ message: 'Codex thread already has an active writer.' })
    await client.close()
  })

  it('keeps an unmaterialized new Thread in a dedicated empty-history error code', async () => {
    const fake = fakeProcess()
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line) as Record<string, unknown>
        if (message.method === 'initialize') {
          fake.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex' } })}\n`)
        } else if (message.method === 'thread/turns/list') {
          fake.stdout.write(`${JSON.stringify({
            id: message.id,
            error: {
              code: -32600,
              message: 'thread 01a05bd0-8d55-7e23-bc95-97fec98aa8f4 is not materialized yet; thread/turns/list is unavailable before first user message',
            },
          })}\n`)
        }
      }
    })
    const client = new CodexAppServerClient('codex', logger(), () => fake.child)
    await client.start()

    await expect(client.call('thread/turns/list', { threadId: 'redacted' })).rejects.toMatchObject({
      code: CODEX_THREAD_UNMATERIALIZED,
      message: CODEX_UNMATERIALIZED_THREAD_MESSAGE,
    })
    await client.close()
  })

  it('catches stdin pipe errors without crashing the host and notifies unavailable once', async () => {
    const fake = fakeProcess()
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line) as Record<string, unknown>
        if (message.method === 'initialize') {
          fake.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex' } })}\n`)
        }
      }
    })
    const client = new CodexAppServerClient('codex', logger(), () => fake.child)
    const unavailable = vi.fn()
    client.onUnavailable(unavailable)
    await client.start()

    const pending = client.call('thread/list', {})
    fake.child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    await expect(pending).rejects.toMatchObject({ code: 'CODEX_APP_SERVER_EXITED' })
    expect(client.isReady()).toBe(false)
    expect(unavailable).toHaveBeenCalledOnce()
    expect(unavailable).toHaveBeenCalledWith('CODEX_APP_SERVER_EXITED')
    await client.close()
  })

  it('escalates to SIGKILL when SIGTERM is ignored after init failure or protocol failure', async () => {
    vi.useFakeTimers()
    await runScenarios([
      {
        name: 'init-timeout',
        run: async () => {
          const fake = fakeProcess({ ignoreSigterm: true })
          const client = new CodexAppServerClient('codex', logger(), () => fake.child)
          const starting = client.start()
          const rejection = expect(starting).rejects.toMatchObject({ code: 'CODEX_REQUEST_TIMEOUT' })
          await vi.advanceTimersByTimeAsync(15_000)
          await rejection
          expect(fake.kill).toHaveBeenCalledWith('SIGTERM')

          let closedDone = false
          const closing = client.close().then(() => { closedDone = true })
          await vi.advanceTimersByTimeAsync(1_999)
          expect(closedDone).toBe(false)
          await vi.advanceTimersByTimeAsync(1)
          await closing
          expect(fake.kill).toHaveBeenCalledWith('SIGKILL')
          expect(closedDone).toBe(true)
        },
      },
      {
        name: 'protocol-failure',
        run: async () => {
          const fake = fakeProcess({ ignoreSigterm: true })
          fake.child.stdin.on('data', chunk => {
            const message = JSON.parse(String(chunk).trim()) as Record<string, unknown>
            if (message.method === 'initialize') {
              fake.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex' } })}\n`)
            }
          })
          const client = new CodexAppServerClient('codex', logger(), () => fake.child)
          await client.start()
          fake.stdout.write('not-json\n')
          await vi.advanceTimersByTimeAsync(0)
          expect(fake.kill).toHaveBeenCalledWith('SIGTERM')

          let closedDone = false
          const closing = client.close().then(() => { closedDone = true })
          await vi.advanceTimersByTimeAsync(2_000)
          await closing
          expect(fake.kill).toHaveBeenCalledWith('SIGKILL')
        },
      },
      {
        name: 'unspawned-enoent-does-not-wait-for-sigkill',
        run: async () => {
          const fake = fakeProcess({ pid: undefined })
          const client = new CodexAppServerClient('missing-codex', logger(), () => fake.child)
          const starting = client.start()
          const rejection = expect(starting).rejects.toMatchObject({ code: 'CODEX_BINARY_UNAVAILABLE' })
          queueMicrotask(() => fake.child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })))
          await rejection
          let closedDone = false
          const closing = client.close().then(() => { closedDone = true })
          await Promise.resolve()
          await closing
          expect(closedDone).toBe(true)
          expect(fake.kill).not.toHaveBeenCalledWith('SIGKILL')
        },
      },
    ])
  })

  it('stops processing remaining lines in the same stdout chunk after invalid JSON and reassembles split lines', async () => {
    const fake = fakeProcess()
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line) as Record<string, unknown>
        if (message.method === 'initialize') {
          fake.stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: 'codex' } })}\n`)
        }
      }
    })
    const client = new CodexAppServerClient('codex', logger(), () => fake.child)
    const inbound = vi.fn()
    client.onInbound(inbound)
    await client.start()

    const call = client.call('thread/list', {})
    await flush()
    const payload = JSON.stringify({ id: 2, result: { data: [{ id: 't1' }] } })
    const mid = Math.floor(payload.length / 2)
    fake.stdout.write(payload.slice(0, mid))
    fake.stdout.write(`${payload.slice(mid)}\n\n`)
    await expect(call).resolves.toEqual({ data: [{ id: 't1' }] })

    fake.stdout.write('bad-json\n{"method":"turn/completed","params":{"threadId":"thr_1"}}\n')
    await flush()
    expect(inbound).not.toHaveBeenCalled()
    expect(client.isReady()).toBe(false)
    await client.close()
  })

  it('turns synchronous spawn failures into CODEX_BINARY_UNAVAILABLE and executes Windows .cmd shims natively', async () => {
    const syncEinval = Object.assign(new Error('spawn codex.cmd EINVAL'), { code: 'EINVAL' })
    const throwingClient = new CodexAppServerClient('codex.cmd', logger(), () => { throw syncEinval })
    const unavailable = vi.fn()
    throwingClient.onUnavailable(unavailable)
    await expect(throwingClient.start()).rejects.toMatchObject({ code: 'CODEX_BINARY_UNAVAILABLE' })
    expect(unavailable).toHaveBeenCalledWith('CODEX_BINARY_UNAVAILABLE')
    await throwingClient.close()

    if (process.platform === 'win32') {
      const dir = await mkdtemp(join(tmpdir(), 'dsh-codex-cmd-'))
      tempDirs.push(dir)
      const pkgDir = join(dir, 'node_modules', '@openai', 'codex', 'bin')
      await mkdir(pkgDir, { recursive: true })
      const serverJs = join(pkgDir, 'codex.js')
      await writeFile(serverJs, [
        'const readline = require("node:readline");',
        'if (!process.argv.includes("app-server")) process.exit(2);',
        'const rl = readline.createInterface({ input: process.stdin });',
        'rl.on("line", line => {',
        '  const msg = JSON.parse(line);',
        '  if (msg.method === "initialize") process.stdout.write(JSON.stringify({ id: msg.id, result: { userAgent: "fake-codex" } }) + "\\n");',
        '  else if (msg.id !== undefined) process.stdout.write(JSON.stringify({ id: msg.id, result: { data: [] } }) + "\\n");',
        '});',
      ].join('\n'))
      const cmdShim = join(dir, 'codex.cmd')
      await writeFile(cmdShim, [
        '@ECHO off',
        'GOTO start',
        ':find_dp0',
        'SET dp0=%~dp0',
        'EXIT /b',
        ':start',
        'SETLOCAL',
        'CALL :find_dp0',
        'SET "_prog=node"',
        'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
      ].join('\r\n'))

      const realClient = new CodexAppServerClient(cmdShim, logger())
      await realClient.start()
      await expect(realClient.call('project/list', {})).resolves.toEqual({ data: [] })
      await realClient.close()
    }
  })
})

function fakeProcess(options: { ignoreSigterm?: boolean; pid?: number | undefined } = {}): {
  child: ChildProcessWithoutNullStreams
  stdout: PassThrough
  kill: ReturnType<typeof vi.fn>
} {
  const emitter = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const state = { killed: false, exitCode: null as number | null }
  const kill = vi.fn((signal?: NodeJS.Signals | number) => {
    state.killed = true
    if (options.ignoreSigterm && signal === 'SIGTERM') return true
    queueMicrotask(() => {
      state.exitCode = 0
      emitter.emit('exit', 0, typeof signal === 'string' ? signal : null)
    })
    return true
  })
  const child = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    pid: 'pid' in options ? options.pid : 123,
    kill,
  })
  Object.defineProperties(child, {
    killed: { get: () => state.killed },
    exitCode: { get: () => state.exitCode },
  })
  return { child: child as unknown as ChildProcessWithoutNullStreams, stdout, kill }
}

function logger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
}

async function flush(): Promise<void> { await new Promise(resolve => setTimeout(resolve, 0)) }
