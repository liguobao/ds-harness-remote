import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { describe, expect, it, vi } from 'vitest'
import { ACP_PROMPT_RPC_TIMEOUT_MS, AgentAcpClient } from '../src/acp-client.js'

describe('ACP image transfer', () => {
  it('requires archive capability and the exact OpenCode confirmation', async () => {
    const confirmed = { backend: 'opencode', sessionId: 'ses_1', archived: true }
    const rpc = vi.fn(async () => confirmed)
    await expect(new AgentAcpClient({ rpc } as never).archiveSession('ses_1', 'opencode')).rejects.toMatchObject({ code: 'OPENCODE_ARCHIVE_UNAVAILABLE' })
    expect(rpc).not.toHaveBeenCalled()
    const client = new AgentAcpClient({ rpc } as never, ['agent.acp.opencode.archive.v1'])
    await expect(client.archiveSession('ses_1', 'opencode')).resolves.toEqual(confirmed)
    expect(rpc).toHaveBeenCalledWith('agent.acp.call', { method: 'dsh/sessionArchive', params: { sessionId: 'ses_1', backend: 'opencode' } }, undefined, undefined)
    for (const response of [{ ...confirmed, archived: false }, { ...confirmed, sessionId: 'other' }, {}]) {
      rpc.mockResolvedValueOnce(response as typeof confirmed)
      await expect(client.archiveSession('ses_1', 'opencode')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    }
    await expect(client.archiveSession('ses_1', 'cursor')).rejects.toMatchObject({ code: 'OPENCODE_ARCHIVE_UNAVAILABLE' })
  })
  it('preserves authoritative ACP catalog/history failures instead of returning an empty successful baseline', async () => {
    const reads = [
      { backend: 'pi', kind: 'workspaces' }, { backend: 'pi', kind: 'catalog' },
      ...['pi', 'claude', 'opencode'].map(backend => ({ backend, kind: 'history' })),
    ]
    await runScenarios(reads.flatMap(({ backend, kind }) => ['transport', 'malformed', 'empty', ...(kind === 'history' ? ['busy', 'oversized'] : [])].map(outcome => ({
      name: `${backend} ${kind}: ${outcome}`,
      run: async () => {
        const errorCode = outcome === 'busy' ? 'OPENCODE_HISTORY_BUSY' : outcome === 'oversized' ? 'ACP_HISTORY_TOO_LARGE' : 'DISCONNECTED'
        const rpc = vi.fn(async (method: string) => {
          if ((kind !== 'history' && method === 'agent.acp.call') || method === 'agent.acp.transfer.commit') {
            if (['transport', 'busy', 'oversized'].includes(outcome)) throw Object.assign(new Error('History unavailable'), { code: errorCode })
            const response = outcome === 'empty' ? kind === 'workspaces' ? [] : kind === 'catalog' ? { items: [] } : { events: [] } : { unexpected: [] }
            return kind !== 'history' ? response : { kind: 'inline', response }
          }
          return {}
        })
        const client = new AgentAcpClient({ rpc } as never)
        const read = kind === 'workspaces' ? client.listWorkspaces(backend) : kind === 'catalog' ? client.listSessions('/project', backend) : client.loadSessionHistory('saved', backend)
        if (outcome === 'empty') await expect(read).resolves.toEqual([])
        else await expect(read).rejects.toMatchObject({ code: outcome === 'malformed' ? 'INVALID_RESPONSE' : errorCode })
        if (kind === 'history') expect(rpc.mock.calls.at(-1)?.[0]).toBe('agent.acp.transfer.close')
      },
    }))))
  })
  it('model selection loads once when negotiated and keeps the legacy load fallback', async () => {
    for (const atomic of [false, true]) {
      const selected = { provider: 'antigravity', model: 'live-model', reasoningEffort: 'low' }
      const rpc = vi.fn(async (_method: string, params: any) => params.method === 'dsh/selectModel' ? { selected } : { sessionId: 'conversation' })
      const client = new AgentAcpClient({ rpc } as never, atomic ? ['agent.acp.antigravity.model-load.v1'] : [])
      expect(await client.selectModel('conversation', 'antigravity', selected)).toEqual(selected)
      expect(rpc.mock.calls.map(([, params]) => params.method)).toEqual(atomic ? ['dsh/selectModel'] : ['session/load', 'dsh/selectModel'])
    }
  })
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
