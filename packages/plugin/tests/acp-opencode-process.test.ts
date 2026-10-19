import { EventEmitter } from 'node:events'
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OpencodeNativeApi } from '../src/acp/adapters/opencode-native-api.js'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { OpencodeAcpClient, OpencodeAcpError } from '../src/acp/adapters/opencode-process.js'
import type { SafeLogger } from '../src/logging.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

describe('OpencodeAcpClient', () => {
  it('negotiates native-listener and stdio-only CLIs without breaking ACP or weakening the private listener', async () => {
    await runScenarios(['legacy', 'stdio'].map(mode => ({ name: mode, run: async () => {
      const cwd = await realpath(await mkdtemp(join(tmpdir(), 'opencode CLI ')))
      const client = new OpencodeAcpClient(process.execPath, logger(), undefined, {
        cwd, args: [fileURLToPath(new URL('./fixtures/opencode-cli.mjs', import.meta.url)), 'acp', mode,
          '--hostname', '0.0.0.0', '--port=4096', '--mdns', 'true', '--no-mdns=false', '--cwd', cwd],
      })
      try {
        await Promise.all([client.start(), client.start()])
        expect(client.isReady()).toBe(true)
        await expect(client.call('session/list', {})).resolves.toMatchObject({ sessions: [{ sessionId: 'saved', cwd }] })
        if (mode === 'legacy') {
          await client.archiveSession('saved', cwd)
          await expect(client.call('session/list', {})).resolves.toMatchObject({ sessions: [{ sessionId: 'saved', archived: true }] })
          await expect(client.call('session/prompt', { sessionId: 'saved', prompt: [] })).rejects.toMatchObject({ code: 'ACP_SESSION_ARCHIVED' })
        } else {
          await expect(client.archiveSession('saved', cwd)).rejects.toMatchObject({ code: 'OPENCODE_ARCHIVE_UNAVAILABLE' })
          await expect(client.call('session/load', { sessionId: 'saved', cwd, mcpServers: [] })).resolves.toMatchObject({ sessionId: 'saved' })
          await expect(client.call('session/prompt', { sessionId: 'saved', prompt: [] })).resolves.toMatchObject({ stopReason: 'end_turn' })
          await expect(client.history('saved', cwd)).resolves.toEqual([])
        }
      } finally { await client.close(); await rm(cwd, { recursive: true, force: true }) }
    } })))
  })

  it('fails closed on uncertain CLI options and cancels probes without a late ACP launch', async () => {
    await runScenarios(['probe-failure', 'probe-partial', 'probe-invalid', 'probe-overflow', 'probe-close', 'missing binary'].map(mode => ({ name: mode, run: async () => {
      const cwd = await realpath(await mkdtemp(join(tmpdir(), 'opencode probe ')))
      const client = new OpencodeAcpClient(mode === 'missing binary' ? join(cwd, 'missing') : process.execPath, logger(), undefined, {
        cwd, args: [fileURLToPath(new URL('./fixtures/opencode-cli.mjs', import.meta.url)), 'acp', mode],
      })
      // Attach the rejection handler before closing a probe or spawning a missing binary.
      const starting = client.start().then(() => undefined, error => error)
      try {
        if (mode === 'probe-close') {
          await vi.waitFor(async () => { await access(join(cwd, 'probe-pid')) })
          await client.close()
          const pid = Number(await readFile(join(cwd, 'probe-pid'), 'utf8'))
          await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow())
        }
        const error = await starting
        expect(error).toMatchObject({ code: mode === 'probe-close' ? 'OPENCODE_CLOSED' : mode === 'missing binary' ? 'OPENCODE_BINARY_UNAVAILABLE' : 'OPENCODE_CLI_PROBE_FAILED' })
        expect(String(error)).not.toContain('private CLI configuration')
        expect(client.isReady()).toBe(false)
        await expect(access(join(cwd, 'acp-started'))).rejects.toThrow()
      } finally { await client.close(); await rm(cwd, { recursive: true, force: true }) }
    } })))
  })

  it('bounds isolated history readers and stops them with the parent during startup or load', async () => {
    await runScenarios(['history', 'close during initialize', 'close during load', 'overflow'].map(scenario => ({ name: scenario, run: async () => {
      const fake = fakeProcess()
      const outbound: Array<{ method: string; id: number }> = []
      const respond = (id: number, result: unknown) => fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
      fake.child.stdin.on('data', chunk => {
        for (const line of String(chunk).trim().split('\n')) {
          const message = JSON.parse(line)
          outbound.push(message)
          if (message.method === 'initialize' && scenario !== 'close during initialize') respond(message.id, { protocolVersion: 1 })
          if (message.method === 'session/load' && (scenario === 'history' || scenario === 'overflow')) {
            fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'saved',
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: scenario === 'overflow' ? 'x'.repeat(8 * 1024 * 1024) : 'saved answer' } },
            } })}\n`)
            if (scenario === 'history') respond(message.id, {})
          }
        }
      })
      const client = new OpencodeAcpClient('opencode', logger(), () => fake.child)
      const pending = client.history('saved', '/tmp').then(result => ({ result, error: undefined }), error => ({ result: undefined, error }))
      try {
        if (scenario.startsWith('close')) {
          await vi.waitFor(() => expect(outbound.some(message => message.method === (scenario === 'close during initialize' ? 'initialize' : 'session/load'))).toBe(true))
          await client.close()
        }
        const outcome = await pending
        if (scenario === 'history') expect(outcome.result).toEqual(expect.arrayContaining([expect.objectContaining({ event: expect.objectContaining({ type: 'assistant/message' }) })]))
        else expect(outcome.error).toMatchObject({ code: scenario === 'overflow' ? 'OPENCODE_HISTORY_TOO_LARGE' : 'OPENCODE_CLOSED' })
        expect(fake.kill).toHaveBeenCalled()
        expect(client.isReady()).toBe(false)
      } finally { await client.close() }
    } })))
  })

  it('uses upstream model contracts with session isolation, rejection and prompt exclusion', async () => {
    await runScenarios(['configOptions', 'legacy'].map(format => ({ name: format, run: async () => {
      const fake = fakeProcess()
      const outbound: any[] = []
      const selected = new Map<string, string>()
      const efforts = new Map<string, string>()
      let rejectChange = false
      let confirmChange = true
      const configuration = (id: string) => format === 'legacy'
        ? { models: { currentModelId: selected.get(id), availableModels: [{ modelId: 'provider/a', name: 'A' }, { modelId: 'provider/b', name: 'B' }] } }
        : { configOptions: [{ id: 'model', type: 'select', currentValue: selected.get(id),
          options: [{ name: 'Provider', options: [{ value: 'provider/a', name: 'A' }, { value: 'provider/b', name: 'B' }] }] },
          ...(selected.get(id) === 'provider/b' ? [{ id: 'effort', type: 'select', currentValue: efforts.get(id) ?? 'default',
            options: [{ value: 'default', name: 'Default' }, { value: 'high', name: 'High' }] }] : [])] }
      const respond = (message: any, result: unknown) => fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
      fake.child.stdin.on('data', chunk => {
        for (const line of String(chunk).trim().split('\n')) {
          const message = JSON.parse(line)
          outbound.push(message)
          if (message.method === 'initialize') respond(message, { protocolVersion: 1 })
          if (message.method === 'session/load') {
            selected.set(message.params.sessionId, 'provider/a')
            fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
              sessionId: message.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old' } },
            } })}\n`)
            respond(message, configuration(message.params.sessionId))
          }
          if (['session/set_model', 'session/set_config_option'].includes(message.method)) {
            if (rejectChange) fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'invalid model' } })}\n`)
            else {
              if (confirmChange) {
                if (message.params.configId === 'effort') efforts.set(message.params.sessionId, message.params.value)
                else selected.set(message.params.sessionId, message.params.modelId ?? message.params.value)
              }
              respond(message, format === 'legacy' ? {} : configuration(message.params.sessionId))
            }
          }
        }
      })
      const client = new OpencodeAcpClient('opencode', logger(), () => fake.child)
      const inbound = vi.fn()
      client.onInbound(inbound)
      try {
        await client.start()
        await expect(client.call('dsh/sessionModels', { sessionId: 'missing' })).rejects.toThrow('Load the OpenCode session')
        await Promise.all(['a', 'b'].map(sessionId => client.call('session/load', { sessionId, cwd: '/tmp', mcpServers: [] })))
        expect(inbound).not.toHaveBeenCalled()
        await expect(client.call('dsh/sessionModels', { sessionId: 'a' })).resolves.toMatchObject({
          current: { model: 'provider/a' }, groups: [{ models: [{ id: 'provider/a' }, { id: 'provider/b' }] }],
        })
        const requestCount = outbound.length
        await expect(client.call('dsh/selectModel', { sessionId: 'a', model: 'invented' })).rejects.toThrow('unavailable')
        await expect(client.call('dsh/selectModel', { sessionId: 'a', model: 'provider/b', reasoningEffort: 'invented' })).rejects.toThrow()
        expect(outbound).toHaveLength(requestCount)
        await expect(client.call('dsh/selectModel', { sessionId: 'a', model: 'provider/b' })).resolves.toMatchObject({ selected: { model: 'provider/b' } })
        expect(outbound.at(-1)).toMatchObject({ method: format === 'legacy' ? 'session/set_model' : 'session/set_config_option',
          params: format === 'legacy' ? { sessionId: 'a', modelId: 'provider/b' } : { sessionId: 'a', configId: 'model', value: 'provider/b' } })
        await expect(client.call('dsh/sessionModels', { sessionId: 'b' })).resolves.toMatchObject({ current: { model: 'provider/a' } })
        if (format === 'configOptions') {
          await expect(client.call('dsh/selectModel', { sessionId: 'a', model: 'provider/b', reasoningEffort: 'high' })).resolves.toMatchObject({ selected: { model: 'provider/b', reasoningEffort: 'high' } })
          expect(outbound.at(-1)).toMatchObject({ method: 'session/set_config_option', params: { sessionId: 'a', configId: 'effort', value: 'high' } })
        }
        rejectChange = true
        await expect(client.call('dsh/selectModel', { sessionId: 'a', model: 'provider/a' })).rejects.toThrow()
        await expect(client.call('dsh/sessionModels', { sessionId: 'a' })).resolves.toMatchObject({ current: { model: 'provider/b' } })
        if (format === 'configOptions') {
          rejectChange = false
          confirmChange = false
          await expect(client.call('dsh/selectModel', { sessionId: 'a', model: 'provider/a' })).rejects.toThrow('did not confirm')
        }
        const prompt = client.call('session/prompt', { sessionId: 'a', prompt: [] })
        await expect(client.call('dsh/selectModel', { sessionId: 'a', model: 'provider/a' })).rejects.toThrow('Stop the OpenCode reply')
        await client.call('session/load', { sessionId: 'a', cwd: '/tmp', mcpServers: [] })
        expect(outbound.filter(message => message.method === 'session/load')).toHaveLength(2)
        respond(outbound.find(message => message.method === 'session/prompt'), { stopReason: 'end_turn' })
        await prompt
        await client.close()
        await expect(client.call('dsh/sessionModels', { sessionId: 'a' })).rejects.toThrow('not ready')
      } finally { await client.close() }
    } })))
  })

  it('rechecks persisted native archive state without relying on a loaded-session cache', async () => {
    const fake = fakeProcess()
    const cwd = await realpath(process.cwd())
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line)
        const result = message.method === 'initialize' ? { protocolVersion: 1 }
          : { sessions: ['archived', 'active'].map(sessionId => ({ sessionId, cwd })), nextCursor: 'next-page' }
        fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
      }
    })
    const request = vi.fn(async (url: unknown) => {
      const id = new URL(String(url)).pathname.split('/').at(-1)
      return new Response(JSON.stringify({ id, directory: cwd, time: id === 'archived' ? { archived: 123 } : {} }))
    })
    const client = new OpencodeAcpClient('opencode', logger(), () => fake.child)
    // Inject the native transport while retaining the real ACP request path.
    Object.assign(client, { nativeApi: new OpencodeNativeApi('http://127.0.0.1:12345', request as typeof fetch) })
    try {
      await client.start()
      await expect(client.call('session/list', {})).resolves.toMatchObject({
        sessions: [{ sessionId: 'archived', archived: true }, { sessionId: 'active', archived: false }], nextCursor: 'next-page',
      })
      expect(request).toHaveBeenCalledTimes(2)
      await expect(client.call('session/prompt', { sessionId: 'archived', prompt: [] })).rejects.toMatchObject({ code: 'ACP_SESSION_ARCHIVED' })
    } finally { await client.close() }
  })

  it('initializes with standard ACP initialize and correlates JSON-RPC responses (without authenticate)', async () => {
    const fake = fakeProcess()
    const outbound: Array<Record<string, unknown>> = []
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        if (!line) continue
        const message = JSON.parse(line) as Record<string, unknown>
        outbound.push(message)
        if (message.method === 'initialize') {
          fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } })}\n`)
        }
      }
    })
    const client = new OpencodeAcpClient('opencode-custom', logger(), binary => {
      expect(binary).toBe('opencode-custom')
      return fake.child
    })
    const inbound = vi.fn()
    client.onInbound(inbound)

    await client.start()
    // OpenCode native ACP must only initialize, strictly no authenticate method
    expect(outbound.map(message => message.method)).toEqual(['initialize'])

    const pending = client.call('session/new', { cwd: '/tmp', mcpServers: [] })
    await flush()
    const request = outbound.find(message => message.method === 'session/new')!
    fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'opc_sess_1' } })}\n`)
    await expect(pending).resolves.toEqual({ sessionId: 'opc_sess_1' })

    fake.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'opc_sess_1', update: { sessionUpdate: 'agent_message_chunk' } },
    })}\n`)
    fake.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 'perm-opc-1',
      method: 'session/request_permission',
      params: { sessionId: 'opc_sess_1' },
    })}\n`)
    await flush()
    expect(inbound).toHaveBeenNthCalledWith(1, {
      kind: 'notification',
      method: 'session/update',
      params: { sessionId: 'opc_sess_1', update: { sessionUpdate: 'agent_message_chunk' } },
    })
    expect(inbound).toHaveBeenNthCalledWith(2, {
      kind: 'request',
      id: 'perm-opc-1',
      method: 'session/request_permission',
      params: { sessionId: 'opc_sess_1' },
    })

    await client.respond('perm-opc-1', { outcome: { outcome: 'selected', optionId: 'allow-once' } })
    expect(outbound.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 'perm-opc-1',
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } },
    })
    await client.close()
  })

  it('rejects pending calls when process exits unexpectedly', async () => {
    const fake = fakeProcess()
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        if (!line) continue
        const message = JSON.parse(line) as Record<string, unknown>
        if (message.method === 'initialize') {
          fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } })}\n`)
        }
      }
    })
    const client = new OpencodeAcpClient('opencode', logger(), () => fake.child)
    const nativeApi = new OpencodeNativeApi('http://127.0.0.1:12345')
    const closeNative = vi.spyOn(nativeApi, 'close')
    Object.assign(client, { nativeApi })
    await client.start()

    const pending = client.call('session/prompt', { sessionId: 'sess_1', prompt: [] })
    await flush()
    fake.child.emit('exit', 1, null)

    await expect(pending).rejects.toThrow(OpencodeAcpError)
    expect(closeNative).toHaveBeenCalledOnce()
  })
})

function fakeProcess(): {
  child: ChildProcessWithoutNullStreams
  stdout: PassThrough
  kill: ReturnType<typeof vi.fn>
} {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  const kill = vi.fn(() => {
    child.emit('exit', 0, null)
    return true
  })
  Object.assign(child, {
    stdout,
    stderr,
    stdin,
    kill,
    exitCode: null,
    killed: false,
  })
  return { child, stdout, kill }
}

function logger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
}

async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}
