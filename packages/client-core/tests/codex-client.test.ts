import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import {
  CodexRemoteClient,
  createCodexTimelineState,
  deriveCodexCwdWorkspaces,
  projectCodexHistory,
  projectCodexThread,
  reduceCodexTimelineFrame,
} from '../src/codex-client.js'

function createStreamCore(
  openImpl: (params: { streamId: string; threadId: string }, signal?: AbortSignal) => Promise<unknown>,
) {
  const eventHandlers = new Set<(event: { event: string; data: unknown }) => void>()
  const closeHandlers = new Set<() => void>()
  const rpcCalls: Array<{ method: string; params: unknown }> = []
  const rpc = vi.fn(async (method: string, params: unknown, signal?: AbortSignal) => {
    rpcCalls.push({ method, params })
    if (method === 'codex.app.stream.open') {
      return openImpl(params as { streamId: string; threadId: string }, signal)
    }
    return {}
  })
  return {
    rpc,
    rpcCalls,
    eventHandlers,
    closeHandlers,
    onEvent(handler: (event: { event: string; data: unknown }) => void) {
      eventHandlers.add(handler)
      return () => { eventHandlers.delete(handler) }
    },
    onClose(handler: () => void) {
      closeHandlers.add(handler)
      return () => { closeHandlers.delete(handler) }
    },
    emitEvent(event: string, data: unknown) {
      for (const handler of [...eventHandlers]) handler({ event, data })
    },
    emitClose() {
      for (const handler of [...closeHandlers]) handler()
    },
  }
}

