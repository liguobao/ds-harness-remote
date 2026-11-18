import { transform } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

// Execute the actual runtime methods with platform boundaries stubbed. This tests
// asynchronous ordering under Node; ArkTS compilation and device UI remain separate.
let AppRuntime: any
beforeAll(async () => {
  const source = readFileSync(fileURLToPath(new URL('../entry/src/main/ets/services/AppRuntime.ets', import.meta.url)), 'utf8')
  const compiled = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' })
  const module = { exports: {} }
  const dependency = new Proxy({}, { get: () => function Stub() {} })
  runInNewContext(compiled.code, { module, exports: module.exports, require: () => dependency, console, setTimeout, clearTimeout })
  AppRuntime = (module.exports as any).AppRuntime
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function runtime() {
  const r = Object.create(AppRuntime.prototype)
  Object.assign(r, {
    phase: 'chat', reconnecting: false, botMode: true,
    botState: { revision: -1, bots: [], rooms: [] }, botStateVersion: 0,
    botLoading: false, botError: '', botStateRequest: undefined, botRosterPending: false,
    selectedBotTargetId: '', sessionSelectionVersion: 0,
    notify: vi.fn(), loadMissingBotOutlines: vi.fn(async () => {}), openSession: vi.fn(async () => {}),
  })
  return r
}

function snapshot(id: string) {
  return { revision: 1, bots: [{ id, sessionId: `${id}-session`, main: true }], rooms: [] }
}

describe('Harmony bot runtime ordering', () => {
  it('shares concurrent roster and mode requests, publishing before session opens', async () => {
    const r = runtime()
    const response = deferred<any>()
    const opening = deferred<void>()
    r.openSession = vi.fn(() => opening.promise)
    r.botClient = { loadState: vi.fn(() => response.promise) }
    const roster = r.loadBotRoster()
    const mode = r.refreshBotState()
    expect(r.botClient.loadState).toHaveBeenCalledTimes(1)
    expect(r.botLoading).toBe(true)
    response.resolve(snapshot('main'))
    await roster
    await Promise.resolve()
    expect(r.botState.bots[0].id).toBe('main')
    expect(r.botLoading).toBe(false)
    expect(r.openSession).toHaveBeenCalledWith('main-session')
    expect(r.notify).toHaveBeenCalled()
    opening.resolve()
    await mode
  })

  it('ignores a late response from an old connection', async () => {
    const r = runtime()
    const old = deferred<any>()
    r.botClient = { loadState: vi.fn(() => old.promise) }
    const oldLoad = r.loadBotRoster()
    r.botClient = { loadState: vi.fn(async () => snapshot('new')) }
    r.botStateRequest = undefined // teardown invalidates the old in-flight request
    await r.loadBotRoster()
    old.resolve(snapshot('old'))
    await oldLoad
    expect(r.botState.bots[0].id).toBe('new')
    expect(r.botStateVersion).toBe(1)
    expect(r.botError).toBe('')
  })

  it('keeps a user-selected session when the initial list finishes later', async () => {
    const r = runtime()
    const list = deferred<any[]>()
    Object.assign(r, {
      harness: {}, sessions: [], lastDeviceId: 'host', pendingResumeSessionId: '',
      loadSessionSnapshot: () => [], setBusy: vi.fn(), sessionListWithRetry: () => list.promise,
      rememberSessions: vi.fn(), persistSessionSnapshot: vi.fn(), pickInitialSession: vi.fn(async () => {}),
    })
    const loading = r.loadSessionsAfterConnect()
    r.sessionSelectionVersion++
    r.currentSessionId = 'user-choice'
    r.messages = [{ text: 'keep' }]
    list.resolve([{ sessionId: 'another', updatedAt: 1 }])
    await loading
    expect(r.pickInitialSession).not.toHaveBeenCalled()
    expect(r.currentSessionId).toBe('user-choice')
    expect(r.messages[0].text).toBe('keep')
  })
  it('preserves the selected session if the initial list fails', async () => {
    const r = runtime()
    const list = deferred<any[]>()
    Object.assign(r, {
      harness: {}, sessions: [], sessionsSnapshot: [], sessionsSnapshotHost: '',
      lastDeviceId: 'host', pendingResumeSessionId: '', loadSessionSnapshot: () => [],
      setBusy: vi.fn(), sessionListWithRetry: () => list.promise,
    })
    const loading = r.loadSessionsAfterConnect()
    r.sessionSelectionVersion++
    r.currentSessionId = 'user-choice'
    r.currentSessionTitle = 'Chosen'
    r.messages = [{ text: 'keep' }]
    r.generating = true
    list.reject(new Error('list failed'))
    await loading
    expect(r.sessionsLoadFailed).toBe(true)
    expect(r.currentSessionId).toBe('user-choice')
    expect(r.currentSessionTitle).toBe('Chosen')
    expect(r.messages[0].text).toBe('keep')
    expect(r.generating).toBe(true)
  })

})
