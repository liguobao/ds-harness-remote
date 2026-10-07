import { describe, expect, it, vi } from 'vitest'
import { HarnessAlphaClient, RemoteTypertGateway, type RemoteClientCore } from '@dsh-remote/client-core'
import { RemoteApiProxy } from '../src/services/api-proxy'
import { forkMessage } from '../src/services/message-actions'

describe('official message action contracts', () => {
  it('executes native slash commands on both carriers with their actual attachment fields', async () => {
    const call = vi.spyOn(RemoteTypertGateway.prototype, 'call').mockResolvedValue({ ok: true, value: { result: { kind: 'success', text: 'done' } } })
    await expect(new HarnessAlphaClient({} as RemoteClientCore, { sessionFormat: 3 }).sessionExecuteCommand('s1', '/compact')).resolves.toMatchObject({ kind: 'success' })
    expect(call).toHaveBeenCalledWith('commands/execute', { args: { agentId: 's1', line: '/compact', submittedAttachments: [] } }, undefined)
    call.mockRestore()
    const rpc = vi.fn(async (_method, params) => ({ rpcId: params.rpcId, result: { ok: true, value: { result: { kind: 'success' } } } }))
    await new RemoteApiProxy({ rpc } as unknown as RemoteClientCore).sessionExecuteCommand('s1', '/compact')
    expect(rpc).toHaveBeenCalledWith('harness.api.call', expect.objectContaining({ method: 'commands.execute', payload: { agentId: 's1', line: '/compact', images: [] } }), undefined)
  })
  it('only publishes a branch confirmed in the authoritative session list and workspace list', async () => {
    const proxy = { sessionFork: vi.fn(async () => ({ sessionId: 'child' })), sessionList: vi.fn(async () => [{ sessionId: 'child', parentSessionId: 'source' }]), workspaceList: vi.fn(async () => ({ items: [], archivedSessionIds: [] })) }
    const message = { kind: 'message' as const, role: 'assistant' as const, sessionId: 'source', id: 'm1', text: 'answer', nativeSeq: 42, createdAt: 1 }
    expect(await forkMessage(message, proxy as unknown as RemoteApiProxy)).toMatchObject({ session: { sessionId: 'child' }, workspaces: [] })
    proxy.sessionList.mockResolvedValueOnce([])
    await expect(forkMessage(message, proxy as unknown as RemoteApiProxy)).rejects.toThrow()
    await expect(forkMessage({ ...message, nativeSeq: undefined }, proxy as unknown as RemoteApiProxy)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(proxy.sessionFork).toHaveBeenCalledTimes(2)
  })
  it('forks an exact inclusive event prefix on both carriers', async () => {
    const call = vi.spyOn(RemoteTypertGateway.prototype, 'call').mockResolvedValue({ ok: true, value: { sessionId: 'child' } })
    const alpha = new HarnessAlphaClient({} as RemoteClientCore)
    await expect(alpha.sessionFork('source', 42)).resolves.toEqual({ sessionId: 'child' })
    expect(call).toHaveBeenCalledWith('session/fork', { args: { request: { sessionId: 'source', atSeq: 42 } } }, undefined)
    call.mockRestore()
    const rpc = vi.fn(async (_method, params) => ({ rpcId: params.rpcId, result: { ok: true, value: { sessionId: 'child' } } }))
    await expect(new RemoteApiProxy({ rpc } as unknown as RemoteClientCore).sessionFork('source', 42)).resolves.toEqual({ sessionId: 'child' })
    expect(rpc).toHaveBeenCalledWith('harness.api.call', expect.objectContaining({ method: 'session.fork', payload: { sessionId: 'source', atSeq: 42 } }), undefined)
  })
})
