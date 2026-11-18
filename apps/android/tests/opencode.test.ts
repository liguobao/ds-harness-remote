import { describe, expect, it, vi } from 'vitest'
import type { AgentAcpClient } from '@dsh-remote/client-core'
import { loadOpencodeCatalog, mergeOpencodeCatalog, readOpencodeHistory } from '../src/services/opencode'
import { applyCursorFrame, createOpencodeSession, createOpencodeWorkspace, foldAcpHistory } from '../src/services/cursor'

describe('OpenCode catalog and recovery', () => {
  it('rediscovers Host sessions and preserves an empty local session and running state during reconnect', async () => {
    const call = vi.fn(async (method: string, params: any) => method === 'dsh/workspaceList'
      ? [{ path: '/host/project', title: 'OpenCode Project' }]
      : { items: [{ conversationId: 'opc-conv-1', title: 'Saved opencode conversation', updatedAt: 456 }] })
    const client = { call } as unknown as AgentAcpClient
    const catalog = await loadOpencodeCatalog(client)
    expect(call).toHaveBeenCalledWith('dsh/sessionList', { backend: 'opencode', path: '/host/project', limit: 100, prewarm: false })
    const blank = createOpencodeSession({ acpSessionId: 'new-blank', cwd: '/host/project' })
    const running = { ...catalog.sessions[0]!, title: 'Old title', running: true }
    const workspace = { ...createOpencodeWorkspace('/host/project'), sessionIds: [blank.sessionId, running.sessionId] }
    const stale = { ...createOpencodeSession({ acpSessionId: 'archived', cwd: '/host/project' }), blank: false }
    workspace.sessionIds.push(stale.sessionId)
    const merged = mergeOpencodeCatalog(catalog, [workspace], [blank, running, stale])
    expect(merged.sessions.some(item => item.sessionId === stale.sessionId)).toBe(false)
    expect(merged.workspaces[0]?.sessionIds).toEqual(['opencode:opc-conv-1', 'opencode:new-blank'])
    expect(merged.sessions.find(item => item.nativeId === 'opc-conv-1')).toMatchObject({ title: 'Saved opencode conversation', running: true, updatedAt: 456, backend: 'opencode' })
    expect(merged.sessions.find(item => item.nativeId === 'new-blank')).toMatchObject({ blank: true, backend: 'opencode' })
  })

  it('loads history through bounded transfer and restores messages', async () => {
    const transferCall = vi.fn(async () => ({ events: [{ event: { type: 'user/message', time: 100, seq: 0, data: {
      id: 'opc-msg-1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Hello OpenCode' }],
    } } }] }))
    const events = await readOpencodeHistory({ transferCall } as unknown as AgentAcpClient, 'opc-conv-1')
    expect(transferCall).toHaveBeenCalledWith('dsh/sessionHistory', { backend: 'opencode', sessionId: 'opc-conv-1' })
    const user = foldAcpHistory(events, 'opencode:opc-conv-1')[0]
    expect(user).toMatchObject({ role: 'user', text: 'Hello OpenCode' })
  })

  it('propagates failed history reads instead of reporting an empty conversation', async () => {
    await expect(readOpencodeHistory({ transferCall: vi.fn(async () => { throw new Error('opencode offline') }) } as unknown as AgentAcpClient, 'opc-conv-1')).rejects.toThrow('opencode offline')
  })

  it('matches OpenCode tool start and completion by callId and preserves its input', () => {
    const frame = (update: Record<string, unknown>) => ({ streamId: 's', frame: { method: 'session/update', params: { sessionId: 'opc', update } } })
    let items = applyCursorFrame([], 'opencode:opc', frame({ sessionUpdate: 'tool_call', callId: '10', name: 'bash', parameters: { command: 'ls -la' } }))
    items = applyCursorFrame(items, 'opencode:opc', frame({ sessionUpdate: 'tool_call_update', callId: '10', output: 'total 0' }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ toolName: 'bash', state: 'finished', arguments: '{\n  "command": "ls -la"\n}', resultDetail: { text: 'total 0' } })
  })
})
