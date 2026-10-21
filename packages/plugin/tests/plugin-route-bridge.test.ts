import { MAX_SECURE_MESSAGE_BYTES } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { PluginRouteDispatcher } from '../src/plugin-route-bridge.js'
import { PluginRouteBridge } from '../src/plugin-route-bridge.js'
import { RpcError } from '../src/rpc-router.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

function dispatcher(overrides: Partial<{ status: number; json: unknown }> = {}): PluginRouteDispatcher {
  return vi.fn(async () => ({ status: 200, json: { ok: true, value: [] }, ...overrides }))
}

describe('PluginRouteBridge', () => {
  it('forwards valid calls to the dispatcher and returns the bounded status/json envelope', async () => {
    const dispatch = dispatcher({ json: { ok: true, value: { answer: 42 } } })
    const bridge = new PluginRouteBridge(dispatch)
    await expect(bridge.call({ route: 'api/bot', body: { endpoint: 'state', payload: null } })).resolves.toEqual({
      status: 200,
      json: { ok: true, value: { answer: 42 } },
    })
    expect(dispatch).toHaveBeenCalledWith('api/bot', { endpoint: 'state', payload: null }, expect.any(AbortSignal))
  })

  it('rejects routes outside the exact plugin allowlist before dispatch', async () => {
    await runScenarios([
      'http://evil/api/bot', '../etc/passwd', '', `api/${'x'.repeat(65)}`,
      'api/bot?x=1', '/api/bot', 'api/unknown', 'api/bot/child',
      'api/../ds-harness-remote/host.logout', 'api/./bot', 'api/other/../bot',
      'api/%62ot', 'api/bot\n',
    ].map(route => ({
      name: JSON.stringify(route),
      run: async () => {
        const dispatch = dispatcher()
        const bridge = new PluginRouteBridge(dispatch)
        await expect(bridge.call({ route, body: { endpoint: 'state' } })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
        expect(dispatch).not.toHaveBeenCalled()
      },
    })))
  })

  it('admits reviewed Bot operations and refuses local administration before dispatch', async () => {
    await runScenarios([
      ...['state', 'send', 'create-bot', 'update-room', 'agent-session', 'schedules'].map(endpoint => ({
        name: `admit ${endpoint}`, body: { endpoint, payload: {} }, allowed: true,
      })),
      { name: 'one-time approval', body: { endpoint: 'approval-answer', payload: { choice: 'allow' } }, allowed: true },
      { name: 'deny approval', body: { endpoint: 'approval-answer', payload: { choice: 'reject' } }, allowed: true },
      ...[
        { name: 'choice', values: { selected: ['first'] } },
        { name: 'confirmation', values: { confirmed: true } },
        { name: 'form', values: { fields: { title: 'Remote answer' } } },
      ].map(({ name, values }) => ({
        name: `admit card ${name}`,
        body: { endpoint: 'view-reply', payload: { sessionId: 'bot-session', viewId: 'pending-view', action: 'card-component', values } },
        allowed: true,
      })),
      ...[
        'update-install', 'dsh-update-install', 'schedule-create', 'schedule-delete',
        'secret-set', 'secret-allow', 'secret-update', 'secret-delete', 'secret-cancel',
        'connector-connect', 'connector-disconnect', 'connector-retry',
        'capability-save', 'capability-delete', 'capability-approve', 'bot-capability',
        'memory-ask', 'memory-forget', 'browser-wait', 'browser-result',
        'diagnostics', 'diagnostics-log', 'diagnostics-clear', 'set-prefs',
        'future-operation', 'State', 'state/child', 'state\n',
      ].map(endpoint => ({ name: `refuse ${endpoint}`, body: { endpoint, payload: {} }, allowed: false })),
      { name: 'missing operation', body: {}, allowed: false },
      { name: 'extra top-level body fields', body: { endpoint: 'state', extra: true }, allowed: false },
      { name: 'array payload', body: { endpoint: 'state', payload: [] }, allowed: false },
      { name: 'session-wide approval', body: { endpoint: 'approval-answer', payload: { choice: 'allow_session' } }, allowed: false },
    ].map(row => ({
      name: row.name,
      run: async () => {
        const dispatch = dispatcher()
        const call = new PluginRouteBridge(dispatch).call({ route: 'api/bot', body: row.body })
        if (row.allowed) {
          await expect(call).resolves.toMatchObject({ status: 200 })
          expect(dispatch).toHaveBeenCalledOnce()
          expect(dispatch).toHaveBeenCalledWith('api/bot', row.body, expect.any(AbortSignal))
        } else {
          await expect(call).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
          expect(dispatch).not.toHaveBeenCalled()
        }
      },
    })))
  })

  it.each([[[]], ['string'], [42], [null], [{ route: 'api/bot', extra: true }]])(
    'rejects invalid payloads (%j) with INVALID_MESSAGE',
    async input => {
      const bridge = new PluginRouteBridge(dispatcher())
      await expect(bridge.call(input)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    },
  )

  it('rejects oversized request bodies with INVALID_MESSAGE', async () => {
    const bridge = new PluginRouteBridge(dispatcher())
    await expect(bridge.call({ route: 'api/bot', body: { endpoint: 'send', payload: { text: 'x'.repeat(MAX_SECURE_MESSAGE_BYTES) } } }))
      .rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
  })

  it('rejects oversized responses with RESPONSE_TOO_LARGE', async () => {
    const bridge = new PluginRouteBridge(dispatcher({ json: { blob: 'x'.repeat(MAX_SECURE_MESSAGE_BYTES) } }))
    await expect(bridge.call({ route: 'api/bot', body: { endpoint: 'state' } }))
      .rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('propagates dispatcher failures after the payload was accepted', async () => {
    const bridge = new PluginRouteBridge(vi.fn(async () => {
      throw new RpcError('TIMEOUT', 'The plugin route call timed out.', undefined, true)
    }))
    await expect(bridge.call({ route: 'api/bot', body: { endpoint: 'state' } }))
      .rejects.toMatchObject({ code: 'TIMEOUT', retryable: true })
  })
})
