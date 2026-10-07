import { describe, expect, it, vi } from 'vitest'
import { AgentAcpClient } from '../src/acp-client.js'

describe('ACP image transfer', () => {
  it('transfers image prompts in ordered chunks and closes inline transfers', async () => {
    const rpc = vi.fn(async (method: string) => method === 'agent.acp.transfer.commit' ? { kind: 'inline', response: { accepted: true } } : {})
    const client = new AgentAcpClient({ rpc } as never)
    await client.prompt('agy-session', 'Inspect', undefined, [{ type: 'image', mimeType: 'image/png', data: 'A'.repeat(800_000) }], 'antigravity')
    const chunks = rpc.mock.calls.filter(([method]) => method === 'agent.acp.transfer.chunk') as unknown as Array<[string, { index: number; data: string }]>
    expect(chunks.map(([, chunk]) => chunk.index)).toEqual([0, 1])
    const envelope = JSON.parse(chunks.map(([, chunk]) => Buffer.from(chunk.data, 'base64').toString()).join(''))
    expect(envelope).toMatchObject({ method: 'session/prompt', params: { sessionId: 'agy-session', backend: 'antigravity', prompt: [{ type: 'text', text: 'Inspect' }, { type: 'image', mimeType: 'image/png' }] } })
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
  })

  it('fails closed on a mismatched response chunk and releases the transfer', async () => {
    let transferId = ''
    const rpc = vi.fn(async (method: string, params: any) => {
      if (method === 'agent.acp.transfer.open') transferId = params.transferId
      if (method === 'agent.acp.transfer.commit') return { kind: 'chunked', transferId, totalBytes: 2, totalChunks: 1 }
      if (method === 'agent.acp.transfer.read') return { transferId: 'another-transfer', index: 0, data: 'e30=' }
      return {}
    })
    const client = new AgentAcpClient({ rpc } as never)
    await expect(client.transferCall('dsh/sessionHistory', { sessionId: 'agy-session' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
  })

  it('closes an unfinished transfer when a chunk fails', async () => {
    const rpc = vi.fn(async (method: string) => { if (method === 'agent.acp.transfer.chunk') throw new Error('disconnected'); return {} })
    const client = new AgentAcpClient({ rpc } as never)
    await expect(client.prompt('agy-session', '', undefined, [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }], 'antigravity')).rejects.toThrow('disconnected')
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
  })
})
