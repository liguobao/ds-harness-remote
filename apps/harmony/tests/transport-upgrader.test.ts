/**
 * Conformance tests for the HarmonyOS in-band transport upgrader
 * (`remote.transport.upgrade.v1`, spec module C).
 *
 * The ArkTS sources cannot be imported by Node directly, so esbuild bundles
 * `net/TransportUpgrader.ets` with every `@kit.*` module replaced by a small stub.
 * The real state machine — offer/ICE/activate/drain/abort ordering, Bounded ICE
 * buffering, telemetry outcomes, cleanup of RtcBridge callbacks — is the code that
 * ships in the HAP. Only the platform boundaries (RPC, SecureTransport, ArkWeb
 * bridge) are faked with duck-typed objects.
 */
import { build } from 'esbuild'
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const etsRoot = join(here, '..', 'entry', 'src', 'main', 'ets')
const bundlePath = join(here, '.transport-upgrader-bundle.mjs')

// RtcBridge needs @kit.ArkWeb, Log needs @kit.PerformanceAnalysisKit, crypto helpers
// need @kit.CryptoArchitectureKit, and the SecureTransport import chain needs
// @kit.NetworkKit. All of them are irrelevant to the state machine under test.
const kitStub = `
export const webview = {
  WebviewController: class {
    runJavaScript(): void {}
  }
}
export const webSocket = {}
export const cryptoFramework = {
  createRandom: () => ({
    generateRandomSync: (len: number) => ({ data: new Uint8Array(len) })
  })
}
export const hilog = { info: () => undefined, warn: () => undefined, error: () => undefined }
`

interface UpgraderModule {
  TransportUpgrader: new (options: any) => any
  TransportUpgraderOptions: new (rpc: any, channel: any, rtc: any) => any
  TransportUpgradeTelemetry: new () => any
  UpgradedRtcLeg: new (rtc: any, mode: string) => any
}

let mod!: UpgraderModule

beforeAll(async () => {
  const entry = `
export {
  TransportUpgrader,
  TransportUpgraderOptions,
  TransportUpgradeTelemetry,
  UpgradedRtcLeg
} from ${JSON.stringify(join(etsRoot, 'net', 'TransportUpgrader.ets'))}
`
  const entryPath = join(here, '.transport-upgrader-entry.ts')
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
  mod = (await import(`file://${bundlePath}`)) as UpgraderModule
})

afterAll(() => {
  rmSync(bundlePath, { force: true })
})

// ---------------------------------------------------------------- test doubles

interface RpcCall {
  method: string
  params: Record<string, any>
}

class FakeRpc {
  calls: RpcCall[] = []
  handlers = new Map<string, (params: Record<string, any>) => any>()
  eventHandlers: Array<(event: any) => void> = []
  private readonly order: string[]

  constructor(order: string[]) {
    this.order = order
  }

  onEvent(cb: (event: any) => void): () => void {
    this.eventHandlers.push(cb)
    return () => {
      this.eventHandlers = this.eventHandlers.filter((entry) => entry !== cb)
    }
  }

  onClose(): () => void {
    return () => undefined
  }

  async rpc(method: string, params: Record<string, any>, _timeoutMs?: number, _traceLabel?: string): Promise<any> {
    this.calls.push({ method, params })
    this.order.push('rpc:' + method)
    const handler = this.handlers.get(method)
    if (handler === undefined) {
      if (method === 'remote.transport.upgrade.abort'
        || method === 'remote.transport.upgrade.ice'
        || method === 'remote.transport.upgrade.drain') {
        return { ok: true }
      }
      throw new Error('unexpected rpc ' + method)
    }
    return await handler(params)
  }

  callsOf(method: string): RpcCall[] {
    return this.calls.filter((call) => call.method === method)
  }

  emitEvent(event: any): void {
    for (const handler of this.eventHandlers.slice()) {
      handler(event)
    }
  }
}

class FakeChannel {
  readonly order: string[]
  attachCalls: any[] = []
  detachCalls: any[] = []
  switchCalls: Array<{ leg: any; closePrevious: boolean; drainMs: number | undefined }> = []
  markCalls: number[] = []
  switchReturn = 7
  relaySent = 120
  relayReceived = 340

  constructor(order: string[]) {
    this.order = order
  }

  outboundCounter(): number {
    return 0
  }

  attachIncomingLeg(leg: any): void {
    this.attachCalls.push(leg)
    this.order.push('attachIncomingLeg')
  }

