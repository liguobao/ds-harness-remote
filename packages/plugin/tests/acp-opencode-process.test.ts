import { EventEmitter } from 'node:events'
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OpencodeNativeApi } from '../src/acp/adapters/opencode-native-api.js'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { OpencodeAcpClient, OpencodeAcpError } from '../src/acp/adapters/opencode-process.js'
import type { SafeLogger } from '../src/logging.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, realpath: vi.fn(actual.realpath) }
})

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

  it('bounds isolated history readers, folds multi-chunk streams and rolling turns, and stops on single-turn overflow', async () => {
    await runScenarios([
      'history',
      'tool first step',
      'many chunks',
      'rolling turns',
      'close during initialize',
      'close during load',
      'overflow',
    ].map(scenario => ({ name: scenario, run: async () => {
      const fake = fakeProcess()
      const outbound: Array<{ method: string; id: number }> = []
      const respond = (id: number, result: unknown) => fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
      fake.child.stdin.on('data', chunk => {
        for (const line of String(chunk).trim().split('\n')) {
          const message = JSON.parse(line)
          outbound.push(message)
          if (message.method === 'initialize' && scenario !== 'close during initialize') respond(message.id, { protocolVersion: 1 })
          if (message.method === 'session/load') {
            if (scenario === 'history') {
              fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'saved',
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'saved answer' } },
              } })}\n`)
              respond(message.id, {})
            } else if (scenario === 'tool first step') {
              fake.stdout.write([
                JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'saved',
                  update: { sessionUpdate: 'tool_call', toolCallId: 'tc-1', title: 'bash', rawInput: { command: 'pwd' }, status: 'completed', rawOutput: '/tmp' },
                } }),
                JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'saved',
                  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'after tool' } },
                } }),
              ].join('\n') + '\n')
              respond(message.id, {})
            } else if (scenario === 'many chunks') {
              // >10,000 tiny streaming deltas must coalesce without tripping OPENCODE_HISTORY_TOO_LARGE.
              const lines = Array.from({ length: 12_000 }, () => JSON.stringify({
                jsonrpc: '2.0',
                method: 'session/update',
                params: { sessionId: 'saved', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a' } } },
              })).join('\n')
              fake.stdout.write(`${lines}\n`)
              respond(message.id, {})
            } else if (scenario === 'rolling turns') {
              // 4 complete turns x ~3 MiB (>8 MiB total) keep the trailing window within 8 MiB cleanly.
              const payload = 't'.repeat(3 * 1024 * 1024)
              for (const tag of ['turn-1', 'turn-2', 'turn-3', 'turn-4']) {
                fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'saved',
                  update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: `${tag}-question` } },
                } })}\n`)
                fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'saved',
                  update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${tag}:${payload}` } },
                } })}\n`)
              }
              respond(message.id, {})
            } else if (scenario === 'overflow') {
              fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'saved',
                update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x'.repeat(16 * 1024 * 1024 + 1024) } },
              } })}\n`)
            }
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
        if (scenario === 'history') {
          expect(outcome.result).toEqual(expect.arrayContaining([expect.objectContaining({ event: expect.objectContaining({ type: 'assistant/message' }) })]))
        } else if (scenario === 'tool first step') {
          expect(outcome.error).toBeUndefined()
          const events = outcome.result as Array<{ event: { type: string; data: { turn?: number; step?: number } } }>
          expect(events.map(e => `${e.event.type}@${e.event.data.step ?? '-'}`)).toEqual([
            'turn/start@-',
            'step/start@1',
            'tool/call@1',
            'tool/result@1',
            'step/end@1',
            'step/start@2',
            'assistant/message@2',
            'step/end@2',
            'turn/end@-',
          ])
        } else if (scenario === 'many chunks') {
          expect(outcome.error).toBeUndefined()
          const assistant = (outcome.result as Array<{ event: { type: string; data: { message: { content: Array<{ text: string }> } } } }>)
            .find(entry => entry.event.type === 'assistant/message')
          expect(assistant?.event.data.message.content[0]?.text).toHaveLength(12_000)
        } else if (scenario === 'rolling turns') {
          expect(outcome.error).toBeUndefined()
          const events = outcome.result as Array<{ event: { type: string; seq: number; data: { content?: Array<{ text: string }> } } }>
          expect(events.map(e => e.event.seq)).toEqual(events.map((_, idx) => idx))
          const texts = events
            .filter(e => e.event.type === 'user/message')
            .map(e => e.event.data.content?.[0]?.text)
          expect(texts).toEqual(['turn-3-question', 'turn-4-question'])
        } else {
          expect(outcome.error).toMatchObject({ code: scenario === 'overflow' ? 'OPENCODE_HISTORY_TOO_LARGE' : 'OPENCODE_CLOSED' })
        }
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
      const path = new URL(String(url)).pathname
      const session = (id: string) => ({ id, directory: cwd, time: id === 'archived' ? { archived: 123 } : {} })
      return new Response(JSON.stringify(path === '/session' ? ['archived', 'active'].map(session) : session(path.split('/').at(-1)!)))
    })
    const client = new OpencodeAcpClient('opencode', logger(), () => fake.child)
    // Inject the native transport while retaining the real ACP request path.
    Object.assign(client, { nativeApi: new OpencodeNativeApi('http://127.0.0.1:12345', request as typeof fetch) })
    try {
      await client.start()
      await expect(client.call('session/list', {})).resolves.toMatchObject({
        sessions: [{ sessionId: 'archived', archived: true }, { sessionId: 'active', archived: false }], nextCursor: 'next-page',
      })
      expect(request).toHaveBeenCalledTimes(1)
      await expect(client.call('session/prompt', { sessionId: 'archived', prompt: [] })).rejects.toMatchObject({ code: 'ACP_SESSION_ARCHIVED' })
    } finally { await client.close() }
  })

  it('uses individual archive reads only for rows missing from the native list', async () => {
    const fake = fakeProcess()
    const cwd = await realpath(process.cwd())
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line)
        const result = message.method === 'initialize' ? { protocolVersion: 1 }
          : { sessions: ['a', 'b', 'c'].map(sessionId => ({ sessionId, cwd })) }
        fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
      }
    })
    const request = vi.fn(async (url: unknown) => {
      const path = new URL(String(url)).pathname
      const session = (id: string) => ({ id, directory: cwd, time: id === 'a' ? { archived: 123 } : {} })
      return new Response(JSON.stringify(path === '/session' ? ['a', 'b'].map(session) : session('c')))
    })
    const client = new OpencodeAcpClient('opencode', logger(), () => fake.child)
    Object.assign(client, { nativeApi: new OpencodeNativeApi('http://127.0.0.1:12345', request as typeof fetch) })
    try {
      await client.start()
      await expect(client.call('session/list', {})).resolves.toMatchObject({
        sessions: [{ sessionId: 'a', archived: true }, { sessionId: 'b', archived: false }, { sessionId: 'c', archived: false }],
      })
      expect(request.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/session', '/session/c'])
    } finally { await client.close() }
  })

  it('truncates oversized session/list pages, caches realpath per query, and isolates per-item failures (#466)', async () => {
    const fake = fakeProcess()
    const cwd = await realpath(process.cwd())
    const cwdAlias = `${cwd}${sep}.`
    const missingCwd = join(cwd, 'non-existent-opencode-dir-466')
    const oversizedSessions = [
      // 1005 items: 5 oldest items should be dropped when keeping the 1000 most recent.
      ...Array.from({ length: 5 }, (_, i) => ({
        sessionId: `stale-${i}`,
        cwd: cwdAlias,
        updatedAt: `2025-01-01T00:00:0${i}Z`,
      })),
      { sessionId: 'missing-dir', cwd: missingCwd, updatedAt: '2026-11-18T12:00:00Z' },
      { sessionId: 'archive-timeout', cwd: cwdAlias, updatedAt: '2026-11-18T11:59:00Z' },
      ...Array.from({ length: 998 }, (_, i) => ({
        sessionId: `recent-${i}`,
        cwd: cwdAlias,
        updatedAt: `2026-11-18T10:${String(Math.floor((997 - i) / 60)).padStart(2, '0')}:${String((997 - i) % 60).padStart(2, '0')}Z`,
      })),
    ]
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        const message = JSON.parse(line)
        const result = message.method === 'initialize'
          ? { protocolVersion: 1 }
          : { sessions: oversizedSessions }
        fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
      }
    })
    const request = vi.fn(async (url: unknown) => {
      const id = new URL(String(url)).pathname.split('/').at(-1)
      if (id === 'archive-timeout') {
        throw new Error('Request timed out')
      }
      return new Response(JSON.stringify({ id, directory: cwd, time: {} }))
    })
    const client = new OpencodeAcpClient('opencode', logger(), () => fake.child)
    Object.assign(client, { nativeApi: new OpencodeNativeApi('http://127.0.0.1:12345', request as typeof fetch) })
    try {
      await client.start()
      vi.mocked(realpath).mockClear()
      const listed = await client.call('session/list', {}) as { sessions: Array<{ sessionId: string; archived: boolean }> }
      expect(listed.sessions).toHaveLength(998)
      expect(listed.sessions.some(s => s.sessionId.startsWith('stale-'))).toBe(false)
      expect(listed.sessions.some(s => s.sessionId === 'missing-dir')).toBe(false)
      expect(listed.sessions.some(s => s.sessionId === 'archive-timeout')).toBe(false)
      expect(listed.sessions[0]).toMatchObject({ sessionId: 'recent-0', archived: false })
      // Within one session/list query, item.cwd realpath is resolved once per unique raw path.
      const itemRealpathCalls = vi.mocked(realpath).mock.calls.filter(([p]) => p === cwdAlias)
      expect(itemRealpathCalls).toHaveLength(1)
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

  it('sends session/cancel as a standard JSON-RPC notification without an id', async () => {
    const fake = fakeProcess()
    const outbound: Array<Record<string, unknown>> = []
    fake.child.stdin.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        if (!line) continue
        const message = JSON.parse(line) as Record<string, unknown>
        outbound.push(message)
        // Only requests (with an id) are answered; a notification must never get a reply.
        if (message.method === 'initialize') {
          fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } })}\n`)
        }
      }
    })
    const client = new OpencodeAcpClient('opencode', logger(), () => fake.child)
    const pendingRequests = () => (client as unknown as { pending: Map<unknown, unknown> }).pending.size
    try {
      await client.start()

      // A cancel arrives while a prompt is in flight and must not wait for upstream.
      const prompt = client.call('session/prompt', { sessionId: 'sess_1', prompt: [] })
      await flush()
      expect(pendingRequests()).toBe(1)

      await expect(client.call('session/cancel', { sessionId: 'sess_1' })).resolves.toEqual({})
      expect(outbound.at(-1)).toEqual({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'sess_1' } })
      expect(outbound.at(-1)).not.toHaveProperty('id')
      // Only the in-flight prompt stays pending: no cancel request was registered.
      expect(pendingRequests()).toBe(1)

      // Cancelling an idle session is likewise fire-and-forget.
      const promptMessage = outbound.find(message => message.method === 'session/prompt')!
      fake.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: promptMessage.id, result: { stopReason: 'cancelled' } })}\n`)
      await expect(prompt).resolves.toEqual({ stopReason: 'cancelled' })
      await expect(client.call('session/cancel', { sessionId: 'sess_1' })).resolves.toEqual({})
      expect(outbound.at(-1)).toEqual({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 'sess_1' } })
      expect(pendingRequests()).toBe(0)
    } finally { await client.close() }
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
