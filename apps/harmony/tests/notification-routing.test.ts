import { transform } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { beforeAll, describe, expect, it, vi } from 'vitest'

let AppRuntime: any
let SecureStore: any
beforeAll(async () => {
  const load = async (name: string) => {
    const source = readFileSync(fileURLToPath(new URL(`../entry/src/main/ets/services/${name}.ets`, import.meta.url)), 'utf8')
    const compiled = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' })
    const module = { exports: {} }
    const dependency = new Proxy({
      randomId: () => '01234567-89ab-7cde-8fab-0123456789ab',
      jsonStr: (value: any, key: string, fallback: string) => typeof value[key] === 'string' ? value[key] : fallback,
      jsonNum: (value: any, key: string, fallback: number) => typeof value[key] === 'number' ? value[key] : fallback,
    }, { get: (target: any, key: string) => target[key] ?? function Stub() {} })
    runInNewContext(compiled.code, { module, exports: module.exports, require: () => dependency, console, setTimeout, clearTimeout })
    return module.exports as any
  }
  AppRuntime = (await load('AppRuntime')).AppRuntime
  SecureStore = (await load('SecureStore')).SecureStore
})

const token = '101:01234567-89ab-7cde-8fab-0123456789ab'
const record = () => JSON.stringify({ token, host: 'host-a', hostKey: 'pin-a', session: 'session-a', server: 'server-a', account: 'account-a', identity: 'identity-a', expires: Date.now() + 10000 })
function runtime(value = record()) {
  const r = Object.create(AppRuntime.prototype)
  Object.assign(r, {
    noticeStoreReady: true, noticeGeneration: 0, acceptedNoticeGeneration: 0, pendingNoticeTaps: [], pendingNoticeHost: '', pendingNoticeSession: '',
    noticePublishQueue: Promise.resolve(), notificationsEnabled: true, appBackground: true,
    pendingNoticeSelectionVersion: 0, sessionSelectionVersion: 0, phase: 'devices', connectedDeviceId: '',
    config: { baseUrl: 'server-a', email: 'account-a' }, identity: { deviceId: 'identity-a' },
    store: { loadHostPins: () => ({ 'host-a': 'pin-a', 'host-b': 'pin-b' }), consumeNoticeTarget: vi.fn(async (_slot: string, presented: string) => presented === token ? value : '') },
    openSession: vi.fn(async () => {}),
  })
  return r
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('Harmony notification routing', () => {
  it('rejects malformed or unknown capabilities and defers until the exact host connects', async () => {
    const r = runtime()
    r.handleNoticeWant('host-a:session-a')
    expect(r.store.consumeNoticeTarget).not.toHaveBeenCalled()
    r.handleNoticeWant(token)
    await tick()
    r.phase = 'chat'; r.harness = {}; r.connectedDeviceId = 'host-b'
    r.openPendingNotice()
    expect(r.openSession).not.toHaveBeenCalled()
    r.connectedDeviceId = 'host-a'; r.openPendingNotice(); r.openPendingNotice()
    expect(r.openSession).toHaveBeenCalledTimes(1)
    expect(r.openSession).toHaveBeenCalledWith('session-a')
  })
  it('discards expired, wrong account, or superseded targets', async () => {
    for (const change of [{ expires: Date.now() - 1 }, { server: 'other' }, { account: 'other' }, { identity: 'other' }, { hostKey: 'other' }]) {
      const r = runtime(JSON.stringify({ ...JSON.parse(record()), ...change }))
      r.handleNoticeWant(token); await tick()
      expect(r.pendingNoticeSession).toBe('')
    }
    const r = runtime(); r.handleNoticeWant(token); await tick()
    r.sessionSelectionVersion++
    r.phase = 'chat'; r.harness = {}; r.connectedDeviceId = 'host-a'; r.openPendingNotice()
    expect(r.openSession).not.toHaveBeenCalled()
    const expiredWhileWaiting = runtime(); expiredWhileWaiting.handleNoticeWant(token); await tick()
    expiredWhileWaiting.pendingNoticeExpires = Date.now() - 1
    expiredWhileWaiting.phase = 'chat'; expiredWhileWaiting.harness = {}; expiredWhileWaiting.connectedDeviceId = 'host-a'
    expiredWhileWaiting.openPendingNotice()
    expect(expiredWhileWaiting.openSession).not.toHaveBeenCalled()
    for (const change of ['account', 'pin']) {
      const changed = runtime(); changed.handleNoticeWant(token); await tick()
      if (change === 'account') changed.config.email = 'other'
      else changed.store.loadHostPins = () => ({ 'host-a': 'new-pin' })
      changed.phase = 'chat'; changed.harness = {}; changed.connectedDeviceId = 'host-a'
      changed.openPendingNotice()
      expect(changed.openSession).not.toHaveBeenCalled()
    }
  })
  it('does not let a delayed consume override a later manual selection', async () => {
    const r = runtime()
    let finish!: (value: string) => void
    r.store.consumeNoticeTarget = () => new Promise(resolve => { finish = resolve })
    r.handleNoticeWant(token); r.sessionSelectionVersion++; finish(record()); await tick()
    expect(r.pendingNoticeSession).toBe('')
  })
  it('drops late session events instead of attributing them to the current session', () => {
    const r = runtime()
    r.currentSessionId = 'session-b'
    r.applyEventPayload = vi.fn()
    r.handleFrame({ payload: { type: 'session/event', sessionId: 'session-a' } })
    expect(r.applyEventPayload).not.toHaveBeenCalled()
    r.handleFrame({ payload: { type: 'session/event', sessionId: 'session-b' } })
    expect(r.applyEventPayload).toHaveBeenCalledTimes(1)
  })
  it('ignores invalid Wants without canceling a verified pending target', async () => {
    const r = runtime()
    r.handleNoticeWant(token); await tick()
    const forged = '101:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    r.handleNoticeWant(forged); await tick()
    r.phase = 'chat'; r.harness = {}; r.connectedDeviceId = 'host-a'; r.openPendingNotice()
    expect(r.openSession).toHaveBeenCalledWith('session-a')
  })
  it('retains an earlier cold-start tap when an invalid Want arrives before initialization', async () => {
    const r = runtime(); r.noticeStoreReady = false
    r.handleNoticeWant(token)
    r.handleNoticeWant('101:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect(r.pendingNoticeTaps).toHaveLength(2)
    r.noticeStoreReady = true
    for (const tap of r.pendingNoticeTaps) await r.consumeNoticeTap(tap)
    r.phase = 'chat'; r.harness = {}; r.connectedDeviceId = 'host-a'; r.openPendingNotice()
    expect(r.openSession).toHaveBeenCalledWith('session-a')
  })
  it('serializes publications and captures the originating host before asynchronous work', async () => {
    const r = runtime()
    let finish!: () => void
    const first = new Promise<void>(resolve => { finish = resolve })
    const calls: any[] = []
    r.connectedDeviceId = 'host-a'
    r.publishNoticeAsync = vi.fn(async (...args: any[]) => {
      calls.push(args)
      if (calls.length === 1) await first
    })
    r.publishBackgroundNotice('first', 'one', 101, 'session-a')
    r.connectedDeviceId = 'host-b'
    r.publishBackgroundNotice('second', 'two', 101, 'session-b')
    await tick()
    expect(calls).toHaveLength(1)
    finish(); await r.noticePublishQueue
    expect(calls.map(call => call[0])).toEqual(['first', 'second'])
    expect(calls.map(call => JSON.parse(call[4]).host)).toEqual(['host-a', 'host-b'])
  })
  it('consumes a capability once even when taps race', async () => {
    const store = Object.create(SecureStore.prototype)
    const saved = record()
    const values = new Map([['noticeTarget.101', saved]])
    store.prefs = {
      getSync: (key: string, fallback: string) => values.get(key) ?? fallback,
      putSync: (key: string, value: string) => values.set(key, value),
      flush: async () => {},
    }
    const [first, second] = await Promise.all([store.consumeNoticeTarget('101', token), store.consumeNoticeTarget('101', token)])
    expect(first).toBe(saved)
    expect(second).toBe('')
  })
})
