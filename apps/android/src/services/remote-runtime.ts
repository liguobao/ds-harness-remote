import { AndroidRemoteConnection } from './connection'
import type { AndroidConnectionOptions, MuxFrameHandler } from './connection'
import type { DeviceIdentity, RemoteDevice } from '../types'
import { foregroundService } from './foreground-service'

/** Owns the authenticated carrier independently from React screens. */
export class AndroidRemoteRuntime {
  private readonly client = new AndroidRemoteConnection()
  private foreground = false
  private generation = 0
  private foregroundTail: Promise<void> = Promise.resolve()

  /** Start while the Activity is visible, before credential/network awaits. */
  async prepareConnection(): Promise<void> {
    const generation = ++this.generation
    await this.updateForeground(generation, true)
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
    try {
      await this.updateForeground(generation, true)
      if (generation !== this.generation) throw new Error('The connection attempt was superseded.')
      await this.client.connect(baseUrl, identity, host, accessToken, onFrame, {
        ...options,
        onClose: () => {
          if (generation !== this.generation) return
          void this.updateForeground(generation, false).catch(() => undefined)
          options.onClose?.()
        },
      })
    } catch (error) {
      await this.updateForeground(generation, false).catch(() => undefined)
      throw error
    }
  }

  async refreshBackends(): Promise<void> { await this.client.refreshBackends() }
  requireProxy() { return this.client.requireProxy() }
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
  getStats() { return this.client.getStats() }
  getNetworkDetails() { return this.client.getNetworkDetails() }
  checkHealth() { return this.client.checkHealth() }

  async close(): Promise<void> {
    const generation = ++this.generation
    try {
      await this.client.close()
    } finally {
      await this.updateForeground(generation, false)
    }
  }

  private updateForeground(generation: number, active: boolean): Promise<void> {
    // A native start/permission prompt is asynchronous. Serialize it with stop
    // and fence retired connection callbacks before touching the shared service.
    const task = this.foregroundTail.then(async () => {
      if (generation !== this.generation || active === this.foreground) return
      if (active) await foregroundService.start()
      else await foregroundService.stop()
      this.foreground = active
    })
    this.foregroundTail = task.catch(() => undefined)
    return task
  }
}

