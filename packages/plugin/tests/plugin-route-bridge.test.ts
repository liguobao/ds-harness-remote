import { MAX_SECURE_MESSAGE_BYTES } from '@dsh-remote/protocol'
import { describe, expect, it, vi } from 'vitest'
import { HarnessRemoteBridge } from '../src/harness-remote-bridge.js'
import type { PluginRouteDispatcher } from '../src/plugin-route-bridge.js'
import { PluginRouteBridge } from '../src/plugin-route-bridge.js'
import upstreamEndpoints from './fixtures/ds-bot-v0.4.1-endpoints.json' with { type: 'json' }
import { RpcError } from '../src/rpc-router.js'
import { runScenarios } from '../../../scripts/test-scenarios.mjs'

function dispatcher(overrides: Partial<{ status: number; json: unknown }> = {}): PluginRouteDispatcher {
  return vi.fn(async () => ({ status: 200, json: { ok: true, value: [] }, ...overrides }))
}

const COMPUTER_ONLY_REMOVED = [
  'folder-pick',
  'browser-wait',
  'browser-result',
  'connector-import',
  'connector-import-scan',
  'phone-pair',
  'phone-pair-cancel',
  'phone-remove',
  'phone-set',
  'computer-allow-foreground',
  'computer-cursor-wait',
  'computer-handback',
  'computer-hold-answer',
  'computer-open-settings',
  'computer-permission',
  'computer-provider-retry',
  'computer-revoke-app',
  'computer-set-enabled',
  'computer-set-level',
  'computer-shot',
  'computer-system-status',
  'computer-takeover',
  'computer-user-active',
]

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

  it('admits DS-Bot v0.4.1 team endpoints and refuses computer-only, host-upgrade, and unknown operations', async () => {
    const nonApprovalAllowed = [...upstreamEndpoints, 'btw', 'btw-cancel', 'room-continue', 'bot-new-part', 'bot-open-part']
      .filter(endpoint => endpoint !== 'approval-answer')
    await runScenarios([
      ...nonApprovalAllowed.map(endpoint => ({
        name: `admit ${endpoint}`, body: { endpoint, payload: {} }, allowed: true,
      })),
      { name: 'one-time approval', body: { endpoint: 'approval-answer', payload: { choice: 'allow' } }, allowed: true },
      { name: 'deny approval', body: { endpoint: 'approval-answer', payload: { choice: 'reject' } }, allowed: true },
      ...[
        { name: 'choice', values: { selected: ['first'] } },
        { name: 'confirmation', values: { confirmed: true } },
        { name: 'form', values: { fields: { title: 'Remote answer' } } },
        { name: 'calculator inputs', values: { inputs: { quantity: 3, enabled: true, size: 'large' } } },
      ].map(({ name, values }) => ({
        name: `admit card ${name}`,
        body: { endpoint: 'view-reply', payload: { sessionId: 'bot-session', viewId: 'pending-view', action: 'card-component', values } },
        allowed: true,
      })),
      ...[
        ...COMPUTER_ONLY_REMOVED,
        'dsh-update-install',
        'changes-diff',
        'changes-summary',
        'push-register',
        'push-unregister',
        'plugins-list',
        'speech-transcribe',
        'api-set',
        'computer-future-operation',
        'future-operation',
        'State',
        'state/child',
        'state\n',
      ].map(endpoint => ({ name: `refuse ${endpoint}`, body: { endpoint, payload: {} }, allowed: false })),
      { name: 'refuse approval always', body: { endpoint: 'approval-answer', payload: { choice: 'always' } }, allowed: false },
      { name: 'refuse approval allow_session', body: { endpoint: 'approval-answer', payload: { choice: 'allow_session' } }, allowed: false },
      { name: 'refuse image parent log read', body: { endpoint: 'image', payload: { sessionId: 'bot-1', parent: 'parent-sess' } }, allowed: false },
      { name: 'missing operation', body: {}, allowed: false },
      { name: 'extra top-level body fields', body: { endpoint: 'state', extra: true }, allowed: false },
      { name: 'array payload', body: { endpoint: 'state', payload: [] }, allowed: false },
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

  it('enforces DS-Bot remote=true sanitization on set-prefs, state, and folders', async () => {
    const prefsPayload = {
      layout: 'bubble',
      css: 'body { background: url(https://evil.invalid); }',
      appearance: {
        theme: 'fei',
        css: '*{color:red}',
        mode: 'dark',
        uiFont: 'Mono',
        codeFont: 'Fira',
        fontSize: 16,
        lineHeight: 1.5,
        material: 'mica',
      },
    }
    const prefsSnapshot = structuredClone(prefsPayload)
    const prefsDispatch = dispatcher()
    await new PluginRouteBridge(prefsDispatch).call({
      route: 'api/bot',
      body: { endpoint: 'set-prefs', payload: prefsPayload },
    })
    expect(prefsPayload).toEqual(prefsSnapshot)
    expect(prefsDispatch).toHaveBeenCalledWith(
      'api/bot',
      { endpoint: 'set-prefs', payload: { layout: 'bubble', appearance: { theme: 'fei' } } },
      expect.any(AbortSignal),
    )

    const rawStateValue = {
      bots: [],
      rooms: [],
      userQuestions: { s1: { id: 'q' } },
      sessionQueues: { s1: [] },
      api: { token: 'secret-token' },
      telemetryPrompt: true,
      releaseNotes: { version: '0.4.1' },
      phone: { paired: true, pairing: { qr: 'secret-qr-uri' } },
      work: {
        approvals: [{ id: 'a1', botId: 'b1', alwaysAllow: true, tool: 'bash' }],
      },
    }
    const stateBridge = new PluginRouteBridge(dispatcher({ json: { ok: true, value: rawStateValue } }))
    const stateRes = await stateBridge.call({ route: 'api/bot', body: { endpoint: 'state', payload: null } })
    expect(stateRes.json).toEqual({
      ok: true,
      value: {
        bots: [],
        rooms: [],
        phone: { paired: true },
        work: {
          approvals: [{ id: 'a1', botId: 'b1', tool: 'bash' }],
        },
      },
    })

    const foldersBridge = new PluginRouteBridge(dispatcher({
      json: { ok: true, value: { workspace: '/repo', data: '/Users/dev/.dsh' } },
    }))
    const foldersRes = await foldersBridge.call({ route: 'api/bot', body: { endpoint: 'folders', payload: null } })
    expect(foldersRes.json).toEqual({ ok: true, value: { workspace: '/repo' } })
  })

  it('refuses dsh-update-install on HarnessRemoteBridge dsBot/call', async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, value: { ok: true } }))
    const bridge = new HarnessRemoteBridge({
      supportsCarrier: true,
      dispatch,
      open: async () => (async function* () {})(),
      invoke: async () => undefined,
      failure: () => ({ code: 'FAILED', message: 'fail', details: {} }),
    } as never, async () => undefined)
    try {
      await expect(bridge.call({
        endpoint: 'dsBot/call',
        payload: { args: { endpoint: 'dsh-update-install', payload: {} } },
      })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      expect(dispatch).not.toHaveBeenCalled()
    } finally {
      await bridge.closeAll()
    }
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

  it('prefers local dsBot/call RPC, sanitizes its response, falls back on gateway/not-found, and still refuses dsh-update-install', async () => {
    const httpDispatch = dispatcher({ json: { ok: true, value: { source: 'http' } } })
    const localCall = vi.fn(async (endpoint: string) => {
      if (endpoint === 'state') {
        return {
          ok: true as const,
          value: { ok: true, value: { bots: [], rooms: [], phone: { pairing: { secret: 'hide' } } } },
        }
      }
      return { ok: false as const, code: 'gateway/not-found' }
    })
    const observed: unknown[] = []
    const bridge = new PluginRouteBridge(httpDispatch, undefined, (route, body, result) => observed.push({ route, body, result }), localCall)

    const stateRes = await bridge.call({ route: 'api/bot', body: { endpoint: 'state' } })
    expect(stateRes).toEqual({ status: 200, json: { ok: true, value: { bots: [], rooms: [], phone: {} } } })
    expect(httpDispatch).not.toHaveBeenCalled()
    expect(observed).toHaveLength(1)

    await expect(bridge.call({ route: 'api/bot', body: { endpoint: 'dsh-update-install', payload: {} } }))
      .rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
    expect(localCall).toHaveBeenCalledTimes(1)

    const fallbackRes = await bridge.call({ route: 'api/bot', body: { endpoint: 'models' } })
    expect(fallbackRes).toEqual({ status: 200, json: { ok: true, value: { source: 'http' } } })
    expect(httpDispatch).toHaveBeenCalledTimes(1)

    await bridge.call({ route: 'api/bot', body: { endpoint: 'state' } })
    expect(localCall).toHaveBeenCalledTimes(2)
    expect(httpDispatch).toHaveBeenCalledTimes(2)
  })

  it('never replays mutations when local dsBot/call fails with a non-terminal error', async () => {
    const httpDispatch = vi.fn(async () => ({ status: 200, json: { ok: true, value: true } }))
    let mode: 'error-code' | 'throw' = 'error-code'
    const localCall = vi.fn(async () => {
      if (mode === 'throw') throw new Error('boom')
      return { ok: false as const, code: 'gateway/internal' }
    })
    const bridge = new PluginRouteBridge(httpDispatch, undefined, undefined, localCall)

    await expect(bridge.call({
      route: 'api/bot',
      body: { endpoint: 'send', payload: { sessionId: 'bot', text: 'hello' } },
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(localCall).toHaveBeenCalledTimes(1)
    expect(httpDispatch).not.toHaveBeenCalled()

    mode = 'throw'
    await expect(bridge.call({
      route: 'api/bot',
      body: { endpoint: 'create-bot', payload: { name: 'Helper' } },
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(localCall).toHaveBeenCalledTimes(2)
    expect(httpDispatch).not.toHaveBeenCalled()
  })

  it('keeps a fixed 30s timeout budget across all bot endpoints and retries local dsBot/call after cooldown', async () => {
    vi.useFakeTimers()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    try {
      let localHealthy = false
      const localCall = vi.fn(async (endpoint: string) => (
        localHealthy ? { ok: true as const, value: { ok: true, value: { endpoint } } } : { ok: false as const, code: 'gateway/not-found' }
      ))
      const httpDispatch = dispatcher({ json: { ok: true, value: { source: 'http' } } })
      const bridge = new PluginRouteBridge(httpDispatch, undefined, undefined, localCall)

      await bridge.call({ route: 'api/bot', body: { endpoint: 'send', payload: { sessionId: 'bot', text: 'hi' } } })
      expect(timeoutSpy).toHaveBeenLastCalledWith(30_000)
      expect(localCall).toHaveBeenCalledTimes(1)

      // Within the 30s cooldown window, im-login-wait skips local RPC and still uses 30s timeout.
      await bridge.call({ route: 'api/bot', body: { endpoint: 'im-login-wait', payload: {} } })
      expect(timeoutSpy).toHaveBeenLastCalledWith(30_000)
      expect(localCall).toHaveBeenCalledTimes(1)
      expect(httpDispatch).toHaveBeenCalledTimes(2)

      // After 30s cooldown, local dsBot/call is retried and recovers.
      localHealthy = true
      vi.advanceTimersByTime(30_000)
      const recovered = await bridge.call({ route: 'api/bot', body: { endpoint: 'state' } })
      expect(recovered).toEqual({ status: 200, json: { ok: true, value: { endpoint: 'state' } } })
      expect(localCall).toHaveBeenCalledTimes(2)
    } finally {
      timeoutSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('enforces DS-Bot allowlist and request/response sanitization on HarnessRemoteBridge dsBot/call', async () => {
    const dispatch = vi.fn(async (_endpoint: string, payload: unknown) => {
      const args = (payload as { args?: { endpoint?: string } }).args ?? (payload as { endpoint?: string })
      if (args.endpoint === 'folders') {
        return { ok: true as const, value: { ok: true, value: { workspace: '/repo', data: '/Users/dev/.dsh' } } }
      }
      if (args.endpoint === 'state') {
        return {
          ok: true as const,
          value: {
            ok: true,
            value: {
              bots: [],
              phone: { pairing: { secret: 'hide' } },
              work: { approvals: [{ id: 'a1', alwaysAllow: true }] },
            },
          },
        }
      }
      return { ok: true as const, value: { ok: true, value: true } }
    })
    const onDsBotCall = vi.fn()
    const bridge = new HarnessRemoteBridge({
      supportsCarrier: true,
      dispatch,
      open: async () => (async function* () {})(),
      invoke: async () => undefined,
      failure: () => ({ code: 'FAILED', message: 'fail', details: {} }),
    } as never, async () => undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { onFrame: vi.fn(), onDsBotCall })
    try {
      await expect(bridge.call({
        endpoint: 'dsBot/call',
        payload: { args: { endpoint: 'computer-shot', payload: {} } },
      })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })

      await expect(bridge.call({
        endpoint: 'dsBot/call',
        payload: { args: { endpoint: 'approval-answer', payload: { id: 'a1', choice: 'always' } } },
      })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })

      await expect(bridge.call({
        endpoint: 'dsBot/call',
        payload: { args: { endpoint: 'image', payload: { parent: '/Users/dev/.dsh/secret.log' } } },
      })).rejects.toMatchObject({ code: 'INVALID_MESSAGE' })
      expect(dispatch).not.toHaveBeenCalled()

      await bridge.call({
        endpoint: 'dsBot/call',
        payload: {
          args: {
            endpoint: 'set-prefs',
            payload: { css: 'body{}', layout: 'flat', appearance: { mode: 'dark', compact: true } },
          },
        },
      })
      expect(dispatch).toHaveBeenLastCalledWith('dsBot/call', {
        args: { endpoint: 'set-prefs', payload: { layout: 'flat', appearance: { compact: true } } },
      }, expect.any(AbortSignal))

      const folders = await bridge.call({ endpoint: 'dsBot/call', payload: { args: { endpoint: 'folders', payload: null } } })
      expect(folders).toEqual({ ok: true, value: { ok: true, value: { workspace: '/repo' } } })

      // Also sanitizes unwrapped dsBot/call values returned without an outer `{ ok, value }` wrapper.
      dispatch.mockResolvedValueOnce({ ok: true as const, value: { workspace: '/repo', data: '/Users/dev/.dsh' } as never })
      const unwrappedFolders = await bridge.call({ endpoint: 'dsBot/call', payload: { args: { endpoint: 'folders', payload: null } } })
      expect(unwrappedFolders).toEqual({ ok: true, value: { workspace: '/repo' } })

      // Smuggled `request` / `_request` properties cannot bypass post-dispatch sanitization or leak to dispatch.
      const smuggledState = await bridge.call({
        endpoint: 'dsBot/call',
        payload: {
          args: { endpoint: 'state', payload: null, request: { endpoint: 'efforts' }, _request: { endpoint: 'models' } },
          request: { endpoint: 'efforts' },
        },
      })
      expect(dispatch).toHaveBeenLastCalledWith('dsBot/call', {
        args: { endpoint: 'state', payload: null },
      }, expect.any(AbortSignal))
      expect(smuggledState).toEqual({
        ok: true,
        value: { ok: true, value: { bots: [], phone: {}, work: { approvals: [{ id: 'a1' }] } } },
      })
      expect(onDsBotCall).toHaveBeenLastCalledWith(
        { endpoint: 'state', payload: null },
        { ok: true, value: { bots: [], phone: {}, work: { approvals: [{ id: 'a1' }] } } },
      )

      const state = await bridge.call({ endpoint: 'dsBot/call', payload: { args: { endpoint: 'state', payload: null } } })
      expect(state).toEqual({
        ok: true,
        value: { ok: true, value: { bots: [], phone: {}, work: { approvals: [{ id: 'a1' }] } } },
      })
      expect(onDsBotCall).toHaveBeenLastCalledWith(
        { endpoint: 'state', payload: null },
        { ok: true, value: { bots: [], phone: {}, work: { approvals: [{ id: 'a1' }] } } },
      )
    } finally {
      await bridge.closeAll()
    }
  })
})