describe('Codex display projection', () => {
  it('keeps the first user message as an untitled thread preview across live updates and history reads', () => {
    const user = { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: '  Check\n the latest PR  ' }] }
    const initial = createCodexTimelineState({ id: 'untitled', turns: [] })!
    const started = reduceCodexTimelineFrame(initial, {
      method: 'item/started', params: { turnId: 't1', item: user },
    })
    expect(started.session).toMatchObject({ preview: 'Check the latest PR' })
    expect(started.session.title).toBeUndefined()
    const later = reduceCodexTimelineFrame(started, {
      method: 'item/completed', params: { turnId: 't2', item: { ...user, id: 'u2', content: [{ type: 'text', text: 'Second prompt' }] } },
    })
    expect(later.session.preview).toBe('Check the latest PR')
    const renamed = reduceCodexTimelineFrame(later, {
      method: 'thread/name/updated', params: { threadName: 'PR review' },
    })
    expect(renamed.session.title).toBe('PR review')
    expect(projectCodexThread({ id: 'untitled', turns: [{ id: 't1', items: [user] }] })?.preview).toBe('Check the latest PR')
    expect(projectCodexThread({ id: 'untitled', preview: 'Server preview', turns: [{ id: 't1', items: [user] }] })?.preview).toBe('Server preview')
    const imageOnly = createCodexTimelineState({ id: 'image', turns: [{ id: 't1', items: [{ id: 'u1', type: 'userMessage', content: [{ type: 'image', url: 'data:image/png;base64,aA==' }] }] }] })!
    expect(imageOnly.session.preview).toBeUndefined()
  })

  it('uses the bounded Codex transfer path for image prompt input', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'codex.app.transfer.commit') return { kind: 'inline', response: { turn: { id: 'turn_1' } } }
      return { accepted: true }
    })
    const client = new CodexRemoteClient({ rpc } as never)

    await client.request('turn/start', {
      threadId: 'thr_1',
      input: [{ type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=' }],
    })

    expect(rpc).not.toHaveBeenCalledWith('codex.app.call', expect.anything(), expect.anything())
    expect(rpc).toHaveBeenCalledWith('codex.app.transfer.open', expect.objectContaining({ totalChunks: 1 }), undefined)
    expect(rpc).toHaveBeenCalledWith('codex.app.transfer.chunk', expect.objectContaining({ index: 0 }), undefined)
    expect(rpc).toHaveBeenCalledWith('codex.app.transfer.commit', expect.anything(), undefined)
  })

  it('keeps Codex identity namespaced and separate from Harness sessions', () => {
    expect(projectCodexThread({
      id: 'thr_123',
      sessionId: 'tree_1',
      name: 'Fix CI',
      preview: 'Investigate the failing build',
      cwd: '/workspace/repo',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_100,
      isPinned: true,
      status: { type: 'active', activeFlags: ['waitingOnApproval'] },
    })).toEqual({
      id: 'codex:thr_123',
      backend: 'codex',
      nativeId: 'thr_123',
      sessionTreeId: 'tree_1',
      title: 'Fix CI',
      preview: 'Investigate the failing build',
      cwd: '/workspace/repo',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      status: 'waiting',
      pinned: true,
    })
  })

  it('projects the current model from the latest CodeX Turn', () => {
    expect(projectCodexThread({
      id: 'thr_model',
      model: 'stale-model',
      turns: [
        { id: 'turn_old', model: 'old-model', reasoningEffort: 'low' },
        { id: 'turn_new', model: 'gpt-5.6-terra', effort: 'high' },
      ],
    })).toMatchObject({ model: 'gpt-5.6-terra', reasoningEffort: 'high' })
  })

  it('derives deterministic fallback workspaces from unique Thread cwd values', () => {
    const workspaces = deriveCodexCwdWorkspaces([
      { id: 'thr_1', cwd: '/workspace/repo/', createdAt: 20, updatedAt: 30 },
      { id: 'thr_2', cwd: '/workspace/repo', createdAt: 10, updatedAt: 40 },
      { id: 'thr_3', cwd: '/workspace/other', createdAt: 15, updatedAt: 25 },
      { id: 'thr_4' },
      { id: 'thr_5', cwd: 'relative/not-allowed' },
    ])

    expect(workspaces).toEqual([
      {
        id: expect.stringMatching(/^cwd-/u),
        name: 'repo',
        path: '/workspace/repo/',
        position: 0,
        createdAt: 10_000,
        updatedAt: 40_000,
      },
      {
        id: expect.stringMatching(/^cwd-/u),
        name: 'other',
        path: '/workspace/other',
        position: 1,
        createdAt: 15_000,
        updatedAt: 25_000,
      },
    ])
    expect(workspaces[0]!.id).not.toBe(workspaces[1]!.id)
    expect(deriveCodexCwdWorkspaces([{ id: 'thr_5', cwd: '/workspace/repo/' }])[0]!.id)
      .toBe(workspaces[0]!.id)
  })

  it('projects messages and tool lifecycle with a safe unknown fallback', () => {
    const items = projectCodexHistory({
      id: 'thr_123',
      turns: [{
        id: 'turn_1',
        items: [
          { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'Run tests' }] },
          { id: 'a1', type: 'agentMessage', text: 'I will inspect CI.', status: 'completed' },
          { id: 'c1', type: 'commandExecution', command: 'pnpm test', aggregatedOutput: '3 passed', status: 'completed' },
          { id: 'f1', type: 'fileChange', changes: [{ kind: 'update', path: 'src/index.ts', diff: '@@' }], status: 'completed' },
          { id: 'future1', type: 'futureCodexItem', secret: 'not projected' },
        ],
      }],
    })

    expect(items).toMatchObject([
      { id: 'codex:thr_123:turn_1:u1', backend: 'codex', kind: 'message', role: 'user', text: 'Run tests' },
      { id: 'codex:thr_123:turn_1:a1', kind: 'message', role: 'assistant', text: 'I will inspect CI.' },
      { id: 'codex:thr_123:turn_1:c1', kind: 'tool', text: 'pnpm test\n\n3 passed', status: 'completed' },
      { id: 'codex:thr_123:turn_1:f1', kind: 'file-change', text: '[update] src/index.ts', status: 'completed' },
      { id: 'codex:thr_123:turn_1:future1', kind: 'unknown', details: { type: 'futureCodexItem' } },
    ])
    expect(JSON.stringify(items)).not.toContain('not projected')
    expect(JSON.stringify(items)).not.toContain('@@')
  })

  it('keeps safe Codex message images in the display projection', () => {
    const items = projectCodexHistory({
      id: 'thr_123',
      turns: [{
        id: 'turn_1',
        items: [
          {
            id: 'u-image',
            type: 'userMessage',
            content: [
              { type: 'text', text: 'Look at this' },
              { type: 'image', url: 'data:image/png;base64,aW1hZ2U=', name: 'screen.png' },
              { type: 'image', url: 'https://example.test/not-allowed.png', name: 'external.png' },
            ],
          },
          {
            id: 'a-image',
            type: 'agentMessage',
            content: [{ type: 'input_image', image_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
            status: 'completed',
          },
          {
            id: 'tool-image',
            type: 'mcpToolCall',
            server: 'cua_repl',
            tool: 'js',
            result: { content: [
              { type: 'text', text: '/workspace/current-browser.png' },
              { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=', name: 'current-browser.png' },
            ] },
            status: 'completed',
          },
        ],
      }],
    })

    expect(items).toMatchObject([
      {
        id: 'codex:thr_123:turn_1:u-image',
        kind: 'message',
        role: 'user',
        text: 'Look at this',
        images: [{ uri: 'data:image/png;base64,aW1hZ2U=', name: 'screen.png' }],
      },
      {
        id: 'codex:thr_123:turn_1:a-image',
        kind: 'message',
        role: 'assistant',
        images: [{ uri: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
      },
      {
        id: 'codex:thr_123:turn_1:tool-image',
        kind: 'tool',
        text: 'js\n\n/workspace/current-browser.png',
        images: [{ uri: 'data:image/png;base64,aW1hZ2U=', name: 'current-browser.png' }],
      },
    ])
    expect(JSON.stringify(items)).not.toContain('example.test')
  })

  it('reduces live item deltas, completion, status, and one-time approvals over a baseline', () => {
    let state = createCodexTimelineState({
      id: 'thr_123',
      cwd: '/workspace/repo',
      createdAt: 1,
      updatedAt: 2,
      status: { type: 'idle' },
      turns: [],
    })!
    state = reduceCodexTimelineFrame(state, {
      method: 'thread/name/updated',
      params: { threadId: 'thr_123', threadName: 'Generated CodeX title' },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'turn/started',
      params: { threadId: 'thr_123', turn: { id: 'turn_1', status: 'inProgress', items: [] } },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thr_123', turnId: 'turn_1', itemId: 'agent_1', delta: 'Hello' },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'item/agentMessage/delta',
      params: { threadId: 'thr_123', turnId: 'turn_1', itemId: 'agent_1', delta: ' world' },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thr_123',
        turnId: 'turn_1',
        requestHandle: 'opaque-handle',
        command: ['pnpm', 'test'],
      },
    })

    expect(state).toMatchObject({
      activeTurnId: 'turn_1',
      approval: { requestHandle: 'opaque-handle', kind: 'command', command: 'pnpm test' },
      session: { title: 'Generated CodeX title', status: 'waiting' },
    })
    expect(state.items).toMatchObject([
      { kind: 'message', role: 'assistant', text: 'Hello world', status: 'running' },
      { kind: 'approval', text: 'pnpm test', status: 'running' },
    ])

    state = reduceCodexTimelineFrame(state, {
      method: 'item/completed',
      params: {
        threadId: 'thr_123',
        turnId: 'turn_1',
        item: { id: 'agent_1', type: 'agentMessage', text: 'Hello world.', status: 'completed' },
      },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'turn/completed',
      params: { threadId: 'thr_123', turn: { id: 'turn_1', status: 'completed', items: [] } },
    })

    expect(state.activeTurnId).toBeUndefined()
    expect(state.approval).toBeUndefined()
    expect(state.session.status).toBe('idle')
    expect(state.items[0]).toMatchObject({ text: 'Hello world.', status: 'completed' })
  })

  it('clears an active turn when the App Server reports an idle or system error status', () => {
    let state = createCodexTimelineState({
      id: 'thr_status', cwd: '/workspace/repo', createdAt: 1, updatedAt: 2,
      status: { type: 'idle' }, turns: [],
    })!
    state = reduceCodexTimelineFrame(state, {
      method: 'turn/started',
      params: { turn: { id: 'turn_status', status: 'inProgress', items: [] } },
    })
    expect(state.activeTurnId).toBe('turn_status')

    state = reduceCodexTimelineFrame(state, {
      method: 'thread/status/changed',
      params: { status: { type: 'idle' } },
    })
    expect(state).toMatchObject({ session: { status: 'idle' } })
    expect(state.activeTurnId).toBeUndefined()
    expect(state.items.every(item => item.status !== 'running')).toBe(true)

    state = reduceCodexTimelineFrame(state, {
      method: 'turn/started',
      params: { turn: { id: 'turn_error', status: 'inProgress', items: [] } },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'thread/status/changed',
      params: { status: { type: 'systemError' } },
    })
    expect(state).toMatchObject({ session: { status: 'failed' } })
    expect(state.activeTurnId).toBeUndefined()
    expect(state.items.every(item => item.status !== 'running')).toBe(true)
  })

  it('merges command, file-change, and approval-resolution notifications by native item id', () => {
    let state = createCodexTimelineState({
      id: 'thr_123', cwd: '/workspace/repo', createdAt: 1, updatedAt: 2, turns: [],
    })!
    state = reduceCodexTimelineFrame(state, {
      method: 'turn/started',
      params: { turn: { id: 'turn_1', status: 'inProgress', items: [] } },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'item/started',
      params: { turnId: 'turn_1', item: { id: 'cmd_1', type: 'commandExecution', command: 'pnpm test', status: 'inProgress' } },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'item/commandExecution/outputDelta',
      params: { turnId: 'turn_1', itemId: 'cmd_1', delta: '\n1 passed' },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'item/started',
      params: { turnId: 'turn_1', item: { id: 'files_1', type: 'fileChange', changes: [], status: 'inProgress' } },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'item/fileChange/patchUpdated',
      params: { turnId: 'turn_1', itemId: 'files_1', changes: [{ kind: 'add', path: 'new.ts' }] },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'item/fileChange/requestApproval',
      params: { turnId: 'turn_1', requestHandle: 'approval_1' },
    })
    state = reduceCodexTimelineFrame(state, {
      method: 'serverRequest/resolved',
      params: { turnId: 'turn_1', requestId: 1 },
    })

    expect(state.approval).toBeUndefined()
    expect(state.items).toMatchObject([
      { nativeRef: { itemId: 'cmd_1' }, text: 'pnpm test\n1 passed', status: 'running' },
      { nativeRef: { itemId: 'files_1' }, text: '[add] new.ts', status: 'running' },
      { nativeRef: { requestHandle: 'approval_1' }, status: 'completed' },
    ])
  })

  it('only clears pending approval on serverRequest/resolved when requestHandle matches or is omitted by legacy Hosts', async () => {
    const base = [
      { method: 'turn/started', params: { turn: { id: 'turn_1', status: 'inProgress', items: [] } } },
      { method: 'item/commandExecution/requestApproval', params: { turnId: 'turn_1', requestHandle: 'approval_1', command: ['pnpm', 'test'] } },
    ].reduce(
      (acc, frame) => reduceCodexTimelineFrame(acc, frame),
      createCodexTimelineState({ id: 'thr_123', cwd: '/workspace/repo', createdAt: 1, updatedAt: 2, turns: [] })!,
    )

    await runScenarios([
      { name: 'mismatched requestHandle keeps approval', params: { turnId: 'turn_1', requestHandle: 'approval_other' }, cleared: false },
      { name: 'exact requestHandle clears approval', params: { turnId: 'turn_1', requestHandle: 'approval_1' }, cleared: true },
      { name: 'legacy omitted requestHandle clears approval', params: { turnId: 'turn_1', requestId: 1 }, cleared: true },
    ].map(({ name, params, cleared }) => ({
      name,
      run: () => {
        const next = reduceCodexTimelineFrame(base, { method: 'serverRequest/resolved', params })
        if (cleared) {
          expect(next.approval).toBeUndefined()
          expect(next.session.status).toBe('running')
          expect(next.items[0]).toMatchObject({ nativeRef: { requestHandle: 'approval_1' }, status: 'completed' })
        } else {
          expect(next).toBe(base)
          expect(next.approval).toMatchObject({ requestHandle: 'approval_1' })
          expect(next.session.status).toBe('waiting')
          expect(next.items[0]).toMatchObject({ nativeRef: { requestHandle: 'approval_1' }, status: 'running' })
        }
      },
    })))
  })

  it('settles running approval items when turn/completed arrives without serverRequest/resolved', async () => {
    const base = [
      { method: 'turn/started', params: { turn: { id: 'turn_1', status: 'inProgress', items: [] } } },
      { method: 'item/commandExecution/requestApproval', params: { turnId: 'turn_1', requestHandle: 'approval_1', command: ['pnpm', 'test'] } },
    ].reduce(
      (acc, frame) => reduceCodexTimelineFrame(acc, frame),
      createCodexTimelineState({ id: 'thr_123', cwd: '/workspace/repo', createdAt: 1, updatedAt: 2, turns: [] })!,
    )

    await runScenarios([
      { name: 'completed turn', status: 'completed', expectedItemStatus: 'completed' },
      { name: 'failed turn', status: 'failed', expectedItemStatus: 'failed' },
    ].map(({ name, status, expectedItemStatus }) => ({
      name,
      run: () => {
        const next = reduceCodexTimelineFrame(base, {
          method: 'turn/completed',
          params: { turn: { id: 'turn_1', status, items: [] } },
        })
        expect(next.approval).toBeUndefined()
        expect(next.items[0]).toMatchObject({
          kind: 'approval',
          nativeRef: { requestHandle: 'approval_1' },
          status: expectedItemStatus,
        })
      },
    })))
  })
})

describe('CodexRemoteClient.subscribe', () => {
  it('propagates replayTruncated only when codex.app.stream.open confirms true', async () => {
    await runScenarios([
      { name: 'replayTruncated: true', openResult: { opened: true, replayTruncated: true }, expected: true },
      { name: 'replayTruncated omitted', openResult: { opened: true }, expected: false },
      { name: 'replayTruncated: false', openResult: { opened: true, replayTruncated: false }, expected: false },
    ].map(({ name, openResult, expected }) => ({
      name,
      run: async () => {
        const core = createStreamCore(async () => openResult)
        const client = new CodexRemoteClient(core as never)
        const stream = await client.subscribe('thr_1', () => undefined)
        if (expected) {
          expect(stream.replayTruncated).toBe(true)
          expect('replayTruncated' in stream).toBe(true)
        } else {
          expect(stream.replayTruncated).toBeUndefined()
          expect('replayTruncated' in stream).toBe(false)
        }
        await stream.close()
      },
    })))
  })

  it('handles core.onClose safely before and after open without duplicate stream-closed notifications', async () => {
    await runScenarios([
      {
        name: 'emits peer-disconnected once after open, removes listeners, and suppresses later stream.closed',
        run: async () => {
          const core = createStreamCore(async () => ({ opened: true }))
          const client = new CodexRemoteClient(core as never)
          const frames: unknown[] = []
          const closed: string[] = []

          const stream = await client.subscribe('thr_1', frame => frames.push(frame), undefined, reason => closed.push(reason))
          expect(core.eventHandlers.size).toBe(1)
          expect(core.closeHandlers.size).toBe(1)

          core.emitClose()
          expect(closed).toEqual(['peer-disconnected'])
          expect(core.eventHandlers.size).toBe(0)
          expect(core.closeHandlers.size).toBe(0)

          core.emitEvent('codex.app.stream.closed', { streamId: stream.streamId, reason: 'failed' })
          core.emitEvent('codex.app.frame', { streamId: stream.streamId, frame: { method: 'turn/started', params: {} } })
          core.emitClose()
          await stream.close()

          expect(closed).toEqual(['peer-disconnected'])
          expect(frames).toEqual([])
          expect(core.rpcCalls.map(call => call.method)).toEqual(['codex.app.stream.open'])
        },
      },
      {
        name: 'cleans up listeners without calling onClose if core closes before open finishes',
        run: async () => {
          let rejectOpen!: (error: Error) => void
          const core = createStreamCore(() => new Promise((_resolve, reject) => { rejectOpen = reject }))
          const client = new CodexRemoteClient(core as never)
          const closed: string[] = []

          const opening = client.subscribe('thr_1', () => undefined, undefined, reason => closed.push(reason))
          expect(core.eventHandlers.size).toBe(1)
          expect(core.closeHandlers.size).toBe(1)

          core.emitClose()
          expect(closed).toEqual([])
          expect(core.eventHandlers.size).toBe(0)
          expect(core.closeHandlers.size).toBe(0)

          rejectOpen(Object.assign(new Error('Transport closed'), { code: 'TRANSPORT_CLOSED' }))
          await expect(opening).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' })
          expect(closed).toEqual([])
          expect(core.eventHandlers.size).toBe(0)
          expect(core.closeHandlers.size).toBe(0)
        },
      },
      {
        name: 'rejects with TRANSPORT_CLOSED if core closes synchronously before open resolves to a result',
        run: async () => {
          let triggerClose!: () => void
          const core = createStreamCore(async () => {
            triggerClose()
            return { opened: true }
          })
          triggerClose = () => core.emitClose()
          const client = new CodexRemoteClient(core as never)
          const closed: string[] = []

          await expect(
            client.subscribe('thr_1', () => undefined, undefined, reason => closed.push(reason)),
          ).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' })
          expect(closed).toEqual([])
          expect(core.eventHandlers.size).toBe(0)
          expect(core.closeHandlers.size).toBe(0)
          expect(core.rpcCalls.map(call => call.method)).toEqual(['codex.app.stream.open'])
        },
      },
      {
        name: 'rejects with TRANSPORT_CLOSED if core closes in the same tick right after open resolves before opened is marked',
        run: async () => {
          let resolveOpen!: (value: unknown) => void
          const core = createStreamCore(() => new Promise(resolve => { resolveOpen = resolve }))
          const client = new CodexRemoteClient(core as never)
          const closed: string[] = []

          const opening = client.subscribe('thr_1', () => undefined, undefined, reason => closed.push(reason))
          resolveOpen({ opened: true })
          core.emitClose()

          await expect(opening).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' })
          expect(closed).toEqual([])
          expect(core.eventHandlers.size).toBe(0)
          expect(core.closeHandlers.size).toBe(0)
          expect(core.rpcCalls.map(call => call.method)).toEqual(['codex.app.stream.open'])
        },
      },
    ])
  })

  it('closes the Host stream when AbortSignal fires after open or races with an open RPC', async () => {
    await runScenarios([
      {
        name: 'abort after open completes',
        run: async () => {
          const controller = new AbortController()
          const core = createStreamCore(async () => ({ opened: true }))
          const client = new CodexRemoteClient(core as never)

          const stream = await client.subscribe('thr_1', () => undefined, controller.signal)
          controller.abort(new Error('navigation'))
          await Promise.resolve()

          expect(core.rpcCalls).toEqual([
            { method: 'codex.app.stream.open', params: { streamId: stream.streamId, threadId: 'thr_1' } },
            { method: 'codex.app.stream.close', params: { streamId: stream.streamId } },
          ])
          expect(core.eventHandlers.size).toBe(0)
          expect(core.closeHandlers.size).toBe(0)

          await stream.close()
          expect(core.rpcCalls).toHaveLength(2)
        },
      },
      {
        name: 'abort racing while open RPC still resolves',
        run: async () => {
          const controller = new AbortController()
          let resolveOpen!: (value: unknown) => void
          let capturedStreamId = ''
          const core = createStreamCore(params => {
            capturedStreamId = params.streamId
            return new Promise(resolve => { resolveOpen = resolve })
          })
          const client = new CodexRemoteClient(core as never)
          const abortReason = new Error('superseded')

          const opening = client.subscribe('thr_1', () => undefined, controller.signal)
          controller.abort(abortReason)
          resolveOpen({ opened: true })

          await expect(opening).rejects.toBe(abortReason)
          expect(core.rpcCalls).toEqual([
            { method: 'codex.app.stream.open', params: { streamId: capturedStreamId, threadId: 'thr_1' } },
            { method: 'codex.app.stream.close', params: { streamId: capturedStreamId } },
          ])
          expect(core.eventHandlers.size).toBe(0)
          expect(core.closeHandlers.size).toBe(0)
        },
      },
    ])
  })
})
