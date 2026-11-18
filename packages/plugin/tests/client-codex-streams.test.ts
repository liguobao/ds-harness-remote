import { describe, expect, it, vi } from 'vitest'
import { ClientCodexStreams, type ClientCodexStreamsContext } from '../src/client-codex-streams.js'

const approval = { method: 'item/commandExecution/requestApproval', params: { requestHandle: 'handle-1' } }

describe('Codex loopback approval recovery', () => {
  it('claims only after polling and deduplicates a concurrent live frame', async () => {
    let onEvent: (event: unknown) => void = () => undefined
    const rpc = vi.fn(async (method: string) => {
      if (method === 'codex.app.approvals.claim') {
        onEvent({ event: 'codex.app.frame', data: { streamId: 's', frame: approval } })
        return { frames: [approval] }
      }
      return { opened: true }
    })
    const client = { rpc, onEvent: (handler: typeof onEvent) => { onEvent = handler; return () => undefined } }
    const streams = new ClientCodexStreams({
      activeRemote: () => ({ client, features: { codex: true } }), codexStreams: new Map(), host: undefined,
    } as unknown as ClientCodexStreamsContext)
    await streams.openCodexStream({ streamId: 's', threadId: 't' })
    expect(rpc).not.toHaveBeenCalledWith('codex.app.approvals.claim', expect.anything())
    await expect(streams.nextCodexFrames({ streamId: 's' })).resolves.toMatchObject({ frames: [approval] })
    expect(rpc).toHaveBeenCalledWith('codex.app.approvals.claim', { streamId: 's' })
  })

  it('claims from the local Host after the first poll', async () => {
    const claim = vi.fn(async () => ({ frames: [approval] }))
    const host = {
      codexStatus: () => ({ available: true }), codexCall: vi.fn(), codexRespond: vi.fn(),
      codexOpenStream: vi.fn(async () => ({ opened: true })), codexCloseStream: vi.fn(async () => ({})),
      codexClaimApprovals: claim,
    }
    const streams = new ClientCodexStreams({
      activeRemote: () => undefined, codexStreams: new Map(), host,
    } as unknown as ClientCodexStreamsContext)
    await streams.openCodexStream({ streamId: 's', threadId: 't' })
    expect(claim).not.toHaveBeenCalled()
    await expect(streams.nextCodexFrames({ streamId: 's' })).resolves.toMatchObject({ frames: [approval] })
    expect(claim).toHaveBeenCalledWith({ streamId: 's' })
  })

  it('discards a claim response after the stream has closed', async () => {
    let resolveClaim: (result: unknown) => void = () => undefined
    const client = {
      rpc: vi.fn((method: string) => method === 'codex.app.approvals.claim'
        ? new Promise(resolve => { resolveClaim = resolve }) : Promise.resolve({ opened: true })),
      onEvent: () => () => undefined,
    }
    const streams = new ClientCodexStreams({
      activeRemote: () => ({ client, features: { codex: true } }), codexStreams: new Map(), host: undefined,
    } as unknown as ClientCodexStreamsContext)
    await streams.openCodexStream({ streamId: 's', threadId: 't' })
    const next = streams.nextCodexFrames({ streamId: 's' })
    await streams.closeCodexStream({ streamId: 's' })
    resolveClaim({ frames: [approval] })
    await expect(next).rejects.toMatchObject({ code: 'STREAM_NOT_FOUND' })
  })
})
