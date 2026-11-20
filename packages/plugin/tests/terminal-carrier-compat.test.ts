import { describe, expect, it, vi } from 'vitest'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'
import { TerminalCarrierCompat, openRemoteTerminal, usesDuplexTerminal } from '../src/terminal-carrier-compat.js'
import type { LocalTypertGateway } from '../src/typert-gateway-contract.js'
import { HarnessRemoteBridge } from '../src/harness-remote-bridge.js'
import { TerminalPolicy } from '../src/terminal-policy.js'

function fixture(writable = true, acknowledge = true) {
  const inputs: unknown[] = []
  const gateway: LocalTypertGateway = {
    supportsCarrier: true,
    invoke: async () => undefined,
    dispatch: vi.fn(async () => ({ ok: true as const })),
    failure: error => ({ code: 'failed', message: String(error), details: {} }),
    open: vi.fn(async (endpoint, payload, signal, uplink) => {
      expect(endpoint).toBe('terminal/attach')
      expect(payload).toEqual({ args: { agentId: 's1', id: 't1' } })
      return (async function* () {
        yield { type: 'snapshot', sequence: 0, screen: '', info: { id: 't1', state: 'running' }, writable }
        for await (const value of uplink!) {
          if (signal.aborted) break
          inputs.push(value)
          if (acknowledge) yield { type: 'ack', sequence: (value as { sequence: number }).sequence }
        }
      })()
    }),
  }
  return { gateway, inputs, carrier: new TerminalCarrierCompat(gateway) }
}
const args = { agentId: 's1', id: 't1', attachmentId: 'a1' }

describe('RC.1 terminal carrier compatibility', () => {
  it('selects the official duplex contract only from its introducing release', async () => {
    await runScenarios([
      [undefined, false], ['0.2.0-rc.2', false], ['0.2.1-alpha.1', false], ['0.2.1-alpha.2', false],
      ['0.2.1-alpha.3', true], ['dsh-v0.2.1-rc.1', true], ['0.2.1', true], ['0.2.2-rc.1', true],
    ].map(([version, expected]) => ({ name: String(version), run: () => expect(usesDuplexTerminal(version as string | undefined)).toBe(expected) })))
  })

  it('carries native Client write/resize to the Host attach stream and acknowledges only accepted inputs', async () => {
    const { carrier, inputs } = fixture()
    const control = new AbortController()
    const target = {
      invoke: async () => undefined,
      dispatch: (endpoint: string, payload: unknown, signal: AbortSignal) => carrier.call(endpoint, payload, signal),
      open: async (endpoint: string, payload: unknown, signal: AbortSignal) => {
        expect(endpoint).toBe('terminal/follow')
        return carrier.open(payload, signal)
      },
    }
    const uplink = (async function* () {
      yield { type: 'write', sequence: 1, data: 'echo fixture\r' }
      yield { type: 'write', sequence: 2, data: 'x', typed: true }
      yield { type: 'resize', sequence: 3, cols: 80, rows: 24 }
    })()
    const iterator = (await openRemoteTerminal(target, { args: { agentId: 's1', id: 't1' } }, control.signal, uplink))[Symbol.asyncIterator]()
    try {
      expect((await iterator.next()).value).toMatchObject({ type: 'snapshot', writable: true })
      expect((await iterator.next()).value).toEqual({ type: 'ack', sequence: 1 })
      expect((await iterator.next()).value).toEqual({ type: 'ack', sequence: 2 })
      expect((await iterator.next()).value).toEqual({ type: 'ack', sequence: 3 })
      expect(inputs).toEqual([
        { type: 'write', sequence: 1, data: 'echo fixture\r' },
        { type: 'write', sequence: 2, data: 'x' },
        { type: 'resize', sequence: 3, cols: 80, rows: 24 },
      ])
    } finally { control.abort(); await iterator.return?.() }
  })

  it('refuses unwritable, wrong-attachment and disconnected input without replay', async () => {
    await runScenarios(['read-only', 'wrong-attachment', 'disconnect', 'pending-limit'].map(scenario => ({ name: scenario, run: async () => {
      const { carrier, inputs } = fixture(scenario !== 'read-only', false)
      const control = new AbortController()
      const iterator = (await carrier.open({ args }, control.signal))[Symbol.asyncIterator]()
      try {
        await iterator.next()
        const alreadyClosed = new AbortController()
        alreadyClosed.abort()
        await expect(carrier.open({ args }, alreadyClosed.signal)).rejects.toThrow()
        const pump = iterator.next()
        if (scenario === 'pending-limit') {
          const pending = Array.from({ length: 32 }, () => carrier.call('terminal/write', { args: { ...args, data: 'pending' } }, control.signal))
          const failures = Promise.allSettled(pending)
          await expect(carrier.call('terminal/write', { args: { ...args, data: 'overflow' } }, control.signal)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
          control.abort()
          expect((await failures).every(item => item.status === 'rejected')).toBe(true)
        } else if (scenario === 'disconnect') {
          const pending = carrier.call('terminal/write', { args: { ...args, data: 'once' } }, control.signal)
          const refused = expect(pending).rejects.toMatchObject({ code: 'TRANSPORT_CLOSED' })
          await vi.waitFor(() => expect(inputs).toHaveLength(1))
          control.abort()
          await refused
        } else {
          await expect(carrier.call('terminal/write', { args: { ...args, attachmentId: scenario === 'wrong-attachment' ? 'other' : 'a1', data: 'refused' } }, control.signal))
            .rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
          expect(inputs).toEqual([])
          control.abort()
        }
        await pump
        await expect(carrier.call('terminal/write', { args: { ...args, data: 'late' } }, new AbortController().signal)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
      } finally { control.abort(); await iterator.return?.() }
    } })))
  })

  it('keeps terminal ownership, enablement and the fixed RPC boundary ahead of the compatibility path', async () => {
    const { gateway, inputs } = fixture()
    const owners = new Map<string, string>()
    let enabled = true
    const publish = vi.fn(async () => undefined)
    const bridge = new HarnessRemoteBridge(gateway, publish, undefined, '0.2.1-rc.1', new TerminalPolicy(() => enabled, 'device1', owners))
    const other = new HarnessRemoteBridge(gateway, publish, undefined, '0.2.1-rc.1', new TerminalPolicy(true, 'device2', owners))
    try {
      await bridge.call({ endpoint: 'terminal/create', payload: { args: { agentId: 's1', request: { id: 't1' } } } })
      await bridge.openStream({ endpoint: 'terminal/follow', streamId: 'f1', payload: { args } })
      await vi.waitFor(() => expect(publish).toHaveBeenCalledWith('harness.remote.frame', expect.objectContaining({ value: expect.objectContaining({ type: 'snapshot' }) })))
      await expect(other.openStream({ endpoint: 'terminal/follow', streamId: 'f2', payload: { args } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
      await expect(bridge.call({ endpoint: 'terminal/write', payload: { args: { ...args, data: 'one' } } })).resolves.toEqual({ ok: true })
      enabled = false
      await expect(bridge.call({ endpoint: 'terminal/write', payload: { args: { ...args, data: 'two' } } })).rejects.toMatchObject({ code: 'TERMINAL_DISABLED' })
      await expect(bridge.openStream({ endpoint: 'terminal/attach', streamId: 'bypass', payload: { args } })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' })
      expect(inputs).toEqual([{ type: 'write', sequence: 1, data: 'one' }])
    } finally { await bridge.closeAll(); await other.closeAll() }
  })
})
