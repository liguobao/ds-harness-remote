import { describe, expect, it, vi } from 'vitest'
import { HarnessRemoteBridge } from '../src/harness-remote-bridge.js'
import { TerminalPolicy } from '../src/terminal-policy.js'
import { resolveConfig } from '../src/config.js'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'

function setup(device: string, owners = new Map<string, string>(), enabled = true) {
  const dispatch = vi.fn(async (_endpoint: string, payload: any) => ({ ok: true as const, value: payload.args?.request ?? [] }))
  const open = vi.fn(async function* () { yield { type: 'snapshot', sequence: 0, screen: '' } })
  const gateway: LocalTypertGateway = { supportsCarrier: true, dispatch, invoke: vi.fn(), open: async () => open(), failure: () => ({ code: 'ERROR', message: '', details: {} }) }
  const publish = vi.fn(async () => undefined)
  const bridge = new HarnessRemoteBridge(gateway, publish, undefined, '0.1.6-alpha.2', new TerminalPolicy(enabled, device, owners))
  return { bridge, dispatch, open, publish }
}
const create = { endpoint: 'terminal/create', payload: { args: { agentId: 'session-1', request: { id: 'terminal-1', cols: 80, rows: 24 } } } }

describe('native sidebar access boundaries', () => {
  it('defaults terminal on and validates explicit preview ports', () => {
    expect(resolveConfig()).toMatchObject({ terminal: { enabled: true }, loopback: { ports: [] } })
    expect(resolveConfig({ loopback: { ports: [3000, 3000, 5173] } }).loopback.ports).toEqual([3000, 5173])
    for (const ports of [[0], [22], [65536], [1.5]]) expect(() => resolveConfig({ loopback: { ports } })).toThrow()
  })
  it('returns actionable Host-only guidance while disabled for calls and streams', async () => {
    const { bridge, dispatch, open } = setup('device-a', undefined, false)
    await expect(bridge.call(create)).rejects.toMatchObject({ code: 'TERMINAL_DISABLED', message: expect.stringContaining('Host Remote settings') })
    await expect(bridge.openStream({ streamId: 'stream', endpoint: 'terminal/follow', payload: { args: {} } })).rejects.toMatchObject({ code: 'TERMINAL_DISABLED' })
    expect(dispatch).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
  })
  it('allows the fixed native read-only methods, rejecting mutations and terminal extensions', async () => {
    const { bridge, dispatch } = setup('device-a')
    for (const method of ['list', 'stat', 'read', 'readBytes', 'readAll', 'readRelated']) {
      await bridge.call({ endpoint: `workspaceFiles/${method}`, payload: { args: { workspaceFileScopeId: 'session-1', path: 'README.md' } } })
    }
    expect(dispatch).toHaveBeenCalledTimes(6)
    for (const endpoint of ['workspaceFiles/write', 'workspaceFiles/delete', 'terminal/exec', 'terminal/spawn']) {
      await expect(bridge.call({ endpoint, payload: { args: {} } })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
    }
    for (const endpoint of ['settings/update', 'settings/replace', 'settings/mutate']) {
      await expect(bridge.call({ endpoint, payload: { args: { ns: 'ds-harness-remote', patch: { terminal: { enabled: true } } } } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    }
  })
  it('keeps terminals device-owned through reconnect, scopes input attachments and filters list', async () => {
    const owners = new Map<string, string>()
    const a = setup('device-a', owners); const b = setup('device-b', owners)
    await a.bridge.call(create)
    await expect(b.bridge.call(create)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    const args = { agentId: 'session-1', id: 'terminal-1', attachmentId: 'attachment-a' }
    await a.bridge.openStream({ streamId: 'follow-a', endpoint: 'terminal/follow', payload: { args } })
    await a.bridge.call({ endpoint: 'terminal/write', payload: { args: { ...args, data: 'ls\r' } } })
    await expect(b.bridge.openStream({ streamId: 'follow-b', endpoint: 'terminal/follow', payload: { args } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await a.bridge.closeAll()
    const reconnected = setup('device-a', owners)
    await expect(reconnected.bridge.call({ endpoint: 'terminal/write', payload: { args: { ...args, data: 'must-not-replay' } } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await reconnected.bridge.openStream({ streamId: 'follow-new', endpoint: 'terminal/follow', payload: { args: { ...args, attachmentId: 'new' } } })
    await reconnected.bridge.call({ endpoint: 'terminal/write', payload: { args: { ...args, attachmentId: 'new', data: 'pwd\r' } } })
    reconnected.dispatch.mockResolvedValueOnce({ ok: true, value: [{ id: 'terminal-1' }, { id: 'local-terminal' }] })
    await expect(reconnected.bridge.call({ endpoint: 'terminal/list', payload: { args: { sessionId: 'session-1' } } })).resolves.toMatchObject({ value: [{ id: 'terminal-1' }] })
    await reconnected.bridge.closeAll(); await b.bridge.closeAll()
  })
})
