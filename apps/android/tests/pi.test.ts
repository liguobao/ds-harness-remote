import { describe, expect, it, vi } from 'vitest'
import type { AgentAcpClient } from '@dsh-remote/client-core'
import { loadPiCatalog, mergePiCatalog, readPiHistory, selectPiModel } from '../src/services/pi'
import { AcpSessionTools } from '../src/services/session-tools'
import { applyCursorFrame, foldAcpHistory, createPiSession, createPiWorkspace, createAntigravitySession, createAntigravityWorkspace } from '../src/services/cursor'
import type { ChatItem } from '../src/types'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

describe('PI ACP client isolation and recovery', () => {
  it('uses independent PI catalog authority and keeps only PI memory across rediscovery', async () => {
    const call = vi.fn(async (method: string) => method === 'dsh/workspaceList'
      ? [{ path: '/host/project', title: 'Project' }, { path: 'relative/unsafe' }]
      : { items: [{ conversationId: 'durable', title: 'Saved title', updatedAt: 123 }] })
    const catalog = await loadPiCatalog({ call } as unknown as AgentAcpClient, [createAntigravityWorkspace('/other/backend')])
    expect(call).toHaveBeenCalledWith('dsh/workspaceList', { backend: 'pi' })
    expect(call).toHaveBeenCalledWith('dsh/sessionList', { backend: 'pi', path: '/host/project', limit: 100, prewarm: false })
    expect(call).toHaveBeenCalledTimes(2)
    expect(catalog.workspaces[0]?.workspaceId).toBe('pi:cwd:%2Fhost%2Fproject')
    const blank = createPiSession({ acpSessionId: 'new', cwd: '/host/project' })
    const running = { ...catalog.sessions[0]!, title: 'Old title', running: true }
    const workspace = { ...createPiWorkspace('/host/project'), sessionIds: [blank.sessionId, running.sessionId] }
    const merged = mergePiCatalog(catalog, [workspace, createAntigravityWorkspace('/other/backend')], [blank, running, createAntigravitySession({ acpSessionId: 'durable' })])
    expect(merged.workspaces).toHaveLength(1)
    expect(merged.workspaces[0]?.sessionIds).toEqual(['pi:durable', 'pi:new'])
    expect(merged.sessions).toHaveLength(2)
    expect(merged.sessions.find(item => item.nativeId === 'durable')).toMatchObject({ backend: 'pi', title: 'Saved title', running: true, updatedAt: 123 })
    expect(merged.sessions.find(item => item.nativeId === 'new')).toMatchObject({ blank: true })
  })

  it('loads bounded PI history and propagates transport failure rather than inventing empty recovery', async () => {
    const transferCall = vi.fn().mockResolvedValueOnce({ events: [{ event: { type: 'user/message' } }] }).mockRejectedValueOnce(new Error('offline'))
    const client = { transferCall } as unknown as AgentAcpClient
    expect(await readPiHistory(client, 'durable')).toHaveLength(1)
    expect(transferCall).toHaveBeenCalledWith('dsh/sessionHistory', { backend: 'pi', sessionId: 'durable' })
    await expect(readPiHistory(client, 'durable')).rejects.toThrow('offline')
  })

  it('restores Host native tool results through PI history without duplicate activity or lost failures', async () => {
    await runScenarios([false, true].map(isError => ({
      name: isError ? 'failed tool recovery' : 'successful tool recovery',
      run: async () => {
        const events = [
          { event: { type: 'tool/call', seq: 0, time: 0, data: { callId: 'bash-1', name: 'bash', arguments: '{}' } } },
          { event: { type: 'tool/result', seq: 1, time: 0, data: { message: {
            role: 'user', source: { kind: 'tool', callId: 'bash-1' }, content: [
              { type: 'tool-result', toolCallId: 'bash-1', content: [{ type: 'text', text: 'terminal output' }], ...(isError ? { isError: true } : {}) },
            ],
          } } } },
        ]
        const client = { transferCall: vi.fn(async () => ({ events })) } as unknown as AgentAcpClient
        const restored = foldAcpHistory(await readPiHistory(client, 'durable'), 'pi:durable')
        expect(restored).toHaveLength(1)
        expect(restored[0]).toMatchObject({ kind: 'tool', id: 'bash-1', sessionId: 'pi:durable', toolName: 'bash',
          state: isError ? 'failed' : 'finished', resultDetail: { text: 'terminal output' } })
        const refolded = foldAcpHistory(await readPiHistory(client, 'durable'), 'pi:durable')
        // Upstream has no timestamps; Android may assign a fresh display time.
        expect(refolded.map(({ createdAt, ...item }) => item)).toEqual(restored.map(({ createdAt, ...item }) => item))
      },
    })))
  })

  it('keeps PI permission handles and bounded terminal deltas across tool updates without changing other backends', async () => {
    await runScenarios(['pi', 'cursor', 'antigravity'].flatMap(backend => [0, 2].map(exitCode => ({ name: `${backend}: exit ${exitCode}`, run: () => {
      const sessionId = `${backend}:native`
      const frame = (update: Record<string, unknown>) => ({ streamId: 's', frame: { method: 'session/update', params: { update } } })
      let messages: ChatItem[] = applyCursorFrame([], sessionId, { streamId: 's', frame: {
        method: 'session/request_permission', params: { requestHandle: 'opaque', toolCall: {
          title: 'Execute command', rawInput: { method: 'confirm', message: 'Run bash in /host/project?' },
        }, options: [{ optionId: 'once', kind: 'allow_once' }] },
      } })
      expect(messages[0]).toMatchObject({ kind: 'approval', approvalId: 'opaque', toolName: 'Execute command', reason: 'Run bash in /host/project?' })
      messages = applyCursorFrame(messages, sessionId, frame({ sessionUpdate: 'tool_call', toolCallId: 'bash', title: 'bash' }))
      for (const data of ['a'.repeat(16_001), 'tail']) {
        messages = applyCursorFrame(messages, sessionId, frame({ sessionUpdate: 'tool_call_update', toolCallId: 'bash', _meta: { terminal_output: { data } } }))
      }
      const tool = messages[1]
      expect(tool?.kind).toBe('tool')
      if (tool?.kind !== 'tool') throw new Error('Missing tool')
      expect(tool.state).toBe('running')
      expect(tool.resultDetail?.text).toBe(backend === 'pi' ? `${'a'.repeat(15_996)}tail` : undefined)
      messages = applyCursorFrame(messages, sessionId, frame({ sessionUpdate: 'tool_call_update', toolCallId: 'bash', _meta: { terminal_exit: { exit_code: exitCode } } }))
      expect(messages[1]).toMatchObject({ state: backend === 'pi' ? exitCode === 0 ? 'finished' : 'failed' : 'running' })
      if (backend === 'pi') {
        messages = applyCursorFrame(messages, sessionId, frame({ sessionUpdate: 'tool_call_update', toolCallId: 'bash', status: 'completed' }))
        // A later generic completion must not erase terminal failure or output.
        expect(messages[1]).toMatchObject({ state: exitCode === 0 ? 'finished' : 'failed', resultDetail: { text: tool.resultDetail?.text } })
      }
    } }))))
  })

  it('uses PI-only file and terminal scope instead of Harness or another ACP backend', async () => {
    const workspaceToolCall = vi.fn(async () => ({}))
    const openStream = vi.fn(async () => ({ streamId: 'tools', close: async () => undefined }))
    const tools = new AcpSessionTools({ workspaceToolCall, openStream } as unknown as AgentAcpClient, 'pi')
    await tools.listFiles('pi:native', '.', undefined)
    expect(workspaceToolCall).toHaveBeenCalledWith('native', 'pi', 'workspaceFiles/list', { workspaceFileScopeId: 'pi:native', path: '.' }, undefined)
    await tools.createTerminal('pi:native', 'terminal', 80, 24)
    expect(workspaceToolCall).toHaveBeenCalledWith('native', 'pi', 'terminal/create', { agentId: 'pi:native', request: { id: 'terminal', cols: 80, rows: 24 } }, undefined)
    const signal = new AbortController().signal
    const stream = await tools.followTerminal('pi:native', 'terminal', 'attachment', signal)
    expect(openStream).toHaveBeenCalledWith('native', expect.any(Function), expect.any(Function), signal,
      { backend: 'pi', endpoint: 'terminal/follow', args: { sessionId: 'pi:native', id: 'terminal', attachmentId: 'attachment' } })
    await stream.close()
  })

  it('scopes model and thinking changes to PI and reads the authoritative selection after commit', async () => {
    const models = { current: { provider: 'pi', model: 'provider/model', reasoningEffort: 'high' }, routable: true,
      groups: [{ id: 'pi', name: 'PI', models: [{ id: 'provider/model', name: 'Model', reasoning: { defaultEffort: 'high', efforts: [{ id: 'high', name: 'High' }] } }] }] }
    const sessionModels = vi.fn(async () => models)
    const selectModel = vi.fn(async () => models.current)
    const client = { sessionModels, selectModel } as unknown as AgentAcpClient
    const result = await selectPiModel(client, 'durable', { provider: 'pi', model: 'provider/model', reasoningEffort: 'high' })
    expect(selectModel).toHaveBeenCalledWith('durable', 'pi', { provider: 'pi', model: 'provider/model', reasoningEffort: 'high' })
    expect(sessionModels).toHaveBeenCalledWith('durable', 'pi')
    expect(selectModel.mock.invocationCallOrder[0]).toBeLessThan(sessionModels.mock.invocationCallOrder[0]!)
    expect(result.current).toEqual(models.current)
    expect(result.groups[0]?.models[0]?.reasoning).toEqual(models.groups[0]!.models[0]!.reasoning)
    selectModel.mockClear()
    sessionModels.mockClear()
    await expect(selectPiModel(client, 'durable', { provider: 'codex', model: 'other' })).rejects.toThrow('Invalid ACP model provider')
    expect(selectModel).not.toHaveBeenCalled()
    selectModel.mockRejectedValueOnce(new Error('denied'))
    await expect(selectPiModel(client, 'durable', { provider: 'pi', model: 'provider/model' })).rejects.toThrow('denied')
    expect(selectModel).toHaveBeenCalledTimes(1)
    expect(sessionModels).not.toHaveBeenCalled()
  })
})
