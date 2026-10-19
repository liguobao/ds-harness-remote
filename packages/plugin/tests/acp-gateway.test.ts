import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { realpath } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { AcpRemoteGateway } from '../src/acp/gateway.js'
import { resolveConfig } from '../src/config.js'
import type { CursorAcpInbound, CursorAcpLike } from '../src/acp/adapters/cursor-process.js'
import type { SafeLogger } from '../src/logging.js'

function silentLogger(): SafeLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as SafeLogger
}

function readyAcp(): CursorAcpLike {
  return {
    start: vi.fn(async () => undefined),
    isReady: () => true,
    call: vi.fn(async () => ({})),
    respond: vi.fn(async () => undefined),
    respondError: vi.fn(async () => undefined),
    onInbound: () => () => undefined,
    onUnavailable: () => () => undefined,
    close: vi.fn(async () => undefined),
  }
}

describe('AcpRemoteGateway', () => {
  it('resolves upload roots only for a live peer, matching backend and session owner', async () => {
    const cwd = await realpath(process.cwd())
    const adapter = readyAcp()
    adapter.call = vi.fn(async () => ({ sessionId: 'upload-session' }))
    const config = { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'fixture', args: [] }] }
    const gateway = new AcpRemoteGateway(config, silentLogger(), () => adapter)
    await gateway.start()
    const owner = gateway.createPeer({ connectionId: 'owner', peerDeviceId: 'a' } as never, async () => undefined)!
    gateway.createPeer({ connectionId: 'other', peerDeviceId: 'b' } as never, async () => undefined)
    try {
      await gateway.call('owner', { method: 'session/new', params: { backend: 'cursor', cwd } })
      expect(gateway.resolveUploadWorkspace('owner', 'cursor:upload-session')).toBe(cwd)
      expect(() => gateway.resolveUploadWorkspace('other', 'cursor:upload-session')).toThrow()
      expect(() => gateway.resolveUploadWorkspace('owner', 'claude:upload-session')).toThrow()
      expect(() => gateway.resolveUploadWorkspace('owner', 'cursor:unknown')).toThrow()
      await owner.closeAll()
      expect(() => gateway.resolveUploadWorkspace('owner', 'cursor:upload-session')).toThrow()
      expect(gateway.resolveUploadWorkspace('other', 'cursor:upload-session')).toBe(cwd)
      await gateway.reconfigure({ enabled: false, backends: [] })
      expect(() => gateway.resolveUploadWorkspace('other', 'cursor:upload-session')).toThrow()
    } finally { await gateway.close() }
  })

  it('does not restore session ownership from new/load results after disconnect, replacement or shutdown', async () => {
    const cwd = await realpath(process.cwd())
    await runScenarios((['cursor', 'pi', 'opencode'] as const).flatMap(backend =>
      (['session/new', 'session/load'] as const).flatMap(method =>
        (['disconnect', 'replace', 'close'] as const).map(transition => ({ name: `${backend}: ${method} / ${transition}`, run: async () => {
          let entered!: () => void, release!: () => void
          const blocked = new Promise<void>(resolve => { entered = resolve })
          const gate = new Promise<void>(resolve => { release = resolve })
          const previous = readyAcp(), next = readyAcp()
          previous.call = vi.fn(async current => {
            if (current === 'session/list') return { sessions: [{ sessionId: 'saved', cwd }] }
            if (current === method) { entered(); await gate }
            return { sessionId: 'saved' }
          })
          const initial = { enabled: true, backends: [{ id: backend, enabled: true, command: 'previous', args: [] }] }
          const gateway = new AcpRemoteGateway(initial, silentLogger(), binary => binary === 'previous' ? previous : next)
          await gateway.start()
          let finishClose!: () => void
          const closeGate = new Promise<void>(resolve => { finishClose = resolve })
          const peer = gateway.createPeer({ connectionId: 'owner', peerDeviceId: 'device' } as never, async event => {
            if (event === 'agent.acp.stream.closed') await closeGate
          })!
          if (transition === 'disconnect') await peer.openStream({ streamId: 'existing', sessionId: 'saved' })
          const pending = gateway.call('owner', { method, params: method === 'session/new' ? { backend, cwd } : { backend, sessionId: 'saved' } })
            .then(result => ({ result, error: undefined }), error => ({ result: undefined, error }))
          let closing: Promise<void> | undefined
          try {
            await blocked
            if (transition === 'disconnect') closing = peer.closeAll()
            else if (transition === 'close') await gateway.close()
            else await gateway.reconfigure({ ...initial, backends: [{ ...initial.backends[0]!, command: 'next' }] })
            release()
            expect((await pending).error).toBeDefined()
            const state = gateway as unknown as { sessionOwners: Map<string, string>; sessionCwds: Map<string, unknown> }
            expect(state.sessionOwners.get('saved')).not.toBe('owner')
            if (transition !== 'disconnect') expect(state.sessionCwds.has('saved')).toBe(false)
          } finally { release(); finishClose(); await closing; await pending; await gateway.close() }
        } })))),
    )
  })

  it('keeps late prompt completion from a retired backend out of a replacement turn', async () => {
    const cwd = await realpath(process.cwd())
    let finishOld!: (value: unknown) => void, finishNew!: (value: unknown) => void
    const previous = readyAcp(), next = readyAcp()
    previous.call = vi.fn(async method => method === 'session/new' ? { sessionId: 'saved' }
      : new Promise(resolve => { finishOld = resolve }))
    next.call = vi.fn(async method => method === 'session/new' ? { sessionId: 'saved' }
      : new Promise(resolve => { finishNew = resolve }))
    const initial = { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'previous', args: [] }] }
    const gateway = new AcpRemoteGateway(initial, silentLogger(), binary => binary === 'previous' ? previous : next)
    await gateway.start()
    const publish = vi.fn(async () => undefined)
    gateway.createPeer({ connectionId: 'owner', peerDeviceId: 'device' } as never, publish)
    const prompt = { method: 'session/prompt', params: { backend: 'cursor', sessionId: 'saved', prompt: [{ type: 'text', text: 'hello' }] } }
    try {
      await gateway.call('owner', { method: 'session/new', params: { backend: 'cursor', cwd } })
      await gateway.call('owner', prompt)
      await gateway.reconfigure({ ...initial, backends: [{ ...initial.backends[0]!, command: 'next' }] })
      await gateway.call('owner', { method: 'session/new', params: { backend: 'cursor', cwd } })
      await expect(gateway.call('owner', prompt)).resolves.toMatchObject({ accepted: true })
      publish.mockClear()
      finishOld({ stopReason: 'end_turn' })
      await new Promise(resolve => setImmediate(resolve))
      expect(publish).not.toHaveBeenCalled()
      await expect(gateway.call('owner', prompt)).rejects.toMatchObject({ code: 'PROMPT_IN_PROGRESS' })
      finishNew({ stopReason: 'end_turn' })
      await vi.waitFor(() => expect(publish).toHaveBeenCalledWith('agent.acp.frame', expect.objectContaining({
        frame: { method: 'session/update', params: { sessionId: 'saved', update: { sessionUpdate: 'prompt_completed', stopReason: 'end_turn' } } },
      })))
    } finally { finishOld?.({}); finishNew?.({}); await gateway.close() }
  })

  it('archives OpenCode natively with trusted authority and fences active turns, concurrent writes and backend replacement', async () => {
    const cwd = await realpath(process.cwd())
    let release!: () => void
    let archived = false
    const archiveSession = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve }); archived = true })
    const acp = Object.assign(readyAcp(), { archiveSession, isSessionArchived: async () => archived, history: vi.fn(async () => []) })
    let finish!: (value: unknown) => void
    acp.call = vi.fn(async method => method === 'session/list' ? { sessions: [{ sessionId: 'saved', cwd, archived }] }
      : method === 'session/prompt' ? new Promise(resolve => { finish = resolve }) : {})
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'opencode', enabled: true, command: 'fixture', args: [] }] }, silentLogger(), () => acp)
    await gateway.start()
    const publishArchive = vi.fn(async () => undefined)
    gateway.createPeer({ connectionId: 'reader', peerDeviceId: 'same-account-device' } as never, publishArchive)
    const archive = { method: 'dsh/sessionArchive', params: { backend: 'opencode', sessionId: 'saved' } }
    const prompt = { method: 'session/prompt', params: { backend: 'opencode', sessionId: 'saved', prompt: [{ type: 'text', text: 'hello' }] } }
    try {
      await expect(gateway.call('reader', { ...archive, params: { backend: 'opencode', sessionId: 'unknown' } })).rejects.toMatchObject({ code: 'ACP_WORKSPACE_UNAVAILABLE' })
      await expect(gateway.call('reader', { ...archive, params: { backend: 'pi', sessionId: 'saved' } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      await gateway.call('owner', { method: 'session/load', params: { backend: 'opencode', sessionId: 'saved' } })
      await gateway.call('owner', prompt)
      await expect(gateway.call('reader', archive)).rejects.toMatchObject({ code: 'ACP_SESSION_BUSY' })
      expect(archiveSession).not.toHaveBeenCalled()
      finish({ stopReason: 'end_turn' })
      await new Promise(resolve => setImmediate(resolve))
      const pending = gateway.call('reader', archive)
      await vi.waitFor(() => expect(archiveSession).toHaveBeenCalledTimes(1))
      expect(archiveSession).toHaveBeenCalledWith('saved', cwd)
      await expect(gateway.call('owner', prompt)).rejects.toMatchObject({ code: 'ACP_SESSION_BUSY' })
      release()
      await expect(pending).resolves.toEqual({ backend: 'opencode', sessionId: 'saved', archived: true })
      expect(publishArchive).toHaveBeenCalledWith('agent.acp.catalog.changed', { backend: 'opencode', sessionId: 'saved', archived: true })
      await expect(gateway.call('owner', prompt)).rejects.toMatchObject({ code: 'ACP_SESSION_ARCHIVED' })
      await expect(gateway.call('reader', { method: 'dsh/sessionList', params: { backend: 'opencode', path: cwd } })).resolves.toEqual({ items: [] })
      await expect(gateway.call('reader', { method: 'dsh/sessionHistory', params: { backend: 'opencode', sessionId: 'opencode:saved' } })).resolves.toEqual({ events: [] })
      const restarted = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'opencode', enabled: true, command: 'fixture', args: [] }] }, silentLogger(), () => Object.assign(readyAcp(), { call: acp.call, history: acp.history, isSessionArchived: acp.isSessionArchived }))
      await restarted.start()
      try {
        await expect(restarted.call('new-reader', { method: 'session/prompt', params: { sessionId: 'saved', prompt: [{ type: 'text', text: 'blocked' }] } })).rejects.toMatchObject({ code: 'ACP_SESSION_ARCHIVED' })
        await expect(restarted.call('new-reader', { method: 'dsh/sessionHistory', params: { backend: 'opencode', sessionId: 'opencode:saved' } })).resolves.toEqual({ events: [] })
      } finally { await restarted.close() }
      archiveSession.mockRejectedValueOnce(new Error('native failed'))
      await expect(gateway.call('reader', archive)).rejects.toThrow('native failed')
      // A late native completion may not publish success for a replacement backend.
      const late = gateway.call('reader', archive)
      await vi.waitFor(() => expect(archiveSession).toHaveBeenCalledTimes(3))
      await gateway.reconfigure({ enabled: false, backends: [] })
      release()
      await expect(late).rejects.toThrow()
    } finally { finish?.({ stopReason: 'end_turn' }); await gateway.close() }
  })
  it('loads Claude model catalogs only with trusted cwd and scopes Cursor/Claude changes to the owner', async () => {
    await runScenarios((['cursor', 'claude'] as const).map(backend => ({ name: backend, run: async () => {
      const acp = readyAcp(), cwd = await realpath(process.cwd())
      acp.call = vi.fn(async (method, params) => {
        if (method === 'session/new') return { sessionId: 'owned' }
        if (method === 'dsh/sessionModels') return { current: { provider: backend, model: 'a' }, groups: [], failures: [], routable: true }
        if (method === 'dsh/selectModel') return { selected: { provider: backend, model: (params as { model: string }).model } }
        return {}
      })
      const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: backend, enabled: true, command: 'fixture', args: [] }] }, silentLogger(), () => acp)
      await gateway.start()
      try {
        await gateway.call('owner', { method: 'session/new', params: { backend, cwd } })
        await expect(gateway.call('owner', { method: 'dsh/sessionModels', params: { backend, sessionId: 'owned' } })).resolves.toMatchObject({ current: { provider: backend } })
        if (backend === 'claude') expect(acp.call).toHaveBeenCalledWith('session/load', { sessionId: 'owned', cwd, mcpServers: [] })
        const selection = { method: 'dsh/selectModel', params: { backend, sessionId: 'owned', model: 'b' } }
        await expect(gateway.call('other', selection)).rejects.toThrow()
        await expect(gateway.call('owner', { ...selection, params: { ...selection.params, backend: backend === 'cursor' ? 'claude' : 'cursor' } })).rejects.toThrow()
        await expect(gateway.call('owner', selection)).resolves.toMatchObject({ selected: { provider: backend, model: 'b' } })
        expect(vi.mocked(acp.call).mock.calls.filter(([method]) => method === 'dsh/selectModel')).toHaveLength(1)
      } finally { await gateway.close() }
    } })))
  })
  it('fences cancelled Pi/Claude preparation from later retries', async () => {
    await runScenarios((['pi', 'claude'] as const).flatMap(backend => ['session/list', 'session/load'].map(stage => ({ name: `${backend}: ${stage}`, run: async () => {
      const acp = readyAcp(), cwd = await realpath(process.cwd())
      let release!: (value: unknown) => void, entered!: () => void
      const blocked = new Promise<void>(resolve => { entered = resolve })
      let first = true
      acp.call = vi.fn(async method => {
        if (first && method === stage) {
          first = false; entered()
          return new Promise(resolve => { release = resolve })
        }
        if (method === 'session/list') return { sessions: [{ sessionId: 'saved', cwd }] }
        if (method === 'session/prompt') return new Promise(() => {})
        return {}
      })
      const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: backend, enabled: true, command: 'fixture', args: [] }] }, silentLogger(), () => acp)
      await gateway.start()
      const prompt = { method: 'session/prompt', params: { backend, sessionId: 'saved', prompt: [{ type: 'text', text: 'hi' }] } }
      try {
        const old = gateway.call('owner', prompt)
        await blocked
        await expect(gateway.call('owner', { method: 'session/cancel', params: { sessionId: 'saved' } })).resolves.toMatchObject({ stopReason: 'cancelled' })
        expect(vi.mocked(acp.call).mock.calls.some(([method]) => method === 'session/prompt' || method === 'session/cancel')).toBe(false)
        await expect(gateway.call('owner', prompt)).resolves.toMatchObject({ accepted: true })
        release(stage === 'session/list' ? { sessions: [{ sessionId: 'saved', cwd }] } : {})
        await expect(old).resolves.toMatchObject({ accepted: false, stopReason: 'cancelled' })
        expect(vi.mocked(acp.call).mock.calls.filter(([method]) => method === 'session/prompt')).toHaveLength(1)
        await expect(gateway.call('owner', prompt)).rejects.toMatchObject({ code: 'PROMPT_IN_PROGRESS' })
        gateway.dropPeer('owner')
        expect(vi.mocked(acp.call).mock.calls.some(([method]) => method === 'session/cancel')).toBe(false)
      } finally { await gateway.close() }
    } }))))
  })
  it('maps one-shot permission kinds to real option IDs without accepting result or persistent grants', async () => {
    await runScenarios(['allow-once', 'reject-once', 'cancel'].map(decision => ({ name: decision, run: async () => {
      const fixture = await approvalFixture()
      try {
        const handle = await fixture.request()
        for (const invalid of [
          { decision: 'allow-always' },
          { decision: ['allow-once'] },
          { decision: 'allow-once', result: { outcome: { outcome: 'selected', optionId: 'persistent' } } },
          { decision: 'allow-once', backend: 'cursor' },
        ]) await expect(fixture.gateway.respond('owner', { requestHandle: handle, ...invalid })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
        await expect(fixture.gateway.respond('observer', { requestHandle: handle, decision })).rejects.toMatchObject({ code: 'CURSOR_APPROVAL_NOT_FOUND' })
        expect(fixture.acp.respond).not.toHaveBeenCalled()
        await fixture.gateway.respond('owner', { requestHandle: handle, decision })
        if (decision === 'cancel') expect(fixture.acp.respondError).toHaveBeenCalledWith(7, -32800, expect.any(String))
        else expect(fixture.acp.respond).toHaveBeenCalledWith(7, { outcome: { outcome: 'selected', optionId: decision === 'allow-once' ? 'real-allow' : 'reject' } })
        await expect(fixture.gateway.respond('owner', { requestHandle: handle, decision })).rejects.toMatchObject({ code: 'CURSOR_APPROVAL_NOT_FOUND' })
      } finally { await fixture.gateway.close() }
    } })))
  })

  it('rejects orphan, mismatched and malformed upstream approvals without broadcasting or trusting upstream handles', async () => {
    const fixture = await approvalFixture()
    try {
      for (const params of [
        { sessionId: 'orphan', options: fixture.options },
        { sessionId: 'session', options: [] },
        { sessionId: 'session', options: [{ kind: 'allow_once', optionId: 'x' }, { kind: 'allow_once', optionId: 'y' }] },
        { sessionId: 'session', options: [{ kind: 'allow_once', optionId: 'x' }, { kind: 'reject_once', optionId: 'x' }] },
      ]) await fixture.emit({ kind: 'request', id: 8, method: 'session/request_permission', params })
      expect(fixture.publish).not.toHaveBeenCalled()
      expect(fixture.observer).not.toHaveBeenCalled()
      expect(fixture.acp.respondError).toHaveBeenCalledTimes(4)
      const handle = await fixture.request()
      expect(handle).not.toBe('forged')
      expect(fixture.observer).not.toHaveBeenCalled()
      fixture.gateway.dropPeer('owner')
      await expect(fixture.gateway.respond('observer', { requestHandle: handle, decision: 'allow-once' })).rejects.toMatchObject({ code: 'CURSOR_APPROVAL_NOT_FOUND' })
      await fixture.emit({ kind: 'request', id: 9, method: 'session/request_permission', params: { sessionId: 'session', options: fixture.options } })
      expect(fixture.publish).toHaveBeenCalledTimes(1)
      expect(fixture.observer).not.toHaveBeenCalled()
      expect(fixture.acp.respond).not.toHaveBeenCalled()
    } finally { await fixture.gateway.close() }
  })

  it('keeps unsupported one-shot decisions retryable and invalidates handles when a backend is rebuilt', async () => {
    const fixture = await approvalFixture()
    try {
      const handle = await fixture.request([{ kind: 'reject_once', optionId: 'only-reject' }])
      await expect(fixture.gateway.respond('owner', { requestHandle: handle, decision: 'allow-once' })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      await fixture.gateway.respond('owner', { requestHandle: handle, decision: 'reject-once' })
      expect(fixture.acp.respond).toHaveBeenLastCalledWith(7, { outcome: { outcome: 'selected', optionId: 'only-reject' } })
      const stale = await fixture.request()
      await fixture.gateway.reconfigure({ enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'new-agent', args: [] }] })
      await expect(fixture.gateway.respond('owner', { requestHandle: stale, decision: 'allow-once' })).rejects.toMatchObject({ code: 'CURSOR_APPROVAL_NOT_FOUND' })
    } finally { await fixture.gateway.close() }
  })

  it('rejects approval requests from a different backend than the session binding', async () => {
    const cursor = readyAcp(), agy = readyAcp()
    let inbound!: (message: CursorAcpInbound) => void
    agy.onInbound = listener => { inbound = listener; return () => undefined }
    cursor.call = vi.fn(async () => ({ sessionId: 'bound-session' }))
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [
      { id: 'cursor', enabled: true, command: 'agent', args: [] },
      { id: 'antigravity', enabled: true, command: 'agy', args: [] },
    ] }, silentLogger(), (_binary, _logger, backend) => backend.id === 'cursor' ? cursor : agy)
    await gateway.start()
    try {
      const publish = vi.fn(async () => undefined)
      gateway.createPeer({ connectionId: 'owner', peerDeviceId: 'device' } as never, publish)
      await gateway.call('owner', { method: 'session/new', params: { backend: 'cursor', cwd: process.cwd() } })
      inbound({ kind: 'request', id: 12, method: 'session/request_permission', params: { sessionId: 'bound-session', options: [{ kind: 'allow_once', optionId: 'allow' }] } })
      await (gateway as unknown as { inboundChain: Promise<void> }).inboundChain
      expect(agy.respondError).toHaveBeenCalledWith(12, -32602, expect.any(String))
      expect(cursor.respondError).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    } finally { await gateway.close() }
  })

  it('retains strict Cursor plan and question outcomes without a generic result bypass', async () => {
    await runScenarios([
      { method: 'cursor/create_plan', decision: 'allow-once', outcome: 'accepted' },
      { method: 'cursor/create_plan', decision: 'reject-once', outcome: 'rejected' },
      { method: 'cursor/ask_question', decision: 'reject-once', outcome: 'cancelled' },
    ].map(scenario => ({ name: `${scenario.method} ${scenario.decision}`, run: async () => {
      const fixture = await approvalFixture()
      try {
        await fixture.emit({ kind: 'request', id: 11, method: scenario.method, params: { sessionId: 'session' } })
        const frame = fixture.publish.mock.calls.at(-1) as unknown as [string, { frame: { params: { requestHandle: string } } }]
        const requestHandle = frame[1].frame.params.requestHandle
        await expect(fixture.gateway.respond('owner', { requestHandle, decision: scenario.decision, result: { outcome: { outcome: scenario.outcome, injected: true } } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
        await fixture.gateway.respond('owner', { requestHandle, decision: scenario.decision, result: { outcome: { outcome: scenario.outcome } } })
        expect(fixture.acp.respond).toHaveBeenCalledWith(11, { outcome: { outcome: scenario.outcome } })
      } finally { await fixture.gateway.close() }
    } })))
  })

  it('auto-initializes PI, respects explicit disable and isolates unavailable PI startup', async () => {
    await runScenarios([
      { name: 'default PI becomes ready after initialization', input: {}, disabled: false, missing: false },
      { name: 'explicit backend disable prevents startup', input: { acp: { backends: [{ id: 'pi', enabled: false }] } }, disabled: true, missing: false },
      { name: 'ACP master disable prevents startup', input: { acp: { enabled: false } }, disabled: true, missing: false },
      { name: 'missing PI does not prevent Cursor becoming ready', input: { cursor: { enabled: true } }, disabled: false, missing: true },
    ].map(scenario => ({ name: scenario.name, run: async () => {
      const pi = readyAcp(), cursor = readyAcp()
      if (scenario.missing) vi.mocked(pi.start).mockRejectedValue(new Error('PI executable unavailable'))
      const create = vi.fn((_binary: string, _logger: SafeLogger, backend: { id: string }) => backend.id === 'pi' ? pi : cursor)
      const gateway = new AcpRemoteGateway(resolveConfig(scenario.input).acp!, silentLogger(), create)
      try {
        await gateway.start()
        expect(gateway.availableBackends().includes('pi')).toBe(!scenario.disabled && !scenario.missing)
        expect(pi.start).toHaveBeenCalledTimes(scenario.disabled ? 0 : 1)
        if (scenario.missing) expect(gateway.availableBackends()).toContain('cursor')
      } finally { await gateway.close() }
    } })))
  })
  it('keeps Claude explicitly selected and unavailable after disabling without falling back to Cursor', async () => {
    const claude = readyAcp()
    const cursor = readyAcp()
    const config = { enabled: true, backends: [
      { id: 'claude', enabled: true, command: 'claude-agent-acp', args: [] },
      { id: 'cursor', enabled: true, command: 'agent', args: ['acp'] },
    ] }
    const gateway = new AcpRemoteGateway(config, silentLogger(), (_binary, _logger, backend) => backend.id === 'claude' ? claude : cursor)
    await gateway.start()
    try {
      expect(gateway.availableBackends()).toContain('claude')
      await expect(gateway.call('client', { method: 'initialize', params: { backend: 'claude' } })).resolves.toMatchObject({ backend: 'claude' })
      await gateway.reconfigure({ ...config, backends: config.backends.map(item => ({ ...item, enabled: item.id !== 'claude' })) })
      expect(claude.close).toHaveBeenCalledTimes(1)
      expect(cursor.close).not.toHaveBeenCalled()
      await expect(gateway.call('client', { method: 'initialize', params: { backend: 'claude' } })).rejects.toMatchObject({ code: 'CURSOR_UNAVAILABLE' })
    } finally { await gateway.close() }
  })
  it('uses PI catalog cwd authority and prevents another connection from stealing loaded sessions', async () => {
    const acp = readyAcp()
    const cwd = await realpath(process.cwd())
    acp.call = vi.fn(async (method) => method === 'session/list'
      ? { sessions: [{ sessionId: 'pi-saved', cwd, title: 'Saved', updatedAt: new Date(0).toISOString() }] }
      : {})
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'pi', enabled: true, command: 'pi-acp', args: [] }] }, silentLogger(), () => acp)
    await gateway.start()
    try {
      await expect(gateway.call('one', { method: 'dsh/sessionList', params: { backend: 'pi', path: cwd } })).resolves.toMatchObject({ items: [{ conversationId: 'pi-saved' }] })
      await gateway.call('one', { method: 'session/load', params: { backend: 'pi', sessionId: 'pi-saved' } })
      expect(acp.call).toHaveBeenLastCalledWith('session/load', expect.objectContaining({ cwd, mcpServers: [] }))
      await expect(gateway.call('two', { method: 'session/load', params: { backend: 'pi', sessionId: 'pi-saved' } })).rejects.toMatchObject({ code: 'CURSOR_SESSION_OWNED' })
      let finish!: (value: unknown) => void
      vi.mocked(acp.call).mockImplementation(async method => method === 'session/prompt' ? new Promise(resolve => { finish = resolve }) : method === 'session/list' ? { sessions: [] } : {})
      const prompt = { method: 'session/prompt', params: { backend: 'pi', sessionId: 'pi-saved', prompt: [{ type: 'text', text: 'hello' }] } }
      await expect(gateway.call('one', prompt)).resolves.toMatchObject({ accepted: true })
      await expect(gateway.call('one', prompt)).rejects.toMatchObject({ code: 'PROMPT_IN_PROGRESS' })
      gateway.dropPeer('one')
      await expect(gateway.call('two', { method: 'session/load', params: { backend: 'pi', sessionId: 'pi-saved' } })).resolves.toBeDefined()
      finish({ stopReason: 'end_turn' })
      await expect(gateway.call('two', { method: 'session/load', params: { backend: 'pi', sessionId: 'unknown' } })).rejects.toMatchObject({ code: 'ACP_WORKSPACE_UNAVAILABLE' })
    } finally { await gateway.close() }
  })
  it('fails closed for malformed or incomplete upstream catalogs while accepting a complete empty catalog', async () => {
    await runScenarios([
      { name: 'missing sessions', result: () => ({}), valid: false },
      { name: 'non-object response', result: () => null, valid: false },
      { name: 'non-array sessions', result: () => ({ sessions: {} }), valid: false },
      { name: 'invalid cursor type', result: () => ({ sessions: [], nextCursor: 1 }), valid: false },
      { name: 'empty cursor', result: () => ({ sessions: [], nextCursor: '' }), valid: false },
      { name: 'repeated cursor', result: () => ({ sessions: [], nextCursor: 'loop' }), valid: false },
      { name: 'page budget exhausted', result: (page: number) => ({ sessions: [], nextCursor: String(page) }), valid: false },
      { name: 'complete empty catalog', result: () => ({ sessions: [] }), valid: true },
      { name: 'complete empty catalog with null cursor (published Pi ACP)', result: () => ({ sessions: [], nextCursor: null }), valid: true },
      { name: 'paginated catalog with null final cursor', result: (page: number) => ({ sessions: [], nextCursor: page === 0 ? 'last' : null }), valid: true },
      { name: 'complete paginated empty catalog', result: (page: number) => ({ sessions: [], ...(page === 0 ? { nextCursor: 'last' } : {}) }), valid: true },
    ].map(scenario => ({ name: scenario.name, run: async () => {
      const acp = readyAcp()
      let page = 0
      acp.call = vi.fn(async () => scenario.result(page++))
      const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'claude', enabled: true, command: 'claude-agent-acp', args: [] }] }, silentLogger(), () => acp)
      await gateway.start()
      try {
        const result = gateway.call('owner', { method: 'dsh/workspaceList', params: { backend: 'claude' } })
        if (scenario.valid) await expect(result).resolves.toEqual([])
        else await expect(result).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      } finally { await gateway.close() }
    } })))
  })

  it('restores Claude exclusively from the upstream catalog and isolates history from active prompts', async () => {
    const cwd = await realpath(process.cwd())
    const history = vi.fn(async () => [{ method: 'session/update', params: { sessionId: 'saved' } }])
    const acp = Object.assign(readyAcp(), { history })
    let finish!: (value: unknown) => void
    acp.call = vi.fn(async method => method === 'session/list'
      ? { sessions: [{ sessionId: 'saved', cwd }, { sessionId: 'relative', cwd: '.' }] }
      : method === 'session/prompt' ? new Promise(resolve => { finish = resolve }) : {})
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'claude', enabled: true, command: 'claude-agent-acp', args: [] }] }, silentLogger(), () => acp)
    await gateway.start()
    try {
      // An unknown history request must not reserve an owner before authority exists.
      vi.mocked(acp.call).mockResolvedValueOnce({ sessions: [] })
      await expect(gateway.call('invalid-requester', { method: 'dsh/sessionHistory', params: { backend: 'claude', sessionId: 'claude:saved' } })).rejects.toMatchObject({ code: 'ACP_WORKSPACE_UNAVAILABLE' })
      // Fresh Host has no in-memory cwd; load must obtain authority from session/list.
      await gateway.call('owner', { method: 'session/load', params: { backend: 'claude', sessionId: 'saved' } })
      expect(acp.call).toHaveBeenLastCalledWith('session/load', { backend: 'claude', sessionId: 'saved', cwd, mcpServers: [] })
      await expect(gateway.call('owner', { method: 'dsh/workspaceList', params: { backend: 'claude' } })).resolves.toEqual([{ path: cwd, title: expect.any(String) }])
      await expect(gateway.call('owner', { method: 'dsh/sessionList', params: { backend: 'claude', path: cwd } })).resolves.toMatchObject({ items: [{ conversationId: 'saved', cwd }] })
      for (const params of [
        { backend: 'claude', sessionId: 'missing' },
        { backend: 'claude', sessionId: 'relative' },
      ]) await expect(gateway.call('owner', { method: 'session/load', params })).rejects.toMatchObject({ code: 'ACP_WORKSPACE_UNAVAILABLE' })
      for (const params of [{ sessionId: 'saved' }, { backend: 'claude', sessionId: 'saved', cwd: '/tmp' }]) {
        await expect(gateway.call('owner', { method: 'session/load', params })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      }
      for (const sessionId of ['pi:saved', 'cursor:saved', 'acp:saved']) {
        await expect(gateway.call('owner', { method: 'dsh/sessionHistory', params: { backend: 'claude', sessionId } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      }
      await expect(gateway.call('other', { method: 'session/load', params: { backend: 'claude', sessionId: 'saved' } })).rejects.toMatchObject({ code: 'CURSOR_SESSION_OWNED' })
      await expect(gateway.call('other', { method: 'dsh/sessionHistory', params: { backend: 'claude', sessionId: 'claude:saved' } })).resolves.toEqual({ events: await history() })
      await gateway.call('owner', { method: 'session/prompt', params: { backend: 'claude', sessionId: 'saved', prompt: [{ type: 'text', text: 'hello' }] } })
      await expect(gateway.call('owner', { method: 'dsh/sessionHistory', params: { backend: 'claude', sessionId: 'claude:saved' } })).resolves.toEqual({ events: await history() })
      expect(history).toHaveBeenCalledWith('saved', cwd)
      gateway.dropPeer('owner')
      await expect(gateway.call('other', { method: 'session/load', params: { backend: 'claude', sessionId: 'saved' } })).rejects.toMatchObject({ code: 'PROMPT_IN_PROGRESS' })
      finish({ stopReason: 'end_turn' })
    } finally { await gateway.close() }
  })

  it('allows catalog-authorized history across connections without claiming or stealing live session control', async () => {
    await runScenarios((['pi', 'claude', 'opencode'] as const).map(backend => ({ name: backend, run: async () => {
      const cwd = await realpath(process.cwd())
      const events = [{ method: 'session/update', params: { sessionId: 'saved' } }]
      const history = vi.fn(async () => events)
      const acp = Object.assign(readyAcp(), { history })
      let finish: ((value: unknown) => void) | undefined
      acp.call = vi.fn(async method => method === 'session/list'
        ? { sessions: [{ sessionId: 'saved', cwd }] }
        : method === 'session/prompt' ? new Promise(resolve => { finish = resolve }) : {})
      const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: backend, enabled: true, command: 'fixture', args: [] }] }, silentLogger(), () => acp)
      await gateway.start()
      const read = { method: 'dsh/sessionHistory', params: { backend, sessionId: `${backend}:saved` } }
      const prompt = { method: 'session/prompt', params: { backend, sessionId: 'saved', prompt: [{ type: 'text', text: 'hello' }] } }
      try {
        await expect(gateway.call('reader', read)).resolves.toEqual({ events })
        expect(history).toHaveBeenCalledWith('saved', cwd)
        expect(vi.mocked(acp.call).mock.calls.map(([method]) => method)).toEqual(['session/list'])
        // Reading first must not reserve ownership and prevent a different peer loading.
        await expect(gateway.call('owner', { method: 'session/load', params: { backend, sessionId: 'saved' } })).resolves.toBeDefined()
        await expect(gateway.call('owner', prompt)).resolves.toMatchObject({ accepted: true })
        await expect(gateway.call('reader', read)).resolves.toEqual({ events })
        for (const mutation of [prompt,
          { method: 'session/cancel', params: { sessionId: 'saved' } },
          { method: 'dsh/selectModel', params: { backend, sessionId: 'saved', model: 'other' } },
        ]) await expect(gateway.call('reader', mutation)).rejects.toMatchObject({ code: 'CURSOR_SESSION_OWNED' })
        await expect(gateway.call('reader', { ...read, params: { backend, sessionId: `${backend}:unknown` } })).rejects.toMatchObject({ code: 'ACP_WORKSPACE_UNAVAILABLE' })
        const otherBackend = backend === 'pi' ? 'opencode' : 'pi'
        await expect(gateway.call('reader', { ...read, params: { backend, sessionId: `${otherBackend}:saved` } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
        expect(history).toHaveBeenCalledTimes(2)
        // The reader must not displace the current owner or stop its active turn.
        await expect(gateway.call('owner', { method: 'session/cancel', params: { sessionId: 'saved' } })).resolves.toBeDefined()
        expect(vi.mocked(acp.call).mock.calls.filter(([method]) => method === 'session/prompt')).toHaveLength(1)
        expect(vi.mocked(acp.call).mock.calls.filter(([method]) => method === 'session/cancel')).toHaveLength(1)
      } finally { finish?.({ stopReason: 'end_turn' }); await gateway.close() }
    } })))
  })

  it('rejects stale catalog authority across backend replacement, disable and shutdown', async () => {
    const cwd = await realpath(process.cwd())
    const nextCwd = await realpath('..')
    await runScenarios((['pi', 'claude'] as const).flatMap(backend =>
      (['catalog response', 'catalog directory', 'cached directory'] as const).flatMap(checkpoint =>
        (['replace', 'disable', 'close'] as const).map(transition => ({
          name: `${backend}: ${checkpoint} / ${transition}`,
          run: async () => {
            let enter!: () => void, release!: () => void
            const entered = new Promise<void>(resolve => { enter = resolve })
            const gate = new Promise<void>(resolve => { release = resolve })
            let paused = false
            let armed = false
            const previous = Object.assign(readyAcp(), { history: vi.fn(async () => []) })
            const next = Object.assign(readyAcp(), { history: vi.fn(async () => []) })
            previous.call = vi.fn(async () => {
              if (armed && checkpoint === 'catalog response' && !paused) {
                paused = true; enter(); await gate
              }
              return { sessions: [{ sessionId: 'saved', cwd }] }
            })
            next.call = vi.fn(async () => ({ sessions: [{ sessionId: 'saved', cwd: nextCwd }] }))
            const initial = { enabled: true, backends: [{ id: backend, enabled: true, command: 'previous', args: [] }] }
            const gateway = new AcpRemoteGateway(initial, silentLogger(), binary => binary === 'previous' ? previous : next)
            const directories = gateway as unknown as { requireExistingDirectory(path: string): Promise<string> }
            const original = directories.requireExistingDirectory.bind(gateway)
            const directory = vi.spyOn(directories, 'requireExistingDirectory').mockImplementation(async path => {
              if (armed && checkpoint !== 'catalog response' && !paused) {
                paused = true; enter(); await gate
              }
              return original(path)
            })
            try {
              await gateway.start()
              if (checkpoint === 'cached directory') {
                await gateway.call('owner', { method: 'dsh/workspaceList', params: { backend } })
              }
              armed = true
              const request = checkpoint === 'cached directory'
                ? { method: 'dsh/sessionHistory', params: { backend, sessionId: `${backend}:saved` } }
                : { method: 'dsh/workspaceList', params: { backend } }
              // Attach rejection handling before retiring the old generation.
              const pending = gateway.call('owner', request).then(result => ({ result, error: undefined }), error => ({ result: undefined, error }))
              await entered
              if (transition === 'close') await gateway.close()
              else await gateway.reconfigure({ enabled: true, backends: [{ ...initial.backends[0]!, command: 'next', enabled: transition !== 'disable' }] })
              release()
              expect((await pending).error).toMatchObject({ code: 'CURSOR_UNAVAILABLE' })
              expect(previous.history).not.toHaveBeenCalled()
              if (transition === 'replace') {
                await expect(gateway.call('next-owner', { method: 'dsh/sessionHistory', params: { backend, sessionId: `${backend}:saved` } })).resolves.toEqual({ events: [] })
                expect(next.call).toHaveBeenCalledWith('session/list', {})
                expect(next.history).toHaveBeenCalledWith('saved', nextCwd)
              } else expect(next.history).not.toHaveBeenCalled()
            } finally {
              release()
              directory.mockRestore()
              await gateway.close()
            }
          },
        })))),
    )
  })

  it('revokes only cancelled session approvals and rejects late handles and upstream requests', async () => {
    const fixture = await approvalFixture('claude')
    try {
      const handle = await fixture.request()
      vi.mocked(fixture.acp.call).mockResolvedValueOnce({ sessionId: 'other-session' })
      await fixture.gateway.call('owner', { method: 'session/new', params: { backend: 'claude', cwd: process.cwd() } })
      await fixture.peer.openStream({ streamId: 'other-stream', sessionId: 'other-session' })
      await fixture.emit({ kind: 'request', id: 8, method: 'session/request_permission', params: { sessionId: 'other-session', options: fixture.options } })
      const otherFrame = fixture.publish.mock.calls.at(-1) as unknown as [string, { frame: { params: { requestHandle: string } } }]
      const otherHandle = otherFrame[1].frame.params.requestHandle
      await fixture.gateway.call('owner', { method: 'session/cancel', params: { sessionId: 'session' } })
      expect(fixture.acp.call).toHaveBeenLastCalledWith('session/cancel', { sessionId: 'session' })
      expect(fixture.acp.respondError).toHaveBeenCalledWith(7, -32800, expect.any(String))
      await expect(fixture.gateway.respond('owner', { requestHandle: handle, decision: 'allow-once' })).rejects.toMatchObject({ code: 'CURSOR_APPROVAL_NOT_FOUND' })
      await fixture.emit({ kind: 'request', id: 99, method: 'session/request_permission', params: { sessionId: 'session', options: fixture.options } })
      expect(fixture.acp.respondError).toHaveBeenLastCalledWith(99, -32602, expect.any(String))
      expect(fixture.publish).toHaveBeenCalledTimes(2)
      await fixture.gateway.respond('owner', { requestHandle: otherHandle, decision: 'allow-once' })
      expect(fixture.acp.respond).toHaveBeenCalledWith(8, { outcome: { outcome: 'selected', optionId: 'real-allow' } })
      expect(vi.mocked(fixture.acp.call).mock.invocationCallOrder.at(-1)!).toBeLessThan(vi.mocked(fixture.acp.respondError).mock.invocationCallOrder[0]!)
    } finally { await fixture.gateway.close() }
  })

  it('isolates backend startup, hot updates and shutdown', async () => {
    await runScenarios([
      {
        name: 'updates one backend live while preserving other backend processes and existing peers',
        run: async () => {
          const cursor = readyAcp()
          const agy = readyAcp()
          const initial = {
            enabled: true,
            backends: [
              { id: 'cursor', enabled: false, command: 'agent', args: ['acp'] },
              { id: 'antigravity', enabled: true, command: 'agy', args: [] },
            ],
          }
          const gateway = new AcpRemoteGateway(initial, silentLogger(), (_binary, _logger, backend) =>
            backend.id === 'cursor' ? cursor : agy,
          )
          await gateway.start()
          const peer = gateway.createPeer(
            { connectionId: 'live-peer', peerDeviceId: 'device' } as never,
            async () => undefined,
          )!
          await gateway.reconfigure({
            ...initial,
            backends: initial.backends.map((item) => ({ ...item, enabled: true })),
          })
          expect(gateway.availableBackends().sort()).toEqual(['antigravity', 'cursor'])
          expect(agy.close).not.toHaveBeenCalled()
          await expect(
            peer.call({ method: 'initialize', params: { backend: 'cursor' } }),
          ).resolves.toMatchObject({ backend: 'cursor' })
          await gateway.reconfigure(initial)
          expect(cursor.close).toHaveBeenCalledTimes(1)
          expect(agy.close).not.toHaveBeenCalled()
          await expect(
            peer.call({ method: 'initialize', params: { backend: 'cursor' } }),
          ).rejects.toMatchObject({ code: 'CURSOR_UNAVAILABLE' })
          await expect(
            peer.call({ method: 'initialize', params: { backend: 'antigravity' } }),
          ).resolves.toMatchObject({ backend: 'antigravity' })
          await gateway.close()
        },
      },
      {
        name: 'stops a starting backend when disabled and rejects its late initialization',
        run: async () => {
          let finish!: () => void
          const starting = readyAcp()
          starting.start = vi.fn(
            () =>
              new Promise<void>((resolve) => {
                finish = resolve
              }),
          )
          starting.close = vi.fn(async () => {
            finish()
          })
          const ready = readyAcp()
          const factory = vi.fn(() => ready).mockReturnValueOnce(starting)
          const config = {
            enabled: true,
            backends: [{ id: 'cursor', enabled: true, command: '/explicit/cursor', args: ['acp'] }],
          }
          const gateway = new AcpRemoteGateway(config, silentLogger(), factory)
          const startup = gateway.start()
          await vi.waitFor(() => expect(starting.start).toHaveBeenCalledOnce())
          await gateway.reconfigure({
            ...config,
            backends: config.backends.map((item) => ({ ...item, enabled: false })),
          })
          await startup
          expect(starting.close).toHaveBeenCalled()
          expect(factory).toHaveBeenCalledOnce()
          expect(gateway.isAvailable()).toBe(false)
          expect(gateway.availableBackends()).toEqual([])
          expect(gateway.status().state).toBe('disabled')
          await gateway.reconfigure(config)
          expect(factory).toHaveBeenCalledTimes(2)
          expect(gateway.availableBackends()).toEqual(['cursor'])
          await gateway.close()
        },
      },
      {
        name: 'honors the global switch and independent backend launch settings',
        run: async () => {
          const factory = vi.fn(() => readyAcp())
          const backends = [
            { id: 'cursor', enabled: false, command: '/custom/cursor', args: ['acp'] },
            {
              id: 'antigravity',
              enabled: true,
              command: '/custom/agy-wrapper',
              args: ['--custom'],
              cwd: '/tmp',
            },
          ]
          const disabled = new AcpRemoteGateway({ enabled: false, backends }, silentLogger(), factory)
          await disabled.start()
          expect(factory).not.toHaveBeenCalled()
          await disabled.close()
          const gateway = new AcpRemoteGateway({ enabled: true, backends }, silentLogger(), factory)
          await gateway.start()
          try {
            expect(factory).toHaveBeenCalledTimes(1)
            expect(factory).toHaveBeenCalledWith('/custom/agy-wrapper', expect.anything(), backends[1])
            expect(gateway.availableBackends()).toEqual(['antigravity'])
            await expect(
              gateway.call('owner', {
                method: 'session/load',
                params: { sessionId: 'cursor-old', backend: 'cursor' },
              }),
            ).rejects.toMatchObject({ code: 'CURSOR_UNAVAILABLE' })
            await expect(
              gateway.call('owner', { method: 'initialize', params: { backend: 'cursor' } }),
            ).rejects.toMatchObject({ code: 'CURSOR_UNAVAILABLE' })
          } finally {
            await gateway.close()
          }
        },
      },
      {
        name: 'makes a ready backend usable while another initializes and cleans up late startup on close',
        run: async () => {
          let release!: () => void
          const slow = readyAcp()
          slow.start = vi.fn(
            () =>
              new Promise<void>((resolve) => {
                release = resolve
              }),
          )
          const fast = readyAcp()
          const factory = vi.fn((_binary: string, _logger: SafeLogger, backend: { id: string }) =>
            backend.id === 'cursor' ? slow : fast,
          )
          const gateway = new AcpRemoteGateway(
            {
              enabled: true,
              backends: [
                { id: 'cursor', enabled: true, command: '/slow-cursor', args: ['acp'] },
                { id: 'antigravity', enabled: true, command: '/fast-agy', args: [] },
              ],
            },
            silentLogger(),
            factory,
          )
          const startup = gateway.start()
          const sameStartup = gateway.start()
          expect(sameStartup).toBe(startup)
          await vi.waitFor(() => expect(gateway.availableBackends()).toEqual(['antigravity']))
          expect(gateway.isAvailable()).toBe(true)
          await gateway.close()
          expect(slow.close).toHaveBeenCalled()
          release()
          await startup
          expect(gateway.status()).toMatchObject({ state: 'disabled', available: false, availableBackends: [] })
          expect(factory).toHaveBeenCalledTimes(2)
        },
      },
    ])
  }, 20000)

  it('prewarms only a validated selected AGY directory while listing history', async () => {
    const acp = readyAcp()
    acp.prewarmSession = vi.fn()
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'antigravity', enabled: true, command: 'agy', args: [] }, { id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] }, silentLogger(), () => acp)
    await gateway.start()
    try {
      const list = (path: string, backend = 'antigravity') => gateway.call('warm-connection', {
        method: 'dsh/sessionList', params: { path, backend },
      })
      await list(process.cwd())
      expect(acp.prewarmSession).toHaveBeenCalledWith(await realpath(process.cwd()))
      await gateway.call('warm-connection', { method: 'dsh/sessionList', params: { path: process.cwd(), backend: 'antigravity', prewarm: false } })
      expect(acp.prewarmSession).toHaveBeenCalledTimes(1)
      await list('')
      await list(process.cwd(), 'cursor')
      await expect(list('/nonexistent-agy-prewarm-directory')).rejects.toMatchObject({ code: 'CURSOR_PATH_NOT_ALLOWED' })
      expect(acp.prewarmSession).toHaveBeenCalledTimes(1)
    } finally {
      await gateway.close()
    }
  })

  it('rejects AGY images and mismatched backend labels on a Cursor-owned session', async () => {
    const acp = readyAcp()
    acp.call = vi.fn(async () => ({ sessionId: 'cursor-image-session' }))
    const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] }, silentLogger(), () => acp)
    await gateway.start()
    try {
      await gateway.call('owner', { method: 'session/new', params: { cwd: process.cwd(), backend: 'cursor' } })
      const prompt = [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=' }]
      await expect(gateway.call('owner', { method: 'session/prompt', params: { sessionId: 'cursor-image-session', backend: 'cursor', prompt } })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
      await expect(gateway.call('owner', { method: 'session/prompt', params: { sessionId: 'cursor-image-session', backend: 'antigravity', prompt } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      await expect(gateway.call('owner', { method: 'dsh/sessionHistory', params: { sessionId: 'acp:cursor-image-session', backend: 'antigravity' } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      await expect(gateway.call('owner', { method: 'dsh/sessionHistory', params: { sessionId: 'acp:cursor-image-session', backend: 'cursor' } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      expect(await gateway.call('owner', { method: 'dsh/sessionHistory', params: { sessionId: 'cursor:cursor-image-session', backend: 'cursor' } })).toEqual({ events: [] })
      expect(acp.call).toHaveBeenCalledTimes(1)
    } finally { await gateway.close() }
  })

  it('answers initialize on the gateway without forwarding to Cursor', async () => {
    const acp = readyAcp()
    const gateway = new AcpRemoteGateway(
      { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] },
      silentLogger(),
      () => acp,
    )
    await gateway.start()
    expect(gateway.isAvailable()).toBe(true)

    const result = await gateway.call('conn-1', {
      method: 'initialize',
      params: { protocolVersion: 1, clientInfo: { name: 'test', version: '0.0.1' } },
    })

    expect(result).toMatchObject({
      protocolVersion: 1,
      backend: 'cursor',
      agentInfo: { name: 'dsh-remote-acp' },
      capabilities: {
        loadSession: true,
        promptTypes: ['text'],
      },
    })
    expect(acp.call).not.toHaveBeenCalled()
  })

  it('delivers ordered ACP stream updates and recovers buffered frames', async () => {
    await runScenarios([
      {
        name: 'keeps ACP inbound subscribed after first launch dispose',
        run: async () => {
          let subscribed = false
          let unsubscribed = false
          let inbound:
            | ((message: { kind: 'notification'; method: string; params: unknown }) => void)
            | undefined
          const acp = readyAcp()
          acp.onInbound = (handler) => {
            subscribed = true
            inbound = handler as typeof inbound
            return () => {
              unsubscribed = true
            }
          }
          acp.call = vi.fn(async (method: string) => {
            if (method === 'session/new') return { sessionId: 'sess-sub' }
            return {}
          })
          const gateway = new AcpRemoteGateway(
            { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] },
            silentLogger(),
            () => acp,
          )
          await gateway.start()
          expect(subscribed).toBe(true)
          expect(unsubscribed).toBe(false)

          const frames: Array<{ event: string; data: unknown }> = []
          const peer = gateway.createPeer(
            { connectionId: 'conn-sub', peerDeviceId: 'client-1' },
            async (event, data) => {
              frames.push({ event, data })
            },
          )
          await gateway.call('conn-sub', {
            method: 'session/new',
            params: { cwd: '/tmp', mcpServers: [] },
          })
          await peer!.openStream({ streamId: 'stream-sub', sessionId: 'sess-sub' })
          inbound?.({
            kind: 'notification',
            method: 'session/update',
            params: {
              sessionId: 'sess-sub',
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'alive' } },
            },
          })
          await vi.waitFor(() => {
            expect(frames.some((frame) => frame.event === 'agent.acp.frame')).toBe(true)
          })
          expect(unsubscribed).toBe(false)
        },
      },
      {
        name: 'accepts session/prompt immediately and finishes via stream update',
        run: async () => {
          let resolvePrompt: (value: unknown) => void = () => undefined
          const promptGate = new Promise<unknown>((resolve) => {
            resolvePrompt = resolve
          })
          let inbound:
            | ((message: { kind: 'notification'; method: string; params: unknown }) => void)
            | undefined
          const acp = readyAcp()
          acp.onInbound = (handler) => {
            inbound = handler as typeof inbound
            return () => undefined
          }
          acp.call = vi.fn(async (method: string) => {
            if (method === 'session/new') return { sessionId: 'sess-1' }
            if (method === 'session/prompt') return promptGate
            return {}
          })
          const gateway = new AcpRemoteGateway(
            { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] },
            silentLogger(),
            () => acp,
          )
          await gateway.start()
          const frames: Array<{ event: string; data: unknown }> = []
          const peer = gateway.createPeer(
            { connectionId: 'conn-1', peerDeviceId: 'client-1' },
            async (event, data) => {
              frames.push({ event, data })
            },
          )
          expect(peer).toBeDefined()
          await gateway.call('conn-1', {
            method: 'session/new',
            params: { cwd: '/tmp', mcpServers: [] },
          })
          await peer!.openStream({ streamId: 'stream-1', sessionId: 'sess-1' })

          const accepted = await gateway.call('conn-1', {
            method: 'session/prompt',
            params: { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'hi' }] },
          })
          expect(accepted).toEqual({ accepted: true, stopReason: 'in_progress' })
          expect(acp.call).toHaveBeenCalledWith('session/prompt', expect.anything())

          inbound?.({
            kind: 'notification',
            method: 'session/update',
            params: {
              sessionId: 'sess-1',
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
            },
          })
          // Resolve the upstream prompt immediately after enqueueing the update so
          // the gateway must drain inboundChain before snapshotting catchUp.
          resolvePrompt({ stopReason: 'end_turn' })
          await vi.waitFor(() => {
            expect(
              frames.some((frame) => {
                if (frame.event !== 'agent.acp.frame') return false
                const data = frame.data as {
                  streamId?: string
                  frame?: { params?: { update?: { sessionUpdate?: string; catchUp?: unknown[] } } }
                }
                return (
                  data.streamId === 'session:sess-1' &&
                  data.frame?.params?.update?.sessionUpdate === 'prompt_completed' &&
                  Array.isArray(data.frame?.params?.update?.catchUp) &&
                  (data.frame?.params?.update?.catchUp?.length ?? 0) >= 1
                )
              }),
            ).toBe(true)
          })
        },
      },
      {
        name: 'fans out burst session/update notifications in order without dropping',
        run: async () => {
          let inbound:
            | ((message: { kind: 'notification'; method: string; params: unknown }) => void)
            | undefined
          const acp = readyAcp()
          acp.onInbound = (handler) => {
            inbound = handler as typeof inbound
            return () => undefined
          }
          acp.call = vi.fn(async (method: string) => {
            if (method === 'session/new') return { sessionId: 'sess-burst' }
            return {}
          })
          const gateway = new AcpRemoteGateway(
            { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] },
            silentLogger(),
            () => acp,
          )
          await gateway.start()
          const frames: Array<{ event: string; data: unknown }> = []
          const peer = gateway.createPeer(
            { connectionId: 'conn-burst', peerDeviceId: 'client-1' },
            async (event, data) => {
              // Simulate slow secure-channel send so fanout must serialize.
              await new Promise((resolve) => setTimeout(resolve, 5))
              frames.push({ event, data })
            },
          )
          expect(peer).toBeDefined()
          await gateway.call('conn-burst', {
            method: 'session/new',
            params: { cwd: '/tmp', mcpServers: [] },
          })
          await peer!.openStream({ streamId: 'stream-burst', sessionId: 'sess-burst' })

          const kinds = ['agent_thought_chunk', 'agent_message_chunk', 'agent_message_chunk']
          for (const kind of kinds) {
            inbound?.({
              kind: 'notification',
              method: 'session/update',
              params: {
                sessionId: 'sess-burst',
                update: { sessionUpdate: kind, content: { type: 'text', text: kind } },
              },
            })
          }

          await vi.waitFor(() => {
            expect(frames.filter((frame) => frame.event === 'agent.acp.frame')).toHaveLength(3)
          })
          const received = frames
            .filter((frame) => frame.event === 'agent.acp.frame')
            .map((frame) => {
              const data = frame.data as { frame?: { params?: { update?: { sessionUpdate?: string } } } }
              return data.frame?.params?.update?.sessionUpdate
            })
          expect(received).toEqual(kinds)
        },
      },
      {
        name: 'buffers frames while peers are down and replays them on stream open',
        run: async () => {
          let inbound:
            | ((message: { kind: 'notification'; method: string; params: unknown }) => void)
            | undefined
          const acp = readyAcp()
          acp.onInbound = (handler) => {
            inbound = handler as typeof inbound
            return () => undefined
          }
          acp.call = vi.fn(async (method: string) => {
            if (method === 'session/new') return { sessionId: 'sess-buffer' }
            return {}
          })
          const gateway = new AcpRemoteGateway(
            { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }] },
            silentLogger(),
            () => acp,
          )
          await gateway.start()
          await gateway.call('conn-buffer', {
            method: 'session/new',
            params: { cwd: '/tmp', mcpServers: [] },
          })

          // Drop the peer so live publish has nowhere to go.
          gateway.dropPeer('conn-buffer')
          inbound?.({
            kind: 'notification',
            method: 'session/update',
            params: {
              sessionId: 'sess-buffer',
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
            },
          })
          await vi.waitFor(() => {
            expect(
              (gateway as unknown as { recentFrames: Map<string, unknown[]> }).recentFrames.get('sess-buffer')
                ?.length,
            ).toBe(1)
          })

          const frames: Array<{ event: string; data: unknown }> = []
          const peer = gateway.createPeer(
            { connectionId: 'conn-buffer-2', peerDeviceId: 'client-1' },
            async (event, data) => {
              frames.push({ event, data })
            },
          )
          expect(peer).toBeDefined()
          await peer!.openStream({ streamId: 'stream-buffer', sessionId: 'sess-buffer' })
          await vi.waitFor(() => {
            expect(
              frames.some((frame) => {
                if (frame.event !== 'agent.acp.frame') return false
                const data = frame.data as { frame?: { params?: { update?: { sessionUpdate?: string } } } }
                return data.frame?.params?.update?.sessionUpdate === 'agent_message_chunk'
              }),
            ).toBe(true)
          })
        },
      },
    ])
  }, 20000)

  it('only reports antigravity in availableBackends when cursor binary is unavailable', async () => {
    const gateway = new AcpRemoteGateway(
      { enabled: true, backends: [{ id: 'cursor', enabled: true, command: 'agent', args: ['acp'] }, { id: 'antigravity', enabled: true, command: 'agy', args: [] }] },
      silentLogger(),
      (binary) => {
        if (binary.includes('agent') || binary === 'agent') {
          throw new Error('agent: not found')
        }
        return readyAcp()
      },
    )
    await gateway.start()
    expect(gateway.isAvailable()).toBe(true)
    expect(gateway.availableBackends()).toEqual(['antigravity'])
    expect(gateway.status().availableBackends).toEqual(['antigravity'])
    const init = await gateway.call('conn-test', {
      method: 'initialize',
      params: { protocolVersion: 1 },
    }) as { backend: string; availableBackends: string[] }
    expect(init.backend).toBe('antigravity')
    expect(init.availableBackends).toEqual(['antigravity'])
  })
})

