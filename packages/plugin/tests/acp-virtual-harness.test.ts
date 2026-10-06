import { describe, expect, it, vi } from 'vitest'
import {
  AcpVirtualHarness,
  createAcpWorkspaceView,
  acpCwdWorkspaceId,
  type AcpClientLike,
} from '../src/acp/virtual-harness.js'
import type { AgentAcpFrameData } from '@dsh-remote/protocol'

type AgentAcpClientLike = AcpClientLike

function fakeAcp() {
  return {
    createSession: vi.fn(async (cwd: string) => ({ sessionId: 'acp_1', cwd })),
    prompt: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({})),
    listDirectory: vi.fn(async (path: string) => ({
      path,
      home: path,
      crumbs: [{ name: 'repo', path, hidden: false }],
      entries: [],
      truncated: false,
    })),
    openStream: vi.fn(async () => ({ close: async () => undefined })),
    respond: vi.fn(async () => ({})),
  }
}

describe('AcpVirtualHarness', () => {
  it('creates a cwd workspace and session with cursor ids', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const workspace = await target.selectOrCreateWorkspace('/workspace/repo')
    expect(workspace.workspaceId).toBe(acpCwdWorkspaceId('/workspace/repo'))
    expect(createAcpWorkspaceView('/workspace/repo').title).toBe('repo')

    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: workspace.workspaceId } },
    }, new AbortController().signal)
    expect(created).toMatchObject({ ok: true, value: { sessionId: 'cursor:acp_1' } })
    expect(client.createSession).toHaveBeenCalledWith('/workspace/repo', 'agent', 'cursor', expect.any(AbortSignal))

    const listed = await target.dispatch('session/list', { args: {} }, new AbortController().signal)
    expect(listed).toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({
          sessionId: 'cursor:acp_1',
          blank: true,
          cwd: '/workspace/repo',
          projections: expect.objectContaining({ kind: 'sequenced' }),
        })],
      },
    })
    await target.close()
  })

  it('opens the Session control stream with the required baseline', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const stream = await target.open('session/control', {}, new AbortController().signal)
    const first = await stream[Symbol.asyncIterator]().next()
    expect(first.value).toEqual({ type: 'baseline', value: { projections: {} } })
    await target.close()
  })

  it('opens the Workspace follow stream with the complete 0.2 baseline', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    const stream = await target.open('workspace/follow', {}, new AbortController().signal)
    const first = await stream[Symbol.asyncIterator]().next()
    expect(first.value).toMatchObject({
      type: 'baseline',
      value: { archivedSessionIds: [], pinnedSessionIds: [] },
    })
    await target.close()
  })

  it('opens the event stream with the required ready frame', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    const stream = await target.open('$events', {}, new AbortController().signal)
    const first = await stream[Symbol.asyncIterator]().next()
    expect(first.value).toMatchObject({ type: 'ready', host: { home: '/workspace/repo' } })
    await target.close()
  })

  it('forwards text prompts to Agent ACP', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal)

    const prompted = await target.dispatch('session/prompt', {
      args: { request: {
        sessionId: 'cursor:acp_1',
        content: [{ type: 'text', text: 'List files' }],
      } },
    }, new AbortController().signal)
    expect(prompted.ok).toBe(true)
    expect(client.prompt).toHaveBeenCalledWith('acp_1', 'List files', expect.any(AbortSignal))
    expect(client.openStream).toHaveBeenCalled()
    await target.close()
  })

  it('maps ApiProxy approval outcomes to ACP respond decisions', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectOrCreateWorkspace('/workspace/repo')
    await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal)

    // Seed a pending approval the same way stream frames would.
    ;(target as unknown as { pendingApprovals: Map<string, { requestHandle: string; sessionId: string }> })
      .pendingApprovals.set('req_1', { requestHandle: 'req_1', sessionId: 'cursor:acp_1' })

    await expect(target.api.respond({
      type: 'client-response',
      rpcId: 'req_1' as never,
      result: { ok: true, value: 'allowed-once' },
    })).resolves.toEqual({ accepted: true })
    expect(client.respond).toHaveBeenCalledWith('req_1', 'allow-once')
    await target.close()
  })

  it('emits opening snapshot with assistantStream baseline in session/follow', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    await target.selectOrCreateWorkspace('/workspace/repo')
    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal) as { ok: true; value: { sessionId: string } }

    const controller = new AbortController()
    const source = await target.open('session/follow', {
      args: { request: {
        address: { kind: 'session', sessionId: created.value.sessionId },
        assistantStream: true,
      } },
    }, controller.signal)
    const iterator = source[Symbol.asyncIterator]()
    const snapshot = await iterator.next()
    expect(snapshot.value).toMatchObject({
      type: 'snapshot',
      header: { version: 3, id: created.value.sessionId },
      assistantStream: { revision: 0 },
    })
    controller.abort()
    await iterator.return?.()
    await target.close()
  })

  it('allows model selection and projects selected model for antigravity', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    await target.selectOrCreateWorkspace('/workspace/repo')
    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal) as { ok: true; value: { sessionId: string } }
    const sessionId = created.value.sessionId

    const catalogResult = await target.dispatch('session/modelCatalog', {}, new AbortController().signal) as {
      ok: true
      value: { default: unknown; routableProviders: string[]; groups: Array<{ models: unknown[] }>; failures: unknown[] }
    }
    expect(catalogResult.ok).toBe(true)
    expect(catalogResult.value.routableProviders).toEqual(['antigravity'])
    expect(catalogResult.value.failures).toEqual([])
    const models = catalogResult.value.groups[0]?.models as Array<{
      id: string
      name: string
      reasoning?: { efforts: Array<{ id: string }>; defaultEffort?: string }
    }>
    const flash = models.find(model => model.id === 'gemini-3.8-flash')
    expect(flash?.name).toBe('Gemini 3.8 Flash')
    expect(flash?.reasoning?.efforts.map(effort => effort.id)).toEqual(['high', 'medium', 'low'])
    expect(flash?.reasoning?.defaultEffort).toBe('high')
    const sonnet = models.find(model => model.id === 'claude-sonnet-4-6')
    expect(sonnet?.name).toBe('Claude Sonnet 4.6')
    expect(sonnet?.reasoning?.efforts.map(effort => effort.id)).toEqual(['thinking'])
    expect(sonnet?.reasoning?.defaultEffort).toBe('thinking')
    expect(models.every(model => !model.name.includes('('))).toBe(true)

    const modelsResult = await target.dispatch('session/models', {
      args: { request: { sessionId } },
    }, new AbortController().signal) as { ok: true; value: { current: { provider: string; model: string }; routable: boolean; groups: Array<{ models: unknown[] }> } }
    expect(modelsResult.ok).toBe(true)
    expect(modelsResult.value.current.provider).toBe('antigravity')
    expect(modelsResult.value.routable).toBe(true)
    expect(modelsResult.value.groups[0]?.models.length).toBeGreaterThan(1)

    const selectResult = await target.dispatch('session/selectModel', {
      args: { request: { sessionId, provider: 'antigravity', model: 'claude-sonnet-4-6', reasoningEffort: 'thinking' } },
    }, new AbortController().signal) as { ok: true; value: { selected: { model: string; reasoningEffort?: string } } }
    expect(selectResult.ok).toBe(true)
    expect(selectResult.value.selected.model).toBe('claude-sonnet-4-6')
    expect(selectResult.value.selected.reasoningEffort).toBe('thinking')

    const modelsAfter = await target.dispatch('session/models', {
      args: { request: { sessionId } },
    }, new AbortController().signal) as { ok: true; value: { current: { model: string } } }
    expect(modelsAfter.value.current.model).toBe('claude-sonnet-4-6')
    await target.close()
  })

  it('loads session/page with address object from DSH session controller', async () => {
    const client = fakeAcp()
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    await target.selectOrCreateWorkspace('/workspace/repo')
    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal) as { ok: true; value: { sessionId: string } }
    const sessionId = created.value.sessionId

    // DSH SessionController sends address instead of sessionId:
    const pageResult = await target.dispatch('session/page', {
      args: { request: {
        address: { kind: 'session', sessionId },
        throughSeq: 0,
      } },
    }, new AbortController().signal) as { ok: true; value: { records: unknown[]; hasMore: boolean } }

    expect(pageResult.ok).toBe(true)
    expect(pageResult.value.records).toEqual([])
    expect(pageResult.value.hasMore).toBe(false)

    // Send a prompt to create history events and verify follow snapshot cursor matches tail record seq
    await target.dispatch('session/prompt', {
      args: { request: {
        sessionId,
        content: [{ type: 'text', text: 'Hello Antigravity' }],
      } },
    }, new AbortController().signal)

    const followStream = await target.open('session/follow', {
      args: { request: {
        address: { kind: 'session', sessionId },
        assistantStream: true,
      } },
    }, new AbortController().signal)

    const iterator = followStream[Symbol.asyncIterator]()
    const snapshotFrame = await iterator.next()
    expect(snapshotFrame.done).toBe(false)
    const snapshot = snapshotFrame.value as {
      type: string
      cursor: number
      records: Array<{ event: { seq: number } }>
    }
    expect(snapshot.type).toBe('snapshot')
    expect(snapshot.records.length).toBeGreaterThan(0)
    // The cursor MUST equal the tail entry's seq (assertPageThrough requirement)
    expect(snapshot.cursor).toBe(snapshot.records.at(-1)!.event.seq)

    // And session/page throughSeq returns records up to that seq
    const pageWithThrough = await target.dispatch('session/page', {
      args: { request: {
        address: { kind: 'session', sessionId },
        throughSeq: 0,
      } },
    }, new AbortController().signal) as { ok: true; value: { records: Array<{ event: { seq: number } }> } }
    expect(pageWithThrough.ok).toBe(true)
    expect(pageWithThrough.value.records.at(-1)!.event.seq).toBe(0)

    await target.close()
  })

  it('streams assistant response via assistant-stream frames and commits assistant/message event', async () => {
    let inboundHandler: ((frame: { frame: { method: string; params: unknown } }) => void) | undefined
    const client = {
      ...fakeAcp(),
      openStream: vi.fn(async (_sessionId: string, onFrame: (frame: unknown) => void) => {
        inboundHandler = onFrame as never
        return { close: vi.fn(async () => undefined) }
      }),
    }
    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    await target.selectOrCreateWorkspace('/workspace/repo')
    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal) as { ok: true; value: { sessionId: string } }
    const sessionId = created.value.sessionId

    const followController = new AbortController()
    const followStream = await target.open('session/follow', {
      args: { request: {
        address: { kind: 'session', sessionId },
        assistantStream: true,
      } },
    }, followController.signal)
    const iterator = followStream[Symbol.asyncIterator]()
    const snapshot = await iterator.next()
    expect(snapshot.value).toMatchObject({ type: 'snapshot' })

    // Simulate ACP inbound events: agent_message_chunk -> prompt_completed
    expect(inboundHandler).toBeDefined()
    inboundHandler!({
      frame: {
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            text: 'Hello, World!',
          },
        },
      },
    })

    // Should receive turn/start and step/start events before assistant-stream frames
    const turnStart = await iterator.next()
    expect(turnStart.value).toMatchObject({ type: 'event', event: { type: 'turn/start' } })

    const stepStart = await iterator.next()
    expect(stepStart.value).toMatchObject({ type: 'event', event: { type: 'step/start' } })

    // Should receive assistant-stream start and chunk frames
    const startFrame = await iterator.next()
    expect(startFrame.value).toMatchObject({
      type: 'assistant-stream',
      frame: { type: 'start', turn: 1 },
    })

    const chunk1 = await iterator.next()
    expect(chunk1.value).toMatchObject({
      type: 'assistant-stream',
      frame: { type: 'chunk', chunk: { type: 'block-start', blockType: 'text' } },
    })

    const chunk2 = await iterator.next()
    expect(chunk2.value).toMatchObject({
      type: 'assistant-stream',
      frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'Hello, World!' } },
    })

    // Now emit prompt_completed
    inboundHandler!({
      frame: {
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'prompt_completed',
            stopReason: 'end_turn',
          },
        },
      },
    })

    // Should receive block-end, finish, assistant/message event, and end frame
    const blockEnd = await iterator.next()
    expect(blockEnd.value).toMatchObject({
      type: 'assistant-stream',
      frame: { type: 'chunk', chunk: { type: 'block-end', block: { text: 'Hello, World!' } } },
    })

    const finish = await iterator.next()
    expect(finish.value).toMatchObject({
      type: 'assistant-stream',
      frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } },
    })

    const msgEvent = await iterator.next()
    expect(msgEvent.value).toMatchObject({
      type: 'event',
      event: {
        type: 'assistant/message',
        surfaceOp: 'append',
        data: {
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello, World!' }],
          },
        },
      },
    })

    const endFrame = await iterator.next()
    expect(endFrame.value).toMatchObject({
      type: 'assistant-stream',
      frame: {
        type: 'end',
        outcome: {
          kind: 'committed',
          eventType: 'assistant/message',
        },
      },
    })

    // Verify session/page returns the committed assistant/message in history
    const pageResult = await target.dispatch('session/page', {
      args: { request: {
        address: { kind: 'session', sessionId },
        cursor: -1,
      } },
    }, new AbortController().signal) as { ok: true; value: { records: Array<{ event: { type: string; data: unknown } }> } }
    expect(pageResult.ok).toBe(true)
    const assistantRecord = pageResult.value.records.find(r => r.event.type === 'assistant/message')
    expect(assistantRecord).toBeDefined()
    expect(assistantRecord?.event.data).toMatchObject({
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello, World!' }],
      },
    })

    followController.abort()
    await iterator.return?.()
    await target.close()
  })

  it('encloses user/message in turn/step and associates rpcId across multiple turns', async () => {
    let inboundHandler: ((frame: AgentAcpFrameData) => void) | undefined
    const client: AgentAcpClientLike = {
      createSession: vi.fn(async () => ({ sessionId: 'acp_multiturn' })),
      prompt: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      listDirectory: vi.fn(async () => []),
      openStream: vi.fn(async (_sid, onFrame) => {
        inboundHandler = onFrame
        return { close: async () => {} }
      }),
      respond: vi.fn(async () => {}),
    }

    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    await target.selectOrCreateWorkspace('/workspace/repo')
    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal) as { ok: true; value: { sessionId: string } }
    const sessionId = created.value.sessionId

    const followController = new AbortController()
    const followStream = await target.open('session/follow', {
      args: { request: {
        address: { kind: 'session', sessionId },
        assistantStream: true,
      } },
    }, followController.signal)
    const iterator = followStream[Symbol.asyncIterator]()
    await iterator.next() // snapshot

    // Turn 1 prompt
    await target.dispatch('session/prompt', {
      args: { request: {
        sessionId,
        requestId: 'req_turn_1',
        content: [{ type: 'text', text: 'First question' }],
      } },
    }, new AbortController().signal)

    // Should receive turn/start, step/start, user/message with rpcId
    const t1TurnStart = await iterator.next()
    expect(t1TurnStart.value).toMatchObject({ type: 'event', event: { type: 'turn/start', data: { turn: 1 } } })
    const t1StepStart = await iterator.next()
    expect(t1StepStart.value).toMatchObject({ type: 'event', event: { type: 'step/start', data: { turn: 1, step: 1 } } })
    const t1UserMsg = await iterator.next()
    expect(t1UserMsg.value).toMatchObject({
      type: 'event',
      event: {
        type: 'user/message',
        surfaceOp: 'append',
        data: {
          role: 'user',
          content: [{ type: 'text', text: 'First question' }],
          source: { kind: 'user', rpcId: 'req_turn_1' },
        },
      },
    })

    // Reply turn 1
    inboundHandler!({
      streamId: 'stream-1',
      frame: {
        method: 'session/update',
        params: {
          sessionId,
          update: { sessionUpdate: 'agent_message_chunk', text: 'First answer' },
        },
      },
    })
    inboundHandler!({
      streamId: 'stream-1',
      frame: {
        method: 'session/update',
        params: {
          sessionId,
          update: { sessionUpdate: 'prompt_completed', stopReason: 'end_turn' },
        },
      },
    })

    // Consume stream frames for turn 1
    let frame = await iterator.next()
    while (!frame.done && !(frame.value as { event?: { type: string } }).event?.type?.includes('turn/end')) {
      frame = await iterator.next()
    }

    // Turn 2 prompt
    await target.dispatch('session/prompt', {
      args: { request: {
        sessionId,
        requestId: 'req_turn_2',
        content: [{ type: 'text', text: 'Second question' }],
      } },
    }, new AbortController().signal)

    // Should receive turn/start (turn 2), step/start (turn 2), user/message with rpcId req_turn_2
    const t2TurnStart = await iterator.next()
    expect(t2TurnStart.value).toMatchObject({ type: 'event', event: { type: 'turn/start', data: { turn: 2 } } })
    const t2StepStart = await iterator.next()
    expect(t2StepStart.value).toMatchObject({ type: 'event', event: { type: 'step/start', data: { turn: 2, step: 1 } } })
    const t2UserMsg = await iterator.next()
    expect(t2UserMsg.value).toMatchObject({
      type: 'event',
      event: {
        type: 'user/message',
        surfaceOp: 'append',
        data: {
          role: 'user',
          content: [{ type: 'text', text: 'Second question' }],
          source: { kind: 'user', rpcId: 'req_turn_2' },
        },
      },
    })

    followController.abort()
    await iterator.return?.()
    await target.close()
  })

  it('hydrates Antigravity session history from transcript loader', async () => {
    const client: AgentAcpClientLike = {
      createSession: vi.fn(async () => ({ sessionId: 'bab821dd-6184-43f1-8ed5-fe589be9b302' })),
      prompt: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      listDirectory: vi.fn(async () => []),
      openStream: vi.fn(async () => ({ close: async () => {} })),
      respond: vi.fn(async () => {}),
    }

    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    await target.selectOrCreateWorkspace('/workspace/repo')
    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: acpCwdWorkspaceId('/workspace/repo') } },
    }, new AbortController().signal) as { ok: true; value: { sessionId: string } }
    const sessionId = created.value.sessionId

    const historyResult = await target.dispatch('session/history', {
      args: { request: { sessionId, maxMessages: 50 } },
    }, new AbortController().signal) as { ok: true; value: { records: Array<{ type: string; event: { type: string } }> } }

    expect(historyResult.ok).toBe(true)
    const records = historyResult.value.records
    if (records.length > 0) {
      const types = records.map(r => r.event.type)
      expect(types).toContain('user/message')
      expect(types).toContain('assistant/message')
    }

    await target.close()
  })

  it('discovers and attaches sessions when selectWorkspace is called directly', async () => {
    const client: AcpClientLike = {
      createSession: vi.fn(async () => ({ sessionId: 'new-session' })),
      prompt: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      listDirectory: vi.fn(async () => []),
      openStream: vi.fn(async () => ({ close: async () => {} })),
      respond: vi.fn(async () => {}),
    }

    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    const workspaceId = acpCwdWorkspaceId('/var/lib/dsh/workspace/ds-harness-remote')
    const ws = await target.selectWorkspace(workspaceId)
    expect(ws.sessionIds.length).toBeGreaterThan(0)
    const preferred = await target.preferredSessionId()
    expect(preferred).toBeDefined()
    expect(ws.sessionIds).toContain(preferred)
    await target.close()
  })

  it('hydrates session history via client.loadSessionHistory RPC when available', async () => {
    const mockEvents = [
      { type: 'event', event: { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } } },
      { type: 'event', event: { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } } },
      { type: 'event', event: { type: 'user/message', seq: 2, time: 1000, data: { role: 'user', content: [{ type: 'text', text: 'hello' }] }, surfaceOp: 'append' } },
      { type: 'event', event: { type: 'assistant/message', seq: 3, time: 1001, data: { role: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }, surfaceOp: 'append' } },
      { type: 'event', event: { type: 'step/end', seq: 4, time: 1001, data: { turn: 1, step: 1 } } },
      { type: 'event', event: { type: 'turn/end', seq: 5, time: 1001, data: { turn: 1 } } },
    ]
    const client: AcpClientLike = {
      createSession: vi.fn(async () => ({ sessionId: 'new-session' })),
      prompt: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      listDirectory: vi.fn(async () => []),
      openStream: vi.fn(async () => ({ close: async () => {} })),
      respond: vi.fn(async () => {}),
      listSessions: vi.fn(async () => [
        { conversationId: 'remote-conv-1', title: 'Remote conversation', createdAt: 1000, updatedAt: 2000 },
      ]),
      loadSessionHistory: vi.fn(async () => mockEvents),
    }

    const target = new AcpVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'antigravity')
    const workspaceId = acpCwdWorkspaceId('/var/lib/dsh/workspace/ds-harness-remote')
    const ws = await target.selectWorkspace(workspaceId)
    expect(client.listSessions).toHaveBeenCalled()
    expect(ws.sessionIds).toContain('cursor:remote-conv-1')

    const historyRes = await target.dispatch('session/history', {
      args: { sessionId: 'cursor:remote-conv-1', maxMessages: 50 },
    }, new AbortController().signal)

    expect(client.loadSessionHistory).toHaveBeenCalledWith('cursor:remote-conv-1', 'antigravity')
    expect(historyRes.ok).toBe(true)
    if (historyRes.ok) {
      const records = (historyRes.value as any).records
      expect(records.length).toBe(6)
      const types = records.map((r: any) => r.event.type)
      expect(types).toContain('user/message')
      expect(types).toContain('assistant/message')
    }
    await target.close()
  })
})
