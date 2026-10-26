// Child process for verify-packed-webrtc.mjs. Requires Node >=22.15.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

assert.equal(typeof globalThis.require, 'undefined', 'smoke must run in pure ESM')
assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined, 'run with the Node runtime, not Electron')
const [entry, bundle] = process.argv.slice(2).map(path => pathToFileURL(path).href)
let nativeAttempts = 0
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@roamhq/wrtc') {
      nativeAttempts++
      throw new Error('native RTC intentionally unavailable in packed fallback smoke')
    }
    assert.notEqual(specifier, 'werift', 'packed runtime must not import external werift')
    return next(specifier, context)
  },
  load(url, context, next) {
    const result = next(url, context)
    if (url === `${bundle}?transport-smoke`) {
      return { ...result, source: `${typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8')}\nexport { loadNodeRtcFactory, loadWeriftFactory, RtcDataChannelTransport };\nexport const weriftLoaded = () => cachedWerift !== undefined;\n` }
    }
    return result
  },
})
const deadline = setTimeout(() => { console.error('packed WebRTC smoke timed out'); process.exit(1) }, 30_000)
const peers = []
try {
  const plugin = await import(entry)
  assert.equal(plugin.name, 'ds-harness-remote')
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(nativeAttempts, 0, 'package import must not initialize native RTC')
  const runtime = await import(`${bundle}?transport-smoke`)
  assert.equal(runtime.weriftLoaded(), false, 'werift must remain lazy until first RTC use')
  const factories = await Promise.all([runtime.loadNodeRtcFactory(), runtime.loadNodeRtcFactory()])
  assert.ok(nativeAttempts > 0, 'exercise real native-unavailable fallback selection')
  for (const factory of factories) assert.ok(factory, 'first/concurrent fallback initialization must succeed')
  assert.equal(runtime.weriftLoaded(), true)
  assert.equal(await runtime.loadWeriftFactory(), await runtime.loadWeriftFactory(), 'reuse cached factory')

  const received = []
  const echoed = []
  const a = new runtime.RtcDataChannelTransport({
    role: 'initiator', factory: factories[0], iceServers: [],
    onSignal: signal => b.handleSignal(signal), negotiateTimeoutMs: 8_000,
  })
  const b = new runtime.RtcDataChannelTransport({
    role: 'responder', factory: factories[1], iceServers: [],
    onSignal: signal => a.handleSignal(signal), negotiateTimeoutMs: 8_000,
  })
  peers.push(a, b)
  a.onMessage(data => echoed.push(Buffer.from(data).toString()))
  b.onMessage(data => received.push(Buffer.from(data).toString()))
  await Promise.all([a.connect(), b.connect()])
  await Promise.all(Array.from({ length: 8 }, (_, i) => a.send(new TextEncoder().encode(`packed-${i}`))))
  while (received.length < 8) await delay(20)
  await Promise.all(received.map(value => b.send(new TextEncoder().encode(`echo:${value}`))))
  while (echoed.length < 8) await delay(20)
  assert.equal(received.length, 8)
  assert.equal(echoed.length, 8)
  for (let i = 0; i < 8; i++) {
    // Do not dump backing-buffer contents if a binary framing regression occurs.
    assert.ok(received[i] === `packed-${i}`, `received frame ${i} payload/order mismatch`)
    assert.ok(echoed[i] === `echo:packed-${i}`, `echo frame ${i} payload/order mismatch`)
  }
  await Promise.all(peers.map(peer => peer.close()))
  for (const peer of peers) assert.equal(peer.getStats().connected, false)
  console.log('pure ESM entry, lazy/native-unavailable fallback, concurrent/cache initialization and ordered bidirectional DataChannel passed')
} finally {
  await Promise.all(peers.map(peer => peer.close()))
  clearTimeout(deadline)
  hooks.deregister()
}
