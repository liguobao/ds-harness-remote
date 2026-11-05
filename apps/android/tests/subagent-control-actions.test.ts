import { beforeEach, describe, expect, it, vi } from 'vitest'

const haptics = vi.hoisted(() => ({
  impactAsync: vi.fn(async () => undefined),
  notificationAsync: vi.fn(async () => undefined),
}))

// Keep the store-action test hermetic: cut the native/expo and server-session
// chains that prompt-actions.ts pulls in transitively. None of these are used
// by the subagent control actions themselves.
vi.mock('expo-haptics', () => ({
  impactAsync: haptics.impactAsync,
  notificationAsync: haptics.notificationAsync,
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}))
vi.mock('../src/lib/errors', () => ({
  friendlyError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  isRecoverableTransportError: () => false,
  isRpcTimeoutError: () => false,
}))
vi.mock('../src/services/storage', () => ({
  loadCodexPermissionPresets: vi.fn(async () => ({})),
}))

import { HarnessAlphaClient, RemoteTypertGateway, type RemoteClientCore } from '@dsh-remote/client-core'
import { createPromptActions } from '../src/state/prompt-actions'
import { initialData, type AppState, type StoreAccess } from '../src/state/store-state'
import type { SessionAccess } from '../src/state/session-runtime'
import type { RemoteSession } from '../src/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const child = (over: Partial<RemoteSession> = {}): RemoteSession => ({
  sessionId: 'child',
  parentSessionId: 'parent',
  running: true,
  blank: false,
  updatedAt: 1,
  ...over,
})

interface FixtureOptions {
  sessions?: RemoteSession[]
  selectedSession?: RemoteSession
  connected?: boolean
}

function fixture(options: FixtureOptions = {}) {
  let state = {
    ...initialData(),
    connection: options.connected === false
      ? { phase: 'offline' as const, stats: { mode: 'Disconnected', connected: false } }
      : { phase: 'connected' as const, stats: { mode: 'Relay', connected: true } },
    sessions: options.sessions ?? [],
    selectedSession: options.selectedSession,
  } as unknown as AppState

  const access: StoreAccess = {
    get: () => state,
    set: partial => { state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) } },
  }

  const proxy = {
    subagentInterruptByParent: vi.fn(async () => true),
    subagentPrompt: vi.fn(async () => ({ messageId: 'm-1' })),
  }
  const runtime = {
    connectionGeneration: 1,
    connection: { requireProxy: () => proxy },
    flushPendingMuxFrames: vi.fn(),
  }
  const actions = createPromptActions({ ...access, runtime } as unknown as SessionAccess)

  return {
    get: access.get,
    set: access.set,
    proxy,
    runtime,
    actions,
  }
}

beforeEach(() => {
  haptics.impactAsync.mockClear()
  haptics.notificationAsync.mockClear()
})

describe('HarnessAlphaClient subagent control protocol', () => {
  it('sends a continuable interrupt addressed by both child and parent', async () => {
    const call = vi.spyOn(RemoteTypertGateway.prototype, 'call').mockResolvedValue({ ok: true, value: { accepted: true } })
    const alpha = new HarnessAlphaClient({} as RemoteClientCore)
    await expect(alpha.subagentInterruptByParent('child', 'parent')).resolves.toBe(true)
    expect(call).toHaveBeenCalledWith('subagents/interruptByParent', {
      args: { childSessionId: 'child', parentSessionId: 'parent', mode: 'continuable' },
    }, undefined)
    call.mockRestore()
  })

  it('sends the prompt request with a fresh requestId and returns the messageId', async () => {
    const call = vi.spyOn(RemoteTypertGateway.prototype, 'call').mockResolvedValue({ ok: true, value: { messageId: 'm-42' } })
    const alpha = new HarnessAlphaClient({} as RemoteClientCore)
    await expect(alpha.subagentPrompt('child', 'parent', 'hello', 'steer')).resolves.toEqual({ messageId: 'm-42' })
    expect(call).toHaveBeenCalledOnce()
    const [endpoint, args] = call.mock.calls[0] as [string, { args: { request: Record<string, unknown> } }]
    expect(endpoint).toBe('subagents/prompt')
    expect(args.args.request).toMatchObject({
      parentSessionId: 'parent',
      childSessionId: 'child',
      mode: 'continuable',
      delivery: 'steer',
      content: [{ type: 'text', text: 'hello' }],
    })
    expect(typeof args.args.request.requestId).toBe('string')
    call.mockRestore()
  })

  it('propagates a Host rejection as a thrown error', async () => {
    const call = vi.spyOn(RemoteTypertGateway.prototype, 'call')
      .mockResolvedValue({ ok: false, error: { code: 'FAILED', message: 'child not running' } })
    const alpha = new HarnessAlphaClient({} as RemoteClientCore)
    await expect(alpha.subagentInterruptByParent('child', 'parent')).rejects.toThrow('child not running')
    call.mockRestore()
  })

  it('rejects an interrupt response that did not accept the signal', async () => {
    const call = vi.spyOn(RemoteTypertGateway.prototype, 'call')
      .mockResolvedValue({ ok: true, value: { accepted: false } })
    const alpha = new HarnessAlphaClient({} as RemoteClientCore)
    await expect(alpha.subagentInterruptByParent('child', 'parent')).rejects.toThrow('The Host did not accept the subagent interrupt.')
    call.mockRestore()
  })
})

