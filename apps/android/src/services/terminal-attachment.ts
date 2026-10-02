import type { RemoteGatewayStream } from '@dsh-remote/client-core'
import { createNativeRpcId } from './api-proxy'
import type { HarnessSessionTools, TerminalFrame, TerminalInfo } from './session-tools'

/** One physical attachment. Never reused on reconnect; uncertain input is never replayed. */
export class TerminalAttachment {
  private readonly controller = new AbortController()
  private readonly attachmentId = createNativeRpcId()
  private stream?: RemoteGatewayStream
  private retention?: RemoteGatewayStream
  private sequence?: number
  private writable = false
  private queuedBytes = 0
  private writes: Promise<void> = Promise.resolve()

  constructor(private readonly tools: HarnessSessionTools, private readonly sessionId: string,
    private readonly terminalId: string, private readonly maxInputBytes: number,
    private readonly render: (data: string, reset: boolean) => Promise<void>,
    private readonly state: (info: TerminalInfo, writable: boolean) => void) {}

  async follow(): Promise<void> {
    try {
      this.retention = await this.tools.retainTerminal(this.sessionId, this.terminalId, this.controller.signal)
      const retained = await this.retention[Symbol.asyncIterator]().next()
      if (retained.done || (retained.value as { type?: string })?.type !== 'retained') throw new Error('Terminal retention failed')
      if (this.controller.signal.aborted) return
      const stream = await this.tools.followTerminal(this.sessionId, this.terminalId, this.attachmentId, this.controller.signal)
      this.stream = stream
      if (this.controller.signal.aborted) return
      for await (const value of stream) {
        if (this.controller.signal.aborted) return
        const frame = value as TerminalFrame
        if (frame.type === 'snapshot') {
          if (this.sequence !== undefined || !Number.isSafeInteger(frame.sequence) || typeof frame.screen !== 'string') throw new Error('Invalid terminal snapshot')
          this.sequence = frame.sequence
          await this.render(frame.screen, true)
          this.updateState(frame.info)
        } else if (frame.type === 'output') {
          if (this.sequence === undefined || frame.sequence !== this.sequence + 1 || typeof frame.data !== 'string') throw new Error('Terminal output out of order')
          this.sequence = frame.sequence
          await this.render(frame.data, false)
        } else if (frame.type === 'state') {
          this.updateState(frame.info)
        } else throw new Error('Invalid terminal frame')
      }
      if (!this.controller.signal.aborted) throw new Error('Terminal stream ended')
    } finally {
      this.writable = false
      this.controller.abort()
      await Promise.all([this.stream?.close().catch(() => undefined), this.retention?.close().catch(() => undefined)])
    }
  }

  write(data: string): Promise<void> {
    const bytes = new TextEncoder().encode(data).byteLength
    if (!this.writable || this.controller.signal.aborted || bytes > this.maxInputBytes || this.queuedBytes + bytes > 65536) {
      return Promise.reject(new Error('Terminal input unavailable'))
    }
    this.queuedBytes += bytes
    const operation = this.writes.then(async () => {
      if (!this.writable || this.controller.signal.aborted) throw new Error('Terminal detached')
      await this.tools.writeTerminal(this.sessionId, this.terminalId, this.attachmentId, data)
    }).catch(error => {
      this.dispose()
      throw error
    }).finally(() => { this.queuedBytes -= bytes })
    this.writes = operation.catch(() => undefined)
    return operation
  }

  async resize(cols: number, rows: number): Promise<void> {
    if (!this.writable || this.controller.signal.aborted) return
    await this.tools.resizeTerminal(this.sessionId, this.terminalId, this.attachmentId, cols, rows)
  }

  dispose(): void {
    this.writable = false
    this.controller.abort()
    void this.stream?.close().catch(() => undefined)
    void this.retention?.close().catch(() => undefined)
  }

  private updateState(info: TerminalInfo): void {
    if (info?.id !== this.terminalId) throw new Error('Unexpected terminal identity')
    this.writable = !this.controller.signal.aborted && this.sequence !== undefined && info.state === 'running'
      && info.controllerId === this.attachmentId
    this.state(info, this.writable)
  }
}
