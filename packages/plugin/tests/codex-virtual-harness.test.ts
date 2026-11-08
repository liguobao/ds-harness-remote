import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import {
  CodexVirtualHarness,
  discoverCodexVirtualWorkspaces,
  paginateCodexNativeHistory,
  projectCodexNativeHistory,
} from '../src/codex/virtual-harness.js'

describe('CodexVirtualHarness', () => {
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
    expect(client.request.mock.calls.find(([method]) => method === 'turn/start')?.[1]).not.toHaveProperty('permissionPreset')
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
    await target.close()
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
    expect(client.request.mock.calls.find(([method]) => method === 'turn/start')?.[1]).not.toHaveProperty('permissionPreset')
    expect(await target.dispatch('session/list', { args: {} }, new AbortController().signal))
      .toMatchObject({ value: { items: expect.arrayContaining([expect.objectContaining({
        sessionId: 'codex:thr_full', projections: { kind: 'sequenced', asOfSeq: 0, values: expect.objectContaining({ permissions: expect.objectContaining({ currentValue: 'danger-full-access' }) }) },
      })]) } })
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