async function approvalFixture(backend = 'cursor') {
  const acp = readyAcp()
  let inbound!: (message: CursorAcpInbound) => void
  acp.onInbound = listener => { inbound = listener; return () => undefined }
  acp.call = vi.fn(async () => ({ sessionId: 'session' }))
  const gateway = new AcpRemoteGateway({ enabled: true, backends: [{ id: backend, enabled: true, command: 'agent', args: [] }] }, silentLogger(), () => acp)
  await gateway.start()
  const publish = vi.fn(async () => undefined), observer = vi.fn(async () => undefined)
  const peer = gateway.createPeer({ connectionId: 'owner', peerDeviceId: 'device' } as never, publish)!
  gateway.createPeer({ connectionId: 'observer', peerDeviceId: 'other' } as never, observer)
  await gateway.call('owner', { method: 'session/new', params: { backend, cwd: process.cwd() } })
  await peer.openStream({ streamId: 'stream', sessionId: 'session' })
  const options = [{ kind: 'allow_once', optionId: 'real-allow' }, { kind: 'reject_once', optionId: 'reject' }, { kind: 'allow_always', optionId: 'persistent' }]
  const emit = async (message: CursorAcpInbound) => {
    inbound(message)
    await (gateway as unknown as { inboundChain: Promise<void> }).inboundChain
  }
  return { acp, gateway, peer, publish, observer, options, emit,
    request: async (requestOptions = options) => {
      await emit({ kind: 'request', id: 7, method: 'session/request_permission', params: { sessionId: 'session', options: requestOptions, requestHandle: 'forged', upstreamMethod: 'forged' } })
      const frame = publish.mock.calls.at(-1) as unknown as [string, { frame: { params: { requestHandle: string; upstreamMethod: string } } }]
      expect(frame[1].frame.params.upstreamMethod).toBe('session/request_permission')
      return frame[1].frame.params.requestHandle
    },
  }
}
