import { describe, expect, it, vi } from 'vitest'
import { assertRemoteEventSource } from '../src/tui-event-source.js'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'

function gateway(open: LocalTypertGateway['open'], peer: unknown = { principal: { kind: 'owner' } }) {
  const dispose = vi.fn(async () => undefined)
  const child = { open, peer, dispose } as unknown as LocalTypertGateway
  const parent = { createPeer: () => child } as unknown as LocalTypertGateway
  return { parent, dispose }
}

describe('dsh-TUI Host Remote event source', () => {
  it('accepts the official ready frame and closes the probe', async () => {
    const closed = vi.fn()
    const open = vi.fn(async () => (async function* () {
      try {
        yield { type: 'ready', clientId: 'probe', host: { home: '/home/user' } }
      } finally {
        closed()
      }
    })())
    const fixture = gateway(open)

    await expect(assertRemoteEventSource(fixture.parent)).resolves.toBeUndefined()
    expect(open).toHaveBeenCalledWith('$events', { args: {} }, expect.any(AbortSignal))
    expect(closed).toHaveBeenCalledOnce()
    expect(fixture.dispose).toHaveBeenCalledOnce()
  })

  it('rejects a Host without the official event source', async () => {
    const fixture = gateway(async () => (async function* () {
      throw new Error('gateway/service-unavailable')
    })())

    await expect(assertRemoteEventSource(fixture.parent))
      .rejects.toThrow('dsh-TUI Remote needs @deepseek-ai/dsh-api-remotes')
    expect(fixture.dispose).toHaveBeenCalledOnce()
  })

  it('requires a live owner Peer before probing', async () => {
    const dispose = vi.fn(async () => undefined)
    const parent = { createPeer: () => ({ dispose }) } as unknown as LocalTypertGateway

    await expect(assertRemoteEventSource(parent))
      .rejects.toThrow('requires an official owner Peer')
    expect(dispose).toHaveBeenCalledOnce()
  })
})