  markPreviousLegEndCounter(previousLegEndCounter: number): void {
    this.markCalls.push(previousLegEndCounter)
    this.order.push('markPreviousLegEndCounter')
  }

  async switchOutboundLeg(leg: any, closePrevious: boolean, drainMs?: number): Promise<number> {
    this.switchCalls.push({ leg, closePrevious, drainMs })
    this.order.push('switchOutboundLeg')
    return this.switchReturn
  }

  async detachLeg(leg: any): Promise<void> {
    this.detachCalls.push(leg)
    this.order.push('detachLeg')
  }

  relayTrafficBytes(): { sent: number; received: number } {
    return { sent: this.relaySent, received: this.relayReceived }
  }
}

class FakeBridge {
  readonly order: string[]
  beginOfferCalls: string[] = []
  answers: string[] = []
  remoteIce: string[] = []
  sent: string[] = []
  closeAllCount = 0
  beginOfferReady = true
  auto = false
  detectedMode = 'p2p'

  onLocalSdp: ((description: string) => void) | undefined = undefined
  onIce: ((candidateJson: string) => void) | undefined = undefined
  onDataOpen: (() => void) | undefined = undefined
  onDataBinary: ((base64: string) => void) | undefined = undefined
  onDataClosed: (() => void) | undefined = undefined
  onPath: ((text: string) => void) | undefined = undefined
  onError: ((message: string) => void) | undefined = undefined
  onTransport: ((kind: string) => void) | undefined = undefined

  constructor(order: string[]) {
    this.order = order
  }

  isReady(): boolean {
    return true
  }

  markReady(): void {
    return
  }

  beginOffer(iceServersJson: string): boolean {
    this.beginOfferCalls.push(iceServersJson)
    this.order.push('beginOffer')
    if (this.auto) {
      queueMicrotask(() => {
        this.onLocalSdp?.('v=0 auto-offer')
      })
    }
    return this.beginOfferReady
  }

  applyAnswer(sdpJson: string): void {
    this.answers.push(sdpJson)
    this.order.push('applyAnswer')
    if (this.auto) {
      queueMicrotask(() => {
        this.onTransport?.(this.detectedMode)
        this.onDataOpen?.()
      })
    }
  }

  addRemoteIce(candidateJson: string): void {
    this.remoteIce.push(candidateJson)
  }

  send(base64: string): void {
    this.sent.push(base64)
  }

  closeAll(): void {
    this.closeAllCount += 1
  }

  callbacksUndefined(): boolean {
    return this.onLocalSdp === undefined
      && this.onIce === undefined
      && this.onDataOpen === undefined
      && this.onDataBinary === undefined
      && this.onDataClosed === undefined
      && this.onPath === undefined
      && this.onError === undefined
      && this.onTransport === undefined
  }
}

interface Context {
  order: string[]
  rpc: FakeRpc
  channel: FakeChannel
  bridge: FakeBridge
  telemetry: any[]
  upgraded: string[]
  upgrader: any
}