describe('interruptSubagent store action', () => {
  it('interrupts through the parent and reflects running:false locally', async () => {
    const f = fixture({ sessions: [child({ running: true })], selectedSession: child({ running: true }) })
    await expect(f.actions.interruptSubagent('child', 'parent')).resolves.toBe(true)
    expect(f.proxy.subagentInterruptByParent).toHaveBeenCalledWith('child', 'parent')
    expect(f.get().sessions.find(s => s.sessionId === 'child')?.running).toBe(false)
    expect(f.get().selectedSession?.running).toBe(false)
    expect(f.get().busyAction).toBeUndefined()
    expect(haptics.impactAsync).toHaveBeenCalled()
  })

  it('resolves parentSessionId from the session list when omitted', async () => {
    const f = fixture({ sessions: [child()] })
    await expect(f.actions.interruptSubagent('child')).resolves.toBe(true)
    expect(f.proxy.subagentInterruptByParent).toHaveBeenCalledWith('child', 'parent')
  })

  it('surfaces a friendly error and clears busyAction on Host failure', async () => {
    const f = fixture({ sessions: [child()] })
    f.proxy.subagentInterruptByParent.mockRejectedValueOnce(new Error('host refused'))
    await expect(f.actions.interruptSubagent('child', 'parent')).resolves.toBe(false)
    expect(f.get().error).toBe('host refused')
    expect(f.get().busyAction).toBeUndefined()
  })

  it('tolerates haptic failure without failing an accepted interrupt', async () => {
    const f = fixture({ sessions: [child()] })
    haptics.impactAsync.mockRejectedValueOnce(new Error('haptic failed'))
    await expect(f.actions.interruptSubagent('child', 'parent')).resolves.toBe(true)
    expect(f.get().error).toBeUndefined()
    expect(f.get().sessions.find(s => s.sessionId === 'child')?.running).toBe(false)
  })

  it('rejects offline or unresolvable-parent interrupts without hitting the Host', async () => {
    const offline = fixture({ sessions: [child()], connected: false })
    await expect(offline.actions.interruptSubagent('child', 'parent')).resolves.toBe(false)
    expect(offline.proxy.subagentInterruptByParent).not.toHaveBeenCalled()

    const noParent = fixture({}) // no child row, no explicit parent
    await expect(noParent.actions.interruptSubagent('child')).resolves.toBe(false)
    expect(noParent.proxy.subagentInterruptByParent).not.toHaveBeenCalled()
  })
})

describe('promptSubagent store action', () => {
  it('steers a running child and queues an idle child, passing trimmed text', async () => {
    const running = fixture({ sessions: [child({ running: true })] })
    await expect(running.actions.promptSubagent('child', '  hi  ', 'parent')).resolves.toBe(true)
    expect(running.proxy.subagentPrompt).toHaveBeenCalledWith('child', 'parent', 'hi', 'steer')

    const idle = fixture({ sessions: [child({ running: false })] })
    await expect(idle.actions.promptSubagent('child', 'hi', 'parent')).resolves.toBe(true)
    expect(idle.proxy.subagentPrompt).toHaveBeenCalledWith('child', 'parent', 'hi', 'queue')
  })

  it('resolves parentSessionId and delivery from selectedSession', async () => {
    const f = fixture({ selectedSession: child({ running: true }) })
    await expect(f.actions.promptSubagent('child', 'hello')).resolves.toBe(true)
    expect(f.proxy.subagentPrompt).toHaveBeenCalledWith('child', 'parent', 'hello', 'steer')
  })

  it('never fabricates an optimistic message and clears busyAction on success', async () => {
    const f = fixture({ sessions: [child()] })
    await expect(f.actions.promptSubagent('child', 'hello', 'parent')).resolves.toBe(true)
    expect(f.get().messages['child'] ?? []).toEqual([])
    expect(f.get().busyAction).toBeUndefined()
    expect(haptics.impactAsync).toHaveBeenCalled()
  })

  it('rejects empty text before touching the Host', async () => {
    const f = fixture({ sessions: [child()] })
    await expect(f.actions.promptSubagent('child', '   ', 'parent')).resolves.toBe(false)
    expect(f.proxy.subagentPrompt).not.toHaveBeenCalled()
    expect(f.get().busyAction).toBeUndefined()
  })

  it('surfaces a friendly error and clears busyAction on Host failure', async () => {
    const f = fixture({ sessions: [child()] })
    f.proxy.subagentPrompt.mockRejectedValueOnce(new Error('prompt refused'))
    await expect(f.actions.promptSubagent('child', 'hello', 'parent')).resolves.toBe(false)
    expect(f.get().error).toBe('prompt refused')
    expect(f.get().busyAction).toBeUndefined()
  })

  it('rejects offline or unresolvable-parent prompts without hitting the Host', async () => {
    const offline = fixture({ sessions: [child()], connected: false })
    await expect(offline.actions.promptSubagent('child', 'hello', 'parent')).resolves.toBe(false)
    expect(offline.proxy.subagentPrompt).not.toHaveBeenCalled()

    const noParent = fixture({})
    await expect(noParent.actions.promptSubagent('child', 'hello')).resolves.toBe(false)
    expect(noParent.proxy.subagentPrompt).not.toHaveBeenCalled()
  })
})

