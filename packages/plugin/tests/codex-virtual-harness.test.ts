import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import {
  CodexVirtualHarness,
  discoverCodexVirtualWorkspaces,
  paginateCodexNativeHistory,
  projectCodexNativeHistory,
} from '../src/codex/virtual-harness.js'
import { enforceCodexHistoryPageBudget, itemEvents } from '../src/codex/virtual-history.js'
import { parseCodexCall } from '../src/codex/method-policy.js'
import { CodexSessionHistoryCache } from '../src/session-history-cache.js'
import {
  createRpcResponse,
  encodeMessage,
  MAX_SECURE_MESSAGE_BYTES,
  SecureMessageCodec,
} from '@dsh-remote/protocol'
import {
  utf8JsonByteLength,
  VIRTUAL_HISTORY_HARD_MAX_BYTES,
  VIRTUAL_HISTORY_MAX_BYTES,
  VIRTUAL_HISTORY_MAX_MESSAGES,
} from '../src/virtual-history-pagination.js'

describe('CodexVirtualHarness', () => {
  it.each([
    { summary: ['Checking files'], content: ['Raw trace'], expected: 'Checking files' },
    { summary: [], content: ['Raw trace'], expected: 'Raw trace' },
    { summary: ['Checking files'], expected: 'Checking files' },
  ])('projects reasoning with $expected as a reasoning block', ({ expected, ...item }) => {
    expect(itemEvents({ type: 'reasoning', id: 'reasoning-1', ...item }, 1, 1)).toMatchObject([{
      type: 'assistant/message',
      data: { message: { content: [{ type: 'reasoning', text: expected }] } },
    }])
  })

  it('forwards CodeX workspace files and terminal calls to the Host carrier', async () => {
    const client = fakeCodex()
    const hostCarrier = {
      invoke: vi.fn(async () => undefined),
      dispatch: vi.fn(async (endpoint: string) => ({ ok: true as const, value: { endpoint } })),
      open: vi.fn(async () => (async function* () { yield { type: 'ready' } })()),
    }
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'legacy', hostCarrier)
    const signal = new AbortController().signal
    await expect(target.dispatch('workspaceFiles/list', { args: { workspaceFileScopeId: 'codex:thr_1', path: '.' } }, signal))
      .resolves.toEqual({ ok: true, value: { endpoint: 'workspaceFiles/list' } })
    await expect(target.dispatch('terminal/environment', { args: { agentId: 'codex:thr_1' } }, signal))
      .resolves.toEqual({ ok: true, value: { endpoint: 'terminal/environment' } })
    const stream = await target.open('terminal/follow', { args: { agentId: 'codex:thr_1', id: 't1' } }, signal)
    await expect(stream[Symbol.asyncIterator]().next()).resolves.toEqual({ done: false, value: { type: 'ready' } })
    expect(hostCarrier.open).toHaveBeenCalledWith('terminal/follow', expect.anything(), signal)
    await target.close()
  })

  it('returns RC.1 sequenced projections from CodeX history without forwarding its identity to Harness', async () => {
    const hostCarrier = { invoke: vi.fn(), dispatch: vi.fn(), open: vi.fn() }
    const target = new CodexVirtualHarness(fakeCodex(), { deviceId: 'host-1', name: 'Host' }, 'v3', hostCarrier)
    const signal = new AbortController().signal
    try {
      await expect(target.dispatch('session/projections', { args: { request: { sessionId: 'codex:thr_1' } } }, signal))
        .resolves.toMatchObject({ ok: true, value: { kind: 'sequenced', asOfSeq: expect.any(Number), values: { title: expect.any(String) } } })
      await expect(target.dispatch('session/projections', { args: { request: { sessionId: 'codex:absent' } } }, signal))
        .resolves.toEqual({ ok: true, value: null })
      expect(hostCarrier.dispatch).not.toHaveBeenCalled()
    } finally { await target.close() }
  })

  it('answers the background-job roster without a terminal stream failure', async () => {
    const target = new CodexVirtualHarness(fakeCodex(), { deviceId: 'host-1', name: 'Host' })
    const rosterController = new AbortController()
    const roster = await target.open('job/list', { args: { request: { sessionId: 'codex:thr_1' } } }, rosterController.signal)
    const rosterIterator = roster[Symbol.asyncIterator]()
    await expect(rosterIterator.next()).resolves.toEqual({ done: false, value: { type: 'rows', jobs: [] } })
    rosterController.abort()
    await expect(rosterIterator.next()).resolves.toMatchObject({ done: true })
    await target.close()
  })

  it('switches the native Session permission projection between workspace and Full access', async () => {
    const client = fakeCodex()
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const signal = new AbortController().signal
    const control = await target.open('session/control', { args: {} }, signal)
    const iterator = control[Symbol.asyncIterator]()
    await iterator.next()

    await expect(target.invoke({ namespace: 'commands', method: 'list', args: { agentId: 'codex:thr_1' } }))
      .resolves.toEqual([expect.objectContaining({ name: 'permission' })])
    await expect(target.invoke({
      namespace: 'commands',
      method: 'execute',
      args: { agentId: 'codex:thr_1', line: '/permission danger-full-access', images: [] },
    })).resolves.toMatchObject({ result: { kind: 'success' } })
    const projectionFrame = await iterator.next()
    expect(projectionFrame).toMatchObject({ value: {
      type: 'projection',
      sessionId: 'codex:thr_1',
      key: 'permissions',
      value: { currentValue: 'danger-full-access' },
      changes: [{ key: 'permissions', val: { currentValue: 'danger-full-access' } }],
    } })

    const prompted = await target.dispatch('session/prompt', { args: { request: {
      sessionId: 'codex:thr_1',
      content: [{ type: 'text', text: 'Use full access' }],
    } } }, signal)
    expect(prompted.ok).toBe(true)
    expect(client.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thr_1',
    }), expect.any(AbortSignal))
    expect(client.request.mock.calls.find(([method]) => method === 'turn/start')?.[1]).toHaveProperty('permissionPreset', 'danger-full-access')
    await iterator.return?.()
    await target.close()
  })

  it('uses the CodeX project list as the virtual Workspace baseline', async () => {
    const client = fakeCodex([], {
      projects: [
        codexProject('repo-project', 'Repo from CodeX', ['/workspace/repo'], 2),
        codexProject('empty-project', 'Empty CodeX', ['/workspace/empty'], 1),
      ],
    })

    const workspaces = await discoverCodexVirtualWorkspaces(client)
    expect(workspaces).toHaveLength(2)
    expect(workspaces.map(item => item.title)).toEqual(['Empty CodeX', 'Repo from CodeX'])
    expect(workspaces[0]).toMatchObject({
      workspaceId: 'codex-workspace:project:empty-project',
      path: '/workspace/empty',
      sessionIds: [],
      sessionCount: 0,
    })
    expect(workspaces[1]).toMatchObject({
      workspaceId: 'codex-workspace:project:repo-project',
      path: '/workspace/repo',
      sessionIds: ['codex:thr_1'],
      sessionCount: 1,
    })

    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectWorkspace('codex-workspace:project:repo-project')
    const result = await target.dispatch('workspace/list', { args: {} }, new AbortController().signal)
    expect(result).toMatchObject({ ok: true, value: { items: [
      { workspaceId: 'codex-workspace:project:repo-project', sessionIds: ['codex:thr_1'] },
    ] } })
    expect(result).not.toMatchObject({ value: { items: [
      expect.objectContaining({ workspaceId: 'codex-workspace:project:empty-project' }),
    ] } })
    await target.close()

    const emptyTarget = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await emptyTarget.selectWorkspace('codex-workspace:project:empty-project')
    const emptyResult = await emptyTarget.dispatch('workspace/list', { args: {} }, new AbortController().signal)
    expect(emptyResult).toMatchObject({ ok: true, value: { items: [
      { workspaceId: 'codex-workspace:project:empty-project', sessionIds: [] },
      { workspaceId: 'codex-workspace:project:repo-project', sessionIds: ['codex:thr_1'] },
    ] } })
    await emptyTarget.close()
  })

  it('hydrates read-only permission snapshots through Typert history and follow and clears unsupported live policies', async () => {
    for (const carrier of ['history', 'follow']) {
      const client = fakeCodex()
      const request = client.request.getMockImplementation()!
      client.request.mockImplementation(async (method: string, params: unknown, signal?: AbortSignal) => {
        const response = await request(method, params, signal)
        return method === 'dsh/sessionHistory' ? { ...response, permissionPreset: 'danger-full-access' } : response
      })
      const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
      const signal = new AbortController().signal
      let stream: AsyncIterator<unknown> | undefined
      if (carrier === 'history') {
        expect(await target.dispatch('session/history', { args: { request: { sessionId: 'codex:thr_1' } } }, signal))
          .toMatchObject({ value: { projections: { values: { permissions: { currentValue: 'danger-full-access' } } } } })
      } else {
        stream = (await target.open('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_1' } } } }, signal))[Symbol.asyncIterator]()
        expect(await stream.next()).toMatchObject({ value: { projections: { values: { permissions: { currentValue: 'danger-full-access' } } } } })
      }
      stream ??= (await target.open('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_1' } } } }, signal))[Symbol.asyncIterator]()
      expect(client.request.mock.calls.some(([method]) => method === 'thread/resume')).toBe(false)
      client.emit('thr_1', { method: 'thread/settings/updated', params: { threadSettings: {
        approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' },
      } } })
      expect(await target.dispatch('session/list', { args: {} }, signal)).toMatchObject({ value: {
        items: [expect.objectContaining({ projections: expect.objectContaining({ values: expect.objectContaining({
          permissions: expect.objectContaining({ currentValue: 'Host settings (not reported)' }),
        }) }) })],
      } })
      await stream?.return?.()
      await target.close()
    }
  })

  it('derives exact cwd authority when project listings are unavailable or empty', async () => {
    await runScenarios([
      {
        name: 'derives exact cwd workspaces when CodeX project/list is unavailable',
        run: async () => {
          const client = fakeCodex([codexThread('thr_2', '/workspace/other', 'Other workspace')], {
            projectListError: Object.assign(
              new Error('The requested Codex method is not available over Remote.'),
              {
                code: 'METHOD_NOT_ALLOWED',
              },
            ),
          })

          const workspaces = await discoverCodexVirtualWorkspaces(client)
          expect(workspaces).toHaveLength(2)
          expect(workspaces).toEqual([
            expect.objectContaining({ path: '/workspace/repo', title: 'repo', sessionIds: ['codex:thr_1'] }),
            expect.objectContaining({ path: '/workspace/other', title: 'other', sessionIds: ['codex:thr_2'] }),
          ])

          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          const sessions = await target.dispatch('session/list', { args: {} }, new AbortController().signal)
          expect(sessions).toMatchObject({
            ok: true,
            value: { items: [{ sessionId: 'codex:thr_1' }, { sessionId: 'codex:thr_2' }] },
          })
          await target.close()
        },
      },
      {
        name: 'derives exact cwd workspaces when CodeX project/list is empty',
        run: async () => {
          const client = fakeCodex([], { projects: [] })

          const workspaces = await discoverCodexVirtualWorkspaces(client)
          expect(workspaces).toEqual([
            expect.objectContaining({ path: '/workspace/repo', title: 'repo', sessionIds: ['codex:thr_1'] }),
          ])

          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          const sessions = await target.dispatch('session/list', { args: {} }, new AbortController().signal)
          expect(sessions).toMatchObject({ ok: true, value: { items: [{ sessionId: 'codex:thr_1' }] } })
          await target.close()
        },
      },
    ])
  }, 10000)

  it('filters CodeX threads that do not belong to an advertised project', async () => {
    const client = fakeCodex([
      codexThread('thr_2', '/workspace/other', 'Other workspace'),
      codexThread('thr_3', undefined, 'Project metadata only', 'repo-project'),
    ])

    const workspaces = await discoverCodexVirtualWorkspaces(client)
    expect(workspaces).toHaveLength(1)
    expect(workspaces[0]).toMatchObject({
      workspaceId: 'codex-workspace:project:repo-project',
      sessionIds: ['codex:thr_1', 'codex:thr_3'],
      sessionCount: 2,
    })

    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const sessions = await target.dispatch('session/list', { args: {} }, new AbortController().signal)
    expect(sessions).toMatchObject({ ok: true, value: { items: [
      { sessionId: 'codex:thr_1' },
      { sessionId: 'codex:thr_3' },
    ] } })
    expect(JSON.stringify(sessions)).not.toContain('codex:thr_2')
    await target.close()
  })

  it('reopens Typert follows after the Host closes the CodeX stream without reviving the old subscriber', async () => {
    await runScenarios(['legacy', 'v3'].map(generation => ({ name: generation, run: async () => {
      const client = fakeCodex()
      const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, generation as 'legacy' | 'v3')
      const controller = new AbortController()
      const payload = { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_1' } } } }
      try {
        const first = (await target.open('session/follow', payload, controller.signal))[Symbol.asyncIterator]()
        expect((await first.next()).done).toBe(false)
        client.closeStream('thr_1', 'failed')
        expect((await first.next()).done).toBe(true)
        const second = (await target.open('session/follow', payload, controller.signal))[Symbol.asyncIterator]()
        expect((await second.next()).done).toBe(false)
        expect(client.subscribe).toHaveBeenCalledTimes(2)
        client.emit('thr_1', { method: 'turn/started', params: { turn: { id: 'turn_recovered', status: 'inProgress', items: [] } } })
        expect((await second.next()).value).toMatchObject({ type: 'event', event: { type: 'turn/start' } })
        expect((await first.next()).done).toBe(true)
      } finally { controller.abort(); await target.close() }
    } })))
  })

  it('projects persisted CodeX history and live frames into native session events', async () => {
    const client = fakeCodex()
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const controller = new AbortController()
    const source = await target.open('session/follow', {
      args: { request: { address: { kind: 'session', sessionId: 'codex:thr_1' } } },
    }, controller.signal)
    const iterator = source[Symbol.asyncIterator]()

    const snapshot = await iterator.next()
    expect(snapshot.value).toMatchObject({
      type: 'snapshot',
      header: { id: 'codex:thr_1', cwd: '/workspace/repo' },
      projections: { values: { modelSelection: { next: {
        provider: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'low',
      } } } },
      records: [
        { event: { type: 'turn/start', seq: 0 } },
        { event: { type: 'step/start', seq: 1 } },
        { event: { type: 'user/message', seq: 2, data: { content: [{ type: 'text', text: 'Use native UI' }] } } },
        { event: { type: 'assistant/message', seq: 3 } },
        { event: { type: 'tool/call', seq: 4 } },
        { event: { type: 'tool/result', seq: 5 } },
        { event: { type: 'tool/call', seq: 6 } },
        { event: { type: 'tool/result', seq: 7 } },
        { event: { type: 'step/end', seq: 8 } },
        { event: { type: 'turn/end', seq: 9 } },
      ],
    })
    expect(snapshot.value.records[2].event.surfaceOp).toBe('append')
    expect(snapshot.value.records[3].event.surfaceOp).toBe('append')
    expect(snapshot.value.records[4].view).toEqual({
      for: 'call',
      view: { card: 'terminal', title: 'pnpm test' },
    })
    expect(snapshot.value.records[5]).toMatchObject({
      event: { surfaceOp: 'append' },
      view: { for: 'result', view: { card: 'terminal', output: '3 passed', exitCode: 0 } },
    })
    expect(snapshot.value.records[6]).toMatchObject({
      view: { for: 'call', view: { card: 'generic', kind: 'edit', locations: [{ path: 'src/native.ts' }] } },
    })
    expect(snapshot.value.records[7].event.surfaceOp).toBe('append')
    expect(JSON.stringify(snapshot.value)).not.toContain('private diff body')

    client.emit('thr_1', {
      method: 'turn/started',
      params: { turn: { id: 'turn_2', status: 'inProgress', items: [] } },
    })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'event', event: { type: 'turn/start', seq: 10 } } })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'event', event: { type: 'step/start', seq: 11 } } })

    client.emit('thr_1', {
      method: 'item/agentMessage/delta',
      params: { turnId: 'turn_2', itemId: 'assistant_2', delta: 'Streaming' },
    })
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'event', event: { type: 'assistant/chunk', data: { chunk: { type: 'block-start' } } } },
    })
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'event', event: { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'Streaming' } } } },
    })

    client.emit('thr_1', {
      method: 'item/completed',
      params: { turnId: 'turn_2', item: { id: 'assistant_2', type: 'agentMessage', text: 'Streaming', status: 'completed' } },
    })
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'event', event: { type: 'assistant/chunk', data: { chunk: {
        type: 'block-end', block: { type: 'text', text: 'Streaming' },
      } } } },
    })
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'event', event: { type: 'assistant/chunk', data: { chunk: {
        type: 'finish', reason: { kind: 'stop' },
      } } } },
    })
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'event', event: { type: 'assistant/message', data: {
        message: { content: [{ type: 'text', text: 'Streaming' }] },
      } } },
    })

    controller.abort()
    await iterator.return?.()
    await target.close()
  })

  it('preserves the model reported by a persisted CodeX Turn', async () => {
    const client = fakeCodex([{
      id: 'thr_model',
      name: 'Model thread',
      cwd: '/workspace/repo',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_100,
      status: { type: 'idle' },
      turns: [{
        id: 'turn_model', model: 'gpt-5.6-terra', effort: 'high',
        items: [{ id: 'assistant_model', type: 'agentMessage', text: 'Using Terra', status: 'completed' }],
      }],
    }])
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const controller = new AbortController()
    try {
      const source = await target.open('session/follow', {
        args: { request: { address: { kind: 'session', sessionId: 'codex:thr_model' } } },
      }, controller.signal)
      const snapshot = await source[Symbol.asyncIterator]().next()
      expect(snapshot.value).toMatchObject({
        projections: { values: { modelSelection: { next: { model: 'gpt-5.6-terra' } } } },
      })
      const records = (snapshot.value as {
        records: Array<{ event: { data: { message?: { source?: { model?: string } } } } }>
      }).records
      expect(records.some(record => record.event.data.message?.source?.model === 'gpt-5.6-terra')).toBe(true)
    } finally {
      controller.abort()
      await target.close()
    }
  })

  it('projects CodeX message and MCP result images into native image blocks and virtual attachments', async () => {
    const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJihxwAAAABJRU5ErkJggg=='
    const client = fakeCodex([{
      id: 'thr_image',
      name: 'Image prompt',
      cwd: '/workspace/repo',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_100,
      status: { type: 'idle' },
      turns: [{
        id: 'turn_image',
        status: 'completed',
        items: [
          {
            id: 'user_image',
            type: 'userMessage',
            content: [
              { type: 'text', text: 'Describe this image' },
              { type: 'image', url: `data:image/png;base64,${imageData}`, name: 'screen.png' },
              { type: 'image', url: 'https://example.test/not-allowed.png', name: 'external.png' },
            ],
          },
          {
            id: 'screenshot_tool',
            type: 'mcpToolCall',
            server: 'cua_repl',
            tool: 'js',
            status: 'completed',
            result: {
              content: [
                { type: 'text', text: '/workspace/current-browser.png' },
                { type: 'image', data: imageData, mimeType: 'image/png', name: 'current-browser.png' },
              ],
              isError: false,
            },
          },
          {
            id: 'assistant_image',
            type: 'agentMessage',
            content: [{ type: 'text', text: '![Current browser](/workspace/current-browser.png)' }],
            status: 'completed',
          },
        ],
      }],
    }])
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })

    const history = await target.dispatch('session/history', { args: { request: { sessionId: 'codex:thr_image' as never } } }, new AbortController().signal)

    expect(history.ok).toBe(true)
    if (!history.ok) throw new Error('history failed')
    const message = (history.value as { events: Array<{ event: { type: string; seq: number; data: unknown } }> }).events.find(entry => entry.event.type === 'user/message')!.event.data as {
      content: Array<{ type: string; attachment?: { attachmentId?: string }; data?: string; url?: string; name?: string }>
    }
    expect(message.content).toMatchObject([
      { type: 'text', text: 'Describe this image' },
      {
        type: 'image',
        mediaType: 'image/png',
        data: imageData,
        url: `data:image/png;base64,${imageData}`,
        name: 'screen.png',
        attachment: { mediaType: 'image/png', width: 1, height: 1, name: 'screen.png' },
      },
    ])
    expect(JSON.stringify(message)).not.toContain('example.test')

    const assistant = (history.value as { events: Array<{ event: { type: string; seq: number; data: unknown } }> }).events.find(entry => entry.event.type === 'assistant/message')!.event.data as {
      message: { content: Array<{ type: string; attachment?: { attachmentId?: string }; data?: string; name?: string }> }
    }
    expect(assistant.message.content).toMatchObject([
      { type: 'text', text: '![Current browser](/workspace/current-browser.png)' },
      {
        type: 'image',
        mediaType: 'image/png',
        data: imageData,
        name: 'current-browser.png',
        attachment: { mediaType: 'image/png', width: 1, height: 1, name: 'current-browser.png' },
      },
    ])

    const tool = (history.value as { events: Array<{ event: { type: string; data: unknown } }> }).events
      .find(entry => entry.event.type === 'tool/result')!.event.data as {
      message: { content: Array<{ content: Array<{ attachment?: { attachmentId: string } }> }> }
    }
    const toolImage = tool.message.content[0]!.content[1]!
    expect(toolImage).not.toHaveProperty('data')
    expect(toolImage).toMatchObject({
      type: 'image',
      attachment: { mediaType: 'image/png', name: 'current-browser.png' },
    })
    await expect(target.dispatch('session/attachment', {
      args: { request: { sessionId: 'codex:thr_image', attachment: toolImage.attachment } },
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: { attachment: toolImage.attachment, data: imageData },
    })

    const attachmentId = message.content[1]!.attachment!.attachmentId!
    const attachment = await target.dispatch('session/attachment', { args: { request: { sessionId: 'codex:thr_image' as never, attachmentId: attachmentId as never } } }, new AbortController().signal)
    expect(attachment).toMatchObject({
      ok: true,
      value: {
        attachment: { attachmentId, mediaType: 'image/png', name: 'screen.png' },
        data: imageData,
      },
    })
    // 0.2.2 clients send the full image reference instead of the bare id.
    await expect(target.dispatch('session/attachment', {
      args: { request: { sessionId: 'codex:thr_image' as never, attachment: message.content[1]!.attachment } },
    }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: { attachment: { attachmentId, mediaType: 'image/png', name: 'screen.png' }, data: imageData },
    })
    const toolAttachmentId = assistant.message.content[1]!.attachment!.attachmentId!
    await expect(target.dispatch('session/attachment', { args: { request: { sessionId: 'codex:thr_image' as never, attachmentId: toolAttachmentId as never } } }, new AbortController().signal)).resolves.toMatchObject({
      ok: true,
      value: {
        attachment: { attachmentId: toolAttachmentId, mediaType: 'image/png', name: 'current-browser.png' },
        data: imageData,
      },
    })
    const controller = new AbortController()
    const follow = await target.open('session/follow', {
      args: { request: { address: { kind: 'session', sessionId: 'codex:thr_image' } } },
    }, controller.signal)
    const iterator = follow[Symbol.asyncIterator]()
    try {
      await iterator.next()
      client.emit('thr_image', {
        method: 'turn/started',
        params: { turn: { id: 'live_screenshot_turn', status: 'inProgress', items: [] } },
      })
      await iterator.next()
      await iterator.next()
      const item = {
        id: 'live_screenshot',
        type: 'mcpToolCall',
        status: 'completed',
        result: { content: [{ type: 'image', data: imageData, mimeType: 'image/png' }] },
      }
      client.emit('thr_image', {
        method: 'turn/completed',
        params: { turn: { id: 'live_screenshot_turn', status: 'completed', items: [item] } },
      })
      await expect(iterator.next()).resolves.toMatchObject({ value: { event: { type: 'tool/call' } } })
      const liveResult = await iterator.next()
      expect(liveResult.value).toMatchObject({ event: {
        type: 'tool/result',
        data: { message: { content: [{ content: [expect.anything(), {
          type: 'image', attachment: { mediaType: 'image/png' },
        }] }] } },
      } })
      await expect(iterator.next()).resolves.toMatchObject({ value: { event: { type: 'step/end' } } })
      await expect(iterator.next()).resolves.toMatchObject({ value: { event: { type: 'turn/end' } } })
    } finally {
      controller.abort()
      await iterator.return?.()
    }
    await target.close()
  })

  it('recovers a missing terminal frame from the exact completed CodeX turn', async () => {
    const thread = { ...codexThread('thr_recovery', '/workspace/repo', 'Recover'), turns: [] as Record<string, unknown>[] }
    const client = fakeCodex([thread])
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'v3')
    const controller = new AbortController()
    const source = await target.open('session/follow', {
      args: { request: { address: { kind: 'session', sessionId: 'codex:thr_recovery' } } },
    }, controller.signal)
    const iterator = source[Symbol.asyncIterator]()
    try {
      await iterator.next()
      client.emit('thr_recovery', { method: 'turn/started', params: { turn: { id: 'turn_recovery', items: [] } } })
      await expect(iterator.next()).resolves.toMatchObject({ value: { event: { type: 'turn/start' } } })
      await iterator.next()
      const turn = { id: 'turn_recovery', status: 'completed', items: [] }
      thread.turns.push(turn)
      client.emit('thr_recovery', { method: 'thread/status/changed', params: { status: { type: 'idle' } } })
      await expect(iterator.next()).resolves.toMatchObject({ value: { event: { type: 'step/end' } } })
      await expect(iterator.next()).resolves.toMatchObject({ value: { event: {
        type: 'turn/end', data: { reason: { kind: 'completed' } },
      } } })
      client.emit('thr_recovery', { method: 'turn/completed', params: { turn } })
      client.emit('thr_recovery', { method: 'turn/started', params: { turn: { id: 'new_turn', items: [] } } })
      await expect(iterator.next()).resolves.toMatchObject({ value: { event: { type: 'turn/start' } } })
    } finally {
      controller.abort()
      await iterator.return?.()
      await target.close()
    }
  })

  it('validates a multi-megabyte inline image without overflowing the base64 matcher', async () => {
    const client = fakeCodex()
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const signal = new AbortController().signal
    const image = { type: 'image', mediaType: 'image/png', data: 'a'.repeat(20_000_000) }
    try {
      await expect(target.dispatch('session/prompt', {
        args: { request: { sessionId: 'codex:thr_1', content: [image] } },
      }, signal)).resolves.toMatchObject({ ok: true })
      expect(client.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ input: [image] }), signal)
    } finally {
      await target.close()
    }
  })

  it('redeems only session-owned Desktop file and image receipts once', async () => {
    const client = fakeCodex()
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const signal = new AbortController().signal
    const image = { type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=' }
    const file = { type: 'text', text: 'Attached workspace file: "./notes.txt"' }
    target.registerDesktopUpload('codex:thr_1', 'file-receipt', file)
    target.registerDesktopUpload('codex:thr_1', 'image-receipt', image)
    const prompt = (sessionId: string) => target.dispatch('session/prompt', {
      args: { request: { sessionId, content: [
        { type: 'file', receiptId: 'file-receipt' },
        { type: 'file', receiptId: 'image-receipt' },
      ] } },
    }, signal)
    try {
      await expect(prompt('codex:other')).resolves.toMatchObject({ ok: false })
      await expect(prompt('codex:thr_1')).resolves.toMatchObject({ ok: true })
      expect(client.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
        input: [file, image],
      }), signal)
      await expect(prompt('codex:thr_1')).resolves.toMatchObject({ ok: false })
    } finally {
      await target.close()
    }
  })

  it('emits Session V3 history, replacements, and assistant stream frames for v0.1.5', async () => {
    const sessionSurface = await import('@deepseek-ai/dsh-session/surface') as unknown as {
      validateSurfaceMetadata(event: unknown): void
      validateSessionEventData(event: unknown, subject: string): void
    }
    const assertV3Event = (event: unknown): void => {
      sessionSurface.validateSurfaceMetadata(event)
      sessionSurface.validateSessionEventData(event, 'CodeX V3 fixture')
    }
    const client = fakeCodex()
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'v3')
    const controller = new AbortController()
    const source = await target.open('session/follow', {
      args: { request: {
        address: { kind: 'session', sessionId: 'codex:thr_1' },
        assistantStream: true,
      } },
    }, controller.signal)
    const iterator = source[Symbol.asyncIterator]()
    const snapshot = await iterator.next()
    expect(snapshot.value).toMatchObject({
      type: 'snapshot',
      header: { version: 3, id: 'codex:thr_1', isSeeded: false },
      assistantStream: { revision: 0 },
    })
    for (const record of snapshot.value.records) {
      expect(() => assertV3Event(record.event)).not.toThrow()
      if (record.event.type === 'assistant/message') expect(record.event.data.stream).toEqual([])
    }

    client.emit('thr_1', {
      method: 'turn/started',
      params: { turn: { id: 'turn_v3', status: 'inProgress', items: [] } },
    })
    await iterator.next()
    await iterator.next()
    client.emit('thr_1', {
      method: 'item/started',
      params: { turnId: 'turn_v3', item: {
        id: 'command_v3', type: 'commandExecution', command: 'pnpm test', status: 'inProgress',
      } },
    })
    await iterator.next()
    client.emit('thr_1', {
      method: 'item/commandExecution/outputDelta',
      params: { turnId: 'turn_v3', itemId: 'command_v3', delta: 'one' },
    })
    const firstResult = await iterator.next()
    client.emit('thr_1', {
      method: 'item/commandExecution/outputDelta',
      params: { turnId: 'turn_v3', itemId: 'command_v3', delta: ' two' },
    })
    const replacement = await iterator.next()
    expect(replacement).toMatchObject({ value: { event: {
      type: 'tool/result',
      surfaceOp: {
        op: 'replace',
        startSeq: firstResult.value.event.seq,
        endSeq: firstResult.value.event.seq,
      },
      sourceEventSeqs: [firstResult.value.event.seq],
    } } })
    expect(() => assertV3Event(replacement.value.event)).not.toThrow()

    client.emit('thr_1', {
      method: 'item/agentMessage/delta',
      params: { turnId: 'turn_v3', itemId: 'assistant_v3', delta: 'hello' },
    })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'assistant-stream', frame: {
      type: 'start', attemptId: expect.any(String), revision: 1,
    } } })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'assistant-stream', frame: {
      type: 'chunk', index: 0, chunk: { type: 'block-start' },
    } } })
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'assistant-stream', frame: {
      type: 'chunk', index: 1, chunk: { type: 'text-delta', text: 'hello' },
    } } })
    client.emit('thr_1', {
      method: 'item/completed',
      params: { turnId: 'turn_v3', item: {
        id: 'assistant_v3', type: 'agentMessage', text: 'hello', status: 'completed',
      } },
    })
    await iterator.next()
    await iterator.next()
    const settlement = await iterator.next()
    expect(settlement.value).toMatchObject({ type: 'event', event: {
      type: 'assistant/message',
      surfaceOp: 'append',
      data: { stream: expect.any(Array), message: { content: [{ type: 'text', text: 'hello' }] } },
    } })
    expect(() => assertV3Event(settlement.value.event)).not.toThrow()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'assistant-stream', frame: {
      type: 'end',
      outcome: { kind: 'committed', eventType: 'assistant/message', seq: settlement.value.event.seq },
    } } })

    controller.abort()
    await iterator.return?.()
    await target.close()
  })

  it('routes text and image composer prompts to CodeX', async () => {
    await runScenarios([
      {
        name: 'routes the native composer prompt back to CodeX resume and turn/start',
        run: async () => {
          const client = fakeCodex()
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          await expect(
            target.dispatch(
              'session/selectModel',
              {
                args: {
                  request: {
                    sessionId: 'codex:thr_1',
                    provider: 'codex',
                    model: 'gpt-5.6-terra',
                    reasoningEffort: 'high',
                  },
                },
              },
              new AbortController().signal,
            ),
          ).resolves.toEqual({
            ok: true,
            value: { selected: { provider: 'codex', model: 'gpt-5.6-terra', reasoningEffort: 'high' } },
          })
          const result = await target.dispatch(
            'session/prompt',
            {
              args: {
                request: {
                  sessionId: 'codex:thr_1',
                  requestId: 'rpc-1',
                  content: [{ type: 'text', text: 'Continue here' }],
                },
              },
            },
            new AbortController().signal,
          )

          expect(result).toEqual({ ok: true, value: { accepted: true } })
          expect(client.request).toHaveBeenCalledWith(
            'thread/resume',
            {
              threadId: 'thr_1',
              model: 'gpt-5.6-terra',
            },
            expect.any(AbortSignal),
          )
          expect(client.request).toHaveBeenCalledWith(
            'turn/start',
            {
              threadId: 'thr_1',
              input: [{ type: 'text', text: 'Continue here' }],
              model: 'gpt-5.6-terra',
              effort: 'high',
            },
            expect.any(AbortSignal),
          )
          await target.close()
        },
      },
      {
        name: 'routes pasted Composer images through the CodeX prompt input',
        run: async () => {
          const client = fakeCodex()
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          const result = await target.dispatch(
            'session/prompt',
            {
              args: {
                request: {
                  sessionId: 'codex:thr_1',
                  requestId: 'rpc-image-1',
                  content: [
                    { type: 'text', text: 'Describe this screenshot' },
                    { type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=' },
                  ],
                },
              },
            },
            new AbortController().signal,
          )

          expect(result).toEqual({ ok: true, value: { accepted: true } })
          expect(client.request).toHaveBeenCalledWith(
            'turn/start',
            expect.objectContaining({
              threadId: 'thr_1',
              input: [
                { type: 'text', text: 'Describe this screenshot' },
                { type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=' },
              ],
            }),
            expect.any(AbortSignal),
          )
          await target.close()
        },
      },
    ])
  }, 10000)

  it('uses the effective App Server permission returned by resume', async () => {
    const client = fakeCodex([codexThread('thr_full', '/workspace/repo', 'Full access thread')])
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const result = await target.dispatch('session/prompt', {
      args: {
        request: {
          sessionId: 'codex:thr_full',
          content: [{ type: 'text', text: 'Continue with the saved permission' }],
        },
      },
    }, new AbortController().signal)

    expect(result).toEqual({ ok: true, value: { accepted: true } })
    expect(client.request).toHaveBeenCalledWith('thread/resume', {
      threadId: 'thr_full',
      model: 'gpt-5.6-sol',
    }, expect.any(AbortSignal))
    expect(client.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thr_full',
    }), expect.any(AbortSignal))
    expect(client.request.mock.calls.find(([method]) => method === 'turn/start')?.[1]).toHaveProperty('permissionPreset', 'danger-full-access')
    expect(await target.dispatch('session/list', { args: {} }, new AbortController().signal))
      .toMatchObject({ value: { items: expect.arrayContaining([expect.objectContaining({
        sessionId: 'codex:thr_full', projections: { kind: 'sequenced', asOfSeq: 0, values: expect.objectContaining({ permissions: expect.objectContaining({ currentValue: 'danger-full-access' }) }) },
      })]) } })
    await target.close()
  })

  it('keeps the confirmed permission when resuming resets the upstream settings', async () => {
    const client = fakeCodex()
    const request = client.request.getMockImplementation()!
    client.request.mockImplementation(async (method, params, signal) => {
      if (method === 'thread/resume' && !('permissionPreset' in params)) {
        return { thread: codexThread('thr_1', '/workspace/repo', 'Thread'), approvalPolicy: 'on-request', sandbox: 'workspace-write' }
      }
      return request(method, params, signal)
    })
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.invoke({ namespace: 'commands', method: 'execute', args: {
      agentId: 'codex:thr_1', line: '/permission danger-full-access', images: [],
    } })
    await target.dispatch('session/prompt', { args: { request: {
      sessionId: 'codex:thr_1', content: [{ type: 'text', text: 'Continue' }],
    } } }, new AbortController().signal)
    expect(client.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thr_1', permissionPreset: 'danger-full-access',
    }), expect.any(AbortSignal))
    await target.close()
  })

  it('cancels the active turn restored from CodeX history', async () => {
    await runScenarios([
      {
        name: 'keeps active CodeX history open and exposes the turn id for cancellation',
        run: async () => {
          const history = projectCodexNativeHistory(
            {
              id: 'thr_active',
              cwd: '/workspace/repo',
              status: { type: 'active', activeFlags: [] },
              turns: [
                {
                  id: 'turn_active',
                  status: 'inProgress',
                  items: [
                    { id: 'assistant_active', type: 'agentMessage', text: 'Working', status: 'inProgress' },
                  ],
                },
              ],
            },
            'codex:thr_active',
          )

          expect(history.activeTurnId).toBe('turn_active')
          expect(history.entries.map((entry) => entry.event.type)).toEqual([
            'turn/start',
            'step/start',
            'assistant/message',
          ])
          expect(paginateCodexNativeHistory(history, {}).activeTurnId).toBe('turn_active')
        },
      },
      {
        name: 'uses the active turn id restored from paginated history when cancelling',
        run: async () => {
          const client = fakeCodex([
            {
              id: 'thr_active',
              cwd: '/workspace/repo',
              name: 'Active',
              status: { type: 'active', activeFlags: [] },
              turns: [{ id: 'turn_active', status: 'inProgress', items: [] }],
            },
          ])
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })

          await target.dispatch(
            'session/history',
            {
              args: { request: { sessionId: 'codex:thr_active' } },
            },
            new AbortController().signal,
          )
          await target.open('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_active' } } } }, new AbortController().signal)
          await expect(
            target.dispatch(
              'session/cancel',
              {
                args: { request: { sessionId: 'codex:thr_active' } },
              },
              new AbortController().signal,
            ),
          ).resolves.toEqual({ ok: true, value: { accepted: true } })

          expect(client.request).toHaveBeenCalledWith(
            'turn/interrupt',
            {
              threadId: 'thr_active',
              turnId: 'turn_active',
            },
            expect.any(AbortSignal),
          )
          await target.close()
        },
      },
    ])
  }, 10000)

  it('serves paged CodeX history with the legacy Host fallback', async () => {
    await runScenarios([
      {
        name: 'serves rc.2 and alpha History as message-aligned backwards pages',
        run: async () => {
          const client = fakeCodex()
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          const tail = await target.dispatch('session/history', { args: { request: { sessionId: 'codex:thr_1' as never, maxMessages: 3 } } }, new AbortController().signal)
          expect(tail).toMatchObject({ ok: true, value: { hasMore: true } })
          if (!tail.ok) throw new Error('tail history failed')
          expect((tail.value as { events: Array<{ event: { type: string; seq: number; data: unknown } }> }).events.map((entry) => entry.event.seq)).toEqual([3, 4, 5, 6, 7, 8, 9])

          const older = await target.dispatch(
            'session/page',
            {
              args: {
                request: {
                  address: { kind: 'session', sessionId: 'codex:thr_1' },
                  throughSeq: 9,
                  beforeSeq: 3,
                  maxMessages: 3,
                },
              },
            },
            new AbortController().signal,
          )
          expect(older).toMatchObject({ ok: true, value: { hasMore: false } })
          if (!older.ok) throw new Error('older history failed')
          expect(
            (older.value as { records: Array<{ event: { seq: number } }> }).records.map(
              (entry) => entry.event.seq,
            ),
          ).toEqual([0, 1, 2])
          await target.close()
        },
      },
      {
        name: 'bounds the native 500-message follow window to the Remote page limit',
        run: async () => {
          const client = fakeCodex()
          const originalRequest = client.request.getMockImplementation()!
          client.request.mockImplementation(async (method: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
            if (method === 'dsh/sessionHistory' && params?.maxMessages === 500) {
              throw Object.assign(new Error('The CodeX call parameters are invalid.'), { code: 'INVALID_MESSAGE' })
            }
            return originalRequest(method, params, signal)
          })
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          const controller = new AbortController()
          try {
            const stream = await target.open(
              'session/follow',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_1' }, maxMessages: 500 } } },
              controller.signal,
            )
            const iterator = stream[Symbol.asyncIterator]()
            await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { type: 'snapshot' } })
            expect(client.request).toHaveBeenCalledWith(
              'dsh/sessionHistory',
              { threadId: 'thr_1', maxMessages: 200 },
              expect.any(AbortSignal),
            )
            await iterator.return?.()
          } finally {
            controller.abort()
            await target.close()
          }
        },
      },
      {
        name: 'falls back to thread/read history when a remote Host lacks the paginated DSH method',
        run: async () => {
          const client = fakeCodex()
          const originalRequest = client.request.getMockImplementation() as
            | ((method: string, params?: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>)
            | undefined
          client.request.mockImplementation(
            async (method: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
              if (method === 'dsh/sessionHistory') {
                throw Object.assign(new Error('The requested Codex method is not available over Remote.'), {
                  code: 'METHOD_NOT_ALLOWED',
                })
              }
              return originalRequest?.(method, params, signal)
            },
          )
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })

          const history = await target.dispatch('session/history', { args: { request: { sessionId: 'codex:thr_1' as never, maxMessages: 3 } } }, new AbortController().signal)

          expect(history).toMatchObject({ ok: true, value: { hasMore: true } })
          if (!history.ok) throw new Error('history failed')
          expect((history.value as { events: Array<{ event: { type: string; seq: number; data: unknown } }> }).events.map((entry) => entry.event.seq)).toEqual([3, 4, 5, 6, 7, 8, 9])
          expect(client.request).toHaveBeenCalledWith(
            'thread/read',
            { threadId: 'thr_1', includeTurns: true },
            expect.any(AbortSignal),
          )
          await target.close()
        },
      },
      {
        name: 'projects a just-created blank Session when an old Host cannot read an unmaterialized Thread',
        run: async () => {
          const client = fakeCodex()
          const originalRequest = client.request.getMockImplementation() as
            | ((method: string, params?: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>)
            | undefined
          client.request.mockImplementation(
            async (method: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
              if (method === 'dsh/sessionHistory') {
                throw Object.assign(new Error('The requested Codex method is not available over Remote.'), {
                  code: 'METHOD_NOT_ALLOWED',
                })
              }
              if (method === 'thread/read' && params?.includeTurns === true
                && String(params.threadId).startsWith('new_')) {
                throw Object.assign(new Error('Codex App Server rejected the request.'), {
                  code: 'CODEX_UPSTREAM_ERROR',
                })
              }
              return originalRequest?.(method, params, signal)
            },
          )
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          await target.selectWorkspace('codex-workspace:project:repo-project')
          const created = await target.dispatch('session/create', {
            args: { request: { workspaceId: 'codex-workspace:project:repo-project' } },
          }, new AbortController().signal)
          expect(created).toEqual({ ok: true, value: { sessionId: 'codex:new_1' } })

          const history = await target.dispatch('session/history', { args: { request: { sessionId: 'codex:new_1' as never } } }, new AbortController().signal)
          expect(history).toMatchObject({
            ok: true,
            value: {
              events: [],
              hasMore: false,
              projections: { values: { sessionListMetadata: { blank: true } } },
            },
          })
          expect(client.request).toHaveBeenCalledWith(
            'thread/read',
            { threadId: 'new_1', includeTurns: true },
            expect.any(AbortSignal),
          )
          await target.close()
        },
      },
    ])
  }, 10000)

  it('starts the first turn in a freshly created CodeX Thread without resuming it first', async () => {
    const client = fakeCodex()
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    await target.selectWorkspace('codex-workspace:project:repo-project')

    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: 'codex-workspace:project:repo-project' } },
    }, new AbortController().signal)
    expect(created).toEqual({ ok: true, value: { sessionId: 'codex:new_1' } })

    const prompted = await target.dispatch('session/prompt', {
      args: {
        request: {
          sessionId: 'codex:new_1',
          content: [{ type: 'text', text: 'Start here' }],
        },
      },
    }, new AbortController().signal)

    expect(prompted).toEqual({ ok: true, value: { accepted: true } })
    expect(client.request).not.toHaveBeenCalledWith('thread/resume', expect.objectContaining({
      threadId: 'new_1',
    }), expect.any(AbortSignal))
    expect(client.request).toHaveBeenCalledWith('turn/start', {
      threadId: 'new_1',
      input: [{ type: 'text', text: 'Start here' }],
      model: 'gpt-5.6-sol',
      effort: 'low',
      permissionPreset: 'workspace-write',
    }, expect.any(AbortSignal))
    await target.close()
  })

  it('opens a freshly created blank CodeX Thread with empty history and a follow snapshot', async () => {
    const client = fakeCodex()
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
    const controller = new AbortController()
    await target.selectWorkspace('codex-workspace:project:repo-project')
    const created = await target.dispatch('session/create', {
      args: { request: { workspaceId: 'codex-workspace:project:repo-project' } },
    }, controller.signal)
    expect(created).toEqual({ ok: true, value: { sessionId: 'codex:new_1' } })

    const history = await target.dispatch('session/history', {
      args: { request: { sessionId: 'codex:new_1' } },
    }, controller.signal)
    expect(history).toMatchObject({
      ok: true,
      value: {
        events: [],
        hasMore: false,
        projections: { values: { sessionListMetadata: { blank: true } } },
      },
    })

    const source = await target.open('session/follow', {
      args: { request: { address: { kind: 'session', sessionId: 'codex:new_1' } } },
    }, controller.signal)
    const iterator = source[Symbol.asyncIterator]()
    const snapshot = await iterator.next()
    expect(snapshot.value).toMatchObject({
      type: 'snapshot',
      cursor: -1,
      records: [],
      projections: { values: { sessionListMetadata: { blank: true } } },
    })
    await iterator.return?.()
    await target.close()
  })

  it('restores catalog sessions without busy-read probes or cross-workspace navigation', async () => {
    await runScenarios([
      { name: 'restores the most recent running thread even without a title', preferred: undefined, expected: 'codex:latest' },
      { name: 'retains the previously opened older thread', preferred: 'codex:older', expected: 'codex:older' },
      { name: 'ignores remembered threads from another workspace', preferred: 'codex:outside', expected: 'codex:latest' },
      { name: 'falls back to the latest after a remembered thread disappears', preferred: 'codex:missing', expected: 'codex:latest' },
      { name: 'an empty workspace does not pick another workspace thread', empty: true, expected: undefined },
      { name: 'an aborted reconnect does not choose a session', aborted: true, expected: undefined },
    ].map(scenario => ({
      name: scenario.name,
      run: async () => {
        const client = fakeCodex([
          { ...codexThread('older', '/workspace/repo', 'Older'), updatedAt: 1_700_000_101 },
          { ...codexThread('latest', '/workspace/repo', ''), updatedAt: 1_700_000_200, status: { type: 'active' } },
          { ...codexThread('outside', '/workspace/other', 'Other'), updatedAt: 1_700_000_300 },
        ], { projects: [
          codexProject('repo-project', 'repo', ['/workspace/repo'], 0),
          codexProject('empty-project', 'empty', ['/workspace/empty'], 1),
          codexProject('outside-project', 'other', ['/workspace/other'], 2),
        ] })
        const original = client.request.getMockImplementation()!
        client.request.mockImplementation(async (method, params) => {
          if (method === 'thread/read') throw new Error('busy')
          return original(method, params)
        })
        const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
        try {
          const workspaces = await target.workspaces()
          await target.selectWorkspace(workspaces.find(workspace => workspace.path === (scenario.empty ? '/workspace/empty' : '/workspace/repo'))!.workspaceId)
          const controller = new AbortController()
          if (scenario.aborted) controller.abort()
          if (scenario.aborted) {
            await expect(target.preferredSessionId(controller.signal, scenario.preferred)).rejects.toMatchObject({ name: 'AbortError' })
          } else {
            await expect(target.preferredSessionId(controller.signal, scenario.preferred)).resolves.toBe(scenario.expected)
          }
          expect(client.request.mock.calls.some(([method]) => method === 'thread/read' || method === 'thread/start' || method === 'thread/resume')).toBe(false)
        } finally {
          await target.close()
        }
      },
    })))
  })

  it('remembers only successful initial history or follow opens for session recovery', async () => {
    await runScenarios(['history', 'follow'].map(mode => ({
      name: mode,
      run: async () => {
        const client = fakeCodex([codexThread('older', '/workspace/repo', 'Older')])
        const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
        const controller = new AbortController()
        try {
          const workspace = (await target.workspaces())[0]!
          await target.selectWorkspace(workspace.workspaceId)
          expect(target.openedSessionId).toBeUndefined()
          if (mode === 'follow') {
            await target.open('session/follow', { args: { request: { address: { kind: 'session', sessionId: 'codex:older' } } } }, controller.signal)
          } else {
            const response = await target.dispatch('session/history', { args: { request: { sessionId: 'codex:older' as never } } }, new AbortController().signal)
            expect(response.ok).toBe(true)
          }
          expect(target.openedSessionId).toBe('codex:older')
          await expect(target.preferredSessionId()).resolves.toBe('codex:older')
          const page = await target.dispatch('session/history', { args: { request: { sessionId: 'codex:thr_1' as never, beforeSeq: 3 } } }, new AbortController().signal)
          expect(page.ok).toBe(true)
          expect(target.openedSessionId).toBe('codex:older')
          const original = client.request.getMockImplementation()!
          client.request.mockImplementation(async (method, params) => {
            if (method === 'dsh/sessionHistory') throw new Error('history temporarily unavailable')
            return original(method, params)
          })
          const failed = await target.dispatch('session/history', { args: { request: { sessionId: 'codex:thr_1' as never } } }, new AbortController().signal)
          expect(failed.ok).toBe(false)
          expect(target.openedSessionId).toBe('codex:older')
        } finally {
          controller.abort()
          await target.close()
        }
      },
    })))
  })

  it('reuses cached Codex history across project switches and falls back to cached pages on transient failures', async () => {
    const client = fakeCodex()
    const cache = new CodexSessionHistoryCache()
    const signal = new AbortController().signal
    const first = new CodexVirtualHarness(client, { deviceId: 'host_1', name: 'Workstation' }, 'v3', undefined, cache)
    try {
      await first.selectWorkspace('codex-workspace:project:repo-project')
      const [history, projections] = await Promise.all([
        first.dispatch('session/history', { args: { request: { sessionId: 'codex:thr_1' as never } } }, signal),
        first.dispatch('session/projections', { args: { request: { sessionId: 'codex:thr_1' as never } } }, signal),
      ])
      expect(history).toMatchObject({ ok: true })
      expect(projections).toMatchObject({ ok: true })
    } finally {
      await first.close()
    }
    const historyCallsAfterFirstOpen = client.request.mock.calls.filter(call => call[0] === 'dsh/sessionHistory').length
    expect(historyCallsAfterFirstOpen).toBeLessThanOrEqual(2)

    const second = new CodexVirtualHarness(client, { deviceId: 'host_1', name: 'Workstation' }, 'v3', undefined, cache)
    try {
      await second.selectWorkspace('codex-workspace:project:repo-project')
      await expect(second.dispatch('session/projections', { args: { request: { sessionId: 'codex:thr_1' as never } } }, signal)).resolves.toMatchObject({ ok: true })
      await expect(second.dispatch('session/history', { args: { request: { sessionId: 'codex:thr_1' as never } } }, signal)).resolves.toMatchObject({ ok: true })
      expect(client.request.mock.calls.filter(call => call[0] === 'dsh/sessionHistory')).toHaveLength(historyCallsAfterFirstOpen)

      await second.dispatch('session/prompt', { args: { request: { sessionId: 'codex:thr_1' as never, prompt: [{ type: 'text', text: 'next' }] } } }, signal)
      const original = client.request.getMockImplementation()!
      client.request.mockImplementation(async (method, params) => {
        if (method === 'dsh/sessionHistory') throw new Error('network timeout')
        return original(method, params)
      })
      await expect(second.dispatch('session/history', { args: { request: { sessionId: 'codex:thr_1' as never } } }, signal)).resolves.toMatchObject({ ok: true })
    } finally {
      await second.close()
    }
  })

  it('bounds CodeX history pages by message cap, turnWindow, and byte budget without gaps or loops', async () => {
    const makeLargeThread = (id: string, turnCount: number, outputBytes: number, withCommand = true) => ({
      id,
      name: `Thread ${id}`,
      cwd: '/workspace/repo',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_100,
      status: { type: 'idle' },
      turns: Array.from({ length: turnCount }, (_, idx) => {
        const turnNum = idx + 1
        return {
          id: `turn_${turnNum}`,
          status: 'completed',
          createdAt: 1_700_000_000 + turnNum,
          updatedAt: 1_700_000_010 + turnNum,
          items: [
            { id: `u_${turnNum}`, type: 'userMessage', content: [{ type: 'text', text: `Prompt ${turnNum}` }] },
            ...(withCommand ? [{
              id: `cmd_${turnNum}`,
              type: 'commandExecution',
              command: `echo ${turnNum}`,
              aggregatedOutput: `out-${turnNum}:` + 'y'.repeat(outputBytes),
              exitCode: 0,
              status: 'completed',
            }] : []),
            { id: `a_${turnNum}`, type: 'agentMessage', text: `Reply ${turnNum}:` + (withCommand ? 'ok' : 'r'.repeat(outputBytes)), status: 'completed' },
          ],
        }
      }),
    })

    await runScenarios([
      {
        name: 'clamps maxMessages=500 and enforces 256 KiB budget across follow and page with lossless cursor walk',
        run: async () => {
          const largeThread = makeLargeThread('thr_large', 60, 6 * 1024, true)
          const fullHistory = projectCodexNativeHistory(largeThread, 'codex:thr_large')
          const client = fakeCodex([largeThread])
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          const controller = new AbortController()
          let iterator: AsyncIterator<unknown> | undefined
          try {
            const followStream = await target.open(
              'session/follow',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_large' }, maxMessages: 500 } } },
              controller.signal,
            )
            iterator = followStream[Symbol.asyncIterator]()
            const snapshot = (await iterator.next()).value as {
              type: string
              hasMore: boolean
              records: Array<{ event: { seq: number } }>
            }
            expect(snapshot.type).toBe('snapshot')
            expect(snapshot.hasMore).toBe(true)
            expect(snapshot.records.length).toBeGreaterThan(0)
            expect(utf8JsonByteLength(snapshot)).toBeLessThanOrEqual(VIRTUAL_HISTORY_MAX_BYTES)
            expect(client.request).toHaveBeenCalledWith(
              'dsh/sessionHistory',
              { threadId: 'thr_large', maxMessages: VIRTUAL_HISTORY_MAX_MESSAGES },
              expect.any(AbortSignal),
            )

            const collected: number[] = []
            let beforeSeq: number | undefined
            let guard = 0
            while (guard++ < 100) {
              const page = await target.dispatch(
                'session/page',
                {
                  args: {
                    request: {
                      address: { kind: 'session', sessionId: 'codex:thr_large' },
                      maxMessages: 500,
                      ...(beforeSeq === undefined ? {} : { beforeSeq }),
                    },
                  },
                },
                controller.signal,
              )
              expect(page.ok).toBe(true)
              if (!page.ok) throw new Error('codex page failed')
              const value = page.value as { records: Array<{ event: { seq: number } }>; hasMore: boolean }
              expect(value.records.length).toBeGreaterThan(0)
              expect(utf8JsonByteLength(value)).toBeLessThanOrEqual(VIRTUAL_HISTORY_MAX_BYTES)
              collected.unshift(...value.records.map(entry => entry.event.seq))
              if (!value.hasMore) break
              beforeSeq = value.records[0]!.event.seq
            }
            expect(collected).toEqual(fullHistory.entries.map(entry => entry.event.seq))
          } finally {
            controller.abort()
            await iterator?.return?.()
            await target.close()
          }
        },
      },
      {
        name: 'aligns integer and object turnWindow to CodeX turn boundaries and falls back cleanly on older Hosts',
        run: async () => {
          const multiTurn = makeLargeThread('thr_turns', 5, 16, false)
          const fullHistory = projectCodexNativeHistory(multiTurn, 'codex:thr_turns')
          const client = fakeCodex([multiTurn])
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          const signal = new AbortController().signal
          try {
            const p1 = await target.dispatch(
              'session/page',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_turns' }, turnWindow: 2 } } },
              signal,
            )
            expect(p1.ok).toBe(true)
            if (!p1.ok) throw new Error('p1 failed')
            const v1 = p1.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(v1.records[0]!.event.type).toBe('turn/start')
            expect(v1.records.map(entry => entry.event.seq)).toEqual(fullHistory.entries.slice(18, 30).map(e => e.event.seq))
            expect(v1.hasMore).toBe(true)

            const p2 = await target.dispatch(
              'session/page',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_turns' }, beforeSeq: 18, turnWindow: 2 } } },
              signal,
            )
            expect(p2.ok).toBe(true)
            if (!p2.ok) throw new Error('p2 failed')
            const v2 = p2.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(v2.records[0]!.event.type).toBe('turn/start')
            expect(v2.records.map(entry => entry.event.seq)).toEqual(fullHistory.entries.slice(6, 18).map(e => e.event.seq))
            expect(v2.hasMore).toBe(true)

            const p3 = await target.dispatch(
              'session/page',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_turns' }, beforeSeq: 6, turnWindow: 2 } } },
              signal,
            )
            expect(p3.ok).toBe(true)
            if (!p3.ok) throw new Error('p3 failed')
            const v3 = p3.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(v3.records[0]!.event.type).toBe('turn/start')
            expect(v3.records.map(entry => entry.event.seq)).toEqual(fullHistory.entries.slice(0, 6).map(e => e.event.seq))
            expect(v3.hasMore).toBe(false)

            const objPage = await target.dispatch(
              'session/page',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_turns' }, maxMessages: 500, turnWindow: { minMessages: 5, minTurns: 2 } } } },
              signal,
            )
            expect(objPage.ok).toBe(true)
            if (!objPage.ok) throw new Error('objPage failed')
            const objVal = objPage.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(objVal.records[0]!.event.type).toBe('turn/start')
            expect(objVal.records.map(entry => entry.event.seq)).toEqual(fullHistory.entries.slice(12, 30).map(e => e.event.seq))
            expect(objVal.hasMore).toBe(true)
          } finally {
            await target.close()
          }

          const legacyClient = fakeCodex([multiTurn])
          const originalRequest = legacyClient.request.getMockImplementation()!
          legacyClient.request.mockImplementation(async (method: string, params?: Record<string, unknown>, s?: AbortSignal) => {
            if (method === 'dsh/sessionHistory' && params?.turnWindow !== undefined) {
              throw Object.assign(new Error('The CodeX call parameters are invalid.'), { code: 'INVALID_MESSAGE' })
            }
            return originalRequest(method, params, s)
          })
          const legacyTarget = new CodexVirtualHarness(legacyClient, { deviceId: 'host-1', name: 'Host' })
          try {
            const fallback = await legacyTarget.dispatch(
              'session/page',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_turns' }, turnWindow: 2 } } },
              signal,
            )
            expect(fallback.ok).toBe(true)
            if (!fallback.ok) throw new Error('fallback failed')
            const fallbackVal = fallback.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(fallbackVal.records[0]!.event.type).toBe('turn/start')
            expect(fallbackVal.records.map(entry => entry.event.seq)).toEqual(fullHistory.entries.slice(18, 30).map(e => e.event.seq))
            expect(fallbackVal.hasMore).toBe(true)
          } finally {
            await legacyTarget.close()
          }
        },
      },
      {
        name: 'returns a single oversized newest CodeX event without empty-page infinite loops',
        run: async () => {
          const oversizedThread = {
            id: 'thr_giant',
            name: 'Giant reply',
            cwd: '/workspace/repo',
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_100,
            status: { type: 'idle' },
            turns: [
              {
                id: 'turn_1',
                status: 'completed',
                createdAt: 1_700_000_001,
                items: [
                  { id: 'u_1', type: 'userMessage', content: [{ type: 'text', text: 'First prompt' }] },
                  { id: 'a_1', type: 'agentMessage', text: 'Small reply', status: 'completed' },
                ],
              },
              {
                id: 'turn_2',
                status: 'inProgress',
                createdAt: 1_700_000_002,
                items: [
                  { id: 'u_2', type: 'userMessage', content: [{ type: 'text', text: 'Big prompt' }] },
                  { id: 'a_2', type: 'agentMessage', text: 'g'.repeat(320 * 1024), status: 'inProgress' },
                ],
              },
            ],
          }
          const fullHistory = projectCodexNativeHistory(oversizedThread, 'codex:thr_giant')
          const client = fakeCodex([oversizedThread])
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          const signal = new AbortController().signal
          try {
            const collected: number[] = []
            let beforeSeq: number | undefined
            let guard = 0
            while (guard++ < 10) {
              const page = await target.dispatch(
                'session/page',
                {
                  args: {
                    request: {
                      address: { kind: 'session', sessionId: 'codex:thr_giant' },
                      maxMessages: 200,
                      ...(beforeSeq === undefined ? {} : { beforeSeq }),
                    },
                  },
                },
                signal,
              )
              expect(page.ok).toBe(true)
              if (!page.ok) throw new Error('giant page failed')
              const value = page.value as { records: Array<{ event: { seq: number } }>; hasMore: boolean }
              expect(value.records.length).toBeGreaterThan(0)
              collected.unshift(...value.records.map(entry => entry.event.seq))
              if (!value.hasMore) break
              beforeSeq = value.records[0]!.event.seq
            }
            expect(collected).toEqual(fullHistory.entries.map(entry => entry.event.seq))
            expect(guard).toBeLessThan(10)
          } finally {
            await target.close()
          }
        },
      },
      {
        name: 'handles large legacy Host turnWindow fallback without half-turn tails and requests 200 messages',
        run: async () => {
          const largeMultiTurn = {
            id: 'thr_legacy_large',
            name: 'Legacy Large Thread',
            cwd: '/workspace/repo',
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_100,
            status: { type: 'idle' },
            turns: Array.from({ length: 7 }, (_, turnIdx) => {
              const turnNum = turnIdx + 1
              return {
                id: `turn_${turnNum}`,
                status: 'completed',
                createdAt: 1_700_000_000 + turnNum,
                updatedAt: 1_700_000_010 + turnNum,
                items: [
                  { id: `u_${turnNum}`, type: 'userMessage', content: [{ type: 'text', text: `Prompt ${turnNum}` }] },
                  ...Array.from({ length: 32 }, (_, toolIdx) => ({
                    id: `cmd_${turnNum}_${toolIdx}`,
                    type: 'commandExecution',
                    command: `step ${turnNum}-${toolIdx}`,
                    aggregatedOutput: 'ok',
                    exitCode: 0,
                    status: 'completed',
                  })),
                  { id: `a_${turnNum}`, type: 'agentMessage', text: `Reply ${turnNum}`, status: 'completed' },
                ],
              }
            }),
          }
          const fullHistory = projectCodexNativeHistory(largeMultiTurn, 'codex:thr_legacy_large')
          const turnStartSeqs = fullHistory.entries
            .filter(entry => entry.event.type === 'turn/start')
            .map(entry => entry.event.seq)
          expect(turnStartSeqs).toHaveLength(7)

          const legacyClient = fakeCodex([largeMultiTurn])
          const originalRequest = legacyClient.request.getMockImplementation()!
          legacyClient.request.mockImplementation(async (method: string, params?: Record<string, unknown>, s?: AbortSignal) => {
            if (method === 'dsh/sessionHistory' && params?.turnWindow !== undefined) {
              throw Object.assign(new Error('The CodeX call parameters are invalid.'), { code: 'INVALID_MESSAGE' })
            }
            return originalRequest(method, params, s)
          })
          const legacyTarget = new CodexVirtualHarness(legacyClient, { deviceId: 'host-1', name: 'Host' })
          const signal = new AbortController().signal
          try {
            const first = await legacyTarget.dispatch(
              'session/page',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_legacy_large' }, turnWindow: 6 } } },
              signal,
            )
            expect(first.ok).toBe(true)
            if (!first.ok) throw new Error('legacy large first page failed')
            expect(legacyClient.request).toHaveBeenCalledWith(
              'dsh/sessionHistory',
              { threadId: 'thr_legacy_large', maxMessages: VIRTUAL_HISTORY_MAX_MESSAGES },
              expect.any(AbortSignal),
            )
            const firstVal = first.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            // Legacy Host returned 200 surface messages starting mid-Turn-2 (hasMore=true);
            // client must drop Turn 2's truncated tail and align cleanly to Turn 3's turn/start.
            expect(firstVal.records[0]!.event.type).toBe('turn/start')
            expect(firstVal.records[0]!.event.seq).toBe(turnStartSeqs[2])
            expect(firstVal.hasMore).toBe(true)

            const second = await legacyTarget.dispatch(
              'session/page',
              {
                args: {
                  request: {
                    address: { kind: 'session', sessionId: 'codex:thr_legacy_large' },
                    beforeSeq: firstVal.records[0]!.event.seq,
                    turnWindow: 6,
                  },
                },
              },
              signal,
            )
            expect(second.ok).toBe(true)
            if (!second.ok) throw new Error('legacy large second page failed')
            const secondVal = second.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            expect(secondVal.records[0]!.event.type).toBe('turn/start')
            expect(secondVal.records[0]!.event.seq).toBe(turnStartSeqs[0])
            expect(secondVal.hasMore).toBe(false)
            expect([
              ...secondVal.records.map(entry => entry.event.seq),
              ...firstVal.records.map(entry => entry.event.seq),
            ]).toEqual(fullHistory.entries.map(entry => entry.event.seq))

            const midTurnOnly = enforceCodexHistoryPageBudget({
              header: { version: 1, id: 'codex:thr_mid', createdAt: 1 },
              cursor: 12,
              nextTurn: 2,
              hasMore: true,
              records: [
                { type: 'event', event: { type: 'user/message', seq: 10, time: 1, data: {}, surfaceOp: 'append' } },
                { type: 'event', event: { type: 'assistant/message', seq: 11, time: 1, data: {}, surfaceOp: 'append' } },
                { type: 'event', event: { type: 'user/message', seq: 12, time: 1, data: {}, surfaceOp: 'append' } },
              ],
            }, { turnWindow: 1 })
            expect(midTurnOnly.records.map(entry => entry.event.seq)).toEqual([10, 11, 12])
          } finally {
            await legacyTarget.close()
          }
        },
      },
      {
        name: 'preserves turn boundary alignment when v3 expansion pushes a near-budget Host page over 256 KiB',
        run: async () => {
          const makeV3BoundaryThread = (msgLen: number) => ({
            id: 'thr_v3_boundary',
            name: 'V3 Boundary Thread',
            cwd: '/workspace/repo',
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_100,
            status: { type: 'idle' },
            turns: [1, 2, 3].map(turnNum => ({
              id: `turn_${turnNum}`,
              status: 'completed',
              createdAt: 1_700_000_000 + turnNum,
              updatedAt: 1_700_000_010 + turnNum,
              items: [
                { id: `u_${turnNum}`, type: 'userMessage', content: [{ type: 'text', text: `Prompt ${turnNum}` }] },
                ...(turnNum === 1
                  ? [{ id: 'a_1', type: 'agentMessage', text: 'short', status: 'completed' }]
                  : Array.from({ length: 50 }, (_, idx) => ({
                      id: `a_${turnNum}_${idx}`,
                      type: 'agentMessage',
                      text: 'm'.repeat(msgLen),
                      status: 'completed',
                    }))),
              ],
            })),
          })
          // Calibrate legacy Turn 2 + Turn 3 to fit inside the Host's 256 KiB budget
          // while v3 `stream: []` injection (+1,200 B across 100 assistant messages)
          // plus `permissionPreset` pushes the adapted page over the client budget.
          const probe = makeV3BoundaryThread(2300)
          const probeHostPage = paginateCodexNativeHistory(
            projectCodexNativeHistory(probe, 'codex:thr_v3_boundary', 'legacy'),
            { turnWindow: 2 },
          )
          const probeHostBytes = utf8JsonByteLength(probeHostPage)
          const targetSlack = VIRTUAL_HISTORY_MAX_BYTES - 2048 - 400
          const deltaPerMsg = Math.floor((targetSlack - probeHostBytes) / 100)
          const boundaryThread = makeV3BoundaryThread(2300 + deltaPerMsg)

          const legacyHistory = projectCodexNativeHistory(boundaryThread, 'codex:thr_v3_boundary', 'legacy')
          const turnStartSeqs = legacyHistory.entries
            .filter(entry => entry.event.type === 'turn/start')
            .map(entry => entry.event.seq)
          const hostPage = paginateCodexNativeHistory(legacyHistory, { turnWindow: 2 })
          // Confirm the Host itself returned both Turn 2 and Turn 3 cleanly before v3 adaptation.
          expect(hostPage.records[0]!.event.seq).toBe(turnStartSeqs[1])
          expect(hostPage.hasMore).toBe(true)

          const client = fakeCodex([boundaryThread])
          const originalRequest = client.request.getMockImplementation()!
          client.request.mockImplementation(async (method: string, params?: Record<string, unknown>, s?: AbortSignal) => {
            const response = await originalRequest(method, params, s)
            return method === 'dsh/sessionHistory'
              ? { ...(response as Record<string, unknown>), permissionPreset: 'workspace-write' }
              : response
          })
          const v3Target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'v3')
          const signal = new AbortController().signal
          try {
            const page = await v3Target.dispatch(
              'session/page',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_v3_boundary' }, turnWindow: 2 } } },
              signal,
            )
            expect(page.ok).toBe(true)
            if (!page.ok) throw new Error('v3 boundary page failed')
            const value = page.value as { records: Array<{ event: { seq: number; type: string } }>; hasMore: boolean }
            // Client secondary byte trim must snap to Turn 3's turn/start rather than splitting Turn 2.
            expect(value.records[0]!.event.type).toBe('turn/start')
            expect(value.records[0]!.event.seq).toBe(turnStartSeqs[2])
            expect(value.hasMore).toBe(true)
            expect(utf8JsonByteLength(value)).toBeLessThanOrEqual(VIRTUAL_HISTORY_MAX_BYTES)
          } finally {
            await v3Target.close()
          }
        },
      },
      {
        name: 'validates turnWindow on dsh/sessionHistory method policy',
        run: async () => {
          expect(parseCodexCall('dsh/sessionHistory', { threadId: 'thr_1', turnWindow: 2 }).params).toEqual({
            threadId: 'thr_1',
            turnWindow: 2,
          })
          expect(parseCodexCall('dsh/sessionHistory', {
            threadId: 'thr_1',
            turnWindow: { minMessages: 50, minTurns: 2 },
          }).params).toEqual({
            threadId: 'thr_1',
            turnWindow: { minMessages: 50, minTurns: 2 },
          })
          expect(() => parseCodexCall('dsh/sessionHistory', { threadId: 'thr_1', turnWindow: 0 })).toThrow()
          expect(() => parseCodexCall('dsh/sessionHistory', { threadId: 'thr_1', turnWindow: {} })).toThrow()
        },
      },
      {
        name: 'compacts a >4 MiB newest CodeX record below MAX_SECURE_MESSAGE_BYTES without mutating source and advances cursor',
        run: async () => {
          const hugeReply = 'c'.repeat(4 * 1024 * 1024 + 64 * 1024)
          const hugeThread = {
            id: 'thr_4m_record',
            name: 'Oversized 4 MiB Thread',
            cwd: '/workspace/repo',
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_100,
            status: { type: 'idle' },
            turns: [
              {
                id: 'turn_1',
                status: 'completed',
                createdAt: 1_700_000_001,
                items: [
                  { id: 'u_1', type: 'userMessage', content: [{ type: 'text', text: 'First prompt' }] },
                  { id: 'a_1', type: 'agentMessage', text: 'Small reply', status: 'completed' },
                ],
              },
              {
                id: 'turn_2',
                status: 'inProgress',
                createdAt: 1_700_000_002,
                items: [
                  { id: 'u_2', type: 'userMessage', content: [{ type: 'text', text: 'Second prompt' }] },
                  { id: 'a_2', type: 'agentMessage', text: hugeReply, status: 'inProgress' },
                ],
              },
            ],
          }
          const sourceHistory = projectCodexNativeHistory(hugeThread, 'codex:thr_4m_record')
          const newestEntry = sourceHistory.entries.at(-1)!
          expect(utf8JsonByteLength(newestEntry)).toBeGreaterThan(MAX_SECURE_MESSAGE_BYTES)

          const page1 = paginateCodexNativeHistory(sourceHistory, { maxMessages: 200 })
          expect(page1.records).toHaveLength(1)
          expect(page1.hasMore).toBe(true)
          expect(page1.records[0]!.event.seq).toBe(newestEntry.event.seq)
          expect((page1.records[0]!.event.data as Record<string, unknown>).truncated).toBe(true)
          expect(utf8JsonByteLength(page1)).toBeLessThanOrEqual(VIRTUAL_HISTORY_HARD_MAX_BYTES)
          const rpcBytes = encodeMessage(createRpcResponse('req-codex-4m', page1))
          expect(rpcBytes.byteLength).toBeLessThanOrEqual(MAX_SECURE_MESSAGE_BYTES)
          expect(() => new SecureMessageCodec().encode(rpcBytes)).not.toThrow()

          // Source history entry must stay untouched.
          const originalText = ((newestEntry.event.data as { message: { content: Array<{ text: string }> } }).message.content[0]!).text
          expect(originalText).toBe(hugeReply)
          expect((newestEntry.event.data as Record<string, unknown>).truncated).toBeUndefined()

          // Client paginates older entries cleanly via beforeSeq.
          const page2 = paginateCodexNativeHistory(sourceHistory, {
            beforeSeq: page1.records[0]!.event.seq,
            maxMessages: 200,
          })
          expect(page2.hasMore).toBe(false)
          expect(page2.records.map(entry => entry.event.seq)).toEqual(
            sourceHistory.entries.slice(0, -1).map(entry => entry.event.seq),
          )
        },
      },
      {
        name: 'surfaces explicit response-too-large / RESPONSE_TOO_LARGE on un-compactable CodeX history envelopes',
        run: async () => {
          const client = fakeCodex()
          const hostTooLargeError = Object.assign(
            new Error('Virtual history response exceeds transport limit.'),
            { code: 'RESPONSE_TOO_LARGE', details: { actualBytes: 5_000_000, maxBytes: VIRTUAL_HISTORY_HARD_MAX_BYTES } },
          )
          client.request.mockImplementation(async (method: string) => {
            if (method === 'dsh/sessionHistory') throw hostTooLargeError
            if (method === 'model/list') return { data: [], nextCursor: null }
            return {}
          })
          const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' })
          const signal = new AbortController().signal
          try {
            const hostRejected = await target.dispatch(
              'session/page',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_1' } } } },
              signal,
            )
            expect(hostRejected).toMatchObject({
              ok: false,
              error: { code: 'RESPONSE_TOO_LARGE' },
            })

            await expect(
              target.open(
                'session/follow',
                { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_1' } } } },
                signal,
              ),
            ).rejects.toMatchObject({
              isDSHRemoteError: true,
              code: 'response-too-large',
              retryable: false,
            })
          } finally {
            await target.close()
          }

          // Local VirtualHistoryResponseTooLargeError (e.g. un-compactable envelope during client budget enforcement)
          // maps cleanly to business failure('response-too-large').
          const localOversizedEnvelopeClient = fakeCodex()
          localOversizedEnvelopeClient.request.mockImplementation(async (method: string) => {
            if (method === 'dsh/sessionHistory') {
              return {
                header: {
                  version: 1,
                  id: 'codex:thr_1',
                  createdAt: 1_700_000_000,
                  cwd: '/'.repeat(MAX_SECURE_MESSAGE_BYTES),
                },
                cursor: 0,
                nextTurn: 1,
                hasMore: false,
                records: [
                  { type: 'event', event: { type: 'user/message', seq: 0, time: 1, data: { text: 'hi' }, surfaceOp: 'append' } },
                ],
              }
            }
            if (method === 'model/list') return { data: [], nextCursor: null }
            return {}
          })
          const localTarget = new CodexVirtualHarness(localOversizedEnvelopeClient, { deviceId: 'host-1', name: 'Host' })
          try {
            const localPage = await localTarget.dispatch(
              'session/page',
              { args: { request: { address: { kind: 'session', sessionId: 'codex:thr_1' } } } },
              signal,
            )
            expect(localPage).toMatchObject({
              ok: false,
              error: { code: 'response-too-large' },
            })

            const localHistory = await localTarget.dispatch(
              'session/history',
              { args: { request: { sessionId: 'codex:thr_1' } } },
              signal,
            )
            expect(localHistory).toMatchObject({
              ok: false,
              error: { code: 'response-too-large' },
            })
          } finally {
            await localTarget.close()
          }
        },
      },
    ])
  })

  it('runs recoverTerminalTurn before publishing api-session/status false when thread/status/changed becomes idle', async () => {
    await runScenarios(['completed-turn', 'failed-read-fallback'].map(mode => ({
      name: mode,
      run: async () => {
        const thread = { ...codexThread('thr_recovery', '/workspace/repo', 'Recover'), turns: [] as Record<string, unknown>[] }
        const client = fakeCodex([thread])
        const baseRequest = client.request.getMockImplementation()!
        let markReadCalled!: () => void
        const readCalled = new Promise<void>(resolve => { markReadCalled = resolve })
        let releaseRead: (() => void) | undefined
        let rejectRead: ((error: Error) => void) | undefined
        client.request.mockImplementation(async (method: string, params?: Record<string, unknown>, signal?: AbortSignal) => {
          if (method === 'thread/read' && params?.threadId === 'thr_recovery' && params?.includeTurns === true) {
            await new Promise<void>((resolve, reject) => {
              releaseRead = resolve
              rejectRead = reject
              markReadCalled()
            })
          }
          return baseRequest(method, params, signal)
        })
        const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'v3')
        const controller = new AbortController()
        const events = (await target.open('$events', { args: {} }, controller.signal))[Symbol.asyncIterator]()
        const follow = (await target.open('session/follow', {
          args: { request: { address: { kind: 'session', sessionId: 'codex:thr_recovery' } } },
        }, controller.signal))[Symbol.asyncIterator]()
        try {
          await expect(events.next()).resolves.toMatchObject({ done: false, value: { type: 'ready' } })
          await expect(follow.next()).resolves.toMatchObject({ done: false, value: { type: 'snapshot' } })

          client.emit('thr_recovery', { method: 'turn/started', params: { turn: { id: 'turn_recovery', items: [] } } })
          await expect(follow.next()).resolves.toMatchObject({ value: { event: { type: 'turn/start' } } })
          await expect(follow.next()).resolves.toMatchObject({ value: { event: { type: 'step/start' } } })
          await expect(events.next()).resolves.toEqual({
            done: false,
            value: { type: 'emit', event: 'api-session/status', args: ['codex:thr_recovery', true] },
          })

          const order: string[] = []
          const nextFollow = follow.next().then(result => {
            if (!result.done) order.push(`follow:${(result.value as { event: { type: string } }).event.type}`)
            return result
          })
          const nextStatus = events.next().then(result => {
            if (!result.done) {
              const payload = result.value as { event: string; args: unknown[] }
              order.push(`event:${payload.event}:${String(payload.args[1])}`)
            }
            return result
          })

          client.emit('thr_recovery', { method: 'thread/status/changed', params: { status: { type: 'idle' } } })
          await readCalled
          await Promise.resolve()
          await Promise.resolve()
          expect(order).toEqual([])

          if (mode === 'completed-turn') {
            thread.turns.push({ id: 'turn_recovery', status: 'completed', items: [] })
            releaseRead?.()
            await Promise.all([nextFollow, nextStatus])
            expect(order).toEqual(['follow:step/end', 'event:api-session/status:false'])
            await expect(follow.next()).resolves.toMatchObject({
              value: { event: { type: 'turn/end', data: { reason: { kind: 'completed' } } } },
            })
          } else {
            rejectRead?.(new Error('transient read error'))
            await nextStatus
            expect(order).toEqual(['event:api-session/status:false'])
          }
        } finally {
          releaseRead?.()
          controller.abort()
          await follow.return?.()
          await events.return?.()
          await target.close()
        }
      },
    })))
  })

  it('cleans up and rejects sessionFollow when the remote stream closes while subscribe is in flight', async () => {
    const client = fakeCodex()
    const streamClose = vi.fn(async () => undefined)
    let markSubscribeEntered!: () => void
    const subscribeEntered = new Promise<void>(resolve => { markSubscribeEntered = resolve })
    let resolveSubscribe!: (stream: { close: () => Promise<void> }) => void
    let capturedOnClose: ((reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected') => void) | undefined
    client.subscribe.mockImplementationOnce(async (
      _threadId: string,
      _onFrame: (frame: { method: string; params: unknown }) => void,
      _signal?: AbortSignal,
      onClose?: (reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected') => void,
    ) => {
      capturedOnClose = onClose
      markSubscribeEntered()
      return await new Promise<{ close: () => Promise<void> }>(resolve => {
        resolveSubscribe = resolve
      })
    })
    const target = new CodexVirtualHarness(client, { deviceId: 'host-1', name: 'Host' }, 'v3')
    const controller = new AbortController()
    const events = (await target.open('$events', { args: {} }, controller.signal))[Symbol.asyncIterator]()
    try {
      await expect(events.next()).resolves.toMatchObject({ done: false, value: { type: 'ready' } })
      const followOpen = target.open('session/follow', {
        args: { request: { address: { kind: 'session', sessionId: 'codex:thr_1' } } },
      }, controller.signal)
      await subscribeEntered

      capturedOnClose?.('failed')
      await expect(events.next()).resolves.toEqual({
        done: false,
        value: { type: 'emit', event: 'api-session/status', args: ['codex:thr_1', false] },
      })

      resolveSubscribe({ close: streamClose })
      await expect(followOpen).rejects.toThrow('The CodeX remote stream closed before ready.')
      expect(streamClose).toHaveBeenCalledOnce()
      expect((target as unknown as { follows: Set<unknown> }).follows.size).toBe(0)

      // Subsequent follow opens and streams normally without interference from the failed open.
      const reopened = (await target.open('session/follow', {
        args: { request: { address: { kind: 'session', sessionId: 'codex:thr_1' } } },
      }, controller.signal))[Symbol.asyncIterator]()
      await expect(reopened.next()).resolves.toMatchObject({ done: false, value: { type: 'snapshot' } })
      await reopened.return?.()
    } finally {
      resolveSubscribe?.({ close: streamClose })
      controller.abort()
      await events.return?.()
      await target.close()
    }
  })
})

interface FakeCodexOptions {
  projects?: Array<Record<string, unknown>>
  projectListError?: Error
}

function fakeCodex(extraThreads: Array<Record<string, unknown>> = [], options: FakeCodexOptions = {}): {
  request: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  respond: ReturnType<typeof vi.fn>
  emit(threadId: string, frame: { method: string; params: unknown }): void
  closeStream(threadId: string, reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected'): void
} {
  const subscribers = new Map<string, Set<{
    onFrame: (frame: { method: string; params: unknown }) => void
    onClose?: (reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected') => void
  }>>()
  const thread = {
    id: 'thr_1',
    name: 'Native renderer',
    cwd: '/workspace/repo',
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_100,
    status: { type: 'idle' },
    turns: [{
      id: 'turn_1',
      status: 'completed',
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_100,
      items: [
        { id: 'user_1', type: 'userMessage', content: [{ type: 'text', text: 'Use native UI' }] },
        { id: 'assistant_1', type: 'agentMessage', text: 'Done.', status: 'completed' },
        {
          id: 'command_1',
          type: 'commandExecution',
          command: 'pnpm test',
          aggregatedOutput: '3 passed',
          exitCode: 0,
          status: 'completed',
        },
        {
          id: 'files_1',
          type: 'fileChange',
          status: 'completed',
          changes: [{ path: 'src/native.ts', kind: { type: 'update' }, diff: 'private diff body' }],
        },
      ],
    }],
  }
  const threads = [thread, ...extraThreads]
  const projects = options.projects ?? [codexProject('repo-project', 'repo', ['/workspace/repo'], 0)]
  let nextThread = 1
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === 'model/list') return { data: [
      {
        id: 'gpt-5.6-sol',
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6-Sol',
        description: 'Latest frontier agentic coding model.',
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast responses with lighter reasoning' },
          { reasoningEffort: 'high', description: 'Greater reasoning depth for complex problems' },
        ],
        defaultReasoningEffort: 'low',
        isDefault: true,
      },
      {
        id: 'gpt-5.6-terra',
        model: 'gpt-5.6-terra',
        displayName: 'GPT-5.6-Terra',
        supportedReasoningEfforts: [
          { reasoningEffort: 'medium' },
          { reasoningEffort: 'high' },
        ],
        defaultReasoningEffort: 'medium',
        isDefault: false,
      },
    ], nextCursor: null }
    if (method === 'project/list') {
      if (options.projectListError !== undefined) throw options.projectListError
      return { data: projects, nextCursor: null }
    }
    if (method === 'thread/list') return { data: threads }
    if (method === 'thread/read') {
      return { thread: threads.find(item => item.id === params?.threadId) ?? thread }
    }
    if (method === 'dsh/sessionHistory') {
      const source = threads.find(item => item.id === params?.threadId) ?? thread
      return paginateCodexNativeHistory(
        projectCodexNativeHistory(source, `codex:${String(source.id)}`),
        {
          beforeSeq: typeof params?.beforeSeq === 'number' ? params.beforeSeq : undefined,
          throughSeq: typeof params?.throughSeq === 'number' ? params.throughSeq : undefined,
          maxMessages: typeof params?.maxMessages === 'number' ? params.maxMessages : undefined,
          turnWindow: params?.turnWindow as never,
        },
      )
    }
    if (method === 'dsh/directoryList') {
      const path = String(params?.path ?? '/workspace/repo')
      return {
        path,
        home: '/workspace/repo',
        crumbs: path === '/workspace/repo'
          ? [{ name: 'repo', path: '/workspace/repo', hidden: false }]
          : [
              { name: 'repo', path: '/workspace/repo', hidden: false },
              { name: 'src', path: '/workspace/repo/src', hidden: false },
            ],
        entries: path === '/workspace/repo'
          ? [{ name: 'src', path: '/workspace/repo/src', hidden: false }]
          : [],
        truncated: false,
      }
    }
    if (method === 'thread/start') {
      const created = codexThread(`new_${nextThread++}`, String(params?.cwd), '')
      threads.push(created)
      return { thread: created }
    }
    if (method === 'thread/resume') {
      const resumed = threads.find(item => item.id === params?.threadId) ?? thread
      return params?.threadId === 'thr_full' || params?.permissionPreset === 'danger-full-access'
        ? { thread: resumed, approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } }
        : { thread: resumed }
    }
    if (method === 'turn/start') return { turn: { id: 'turn_2', status: 'inProgress', items: [] } }
    return {}
  })
  const subscribe = vi.fn(async (
    threadId: string,
    onFrame: (frame: { method: string; params: unknown }) => void,
    _signal?: AbortSignal,
    onClose?: (reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected') => void,
  ) => {
    const listeners = subscribers.get(threadId) ?? new Set()
    const listener = { onFrame, onClose }
    listeners.add(listener)
    subscribers.set(threadId, listeners)
    return { close: vi.fn(async () => { listeners.delete(listener) }) }
  })
  return {
    request,
    subscribe,
    respond: vi.fn(async () => undefined),
    emit(threadId, frame) {
      for (const listener of subscribers.get(threadId) ?? []) listener.onFrame(frame)
    },
    closeStream(threadId, reason) {
      const listeners = subscribers.get(threadId)
      for (const listener of [...(listeners ?? [])]) {
        listeners?.delete(listener)
        listener.onClose?.(reason)
      }
    },
  }
}

function codexThread(id: string, cwd: string | undefined, name: string, projectId?: string): Record<string, unknown> {
  return {
    id,
    name,
    ...(projectId === undefined ? {} : { projectId }),
    ...(cwd === undefined ? {} : { cwd }),
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_100,
    status: { type: 'idle' },
    turns: [],
  }
}

function codexProject(id: string, name: string, roots: string[], position: number): Record<string, unknown> {
  return {
    id,
    name,
    roots: roots.map(path => ({ path })),
    metadata: {},
    position,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_100,
  }
}
