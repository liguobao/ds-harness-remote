import { describe, expect, it, vi } from 'vitest'
import { AcpRemoteGateway } from '../src/acp/gateway.js'
import { CursorAcpClient } from '../src/acp/adapters/cursor-process.js'
import { PiAcpClient } from '../src/acp/adapters/pi-process.js'
import { ClaudeAcpClient } from '../src/acp/adapters/claude-process.js'
import { HermesAcpClient } from '../src/acp/adapters/hermes-process.js'
import type { CursorAcpLike } from '../src/acp/adapters/cursor-process.js'
import type { SafeLogger } from '../src/logging.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

/**
 * A backend the profile disabled must never be spawned or probed, and it must not
 * produce a `*_BINARY_UNAVAILABLE` line. Pi/Claude/Hermes reuse the Cursor stdio
 * client, so their failures used to be reported as Cursor failures — which made a
 * disabled Cursor look like it was still being probed at startup.
 */

// Deterministic ENOENT: no such path can exist, and no fixture binary is needed.
const MISSING = '/nonexistent/ds-harness-remote-pr1/'

function silentLogger(): SafeLogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as SafeLogger
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

function warnCodes(logger: SafeLogger): string[] {
  return vi.mocked(logger.warn).mock.calls.flatMap(([, data]) => {
    const code = (data as { code?: unknown } | undefined)?.code
    return typeof code === 'string' ? [code] : []
  })
}

function warnMessages(logger: SafeLogger): string[] {
  return vi.mocked(logger.warn).mock.calls.map(([message]) => String(message))
}

describe('disabled ACP backends', () => {
  it('never launches a configured-off backend at startup', async () => {
    const logger = silentLogger()
    const create = vi.fn((_binary: string, _logger: SafeLogger, backend: { id: string }) => {
      const client = readyAcp()
      if (backend.id === 'pi' || backend.id === 'claude') {
        // Enabled but missing on this Host: the adapter must name itself.
        client.start = vi.fn(async () => { throw Object.assign(new Error('missing'), { code: `${backend.id.toUpperCase()}_BINARY_UNAVAILABLE` }) })
      }
      return client
    })
    const gateway = new AcpRemoteGateway({
      enabled: true,
      backends: [
        { id: 'cursor', enabled: false, command: 'agent', args: ['acp'] },
        { id: 'antigravity', enabled: false, command: 'agy', args: [] },
        { id: 'pi', enabled: true, command: 'pi-acp', args: [] },
        { id: 'claude', enabled: true, command: 'claude-agent-acp', args: [] },
        { id: 'opencode', enabled: true, command: 'opencode', args: ['acp'] },
      ],
    }, logger, create)
    try {
      await gateway.start()
      expect(create.mock.calls.map(([, , backend]) => backend.id).sort()).toEqual(['claude', 'opencode', 'pi'])
      expect(logger.warn).not.toHaveBeenCalled()
      expect(gateway.enabledBackends()).toEqual(['pi', 'claude', 'opencode'])
      expect(gateway.availableBackends()).toEqual(['opencode'])
      expect(gateway.status().error).toBeUndefined()
    } finally { await gateway.close() }
  })

  it('reports a disabled backend as configured-off instead of launching it', async () => {
    const logger = silentLogger()
    const create = vi.fn(() => readyAcp())
    const gateway = new AcpRemoteGateway({
      enabled: true,
      backends: [
        { id: 'cursor', enabled: false, command: 'agent', args: ['acp'] },
        { id: 'antigravity', enabled: true, command: 'agy', args: [] },
      ],
    }, logger, create)
    try {
      await gateway.start()
      expect(create).toHaveBeenCalledTimes(1)
      await expect(gateway.call('client', { method: 'initialize', params: { backend: 'cursor' } })).rejects.toMatchObject({
        code: 'ACP_BACKEND_DISABLED',
        message: 'The cursor ACP backend is disabled by configuration.',
      })
      await expect(gateway.call('client', { method: 'dsh/workspaceList', params: { backend: 'cursor' } })).rejects.toMatchObject({
        code: 'ACP_BACKEND_DISABLED',
      })
      // The rejected request never reached the adapter.
      expect(create).toHaveBeenCalledTimes(1)
      expect(create).toHaveBeenCalledWith(expect.stringContaining('agy'), expect.anything(), expect.objectContaining({ id: 'antigravity' }))
    } finally { await gateway.close() }
  })

  it('leaves an explicitly disabled Cursor backend out of startup failures', async () => {
    const logger = silentLogger()
    const gateway = new AcpRemoteGateway({
      enabled: true,
      backends: [
        { id: 'cursor', enabled: false, command: `${MISSING}cursor`, args: ['acp'] },
        { id: 'antigravity', enabled: false, command: `${MISSING}agy`, args: [] },
        { id: 'pi', enabled: true, command: `${MISSING}pi-acp`, args: [] },
        { id: 'claude', enabled: true, command: `${MISSING}claude-agent-acp`, args: [] },
      ],
    }, logger)
    try {
      await gateway.start()
      const codes = warnCodes(logger)
      expect(codes).toContain('PI_BINARY_UNAVAILABLE')
      expect(codes).toContain('CLAUDE_BINARY_UNAVAILABLE')
      expect(codes.filter(code => code.startsWith('CURSOR_'))).toEqual([])
      expect(warnMessages(logger).filter(message => message.includes('Cursor'))).toEqual([])
      expect(gateway.enabledBackends()).toEqual(['pi', 'claude'])
      expect(gateway.availableBackends()).toEqual([])
    } finally { await gateway.close() }
  })
})

describe('shared ACP stdio adapter attribution', () => {
  it('names the failing backend instead of Cursor', async () => {
    const cases = [
      { name: 'cursor', create: (logger: SafeLogger) => new CursorAcpClient(`${MISSING}cursor`, logger), label: 'Cursor', prefix: 'CURSOR' },
      { name: 'pi', create: (logger: SafeLogger) => new PiAcpClient(`${MISSING}pi-acp`, logger), label: 'Pi', prefix: 'PI' },
      { name: 'claude', create: (logger: SafeLogger) => new ClaudeAcpClient(`${MISSING}claude-agent-acp`, logger), label: 'Claude', prefix: 'CLAUDE' },
      { name: 'hermes', create: (logger: SafeLogger) => new HermesAcpClient(`${MISSING}hermes`, logger), label: 'Hermes', prefix: 'HERMES' },
    ]
    await runScenarios(cases.map(scenario => ({
      name: scenario.name,
      run: async () => {
        const logger = silentLogger()
        const client = scenario.create(logger)
        try {
          await expect(client.start()).rejects.toMatchObject({ code: `${scenario.prefix}_BINARY_UNAVAILABLE` })
          expect(warnMessages(logger)).toEqual([`${scenario.label} ACP communication failed`])
          expect(warnCodes(logger)).toEqual([`${scenario.prefix}_BINARY_UNAVAILABLE`])
        } finally { await client.close() }
      },
    })))
  })
})