describe('subagent control busyAction state', () => {
  it('serializes concurrent subagent operations and settles busyAction', async () => {
    const f = fixture({ sessions: [child()] })
    const gate = deferred<boolean>()
    f.proxy.subagentInterruptByParent.mockReturnValueOnce(gate.promise)

    const pending = f.actions.interruptSubagent('child', 'parent')
    // The synchronous prefix has already published the busy marker.
    expect(f.get().busyAction).toBe('subagent:stop:child')

    // A concurrent prompt and a second interrupt are both rejected while busy.
    await expect(f.actions.promptSubagent('child', 'hello', 'parent')).resolves.toBe(false)
    await expect(f.actions.interruptSubagent('child', 'parent')).resolves.toBe(false)
    expect(f.proxy.subagentPrompt).not.toHaveBeenCalled()
    expect(f.proxy.subagentInterruptByParent).toHaveBeenCalledTimes(1)

    gate.resolve(true)
    await expect(pending).resolves.toBe(true)
    expect(f.get().busyAction).toBeUndefined()
  })

  it('publishes the prompt busy marker while the request is in flight', async () => {
    const f = fixture({ sessions: [child()] })
    const gate = deferred<{ messageId: string }>()
    f.proxy.subagentPrompt.mockReturnValueOnce(gate.promise)
    const pending = f.actions.promptSubagent('child', 'hello', 'parent')
    expect(f.get().busyAction).toBe('subagent:prompt:child')
    gate.resolve({ messageId: 'm' })
    await expect(pending).resolves.toBe(true)
    expect(f.get().busyAction).toBeUndefined()
  })
})

describe('subagent control generation isolation', () => {
  it('never publishes stale success or failure after a reconnect owns the state', async () => {
    for (const action of ['interrupt', 'prompt'] as const) {
      for (const outcome of ['success', 'error'] as const) {
        const f = fixture({ sessions: [child({ running: true })] })
        const gate = deferred<unknown>()
        if (action === 'interrupt') f.proxy.subagentInterruptByParent.mockReturnValueOnce(gate.promise as Promise<boolean>)
        else f.proxy.subagentPrompt.mockReturnValueOnce(gate.promise as Promise<{ messageId: string }>)

        const pending = action === 'interrupt'
          ? f.actions.interruptSubagent('child', 'parent')
          : f.actions.promptSubagent('child', 'hello', 'parent')

        // Simulate a reconnect (new generation) that already moved the state on.
        f.runtime.connectionGeneration += 1
        f.set({
          busyAction: 'successor operation',
          error: 'successor error',
          sessions: [child({ running: false, title: 'successor' })],
        })
        const expected = JSON.parse(JSON.stringify(f.get())) as AppState

        if (outcome === 'success') gate.resolve(action === 'interrupt' ? true : { messageId: 'm' })
        else gate.reject(new Error('stale failure'))

        await expect(pending).resolves.toBe(false)
        expect(f.get()).toEqual(expected) // busyAction, error and sessions untouched
      }
    }
  })

  it('still publishes a normal completion when the generation is unchanged', async () => {
    const f = fixture({ sessions: [child({ running: true })] })
    await expect(f.actions.interruptSubagent('child', 'parent')).resolves.toBe(true)
    expect(f.get().sessions.find(s => s.sessionId === 'child')?.running).toBe(false)
    expect(f.get().busyAction).toBeUndefined()
  })
})
