import { describe, expect, it, vi } from 'vitest'
import { HarnessAlphaClient, RemoteTypertGateway, type RemoteClientCore } from '@dsh-remote/client-core'
import { forkMessage } from '../src/services/message-actions'

describe('official message action contracts', () => {
  it('executes native slash commands through Typert with their actual attachment fields', async () => {
    const call = vi.spyOn(RemoteTypertGateway.prototype, 'call').mockResolvedValue({ ok: true, value: { result: { kind: 'success', text: 'done' } } })
    await expect(new HarnessAlphaClient({} as RemoteClientCore, { sessionFormat: 3 }).sessionExecuteCommand('s1', '/compact')).resolves.toMatchObject({ kind: 'success' })
    expect(call).toHaveBeenCalledWith('commands/execute', { args: { agentId: 's1', line: '/compact', submittedAttachments: [] } }, undefined)
    call.mockRestore()
  })
  it('only publishes a branch confirmed in the authoritative session list and workspace list', async () => {
    const proxy = { sessionFork: vi.fn(async () => ({ sessionId: 'child' })), sessionList: vi.fn(async () => [{ sessionId: 'child', parentSessionId: 'source' }]), workspaceList: vi.fn(async () => ({ items: [], archivedSessionIds: [] })) }
    const message = { kind: 'message' as const, role: 'assistant' as const, sessionId: 'source', id: 'm1', text: 'answer', nativeSeq: 42, createdAt: 1 }
    expect(await forkMessage(message, proxy as unknown as HarnessAlphaClient)).toMatchObject({ session: { sessionId: 'child' }, workspaces: [] })
    proxy.sessionList.mockResolvedValueOnce([])
    await expect(forkMessage(message, proxy as unknown as HarnessAlphaClient)).rejects.toThrow()
    await expect(forkMessage({ ...message, nativeSeq: undefined }, proxy as unknown as HarnessAlphaClient)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(proxy.sessionFork).toHaveBeenCalledTimes(2)
  })
  it('forks an exact inclusive event prefix through Typert', async () => {
    const call = vi.spyOn(RemoteTypertGateway.prototype, 'call').mockResolvedValue({ ok: true, value: { sessionId: 'child' } })
    const alpha = new HarnessAlphaClient({} as RemoteClientCore)
    await expect(alpha.sessionFork('source', 42)).resolves.toEqual({ sessionId: 'child' })
    expect(call).toHaveBeenCalledWith('session/fork', { args: { request: { sessionId: 'source', atSeq: 42 } } }, undefined)
    call.mockRestore()
  })
})
