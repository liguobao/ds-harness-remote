import { NoiseIkSession, createNoisePrologue } from '@dsh-remote/crypto'
import type { UpgradeableSecureChannel } from '@dsh-remote/client-core'
import {
  DEFAULT_PREVIOUS_LEG_DRAIN_MS,
  SecureMessageCodec,
  SequencedCiphertextReorderBuffer,
  type TransportStats,
} from '@dsh-remote/protocol'
import {
  isSequencedOutboundTransport,
  type RemoteTransport,
  type SecureHandshakeTransport,
  type SequencedOutboundTransport,
} from '@dsh-remote/webrtc'
import { connectionLog } from './connection-log'
import { strings } from '../locales/i18n'
import { nativeChaChaEncryptor } from './native-chacha-poly'
import type { DeviceIdentity, RemoteDevice } from '../types'

interface AttachedLeg {
  readonly leg: SequencedOutboundTransport
  readonly unsubscribeMsg: () => void
  readonly unsubscribeClose: () => void
}

interface DrainingLeg {
  readonly leg: SequencedOutboundTransport
  endCounter?: number
  readonly timer: ReturnType<typeof setTimeout>
}

export class SecureTransport implements RemoteTransport, UpgradeableSecureChannel {
  private noise?: NoiseIkSession
  private activeOutbound?: RemoteTransport
  private relayBytesSent = 0
  private relayBytesReceived = 0
  private unsubscribeInner?: () => void
  private unsubscribeInnerClose?: () => void
  private messageCb?: (data: Uint8Array) => void
  private readonly closeHandlers = new Set<(error?: Error) => void>()
  private readonly attachedLegs = new Map<SequencedOutboundTransport, AttachedLeg>()
  private readonly drainingLegs = new Map<SequencedOutboundTransport, DrainingLeg>()
  private readonly reorderBuffer: SequencedCiphertextReorderBuffer
  private readonly incoming = new SecureMessageCodec()
  private readonly outgoing = new SecureMessageCodec()
  private closed = false
  /** Noise + SecureMessageCodec counters are not re-entrant; serialize sends. */
  private sendTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly inner: SecureHandshakeTransport,
    private readonly identity: DeviceIdentity,
    private readonly host: RemoteDevice,
    private readonly onHandshakeStarting?: () => void,
    reorderOptions?: { maxFrames?: number; maxBytes?: number; gapTimeoutMs?: number },
  ) {
    if (host.identityKey.length === 0) throw new Error(strings.runtime.hostMissingKey)
    this.reorderBuffer = new SequencedCiphertextReorderBuffer({
      ...reorderOptions,
      onGapTimeout: () => {
        connectionLog('secure-receive-failed', { stage: 'reorder-gap-timeout', errorName: 'TimeoutError' })
        void this.failAndClose(new Error('Secure channel reorder gap timed out.'))
      },
    })
  }

  get outboundCounter(): number { return this.noise ? Number(this.noise.sendingCounter()) : 0 }

  relayTrafficBytes(): { sent: number; received: number } {
    return { sent: this.relayBytesSent, received: this.relayBytesReceived }
  }

  async connect(): Promise<void> {
    this.closed = false
    this.relayBytesSent = 0
    this.relayBytesReceived = 0
    this.activeOutbound = this.inner
    this.reorderBuffer.clear()
    this.incoming.reset()
    this.outgoing.reset()
    await this.inner.connect()
    const info = this.inner.connectionInfo()
    if (info.localDeviceId !== this.identity.deviceId || info.remoteDeviceId !== this.host.deviceId) {
      await this.inner.close()
      throw new Error(strings.runtime.unexpectedRelayDevice)
    }
    connectionLog('handshake', { phase: 'starting' })
    this.onHandshakeStarting?.()
    const noise = new NoiseIkSession({
      role: 'initiator',
      encryptChaChaPoly: nativeChaChaEncryptor(),
      localPrivateKey: this.identity.privateKey,
      localPublicKey: this.identity.publicKey,
      remotePublicKey: this.host.identityKey,
      prologue: createNoisePrologue(info.connectionId, this.host.deviceId, this.identity.deviceId),
    })
    this.noise = noise
    try {
      await waitForResponder(this.inner, noise)
      this.inner.markSecureReady?.()
      connectionLog('handshake', { phase: 'ready' })
    } catch (error) {
      noise.destroy()
      this.noise = undefined
      await this.inner.close()
      throw error
    }
    this.unsubscribeInnerClose = this.inner.onClose?.(err => {
      void this.failAndClose(err ?? new Error('Control transport closed.'))
    })
  }

  markPreviousLegEndCounter(previousLegEndCounter: number): void {
    for (const [draining, entry] of this.drainingLegs) {
      entry.endCounter = previousLegEndCounter
      if (this.noise !== undefined && Number(this.noise.receivingCounter()) >= previousLegEndCounter) {
        clearTimeout(entry.timer)
        this.drainingLegs.delete(draining)
        void this.detachLeg(draining)
      }
    }
  }

  attachIncomingLeg(leg: SequencedOutboundTransport): void {
    if (this.closed || this.attachedLegs.has(leg)) return
    const unsubscribeMsg = leg.onSequencedMessage((counter, ciphertext) => {
      this.handleIncomingCiphertext(counter, ciphertext)
    })
    const unsubscribeClose = leg.onClose?.(err => {
      if (this.activeOutbound === leg && !this.closed) {
        void this.failAndClose(err ?? new Error('Upgraded WebRTC DataChannel closed.'))
      }
    }) ?? (() => undefined)
    this.attachedLegs.set(leg, { leg, unsubscribeMsg, unsubscribeClose })
  }

  async switchOutboundLeg(
    leg: SequencedOutboundTransport,
    options: { closePrevious?: boolean; drainMs?: number } = {},
  ): Promise<number> {
    const run = this.sendTail.then(async () => {
      if (this.closed) {
        await this.detachLeg(leg)
        return this.outboundCounter
      }
      const prev = this.activeOutbound
      this.activeOutbound = leg
      const endCounter = this.outboundCounter
      if (options.closePrevious && prev !== undefined && prev !== leg && prev !== this.inner && isSequencedOutboundTransport(prev)) {
        const drainMs = options.drainMs ?? DEFAULT_PREVIOUS_LEG_DRAIN_MS
        const timer = setTimeout(() => {
          this.drainingLegs.delete(prev)
          void this.detachLeg(prev)
        }, drainMs)
        ;(timer as { unref?: () => void }).unref?.()
        this.drainingLegs.set(prev, { leg: prev, timer })
      }
      return endCounter
    })
    this.sendTail = run.then(() => undefined, () => undefined)
    return run
  }

  async detachLeg(leg: SequencedOutboundTransport): Promise<void> {
    const draining = this.drainingLegs.get(leg)
    if (draining !== undefined) {
      clearTimeout(draining.timer)
      this.drainingLegs.delete(leg)
    }
    const attached = this.attachedLegs.get(leg)
    if (attached !== undefined) {
      this.attachedLegs.delete(leg)
      attached.unsubscribeMsg()
      attached.unsubscribeClose()
    }
    await leg.close().catch(() => undefined)
  }

  async send(data: Uint8Array): Promise<void> {
    const run = this.sendTail.then(() => this.sendNow(data))
    this.sendTail = run.catch(() => undefined)
    return run
  }

  private async sendNow(data: Uint8Array): Promise<void> {
    const plaintextFrames = this.outgoing.encode(data)
    try {
      for (const plaintext of plaintextFrames) {
        const noise = this.requireNoise()
        const ciphertext = noise.encrypt(plaintext)
        const counter = Number(noise.sendingCounter() - 1n)
        const target = this.activeOutbound ?? this.inner
        if (isSequencedOutboundTransport(target)) {
          await target.sendSequenced(counter, ciphertext)
        } else {
          this.relayBytesSent += ciphertext.byteLength
          await target.send(ciphertext)
        }
      }
    } catch (error) {
      connectionLog('secure-send-failed')
      await this.failAndClose(error instanceof Error ? error : new Error('Secure send failed.')).catch(() => undefined)
      throw error
    }
  }

  onMessage(cb: (data: Uint8Array) => void): () => void {
    this.messageCb = cb
    this.unsubscribeInner?.()
    this.unsubscribeInner = this.inner.onSequencedMessage
      ? this.inner.onSequencedMessage((counter, data) => {
          this.relayBytesReceived += data.byteLength
          this.handleIncomingCiphertext(counter, data)
        })
      : this.inner.onMessage(data => {
          this.relayBytesReceived += data.byteLength
          this.handleIncomingCiphertext(undefined, data)
        })
    return () => {
      if (this.messageCb === cb) this.messageCb = undefined
      this.unsubscribeInner?.()
      this.unsubscribeInner = undefined
    }
  }

  private handleIncomingCiphertext(counter: number | undefined, ciphertext: Uint8Array): void {
    const noise = this.noise
    if (noise === undefined || !noise.complete || this.closed) return
    let stage = 'decrypt'
    try {
      if (counter !== undefined) {
        const expected = Number(noise.receivingCounter())
        if (!Number.isSafeInteger(counter) || counter < expected) {
          throw new Error('Ciphertext counter is duplicated or out of order.')
        }
        if (counter > expected) {
          this.reorderBuffer.push(counter, expected, ciphertext)
          return
        }
      }
      this.decryptAndDeliver(noise, ciphertext, s => { stage = s })
      while (!this.closed) {
        const nextExpected = Number(noise.receivingCounter())
        const buffered = this.reorderBuffer.takeNext(nextExpected)
        if (buffered === undefined) break
        stage = 'decrypt'
        this.decryptAndDeliver(noise, buffered, s => { stage = s })
      }
    } catch (error) {
      const name = error instanceof Error
        && ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'ZodError'].includes(error.name)
        ? error.name : 'unknown'
      connectionLog('secure-receive-failed', { stage, errorName: name })
      void this.failAndClose(error instanceof Error ? error : new Error('Secure receive failed.'))
    }
  }

  private decryptAndDeliver(noise: NoiseIkSession, ciphertext: Uint8Array, setStage: (s: string) => void): void {
    const plaintext = noise.decrypt(ciphertext)
    const currentReceiving = Number(noise.receivingCounter())
    this.reorderBuffer.onExpectedAdvanced(currentReceiving)
    for (const [leg, draining] of this.drainingLegs) {
      if (draining.endCounter !== undefined && currentReceiving >= draining.endCounter) {
        clearTimeout(draining.timer)
        this.drainingLegs.delete(leg)
        void this.detachLeg(leg)
      }
    }
    setStage('reassembly')
    const message = this.incoming.decode(plaintext)
    if (message !== undefined && this.messageCb !== undefined) {
      setStage('message-handler')
      this.messageCb(message)
    }
  }

  onClose(cb: (error?: Error) => void): () => void {
    this.closeHandlers.add(cb)
    return () => this.closeHandlers.delete(cb)
  }

  private async failAndClose(error?: Error): Promise<void> {
    const wasClosed = this.closed
    await this.close()
    if (!wasClosed) {
      for (const cb of this.closeHandlers) cb(error)
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.reorderBuffer.clear()
    this.unsubscribeInner?.()
    this.unsubscribeInner = undefined
    this.unsubscribeInnerClose?.()
    this.unsubscribeInnerClose = undefined
    for (const [, draining] of this.drainingLegs) clearTimeout(draining.timer)
    this.drainingLegs.clear()
    const legs = [...this.attachedLegs.values()]
    this.attachedLegs.clear()
    for (const entry of legs) {
      entry.unsubscribeMsg()
      entry.unsubscribeClose()
      await entry.leg.close().catch(() => undefined)
    }
    this.activeOutbound = undefined
    this.incoming.reset()
    this.outgoing.reset()
    this.noise?.destroy()
    this.noise = undefined
    await this.inner.close()
  }

  getStats(): TransportStats {
    const active = this.activeOutbound
    if (active !== undefined && active !== this.inner) {
      return active.getStats()
    }
    return this.inner.getStats()
  }

  private requireNoise(): NoiseIkSession {
    if (this.noise === undefined || !this.noise.complete || this.closed) {
      throw new Error(strings.runtime.secureChannelNotConnected)
    }
    return this.noise
  }
}

async function waitForResponder(inner: SecureHandshakeTransport, noise: NoiseIkSession): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => finish(new Error(strings.runtime.secureHandshakeTimedOut)), 10_000)
    const unsubscribe = inner.onHandshake((step, data) => {
      if (settled) return
      try {
        if (step !== 2) throw new Error(strings.runtime.secureHandshakeOrder)
        noise.readHandshake(data)
        if (!noise.complete) throw new Error(strings.runtime.secureHandshakeIncomplete)
        finish()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(strings.runtime.secureHandshakeFailed))
      }
    })
    const unsubscribeClose = inner.onClose?.(error => {
      finish(error ?? new Error(strings.runtime.secureHandshakeFailed))
    })
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      unsubscribeClose?.()
      if (error === undefined) resolve()
      else reject(error)
    }
    void inner.sendHandshake(1, noise.writeHandshake()).catch(error => {
      finish(error instanceof Error ? error : new Error(strings.runtime.secureHandshakeFailed))
    })
  })
}
