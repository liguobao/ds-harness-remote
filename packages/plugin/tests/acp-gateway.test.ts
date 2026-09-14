import { describe, expect, it, vi } from 'vitest'
import { AcpRemoteGateway } from '../src/acp/gateway.js'
import type { CursorAcpLike } from '../src/acp/adapters/cursor-process.js'
import type { SafeLogger } from '../src/logging.js'

function silentLogger(): SafeLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

function readyAcp(): CursorAcpLike {
  return {
    start: vi.fn(async () => undefined),
    isReady: () => true,
    call: vi.fn(async () => ({})),
    respond: vi.fn(async () => undefined),
    respondError: vi.fn(async () => undefined),
    onInbound: () => () => undefined,
    onUnavailable: () => () => undefined,
    close: vi.fn(async () => undefined),
  }
}

describe('AcpRemoteGateway', () => {
  it('answers initialize on the gateway without forwarding to Cursor', async () => {
    const acp = readyAcp()
    const gateway = new AcpRemoteGateway(
      { enabled: true, binary: 'agent' },
      silentLogger(),
      () => acp,
    )
    await gateway.start()
    expect(gateway.isAvailable()).toBe(true)

    const result = await gateway.call('conn-1', {
      method: 'initialize',
      params: { protocolVersion: 1, clientInfo: { name: 'test', version: '0.0.1' } },
    })

    expect(result).toMatchObject({
      protocolVersion: 1,
      backend: 'cursor',
      agentInfo: { name: 'dsh-remote-acp' },
      capabilities: {
        loadSession: true,
        promptTypes: ['text'],
      },
    })
    expect(acp.call).not.toHaveBeenCalled()
  })
})