function createContext(): Context {
  const order: string[] = []
  const rpc = new FakeRpc(order)
  const channel = new FakeChannel(order)
  const bridge = new FakeBridge(order)
  const telemetry: any[] = []
  const upgraded: string[] = []
  const options = new mod.TransportUpgraderOptions(rpc, channel, bridge)
  options.connectionId = 'conn-harmony-upgrade'
  options.fetchIceServers = async (): Promise<string> => '[]'
  options.iceServersTimeoutMs = 200
  options.negotiateTimeoutMs = 300
  options.onUpgraded = (mode: string): void => {
    upgraded.push(mode)
  }
  options.onTelemetry = (entry: any): void => {
    telemetry.push(entry)
  }
  const upgrader = new mod.TransportUpgrader(options)
  return { order, rpc, channel, bridge, telemetry, upgraded, upgrader }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out')
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/**
 * Drive one attempt up to the DataChannel-open point: wait for the bridge to open
 * the offer, feed the local SDP back, wait for applyAnswer, then report the selected
 * path and the open event. Returns the promote() promise for the caller to await.
 */
async function startAttempt(ctx: Context, detectedMode: string): Promise<Promise<boolean>> {
  const offersBefore = ctx.bridge.beginOfferCalls.length
  const answersBefore = ctx.bridge.answers.length
  const promoted = ctx.upgrader.promote(false)
  await waitFor(() => ctx.bridge.beginOfferCalls.length === offersBefore + 1)
  ctx.bridge.onLocalSdp?.('v=0 test-offer')
  await waitFor(() => ctx.bridge.answers.length === answersBefore + 1)
  ctx.bridge.onTransport?.(detectedMode)
  ctx.bridge.onDataOpen?.()
  return promoted
}

// ---------------------------------------------------------------- scenarios

describe('TransportUpgrader', () => {
  let ctx: Context

  beforeEach(() => {
    ctx = createContext()
  })

  it('upgrades Relay -> P2P: attach before activate, then switch and drain the old-leg watermark', async () => {
    ctx.rpc.handlers.set('remote.transport.upgrade.offer', () => ({ sdp: 'v=0 answer' }))
    ctx.rpc.handlers.set('remote.transport.upgrade.activate',
      () => ({ activated: true, mode: 'P2P', previousLegEndCounter: 41 }))

    const promoted = await startAttempt(ctx, 'p2p')
    expect(await promoted).toBe(true)
    await flush()

    // Ordering invariant: inbound leg attached before the Host is asked to switch.
    const attachIndex = ctx.order.indexOf('attachIncomingLeg')
    const activateIndex = ctx.order.indexOf('rpc:remote.transport.upgrade.activate')
    const switchIndex = ctx.order.indexOf('switchOutboundLeg')
    const drainIndex = ctx.order.indexOf('rpc:remote.transport.upgrade.drain')
    expect(attachIndex).toBeGreaterThan(-1)
    expect(activateIndex).toBeGreaterThan(attachIndex)
    expect(switchIndex).toBeGreaterThan(activateIndex)
    expect(drainIndex).toBeGreaterThan(switchIndex)

    // drain carries the counter returned by switchOutboundLeg, on the new leg.
    const drainCalls = ctx.rpc.callsOf('remote.transport.upgrade.drain')
    expect(drainCalls).toHaveLength(1)
    expect(drainCalls[0].params.previousLegEndCounter).toBe(ctx.channel.switchReturn)
    // Host watermark for the retired inbound leg is applied after the switch.
    expect(ctx.channel.markCalls).toEqual([41])
    expect(ctx.channel.markCalls).toHaveLength(1)

    // Switch hands the attached leg over with closePrevious=true.
    expect(ctx.channel.switchCalls).toHaveLength(1)
    expect(ctx.channel.switchCalls[0].leg).toBe(ctx.channel.attachCalls[0])
    expect(ctx.channel.switchCalls[0].closePrevious).toBe(true)

    expect(ctx.upgrader.currentMode()).toBe('P2P')
    expect(ctx.upgraded).toEqual(['p2p'])

    const last = ctx.telemetry[ctx.telemetry.length - 1]
    expect(last.outcome).toBe('activated')
    expect(last.from).toBe('Relay')
    expect(last.to).toBe('P2P')
    expect(last.durationMs).toBeGreaterThanOrEqual(0)
    expect(last.relaySentBytes).toBe(ctx.channel.relaySent)
    expect(last.relayReceivedBytes).toBe(ctx.channel.relayReceived)

    await ctx.upgrader.close()
  })

  it('aborts without activating when the Host-verified tier is not higher (TURN <= P2P)', async () => {
    ctx.rpc.handlers.set('remote.transport.upgrade.offer', () => ({ sdp: 'v=0 answer' }))
    let activateCalls = 0
    ctx.rpc.handlers.set('remote.transport.upgrade.activate', () => {
      activateCalls += 1
      return { activated: true, mode: 'P2P' }
    })

    // First hop: Relay -> P2P.
    const first = await startAttempt(ctx, 'p2p')
    expect(await first).toBe(true)
    await flush()
    expect(activateCalls).toBe(1)
    expect(ctx.upgrader.currentMode()).toBe('P2P')

    // Second hop: bridge reports TURN, which is rank 1 <= current P2P -> give up.
    const second = await startAttempt(ctx, 'turn')
    expect(await second).toBe(false)
    await flush()

    expect(activateCalls).toBe(1)
    expect(ctx.rpc.callsOf('remote.transport.upgrade.abort').length).toBeGreaterThanOrEqual(1)
    expect(ctx.upgrader.currentMode()).toBe('P2P')
    const last = ctx.telemetry[ctx.telemetry.length - 1]
    expect(last.outcome).toBe('skipped-not-higher')
    expect(last.to).toBe('TURN')
    expect(ctx.bridge.callbacksUndefined()).toBe(true)

    await ctx.upgrader.close()
  })

  it('detaches the inbound leg and reports rejected when activate answers activated=false', async () => {
    ctx.rpc.handlers.set('remote.transport.upgrade.offer', () => ({ sdp: 'v=0 answer' }))
    ctx.rpc.handlers.set('remote.transport.upgrade.activate', () => ({ activated: false, mode: 'P2P' }))

    const promoted = await startAttempt(ctx, 'p2p')
    expect(await promoted).toBe(false)
    await flush()

    expect(ctx.channel.detachCalls).toHaveLength(1)
    expect(ctx.channel.detachCalls[0]).toBe(ctx.channel.attachCalls[0])
    expect(ctx.channel.switchCalls).toHaveLength(0)
    expect(ctx.rpc.callsOf('remote.transport.upgrade.drain')).toHaveLength(0)
    expect(ctx.upgrader.currentMode()).toBe('Relay')
    expect(ctx.telemetry[ctx.telemetry.length - 1].outcome).toBe('rejected')
    expect(ctx.bridge.callbacksUndefined()).toBe(true)

    await ctx.upgrader.close()
  })

  it('aborts and closes the peer when the offer RPC fails, reporting failed', async () => {
    ctx.rpc.handlers.set('remote.transport.upgrade.offer', () => {
      throw new Error('host rejected the upgrade offer')
    })

    const offersBefore = ctx.bridge.beginOfferCalls.length
    const promoted = ctx.upgrader.promote(false)
    await waitFor(() => ctx.bridge.beginOfferCalls.length === offersBefore + 1)
    ctx.bridge.onLocalSdp?.('v=0 test-offer')
    expect(await promoted).toBe(false)
    await flush()

    expect(ctx.rpc.callsOf('remote.transport.upgrade.abort').length).toBe(1)
    expect(ctx.rpc.callsOf('remote.transport.upgrade.activate')).toHaveLength(0)
    expect(ctx.bridge.closeAllCount).toBeGreaterThanOrEqual(1)
    const last = ctx.telemetry[ctx.telemetry.length - 1]
    expect(last.outcome).toBe('failed')
    expect(last.reason).toBe('Error')
    expect(ctx.bridge.callbacksUndefined()).toBe(true)

    await ctx.upgrader.close()
  })

  it('buffers remote ICE until the answer is applied, then forwards it; ignores stale attempts', async () => {
    let resolveOffer: ((value: any) => void) | undefined = undefined
    const offerGate = new Promise((resolve) => {
      resolveOffer = resolve
    })
    ctx.rpc.handlers.set('remote.transport.upgrade.offer', async () => {
      const params = await offerGate
      return { sdp: 'v=0 answer' }
    })
    ctx.rpc.handlers.set('remote.transport.upgrade.activate', () => ({ activated: true, mode: 'P2P' }))

    const offersBefore = ctx.bridge.beginOfferCalls.length
    const promoted = ctx.upgrader.promote(false)
    await waitFor(() => ctx.bridge.beginOfferCalls.length === offersBefore + 1)
    ctx.bridge.onLocalSdp?.('v=0 test-offer')
    // The offer RPC is now blocked, so remoteDescReady is still false.
    await waitFor(() => ctx.rpc.callsOf('remote.transport.upgrade.offer').length === 1)
    const attemptId = ctx.rpc.callsOf('remote.transport.upgrade.offer')[0].params.attemptId as string
    expect(typeof attemptId).toBe('string')

    // Stale attempt events are ignored outright.
    ctx.rpc.emitEvent({
      event: 'remote.transport.upgrade.ice',
      data: { attemptId: 'upg_stale_attempt', candidate: { candidate: 'candidate-stale' } }
    })
    // Current attempt, but before applyAnswer: buffered, not applied yet.
    ctx.rpc.emitEvent({
      event: 'remote.transport.upgrade.ice',
      data: { attemptId, candidate: { candidate: 'candidate-buffered' } }
    })
    expect(ctx.bridge.remoteIce).toHaveLength(0)

    // Apply the answer; the buffered remote candidate is flushed afterwards.
    resolveOffer?.({ sdp: 'v=0 answer' })
    await waitFor(() => ctx.bridge.answers.length >= 1)
    await waitFor(() => ctx.bridge.remoteIce.length === 1)
    expect(ctx.bridge.remoteIce[0]).toContain('candidate-buffered')

    // After applyAnswer, late ICE is forwarded directly.
    ctx.rpc.emitEvent({
      event: 'remote.transport.upgrade.ice',
      data: { attemptId, candidate: { candidate: 'candidate-late' } }
    })
    await waitFor(() => ctx.bridge.remoteIce.length === 2)
    expect(ctx.bridge.remoteIce[1]).toContain('candidate-late')

    ctx.bridge.onTransport?.('p2p')
    ctx.bridge.onDataOpen?.()
    expect(await promoted).toBe(true)
    await ctx.upgrader.close()
  })

  it('waitForInitialWindow resolves true when the promotion finishes inside the window', async () => {
    ctx.bridge.auto = true
    ctx.rpc.handlers.set('remote.transport.upgrade.offer', () => ({ sdp: 'v=0 answer' }))
    ctx.rpc.handlers.set('remote.transport.upgrade.activate', () => ({ activated: true, mode: 'P2P' }))

    const result = await ctx.upgrader.waitForInitialWindow(1000)
    expect(result).toBe(true)
    expect(ctx.upgrader.currentMode()).toBe('P2P')
    await ctx.upgrader.close()
  })

  it('waitForInitialWindow resolves false when the promotion is still in flight; windowMs<=0 is false', async () => {
    // No auto bridge: negotiation stays stuck on the offer, so the window must expire.
    const result = await ctx.upgrader.waitForInitialWindow(30)
    expect(result).toBe(false)
    expect(ctx.upgrader.currentMode()).toBe('Relay')

    const zero = await ctx.upgrader.waitForInitialWindow(0)
    expect(zero).toBe(false)

    await ctx.upgrader.close()
    await flush()
    const last = ctx.telemetry[ctx.telemetry.length - 1]
    expect(last.outcome).toBe('aborted')
  })

  it('close() is idempotent and clears every RtcBridge callback it installed', async () => {
    ctx.rpc.handlers.set('remote.transport.upgrade.offer', () => ({ sdp: 'v=0 answer' }))
    const offersBefore = ctx.bridge.beginOfferCalls.length
    const promoted = ctx.upgrader.promote(false)
    await waitFor(() => ctx.bridge.beginOfferCalls.length === offersBefore + 1)
    // Negotiation callbacks are installed while the attempt is in flight.
    expect(ctx.bridge.onLocalSdp).toBeTypeOf('function')
    expect(ctx.bridge.onDataBinary).toBeTypeOf('function')

    await ctx.upgrader.close()
    expect(ctx.bridge.callbacksUndefined()).toBe(true)
    expect(ctx.bridge.closeAllCount).toBeGreaterThanOrEqual(1)
    await ctx.upgrader.close()
    expect(ctx.bridge.callbacksUndefined()).toBe(true)
    expect(await promoted).toBe(false)
    await flush()
  })

  it('UpgradedRtcLeg wraps DSHU frames, unwraps inbound frames and closes once', async () => {
    const bridge = new FakeBridge([])
    const leg = new mod.UpgradedRtcLeg(bridge, 'p2p')
    const received: Array<{ counter: number; ciphertext: Uint8Array }> = []
    leg.onSequencedMessage((counter: number, ciphertext: Uint8Array) => {
      received.push({ counter, ciphertext })
    })
    let closeError: Error | undefined = undefined
    leg.onClose((error?: Error) => {
      closeError = error
    })

    await leg.sendSequenced(5, new Uint8Array([1, 2, 3]))
    expect(bridge.sent).toHaveLength(1)
    const frame = new Uint8Array(Buffer.from(bridge.sent[0], 'base64url'))
    expect(frame).toHaveLength(12 + 3)
    expect(String.fromCharCode(frame[0], frame[1], frame[2], frame[3])).toBe('DSHU')
    expect(frame[11]).toBe(5)

    leg.deliver(bridge.sent[0])
    expect(received).toHaveLength(1)
    expect(received[0].counter).toBe(5)
    expect(Array.from(received[0].ciphertext)).toEqual([1, 2, 3])

    // A frame that is not a valid DSHU frame fails the leg exactly once.
    leg.deliver(Buffer.from('not-a-dshu-frame').toString('base64url'))
    expect(closeError).toBeInstanceOf(Error)
    const closesBefore = bridge.closeAllCount
    await leg.close()
    expect(bridge.closeAllCount).toBe(closesBefore)
  })
})
