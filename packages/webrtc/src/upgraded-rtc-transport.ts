import {
  unwrapUpgradedTransportFrame,
  wrapUpgradedTransportFrame,
  type TransportStats,
} from '@dsh-remote/protocol'
import { RtcDataChannelTransport, type RtcConnectionDetails, type RtcPathMode, type RtcSelectedTransport } from './rtc-data-channel.js'
import type { RemoteTransport } from './transport.js'

export interface SequencedOutboundTransport extends RemoteTransport {
  readonly isSequencedUpgradeLeg: true
  readonly mode: RtcPathMode
  readonly selectedTransport: RtcSelectedTransport
  sendSequenced(counter: number, ciphertext: Uint8Array): Promise<void>
  onSequencedMessage(cb: (counter: number, ciphertext: Uint8Array) => void): () => void
  connectionDetails(): Promise<RtcConnectionDetails>
}

export function isSequencedOutboundTransport(value: RemoteTransport): value is SequencedOutboundTransport {
  return 'isSequencedUpgradeLeg' in value && (value as SequencedOutboundTransport).isSequencedUpgradeLeg === true
}

export class UpgradedRtcDataChannelTransport implements SequencedOutboundTransport {
  readonly isSequencedUpgradeLeg = true as const
  private readonly sequencedHandlers = new Set<(counter: number, ciphertext: Uint8Array) => void>()
  private readonly plainHandlers = new Set<(data: Uint8Array) => void>()
  private readonly closeHandlers = new Set<(error?: Error) => void>()
  private unsubscribeMessage?: () => void
  private unsubscribeClose?: () => void
  private unsubscribeError?: () => void
  private closed = false

  private currentModeValue: RtcPathMode
  private currentSelectedValue: RtcSelectedTransport

  constructor(
    readonly rtc: RtcDataChannelTransport,
    mode: RtcPathMode,
    selectedTransport: RtcSelectedTransport,
  ) {
    this.currentModeValue = mode
    this.currentSelectedValue = selectedTransport
    this.unsubscribeMessage = rtc.onMessage(frame => {
      try {
        const parsed = unwrapUpgradedTransportFrame(frame)
        for (const handler of this.sequencedHandlers) handler(parsed.counter, parsed.ciphertext)
        for (const handler of this.plainHandlers) handler(parsed.ciphertext)
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('Invalid upgraded WebRTC frame.')
        void this.close(failure)
      }
    })
    this.unsubscribeClose = rtc.onClose(() => this.emitClose(new Error('Upgraded WebRTC DataChannel closed.')))
    this.unsubscribeError = rtc.onError(err => this.emitClose(err))
  }

  async connect(): Promise<void> {
    await this.rtc.connect()
  }

  async send(_data: Uint8Array): Promise<void> {
    throw new Error('UpgradedRtcDataChannelTransport requires sendSequenced(counter, ciphertext).')
  }

  async sendSequenced(counter: number, ciphertext: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('Upgraded WebRTC transport is closed.')
    await this.rtc.send(wrapUpgradedTransportFrame(counter, ciphertext))
  }

  onSequencedMessage(cb: (counter: number, ciphertext: Uint8Array) => void): () => void {
    this.sequencedHandlers.add(cb)
    return () => this.sequencedHandlers.delete(cb)
  }

  onMessage(cb: (data: Uint8Array) => void): () => void {
    this.plainHandlers.add(cb)
    return () => this.plainHandlers.delete(cb)
  }

  onClose(cb: (error?: Error) => void): () => void {
    this.closeHandlers.add(cb)
    return () => this.closeHandlers.delete(cb)
  }

  async close(reason?: Error): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.unsubscribeMessage?.()
    this.unsubscribeClose?.()
    this.unsubscribeError?.()
    await this.rtc.close()
    if (reason !== undefined) {
      for (const cb of this.closeHandlers) cb(reason)
    }
  }

  get mode(): RtcPathMode { return this.currentModeValue }
  get selectedTransport(): RtcSelectedTransport { return this.currentSelectedValue }

  updateMode(mode: RtcPathMode, selectedTransport: RtcSelectedTransport): void {
    this.currentModeValue = mode
    this.currentSelectedValue = selectedTransport
  }

  getStats(): TransportStats {
    const base = this.rtc.getStats()
    return { ...base, mode: base.connected ? this.currentModeValue : 'Disconnected' }
  }

  connectionDetails(): Promise<RtcConnectionDetails> {
    return this.rtc.connectionDetails()
  }

  private emitClose(error?: Error): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribeMessage?.()
    this.unsubscribeClose?.()
    this.unsubscribeError?.()
    for (const cb of this.closeHandlers) cb(error)
  }
}
