import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import { ACP_PROMPT_RPC_TIMEOUT_MS, AgentAcpClient } from '../src/acp-client.js'

describe('ACP image transfer', () => {
  it('loads bounded chunked history through the independent ACP domain', async () => {
    let transferId = ''
    const response = JSON.stringify({ events: [{ type: 'image', data: 'A'.repeat(800_000) }] })
    const bytes = Buffer.from(response)
    const chunkBytes = 512 * 1024
    const rpc = vi.fn(async (method: string, params: any) => {
      if (method === 'agent.acp.transfer.open') transferId = params.transferId
      if (method === 'agent.acp.transfer.commit') return { kind: 'chunked', transferId, totalBytes: bytes.length, totalChunks: 2 }
      if (method === 'agent.acp.transfer.read') return { transferId, index: params.index, data: bytes.subarray(params.index * chunkBytes, (params.index + 1) * chunkBytes).toString('base64') }
      return {}
    })
    const client = new AgentAcpClient({ rpc } as never)
    expect(await client.loadSessionHistory('acp:remote', 'antigravity')).toEqual(JSON.parse(response).events)
    expect(rpc.mock.calls.every(([method]) => method.startsWith('agent.acp.'))).toBe(true)
    const request = rpc.mock.calls.find(([method]) => method === 'agent.acp.transfer.chunk')![1]
    expect(JSON.parse(Buffer.from(request.data, 'base64').toString())).toEqual({ method: 'dsh/sessionHistory', params: { sessionId: 'acp:remote', backend: 'antigravity' } })
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
  })

  it('transfers image prompts in ordered chunks and closes inline transfers', async () => {
    const rpc = vi.fn(async (method: string) => method === 'agent.acp.transfer.commit' ? { kind: 'inline', response: { accepted: true } } : {})
    const client = new AgentAcpClient({ rpc } as never)
    await client.prompt('agy-session', 'Inspect', undefined, [{ type: 'image', mimeType: 'image/png', data: 'A'.repeat(800_000) }], 'antigravity')
    const chunks = rpc.mock.calls.filter(([method]) => method === 'agent.acp.transfer.chunk') as unknown as Array<[string, { index: number; data: string }]>
    expect(chunks.map(([, chunk]) => chunk.index)).toEqual([0, 1])
    const envelope = JSON.parse(chunks.map(([, chunk]) => Buffer.from(chunk.data, 'base64').toString()).join(''))
    expect(envelope).toMatchObject({ method: 'session/prompt', params: { sessionId: 'agy-session', backend: 'antigravity', prompt: [{ type: 'text', text: 'Inspect' }, { type: 'image', mimeType: 'image/png' }] } })
    expect(rpc).toHaveBeenCalledWith('agent.acp.transfer.commit', expect.anything(), undefined, ACP_PROMPT_RPC_TIMEOUT_MS)
    expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
  })

  it('releases failed or mismatched ACP response transfers', async () => {
    await runScenarios([
      {
        name: 'fails closed on a mismatched response chunk and releases the transfer',
        run: async () => {
          let transferId = ''
          const rpc = vi.fn(async (method: string, params: any) => {
            if (method === 'agent.acp.transfer.open') transferId = params.transferId
            if (method === 'agent.acp.transfer.commit')
              return { kind: 'chunked', transferId, totalBytes: 2, totalChunks: 1 }
            if (method === 'agent.acp.transfer.read')
              return { transferId: 'another-transfer', index: 0, data: 'e30=' }
            return {}
          })
          const client = new AgentAcpClient({ rpc } as never)
          await expect(
            client.transferCall('dsh/sessionHistory', { sessionId: 'agy-session' }),
          ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
          expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
        },
      },
      {
        name: 'closes an unfinished transfer when a chunk fails',
        run: async () => {
          const rpc = vi.fn(async (method: string) => {
            if (method === 'agent.acp.transfer.chunk') throw new Error('disconnected')
            return {}
          })
          const client = new AgentAcpClient({ rpc } as never)
          await expect(
            client.prompt(
              'agy-session',
              '',
              undefined,
              [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }],
              'antigravity',
            ),
          ).rejects.toThrow('disconnected')
          expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
        },
      },
    ])
  }, 10000)

})
