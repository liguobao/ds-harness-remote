import { AndroidRemoteConnection } from './connection'
import type { AndroidConnectionOptions, MuxFrameHandler } from './connection'
import type { DeviceIdentity, RemoteDevice } from '../types'
import { foregroundService } from './foreground-service'

/** Owns the authenticated carrier independently from React screens. */
export class AndroidRemoteRuntime {
  private readonly client = new AndroidRemoteConnection()
  private foreground = false
  private connected = false
  private recovering = false
  private generation = 0
  private foregroundTail: Promise<void> = Promise.resolve()

  /** Start while the Activity is visible, before credential/network awaits. */
  async prepareConnection(recovering = false): Promise<void> {
    const generation = ++this.generation
    this.connected = false
    this.recovering = recovering && this.foreground
    await this.updateForeground(generation, true, this.recovering ? 'reconnecting' : 'connecting')
    if (generation !== this.generation) throw new Error('The connection attempt was superseded.')
  }

  async connect(
    baseUrl: string,
    identity: DeviceIdentity,
    host: RemoteDevice,
    accessToken: string,
    onFrame: MuxFrameHandler,
    options: AndroidConnectionOptions = {},
  ): Promise<void> {
    const generation = ++this.generation
    this.connected = false
    try {
      await this.updateForeground(generation, true, this.recovering ? 'reconnecting' : 'connecting')
      if (generation !== this.generation) throw new Error('The connection attempt was superseded.')
      await this.client.connect(baseUrl, identity, host, accessToken, onFrame, {
        ...options,
        onClose: closeOptions => {
          if (generation !== this.generation) return
          this.recovering = closeOptions?.retryable !== false && (this.connected || this.recovering)
          this.connected = false
          void this.updateForeground(generation, this.recovering, 'reconnecting').catch(() => undefined)
          options.onClose?.(closeOptions)
        },
      })
      if (generation !== this.generation) throw new Error('The connection attempt was superseded.')
      this.connected = true
      this.recovering = false
      await this.updateForeground(generation, true, 'connected')
    } catch (error) {
      if (generation === this.generation && !this.recovering) {
        await this.updateForeground(generation, false).catch(() => undefined)
      }
      throw error
    }
  }

  async refreshBackends(): Promise<void> { await this.client.refreshBackends() }
  configureHistory(compact: boolean) { return this.client.configureHistory(compact) }
  requireProxy() { return this.client.requireProxy() }
  readSessionImageAttachment(sessionId: string, attachmentId: string, signal: AbortSignal) {
    return this.client.readSessionImageAttachment(sessionId, attachmentId, signal)
  }
  requireBotClient() { return this.client.requireBotClient() }
  requireCodex() { return this.client.requireCodex() }
  requireSessionTools(sessionId?: string) { return this.client.requireSessionTools(sessionId) }
  hasCodex() { return this.client.hasCodex() }
  requireCursor() { return this.client.requireCursor() }
  hasCursor() { return this.client.hasCursor() }
  requireAntigravity() { return this.client.requireAntigravity() }
  hasAntigravity() { return this.client.hasAntigravity() }
  requirePi() { return this.client.requirePi() }
  hasPi() { return this.client.hasPi() }
  requireOpencode() { return this.client.requireOpencode() }
  hasOpencode() { return this.client.hasOpencode() }
  requireClaude() { return this.client.requireClaude() }
  hasClaude() { return this.client.hasClaude() }
  requireHermes() { return this.client.requireHermes() }
  hasHermes() { return this.client.hasHermes() }
  getStats() { return this.client.getStats() }
  getNetworkDetails() { return this.client.getNetworkDetails() }
  checkHealth() { return this.client.checkHealth() }

  async close(options: { preserveRecovery?: boolean } = {}): Promise<void> {
    const generation = ++this.generation
    this.connected = false
    this.recovering = options.preserveRecovery === true && this.foreground
    try {
      await this.client.close()
    } finally {
      await this.updateForeground(generation, this.recovering, 'reconnecting')
    }
  }

  /** The bounded retry owner releases the existing service after its final failure. */
  async stopRecovery(): Promise<void> {
    if (!this.recovering || this.connected) return
    this.recovering = false
    await this.updateForeground(this.generation, false)
  }

  private updateForeground(generation: number, active: boolean, status: 'connecting' | 'connected' | 'reconnecting' = 'connecting'): Promise<void> {
    // A native start/permission prompt is asynchronous. Serialize it with stop
    // and fence retired connection callbacks before touching the shared service.
    const task = this.foregroundTail.then(async () => {
      if (generation !== this.generation) return
      if (active !== this.foreground) {
        if (active) await foregroundService.start()
        else await foregroundService.stop()
        this.foreground = active
      }
      if (active) await foregroundService.setStatus(status)
    })
    this.foregroundTail = task.catch(() => undefined)
    return task
  }
}

