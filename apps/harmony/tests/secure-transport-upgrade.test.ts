/**
 * Conformance tests for the upgradeable secure channel (`net/SecureTransport.ets`
 * implementing `UpgradeableSecureChannel`) and the relay-first data path in
 * `net/RelayTransport.ets` (`remote.transport.upgrade.v1`, in-band transport upgrade).
 *
 * The ArkTS sources cannot be imported by Node, so esbuild bundles the real files with every
 * `@kit.*` module replaced by the stub below. A fake Noise session (real bigint counters,
 * identity ciphertext) and fake legs are injected through the duck-typed internals so the
 * tests exercise the shipped state machine: DSHU sequence handling, bounded reorder,
 * two-phase drain, and fail-closed behavior.
 */
import { build } from 'esbuild'
import { rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const entryPath = join(here, '.secure-transport-entry.ts')
const bundlePath = join(here, '.secure-transport-bundle.mjs')

const kitStub = `
export const hilog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
}
export const cryptoFramework = {
  createRandom: () => ({
    generateRandomSync: (len: number) => ({ data: new Uint8Array(len) })
  })
}
export const webSocket = {
  createWebSocket: () => { throw new Error('webSocket stub must not be used') }
}
export const webview = {
  WebviewController: class {}
}
`

interface IdentityLike {
  deviceId: string
  privateKey: string
  publicKey: string
}

interface HostLike {
  deviceId: string
  identityKey: string
}

interface SequencedTransportLike {
  mode(): string
  selectedTransport(): string
  sendSequenced(counter: number, ciphertext: Uint8Array): Promise<void>
  onSequencedMessage(cb: (counter: number, ciphertext: Uint8Array) => void): () => void
  onClose(cb: (error: Error | undefined) => void): () => void
  close(): Promise<void>
}

interface SecureTransportLike {
  onClosed?: () => void
  connect(): Promise<void>
  send(data: Uint8Array): Promise<void>
  setMessageHandler(handler: (data: Uint8Array) => void): void
  close(): Promise<void>
  outboundCounter(): number
  attachIncomingLeg(leg: SequencedTransportLike): void
  markPreviousLegEndCounter(previousLegEndCounter: number): void
  switchOutboundLeg(leg: SequencedTransportLike, closePrevious: boolean, drainMs?: number): Promise<number>
  detachLeg(leg: SequencedTransportLike): Promise<void>
  relayTrafficBytes(): { sent: number; received: number }
}

interface FakeInnerLike {
  onMessage?: (data: Uint8Array) => void
  onMessageWithCounter?: (counter: number | undefined, data: Uint8Array) => void
  send(data: Uint8Array): Promise<void>
  close(): void
}

interface RelayTransportLike {
  onMessage?: (data: Uint8Array) => void
  onMessageWithCounter?: (counter: number | undefined, data: Uint8Array) => void
  isAuthorized(): boolean
  transportKind(): string
  connect(): Promise<void>
  close(): void
}

interface RelayTransportOptionsLike {
  deviceId: string
  accessToken: string
  targetDeviceId: string
  relayFirst: boolean
  rtc?: object
}

interface SecureTransportModule {
  SecureTransport: new (
    inner: FakeInnerLike,
    identity: IdentityLike,
    host: HostLike,
    pinnedHostKey?: string
  ) => SecureTransportLike
  RelayTransport: new (url: string, options: RelayTransportOptionsLike) => RelayTransportLike
  RelayTransportOptions: new () => RelayTransportOptionsLike
  utf8Encode(text: string): Uint8Array
  toBase64Url(bytes: Uint8Array): string
}

let mod!: SecureTransportModule
const decoder = new TextDecoder()

beforeAll(async () => {
  const entry = `
export { SecureTransport } from ${JSON.stringify(join(etsRoot, 'net', 'SecureTransport.ets'))}
export { RelayTransport, RelayTransportOptions } from ${JSON.stringify(join(etsRoot, 'net', 'RelayTransport.ets'))}
export { utf8Encode, toBase64Url } from ${JSON.stringify(join(etsRoot, 'crypto', 'Bytes.ets'))}
`
  writeFileSync(entryPath, entry, 'utf8')
  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      write: false,
      platform: 'neutral',
      loader: { '.ets': 'ts' },
      resolveExtensions: ['.ets', '.ts', '.js'],
      plugins: [
        {
          name: 'kit-stub',
          setup(pluginBuild) {
            pluginBuild.onResolve({ filter: /^@kit\./ }, () => ({ path: 'kit', namespace: 'kit-stub' }))
            pluginBuild.onLoad({ filter: /.*/, namespace: 'kit-stub' }, () => ({
              contents: kitStub,
              loader: 'ts'
            }))
          }
        }
      ]
    })
    writeFileSync(bundlePath, result.outputFiles[0].text, 'utf8')
  } finally {
    rmSync(entryPath, { force: true })
  }
  mod = (await import(`file://${bundlePath}`)) as SecureTransportModule
})

