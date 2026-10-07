import { describe, expect, it, vi } from 'vitest'
import type { AgentAcpClient } from '@dsh-remote/client-core'
import { loadAntigravityCatalog, mergeAntigravityCatalog, readAntigravityHistory } from '../src/services/antigravity'
import { applyCursorFrame, createAntigravitySession, createAntigravityWorkspace, foldAcpHistory } from '../src/services/cursor'

describe('AGY catalog and recovery', () => {
  it('rediscovers Host sessions and preserves an empty local session and running state during reconnect', async () => {
    const call = vi.fn(async (method: string, params: any) => method === 'dsh/workspaceList'
      ? [{ path: '/host/project', title: 'Project' }]
      : { items: [{ conversationId: 'durable', title: 'Saved title', updatedAt: 123 }] })
    const client = { call } as unknown as AgentAcpClient
    const catalog = await loadAntigravityCatalog(client)
    expect(call).toHaveBeenCalledWith('dsh/sessionList', { backend: 'antigravity', path: '/host/project', limit: 100, prewarm: false })
    const blank = createAntigravitySession({ acpSessionId: 'new', cwd: '/host/project' })
    const running = { ...catalog.sessions[0]!, title: 'Old title', running: true }
    const workspace = { ...createAntigravityWorkspace('/host/project'), sessionIds: [blank.sessionId, running.sessionId] }
    const merged = mergeAntigravityCatalog(catalog, [workspace], [blank, running])
    expect(merged.workspaces[0]?.sessionIds).toEqual(['antigravity:durable', 'antigravity:new'])
    expect(merged.sessions.find(item => item.nativeId === 'durable')).toMatchObject({ title: 'Saved title', running: true, updatedAt: 123 })
    expect(merged.sessions.find(item => item.nativeId === 'new')).toMatchObject({ blank: true })
  })

  it('loads history through bounded transfer and restores image bytes without exposing cache markers', async () => {
    const transferCall = vi.fn(async () => ({ events: [{ event: { type: 'user/message', time: 100, seq: 0, data: {
      id: 'image-user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Read this' },
        { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' }],
    } } }] }))
    const events = await readAntigravityHistory({ transferCall } as unknown as AgentAcpClient, 'durable')
    expect(transferCall).toHaveBeenCalledWith('dsh/sessionHistory', { backend: 'antigravity', sessionId: 'durable' })
    const user = foldAcpHistory(events, 'antigravity:durable')[0]
    expect(user).toMatchObject({ role: 'user', images: [{ uri: 'data:image/png;base64,aGVsbG8=' }] })
  })

  it('propagates failed history reads instead of reporting an empty conversation', async () => {
    await expect(readAntigravityHistory({ transferCall: vi.fn(async () => { throw new Error('offline') }) } as unknown as AgentAcpClient, 'durable')).rejects.toThrow('offline')
  })

  it('matches AGY tool start and completion by callId and preserves its input', () => {
    const frame = (update: Record<string, unknown>) => ({ streamId: 's', frame: { method: 'session/update', params: { sessionId: 'agy', update } } })
    let items = applyCursorFrame([], 'antigravity:agy', frame({ sessionUpdate: 'tool_call', callId: '3', name: 'view_file', parameters: { path: '/host/file' } }))
    items = applyCursorFrame(items, 'antigravity:agy', frame({ sessionUpdate: 'tool_call_update', callId: '3', output: 'file content' }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ toolName: 'view_file', state: 'finished', arguments: '{\n  "path": "/host/file"\n}', resultDetail: { text: 'file content' } })
  })
})
