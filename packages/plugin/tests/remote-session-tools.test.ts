import { afterEach, describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { RemoteSessionTools, type RemoteToolConnection } from '../src/remote-session-tools.js'
import { RemoteTypertGateway } from '../src/remote-typert-gateway.js'
import type { ConnectedRemote } from '../src/client-runtime-contract.js'
import { remoteSessionTools } from '../src/remote-tools.js'

const target = { hostId: 'host', backend: 'harness' as const, workspaceId: 'workspace', sessionId: 'session' }
const operationId = 'operation_00000001'
const signal = () => new AbortController().signal
const event = (seq: number, type: string, data: unknown = {}) => ({ type: 'event', event: { seq, type, time: seq, data } })
const cleanup = () => { vi.restoreAllMocks(); vi.useRealTimers() }
afterEach(cleanup)

function fixture() {
  const state = {
    rows: [{ sessionId: 'session', title: 'Session', running: false, blank: false, updatedAt: 1 }] as Record<string, unknown>[],
    ids: ['session'],
    history: [event(1, 'user/message', { content: [{ type: 'text', text: 'Hello' }] })],
    hasMore: false,
    cursor: 1,
    frames: [] as Record<string, unknown>[],
    queries: [] as string[],
    closed: 0,
    supported: true,
  }
  const invoke = vi.spyOn(RemoteTypertGateway.prototype, 'invoke').mockImplementation(async request => {
    state.queries.push(`${request.namespace}/${request.method}`)
    if (request.namespace === 'session' && request.method === 'list') return { items: state.rows }
    if (request.namespace === 'session' && request.method === 'page') return { records: state.history, hasMore: state.hasMore }
    throw new Error('Unexpected query')
  })
  const open = vi.spyOn(RemoteTypertGateway.prototype, 'open').mockImplementation(async (endpoint, _payload, active) => {
    state.queries.push(endpoint)
    return (async function* () {
      try {
        if (endpoint === 'workspace/follow') {
          yield { type: 'baseline', value: { items: [{ workspaceId: 'workspace', path: '/project', title: 'Project', sessionIds: state.ids }] } }
        } else if (endpoint === 'session/follow') {
          yield { type: 'snapshot', cursor: state.cursor, records: state.history, hasMore: state.hasMore, projections: { values: {} } }
          for (const frame of state.frames) yield frame
          if (!active.aborted) await new Promise<void>(resolve => active.addEventListener('abort', () => resolve(), { once: true }))
        } else throw new Error('Unexpected stream')
      } finally { state.closed++ }
    })()
  })
  const dispatch = vi.spyOn(RemoteTypertGateway.prototype, 'dispatch').mockResolvedValue({ ok: true, value: { accepted: true } })
  const connect: RemoteToolConnection = async (_host, active, query) => {
    active.throwIfAborted()
    return query({ features: { remoteGateway: state.supported }, client: {} } as ConnectedRemote, active)
  }
  const tools = new RemoteSessionTools(connect)
  return { state, tools, invoke, open, dispatch, connect }
}

describe('Native Remote session tool boundaries', () => {
  it('uses workspace membership and excludes foreign and subagent sessions before mutation', async () => {
    await runScenarios(['foreign', 'subagent', 'workspace', 'unsupported'].map(kind => ({ name: kind, run: async () => {
      const f = fixture()
      if (kind === 'foreign') f.state.ids = ['another-session']
      if (kind === 'subagent') f.state.rows[0]!.parentSessionId = 'parent'
      if (kind === 'unsupported') f.state.supported = false
      const args = { ...target, operationId, message: 'Task', ...(kind === 'workspace' ? { workspaceId: 'other' } : {}) }
      await expect(f.tools.run('remote_send_message', args, signal())).rejects.toThrow('REMOTE_PREFLIGHT_FAILED')
      await expect(f.tools.run('remote_download_file', { ...target, ...(kind === 'workspace' ? { workspaceId: 'other' } : {}), path: 'output.bin' }, signal())).rejects.toThrow()
      expect(f.dispatch).not.toHaveBeenCalled()
      expect(await f.tools.run('remote_get_operation', { operationId }, signal())).toMatchObject({ status: 'not_found' })
      if (kind === 'foreign' || kind === 'subagent') {
        const { sessionId: _, ...workspace } = target
        expect(await f.tools.run('remote_list_sessions', workspace, signal())).toMatchObject({ sessions: [] })
      }
    } })), cleanup)
  })

  it('deduplicates accepted, rejected and uncertain writes and binds keys to target and content', async () => {
    await runScenarios(['accepted', 'rejected', 'unknown'].map(outcome => ({ name: outcome, run: async () => {
      const f = fixture()
      if (outcome === 'rejected') f.dispatch.mockResolvedValue({ ok: false, error: { code: 'denied', message: 'private', details: {} } })
      if (outcome === 'unknown') f.dispatch.mockRejectedValue(new Error('token=private'))
      const args = { ...target, operationId, message: 'private prompt body' }
      const results = await Promise.all([f.tools.run('remote_send_message', args, signal()), f.tools.run('remote_send_message', args, signal())])
      expect(results[0]).toEqual(results[1])
      expect(results[0]).toMatchObject({ operationId, status: outcome, sessionId: 'session' })
      expect(f.dispatch).toHaveBeenCalledOnce()
      expect(f.dispatch.mock.calls[0]).toEqual(['session/prompt', { args: { request: {
        sessionId: 'session', requestId: expect.any(String), mode: 'queue', content: [{ type: 'text', text: 'private prompt body' }],
      } } }, expect.any(AbortSignal)])
      expect(await f.tools.run('remote_get_operation', { operationId }, signal())).toEqual(results[0])
      expect(await f.tools.run('remote_send_message', args, signal())).toEqual(results[0])
      for (const changed of [{ message: 'different' }, { hostId: 'other' }, { workspaceId: 'other' }, { sessionId: 'other' }]) {
        await expect(f.tools.run('remote_send_message', { ...args, ...changed }, signal())).rejects.toThrow('OPERATION_ID_CONFLICT')
      }
      expect(f.dispatch).toHaveBeenCalledOnce()
      expect(JSON.stringify(results)).not.toContain('private')
    } })), cleanup)
  })

  it('keeps creation and interruption fixed to their native endpoints and never expands permissions', async () => {
    const f = fixture()
    const { sessionId: _, ...workspace } = target
    f.dispatch.mockResolvedValueOnce({ ok: true, value: { sessionId: 'created' } })
    expect(await f.tools.run('remote_create_session', { ...workspace, operationId }, signal())).toMatchObject({ status: 'accepted', sessionId: 'created' })
    expect(f.dispatch.mock.calls[0]?.slice(0, 2)).toEqual(['session/create', { args: { request: { workspaceId: 'workspace' } } }])
    expect(await f.tools.run('remote_interrupt_session', { ...target, operationId: 'interrupt_0000001' }, signal())).toMatchObject({ status: 'accepted' })
    expect(f.dispatch.mock.calls[1]?.slice(0, 2)).toEqual(['session/cancel', { args: { request: { sessionId: 'session' } } }])
    const definitions = remoteSessionTools(() => ({ runSessionTool: f.tools.run.bind(f.tools) }))
    const send = definitions.find(tool => tool.name === 'remote_send_message')!
    for (const extra of [{ backend: 'codex' }, { permissionPreset: 'danger-full-access' }, { cwd: '/outside' }, { method: 'settings/update' }]) {
      await expect(send.execute({ ...target, operationId, message: 'task', ...extra }, { signal: signal() })).rejects.toThrow()
    }
    expect(f.dispatch).toHaveBeenCalledTimes(2)
  })

  it('lists workspace sessions from a catalogue larger than the client row bound', async () => {
    await runScenarios(['owned roots', 'subagent dominated'].map(name => ({ name, run: async () => {
      const f = fixture()
      const owned = Array.from({ length: 100 }, (_, index) => ({
        sessionId: `owned-${index}`, title: `Owned ${index}`, running: false, blank: false, updatedAt: index,
      }))
      // A shared account catalogue: the workspace owns 100 roots while the rest
      // belongs to other Workspaces and to subagent Sessions.
      f.state.rows = [
        ...owned,
        ...Array.from({ length: 2_900 }, (_, index) => ({
          sessionId: `foreign-${index}`, title: `Foreign ${index}`, running: false, blank: false, updatedAt: index,
        })),
      ]
      f.state.ids = owned.map(row => row.sessionId)
      const { sessionId: _, ...workspace } = target
      const result = await f.tools.run('remote_list_sessions', workspace, signal()) as { sessions: { sessionId: string }[] }
      expect(result.sessions.length).toBe(30)
      expect(result.sessions.every(row => row.sessionId.startsWith('owned-'))).toBe(true)
      expect(f.state.queries).toContain('session/list')
    } })), cleanup)
  })

  it('bounds history while preserving native paging and closes each snapshot subscription', async () => {
    const f = fixture()
    f.state.history = Array.from({ length: 10 }, (_, i) => event(i + 1, 'assistant/message', { message: { content: [{ type: 'text', text: 'x'.repeat(20_000) }] } }))
    f.state.cursor = 10
    const result = await f.tools.run('remote_read_session', target, signal()) as {
      records: { seq: number; json: string; truncated: boolean }[]; nextCursor: { throughSeq: number; beforeSeq: number }; hasMore: boolean
    }
    expect(result.records.reduce((n, row) => n + row.json.length, 0)).toBeLessThanOrEqual(48_000)
    expect(result.records.every(row => row.truncated)).toBe(true)
    expect(result.records.at(-1)?.seq).toBe(10)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toEqual({ throughSeq: 10, beforeSeq: result.records[0]!.seq })
    expect(f.state.closed).toBe(2)
    f.state.history = [event(1, 'user/message')]
    await f.tools.run('remote_read_session', { ...target, cursor: result.nextCursor }, signal())
    expect(f.invoke).toHaveBeenLastCalledWith({ namespace: 'session', method: 'page', args: { request: {
      address: { kind: 'session', sessionId: 'session' }, ...result.nextCursor, maxMessages: 20,
    } }, signal: expect.any(AbortSignal) })
    expect(f.state.closed).toBe(3)
  })

  it('waits for native execution transitions without treating idle as task success or resolving approvals', async () => {
    const cases = [
      { name: 'turn ended', frames: [event(2, 'turn/end', { reason: { kind: 'completed' } })], status: 'idle' },
      { name: 'turn failed', frames: [event(2, 'turn/end', { reason: { kind: 'error', error: { message: 'private' } } })], status: 'failed' },
      { name: 'approval pending', frames: [event(2, 'approval/asked', { id: 'approval' })], status: 'needs_user_input' },
      { name: 'question pending', frames: [event(2, 'tool/call', { name: 'ask_user_question', id: 'question' })], status: 'needs_user_input' },
    ]
    await runScenarios(cases.map(item => ({ name: item.name, run: async () => {
      const f = fixture()
      f.state.rows[0]!.running = true
      f.state.frames = item.frames
      const result = await f.tools.run('remote_wait_sessions', { targets: [target], timeoutMs: 1000 }, signal())
      expect(result).toEqual({ sessions: [{ ...target, status: item.status }], timedOut: false })
      expect(f.dispatch).not.toHaveBeenCalled()
      expect(f.state.closed).toBe(2)
    } })), cleanup)
  })

  it('closes wait streams on timeout and cancellation without sending a cancel RPC', async () => {
    await runScenarios(['timeout', 'cancel'].map(action => ({ name: action, run: async () => {
      const f = fixture()
      f.state.rows[0]!.running = true
      const controller = new AbortController()
      const pending = f.tools.run('remote_wait_sessions', { targets: [target], timeoutMs: action === 'cancel' ? 5000 : 50 }, controller.signal)
      const observed = pending.then(value => ({ value }), error => ({ error }))
      await vi.waitFor(() => expect(f.state.queries).toContain('session/follow'))
      if (action === 'cancel') controller.abort()
      const result = await observed
      if (action === 'cancel') expect(result).toHaveProperty('error')
      else expect(result).toEqual({ value: { sessions: [{ ...target, status: 'running' }], timedOut: true } })
      expect(f.dispatch).not.toHaveBeenCalled()
      expect(f.state.closed).toBe(2)
    } })), cleanup)
  })

  it('rejects late mutation results after authority reset and reports lost receipts conservatively', async () => {
    const f = fixture()
    let finish!: (value: { ok: true }) => void
    f.dispatch.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = f.tools.run('remote_send_message', { ...target, operationId, message: 'task' }, signal())
    const rejected = expect(pending).rejects.toThrow('REMOTE_AUTHORITY_CHANGED')
    await vi.waitFor(() => expect(f.dispatch).toHaveBeenCalledOnce())
    expect(await f.tools.run('remote_get_operation', { operationId }, signal())).toMatchObject({ status: 'pending' })
    f.tools.invalidate()
    finish({ ok: true })
    await rejected
    expect(await f.tools.run('remote_get_operation', { operationId }, signal())).toMatchObject({ status: 'not_found', warning: expect.stringContaining('does not prove') })
  })
})