afterAll(() => {
  rmSync(bundlePath, { force: true })
})

function utf8(text: string): Uint8Array {
  return mod.utf8Encode(text)
}

function textOf(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Real-ish Noise stand-in: identity transform + authentic bigint frame counters. */
class FakeNoise {
  sendCounter = 0n
  receiveCounter = 0n
  decryptCalls = 0

  isComplete(): boolean {
    return true
  }

  sendingCounter(): bigint {
    return this.sendCounter
  }

  receivingCounter(): bigint {
    return this.receiveCounter
  }

  encrypt(plaintext: Uint8Array): Uint8Array {
    this.sendCounter += 1n
    return plaintext
  }

  decrypt(ciphertext: Uint8Array): Uint8Array {
    this.decryptCalls += 1
    this.receiveCounter += 1n
    return ciphertext
  }
}

class FakeInner implements FakeInnerLike {
  onMessage?: (data: Uint8Array) => void
  onMessageWithCounter?: (counter: number | undefined, data: Uint8Array) => void
  onHandshakeStep?: (step: number, data: Uint8Array) => void
  onClosed?: () => void
  sent: Uint8Array[] = []
  closeCalls = 0

  connect(): Promise<void> {
    return Promise.resolve()
  }

  send(data: Uint8Array): Promise<void> {
    this.sent.push(data)
    return Promise.resolve()
  }

  close(): void {
    this.closeCalls += 1
  }
}

class FakeLeg implements SequencedTransportLike {
  modeValue = 'P2P'
  sent: Array<{ counter: number; ciphertext: Uint8Array }> = []
  messageHandlers: Array<(counter: number, ciphertext: Uint8Array) => void> = []
  closeHandlers: Array<(error: Error | undefined) => void> = []
  closeCalls = 0

  mode(): string {
    return this.modeValue
  }

  selectedTransport(): string {
    return this.modeValue.toLowerCase()
  }

  sendSequenced(counter: number, ciphertext: Uint8Array): Promise<void> {
    this.sent.push({ counter, ciphertext })
    return Promise.resolve()
  }

  onSequencedMessage(cb: (counter: number, ciphertext: Uint8Array) => void): () => void {
    this.messageHandlers.push(cb)
    return () => {
      const index = this.messageHandlers.indexOf(cb)
      if (index >= 0) this.messageHandlers.splice(index, 1)
    }
  }

  onClose(cb: (error: Error | undefined) => void): () => void {
    this.closeHandlers.push(cb)
    return () => {
      const index = this.closeHandlers.indexOf(cb)
      if (index >= 0) this.closeHandlers.splice(index, 1)
    }
  }

  close(): Promise<void> {
    this.closeCalls += 1
    return Promise.resolve()
  }

  deliver(counter: number, ciphertext: Uint8Array): void {
    for (const handler of [...this.messageHandlers]) handler(counter, ciphertext)
  }

  emitClose(error?: Error): void {
    for (const handler of [...this.closeHandlers]) handler(error)
  }
}

const identity: IdentityLike = {
  deviceId: 'client-device',
  privateKey: 'client-private',
  publicKey: 'client-public'
}

const host: HostLike = {
  deviceId: 'host-device',
  identityKey: 'host-identity-key'
}

interface Harness {
  secure: SecureTransportLike
  inner: FakeInner
  noise: FakeNoise
  received: Uint8Array[]
  onClosedCalls: () => number
}

function makeHarness(): Harness {
  const inner = new FakeInner()
  const secure = new mod.SecureTransport(inner, identity, host, '')
  const noise = new FakeNoise()
  ;(secure as unknown as { noise?: FakeNoise }).noise = noise
  ;(secure as unknown as { closed?: boolean }).closed = false
  const received: Uint8Array[] = []
  let closedCalls = 0
  secure.onClosed = () => {
    closedCalls += 1
  }
  secure.setMessageHandler((data: Uint8Array) => {
    received.push(data)
  })
  return { secure, inner, noise, received, onClosedCalls: () => closedCalls }
}

describe('SecureTransport in-band upgrade', () => {
  it('decrypts counter-less frames through onMessageWithCounter (legacy path)', () => {
    const { secure, inner, received } = makeHarness()
    inner.onMessageWithCounter!(undefined, utf8('hello'))
    expect(received.map(textOf)).toEqual(['hello'])
    expect(secure.relayTrafficBytes()).toEqual({ sent: 0, received: 5 })
    expect((secure as unknown as { closed?: boolean }).closed).toBe(false)
  })

  it('buffers out-of-order inbound frames and delivers them in counter order', () => {
    const { secure, inner, received } = makeHarness()
    inner.onMessageWithCounter!(0, utf8('a'))
    inner.onMessageWithCounter!(2, utf8('c'))
    // expected counter is 1: counter 2 stays buffered, no delivery yet.
    expect(received.map(textOf)).toEqual(['a'])
    inner.onMessageWithCounter!(1, utf8('b'))
    expect(received.map(textOf)).toEqual(['a', 'b', 'c'])
    expect(secure.relayTrafficBytes().received).toBe(3)
  })

  it('merges relay and upgraded-leg frames into one ordered counter space', () => {
    const { secure, inner, received } = makeHarness()
    const leg = new FakeLeg()
    secure.attachIncomingLeg(leg)

    inner.onMessageWithCounter!(0, utf8('relay-0'))
    leg.deliver(2, utf8('leg-2'))
    expect(received.map(textOf)).toEqual(['relay-0'])

    inner.onMessageWithCounter!(1, utf8('relay-1'))
    expect(received.map(textOf)).toEqual(['relay-0', 'relay-1', 'leg-2'])

    leg.deliver(3, utf8('leg-3'))
    expect(received.map(textOf)).toEqual(['relay-0', 'relay-1', 'leg-2', 'leg-3'])
    // Only frames that arrive over the relay leg count as relay traffic.
    expect(secure.relayTrafficBytes().received).toBe('relay-0'.length + 'relay-1'.length)
  })

  it('returns the pre-switch watermark and routes later sends through the new leg', async () => {
    const { secure, inner, noise } = makeHarness()
    await secure.send(utf8('one'))
    expect(inner.sent).toHaveLength(1)
    expect(noise.sendCounter).toBe(1n)
    expect(secure.outboundCounter()).toBe(1)
    // Relay-path sends are counted for upgrade telemetry.
    expect(secure.relayTrafficBytes().sent).toBe(3)

    const legA = new FakeLeg()
    secure.attachIncomingLeg(legA)
    const watermark = await secure.switchOutboundLeg(legA, false)
    expect(watermark).toBe(1)

    await secure.send(utf8('two'))
    expect(inner.sent).toHaveLength(1)
    expect(legA.sent).toHaveLength(1)
    expect(legA.sent[0].counter).toBe(1)
    expect(textOf(legA.sent[0].ciphertext)).toBe('two')
    // Upgraded-leg sends are not relay traffic.
    expect(secure.relayTrafficBytes().sent).toBe(3)

    const legB = new FakeLeg()
    secure.attachIncomingLeg(legB)
    const secondWatermark = await secure.switchOutboundLeg(legB, true, 15)
    expect(secondWatermark).toBe(2)
    expect(legA.closeCalls).toBe(0)
    await delay(60)
    expect(legA.closeCalls).toBe(1)

    await secure.send(utf8('three'))
    expect(legB.sent).toHaveLength(1)
    expect(legB.sent[0].counter).toBe(2)
  })

  it('detaches a draining leg as soon as the inbound watermark reaches the Host end counter', async () => {
    const { secure, inner } = makeHarness()
    const legA = new FakeLeg()
    secure.attachIncomingLeg(legA)
    await secure.switchOutboundLeg(legA, false)
    const legB = new FakeLeg()
    secure.attachIncomingLeg(legB)
    await secure.switchOutboundLeg(legB, true, 20)
    expect(legA.closeCalls).toBe(0)

    // Host reports that its last old-leg frame is counter 0 (watermark 1).
    secure.markPreviousLegEndCounter(1)
    // Nothing received yet: the leg stays draining.
    expect(legA.closeCalls).toBe(0)

    inner.onMessageWithCounter!(0, utf8('tail'))
    expect(legA.closeCalls).toBe(1)
    // The fallback drain timer must have been cleared: no second detach.
    await delay(50)
    expect(legA.closeCalls).toBe(1)
  })

  it('fails closed on a duplicated counter', () => {
    const harness = makeHarness()
    harness.inner.onMessageWithCounter!(0, utf8('a'))
    expect(harness.onClosedCalls()).toBe(0)
    harness.inner.onMessageWithCounter!(0, utf8('a'))
    expect(harness.onClosedCalls()).toBe(1)
    expect((harness.secure as unknown as { closed?: boolean }).closed).toBe(true)
  })

  it('fails closed when the bounded reorder buffer overflows', () => {
    const harness = makeHarness()
    for (let counter = 1; counter <= 256; counter += 1) {
      harness.inner.onMessageWithCounter!(counter, utf8('x'))
    }
    expect(harness.onClosedCalls()).toBe(0)
    harness.inner.onMessageWithCounter!(257, utf8('x'))
    expect(harness.onClosedCalls()).toBe(1)
    expect((harness.secure as unknown as { closed?: boolean }).closed).toBe(true)
  })

  it('fails closed when the active upgraded leg closes', async () => {
    const harness = makeHarness()
    const leg = new FakeLeg()
    harness.secure.attachIncomingLeg(leg)
    await harness.secure.switchOutboundLeg(leg, false)
    leg.emitClose(new Error('datachannel closed'))
    await delay(0)
    expect(harness.onClosedCalls()).toBe(1)
    expect(leg.closeCalls).toBe(1)
  })

  it('closes idempotently, notifies once, and closes every attached leg', async () => {
    const harness = makeHarness()
    const legA = new FakeLeg()
    const legB = new FakeLeg()
    harness.secure.attachIncomingLeg(legA)
    harness.secure.attachIncomingLeg(legB)
    await harness.secure.switchOutboundLeg(legB, false)

    await harness.secure.close()
    await harness.secure.close()

    expect(legA.closeCalls).toBe(1)
    expect(legB.closeCalls).toBe(1)
    expect(harness.inner.closeCalls).toBe(1)
    expect(harness.onClosedCalls()).toBe(1)
  })
})

class FakeBridge {
  readyCalls = 0

  isReady(): boolean {
    this.readyCalls += 1
    return false
  }
}

function makeRelay(relayFirst: boolean, bridge: FakeBridge): RelayTransportLike {
  const options = new mod.RelayTransportOptions()
  options.deviceId = 'client-device'
  options.accessToken = 'token'
  options.targetDeviceId = 'host-device'
  options.relayFirst = relayFirst
  options.rtc = bridge
  return new mod.RelayTransport('ws://relay.invalid/ws/v1/connect', options)
}

interface ConnectAcceptedFrame {
  payload: Record<string, object>
}

describe('RelayTransport relay-first data path', () => {
  it('skips the direct RTC attempt when relayFirst is enabled', () => {
    const bridge = new FakeBridge()
    const relay = makeRelay(true, bridge)
    ;(relay as unknown as { handleConnectAccepted(frame: ConnectAcceptedFrame): void })
      .handleConnectAccepted({ payload: { connectionId: 'conn-1' } })
    expect(bridge.readyCalls).toBe(0)
    expect(relay.isAuthorized()).toBe(true)
    expect(relay.transportKind()).toBe('relay')
  })

  it('still attempts the direct RTC link when relayFirst is disabled', () => {
    const bridge = new FakeBridge()
    const relay = makeRelay(false, bridge)
    ;(relay as unknown as { handleConnectAccepted(frame: ConnectAcceptedFrame): void })
      .handleConnectAccepted({ payload: { connectionId: 'conn-1' } })
    expect(bridge.readyCalls).toBe(1)
    expect(relay.transportKind()).toBe('relay')
  })

  it('forwards the relay wire counter through onMessageWithCounter', () => {
    const relay = makeRelay(true, new FakeBridge())
    ;(relay as unknown as { connectionId?: string }).connectionId = 'conn-1'
    const seen: Array<{ counter: number | undefined; data: Uint8Array }> = []
    const legacy: Uint8Array[] = []
    relay.onMessageWithCounter = (counter, data) => {
      seen.push({ counter, data })
    }
    relay.onMessage = (data) => {
      legacy.push(data)
    }
    const handleRelayPayload = (payload: Record<string, object>): void => {
      ;(relay as unknown as { handleRelayPayload(p: Record<string, object>): void })
        .handleRelayPayload(payload)
    }

    handleRelayPayload({
      connectionId: 'conn-1',
      targetDeviceId: 'client-device',
      counter: 7,
      ciphertext: mod.toBase64Url(utf8('counted'))
    })
    expect(seen).toHaveLength(1)
    expect(seen[0].counter).toBe(7)
    expect(textOf(seen[0].data)).toBe('counted')
    // onMessageWithCounter wins; the legacy callback must not fire.
    expect(legacy).toHaveLength(0)

    // Hosts without the unified wire counter (or counter < 0) yield undefined.
    handleRelayPayload({
      connectionId: 'conn-1',
      targetDeviceId: 'client-device',
      ciphertext: mod.toBase64Url(utf8('uncounted'))
    })
    expect(seen).toHaveLength(2)
    expect(seen[1].counter).toBeUndefined()
    expect(textOf(seen[1].data)).toBe('uncounted')
  })

  it('falls back to the legacy onMessage callback when no counter subscriber exists', () => {
    const relay = makeRelay(true, new FakeBridge())
    ;(relay as unknown as { connectionId?: string }).connectionId = 'conn-1'
    const legacy: Uint8Array[] = []
    relay.onMessage = (data) => {
      legacy.push(data)
    }
    ;(relay as unknown as { handleRelayPayload(p: Record<string, object>): void })
      .handleRelayPayload({
        connectionId: 'conn-1',
        targetDeviceId: 'client-device',
        counter: 0,
        ciphertext: mod.toBase64Url(utf8('legacy'))
      })
    expect(legacy.map(textOf)).toEqual(['legacy'])
  })
})
