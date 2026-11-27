import { Buffer } from 'node:buffer'
import type { AcpAvailableCommand, AcpSessionModes } from '@dsh-remote/protocol'
import type { SafeLogger } from '../../logging.js'
import { ADAPTER_LABELS, CursorAcpClient, CursorAcpError, type CursorAcpInbound, type CursorAcpOptions, type SpawnCursorAcp, type CursorAcpInboundHandler } from './cursor-process.js'
import { acpHistoryEvents } from '../history-events.js'

const DEFAULT_LOAD_TOMBSTONE_TTL_MS = 60_000
const MAX_LOAD_TOMBSTONE_TTL_MS = 5 * 60_000
const MAX_LOAD_TOMBSTONES = 256
const MAX_HISTORY_METADATA = 64

/** Host-local authentication; no interactive login or filesystem transcript reads.
 *
 * Also the standard-ACP client shape used by other pre-authenticated backends (Hermes,
 * native AGY ACP, and custom ACP backends): one process per live session, a separate
 * reader for history replay, and load-replay suppression so a replayed transcript
 * never mixes into a live turn's stream.
 */
export class ClaudeAcpClient extends CursorAcpClient {
  private readonly live = new Map<string, unknown>()
  private readonly loads = new Map<string, Promise<unknown>>()
  private readonly claudeInboundHandlers = new Set<CursorAcpInboundHandler>()
  private readonly loadSuppressions = new Map<string, { gen: number; timer?: ReturnType<typeof setTimeout> }>()
  private readonly liveHistoryCollectors = new Map<string, (message: CursorAcpInbound) => void>()
  private loadGen = 0
  private pendingNew = 0
  private historyStop?: () => Promise<void>
  private historyReading = false
  private shuttingDown = false
  private readonly historyMetadata = new Map<string, { models?: unknown; modes?: AcpSessionModes; commands?: AcpAvailableCommand[] }>()
  private readonly makeClient: () => CursorAcpClient

  constructor(binary = 'claude-agent-acp', logger?: SafeLogger, spawnAcp?: SpawnCursorAcp,
    options: Pick<CursorAcpOptions, 'args' | 'cwd'> = {}, backend: string = 'claude') {
    const config = { ...options, args: options.args ?? [], authenticationMethod: null, modelBackend: backend, backend }
    super(binary, logger, spawnAcp, config)
    this.makeClient = () => new CursorAcpClient(binary, logger, spawnAcp, config)
    this.modelLabel = backend
    super.onUnavailable(() => {
      this.live.clear()
      this.clearAllLoadSuppressions()
      this.liveHistoryCollectors.clear()
    })
    super.onInbound(message => {
      const id = isRecord(message.params) && typeof message.params.sessionId === 'string'
        ? message.params.sessionId
        : undefined
      // First load (or a timed-out/aborted load whose late replay frames are still arriving)
      // belongs exclusively to history(), never live streams or interactive approvals.
      if (id && this.loadSuppressions.has(id)) {
        if (message.kind === 'request') {
          void (message.method === 'session/request_permission'
            ? this.respond(message.id, { outcome: { outcome: 'cancelled' } })
            : this.respondError(message.id, -32600, `${this.label} session is not loaded.`)
          ).catch(() => undefined)
        } else if (message.kind === 'notification' && message.method === 'session/update') {
          this.liveHistoryCollectors.get(id)?.(message)
        }
        return
      }
      for (const handler of this.claudeInboundHandlers) handler(message)
    })
  }

  /** History events and model catalogs are labelled with the backend that produced them. */
  private readonly modelLabel: string
  private get label(): string {
    return ADAPTER_LABELS[this.modelLabel] ?? this.modelLabel
  }

  override onInbound(handler: CursorAcpInboundHandler): () => void {
    this.claudeInboundHandlers.add(handler)
    return () => this.claudeInboundHandlers.delete(handler)
  }

  override async call(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    if (this.shuttingDown) throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
    const id = (params as { sessionId?: string } | null)?.sessionId
    if (method === 'session/load' && typeof id === 'string') {
      // Upstream reloads even an already live session, replaying into active listeners.
      if (this.live.has(id)) {
        if (!this.liveHistoryCollectors.has(id)) this.clearLoadSuppression(id)
        return this.live.get(id)
      }
      const pending = this.loads.get(id)
      if (pending) return pending
      this.checkSessionLimit()
      const gen = this.beginLoadSuppression(id)
      let responded = false
      // Defer the actual call until the suppression/deduplication guard is installed.
      const load = Promise.resolve().then(() => super.call(method, params, timeoutMs)).then(result => {
        responded = true
        this.assertLoaded(result, id)
        this.live.set(id, result)
        this.historyMetadata.delete(id)
        this.clearLoadSuppression(id, gen)
        return result
      })
      this.loads.set(id, load)
      try {
        return await load
      } catch (error) {
        if (responded || this.shuttingDown || !this.isReady()) {
          this.clearLoadSuppression(id, gen)
        } else {
          this.armLoadTombstone(id, gen, timeoutMs)
        }
        throw error
      } finally {
        this.loads.delete(id)
      }
    }
    if (method === 'session/new' || method === 'session/fork') {
      this.checkSessionLimit()
      this.pendingNew++
      try {
        const result = await super.call(method, params, timeoutMs)
        const newId = (result as { sessionId?: string } | null)?.sessionId
        if (typeof newId !== 'string' || this.shuttingDown) throw new CursorAcpError('ACP_INVALID_SESSION', `${this.label} returned an invalid session.`)
        this.live.set(newId, result)
        this.historyMetadata.delete(newId)
        this.clearLoadSuppression(newId)
        return result
      } finally { this.pendingNew-- }
    }
    if (method === 'session/prompt' && typeof id === 'string' && !this.liveHistoryCollectors.has(id)) {
      this.clearLoadSuppression(id)
    }
    if ((method === 'dsh/selectModel' || method === 'session/set_mode') && typeof id === 'string') {
      this.historyMetadata.delete(id)
    }
    return super.call(method, params, timeoutMs)
  }

  private beginLoadSuppression(sessionId: string): number {
    this.clearLoadSuppression(sessionId)
    const gen = ++this.loadGen
    this.loadSuppressions.set(sessionId, { gen })
    return gen
  }

  private armLoadTombstone(sessionId: string, gen: number, timeoutMs?: number): void {
    const current = this.loadSuppressions.get(sessionId)
    if (!current || current.gen !== gen) return
    if (current.timer !== undefined) clearTimeout(current.timer)
    while (this.loadSuppressions.size > MAX_LOAD_TOMBSTONES) {
      let evictKey: string | undefined
      for (const [key, entry] of this.loadSuppressions) {
        if (key !== sessionId && entry.timer !== undefined) { evictKey = key; break }
      }
      if (evictKey === undefined) {
        for (const key of this.loadSuppressions.keys()) {
          if (key !== sessionId) { evictKey = key; break }
        }
      }
      if (evictKey === undefined) break
      this.clearLoadSuppression(evictKey)
    }
    const ttl = Math.min(Math.max(timeoutMs ?? DEFAULT_LOAD_TOMBSTONE_TTL_MS, DEFAULT_LOAD_TOMBSTONE_TTL_MS), MAX_LOAD_TOMBSTONE_TTL_MS)
    const timer = setTimeout(() => {
      this.clearLoadSuppression(sessionId, gen)
    }, ttl)
    timer.unref?.()
    this.loadSuppressions.set(sessionId, { gen, timer })
  }

  private clearLoadSuppression(sessionId: string, expectedGen?: number): void {
    const entry = this.loadSuppressions.get(sessionId)
    if (!entry) return
    if (expectedGen !== undefined && entry.gen !== expectedGen) return
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    this.loadSuppressions.delete(sessionId)
  }

  private clearAllLoadSuppressions(): void {
    for (const entry of this.loadSuppressions.values()) {
      if (entry.timer !== undefined) clearTimeout(entry.timer)
    }
    this.loadSuppressions.clear()
  }

  private checkSessionLimit(): void {
    if (this.live.size + this.loads.size + this.pendingNew >= 30) throw new CursorAcpError('ACP_PROCESS_LIMIT', `Too many ${this.label} sessions are active.`)
  }
  private assertLoaded(result: unknown, sessionId: string): void {
    const id = (result as { sessionId?: unknown } | null)?.sessionId
    if (this.shuttingDown) throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
    if (id !== undefined && id !== sessionId) throw new CursorAcpError('ACP_INVALID_SESSION', `${this.label} returned an invalid history session.`)
  }

  isSessionLoaded(sessionId: string): boolean {
    return this.live.has(sessionId)
  }

  protected pendingSessionLoad(sessionId: string): Promise<unknown> | undefined {
    return this.loads.get(sessionId)
  }

  invalidateHistoryMetadata(sessionId: string): void {
    this.historyMetadata.delete(sessionId)
  }

  lastHistoryMetadata(sessionId: string): { models?: unknown; modes?: AcpSessionModes; commands?: AcpAvailableCommand[] } | undefined {
    return this.historyMetadata.get(sessionId)
  }

  protected filterHistoryUpdates(updates: CursorAcpInbound[]): CursorAcpInbound[] {
    return updates
  }

  /**
   * Reload history via a suppressed `session/load` on the active process instead of
   * spawning a second process, for backends that enforce an exclusive per-session lock.
   */
  protected async readLiveHistory(sessionId: string, cwd: string, signal?: AbortSignal): Promise<unknown[]> {
    signal?.throwIfAborted()
    if (this.shuttingDown) throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
    if (this.historyReading) throw new CursorAcpError('ACP_PROCESS_LIMIT', `A ${this.label} history read is already in progress.`)
    this.historyReading = true
    const updates: Parameters<typeof acpHistoryEvents>[0] = []
    let bytes = 0
    let count = 0
    let overflow = false
    let responded = false
    const gen = this.beginLoadSuppression(sessionId)
    this.liveHistoryCollectors.set(sessionId, message => {
      if (overflow) return
      bytes += Buffer.byteLength(JSON.stringify(message))
      count++
      if (bytes > 8 * 1024 * 1024 || count > 10000) overflow = true
      else updates.push(message)
    })
    try {
      const result = await super.call('session/load', { sessionId, cwd, mcpServers: [] })
      responded = true
      this.assertLoaded(result, sessionId)
      this.live.set(sessionId, result)
      this.clearLoadSuppression(sessionId, gen)
      signal?.throwIfAborted()
      if (overflow) throw new CursorAcpError('ACP_HISTORY_TOO_LARGE', `${this.label} history exceeds the transfer limit.`)
      await this.populateHistoryMetadata(sessionId, (method, params) => super.call(method, params), signal)
      return acpHistoryEvents(this.filterHistoryUpdates(updates), sessionId, this.modelLabel)
    } catch (error) {
      if (!responded && !this.shuttingDown && this.isReady()) {
        this.armLoadTombstone(sessionId, gen)
      } else {
        this.clearLoadSuppression(sessionId, gen)
      }
      signal?.throwIfAborted()
      if (overflow) throw new CursorAcpError('ACP_HISTORY_TOO_LARGE', `${this.label} history exceeds the transfer limit.`)
      throw error
    } finally {
      this.liveHistoryCollectors.delete(sessionId)
      this.historyReading = false
    }
  }

  private async populateHistoryMetadata(
    sessionId: string,
    callMetadata: (method: string, params: unknown) => Promise<unknown>,
    signal?: AbortSignal,
  ): Promise<void> {
    const [modelsRaw, modesRaw, commandsRaw] = await Promise.all([
      callMetadata('dsh/sessionModels', { sessionId }).catch(() => undefined),
      callMetadata('dsh/sessionModes', { sessionId }).catch(() => undefined),
      callMetadata('dsh/sessionCommands', { sessionId }).catch(() => undefined),
    ])
    signal?.throwIfAborted()
    const models = isRecord(modelsRaw) ? modelsRaw : undefined
    const modes = isRecord(modesRaw) && Array.isArray(modesRaw.availableModes)
      ? modesRaw as unknown as AcpSessionModes
      : undefined
    const commands = isRecord(commandsRaw) && Array.isArray(commandsRaw.commands) && commandsRaw.commands.length > 0
      ? commandsRaw.commands as AcpAvailableCommand[]
      : undefined
    if (models !== undefined || modes !== undefined || commands !== undefined) {
      this.historyMetadata.delete(sessionId)
      this.historyMetadata.set(sessionId, {
        ...(models !== undefined ? { models } : {}),
        ...(modes !== undefined ? { modes } : {}),
        ...(commands !== undefined ? { commands } : {}),
      })
      while (this.historyMetadata.size > MAX_HISTORY_METADATA) {
        const oldest = this.historyMetadata.keys().next().value
        if (oldest === undefined) break
        this.historyMetadata.delete(oldest)
      }
    }
  }

  /** One temporary process, separate from all live sessions (including active prompts). */
  async history(sessionId: string, cwd: string, signal?: AbortSignal): Promise<unknown[]> {
    signal?.throwIfAborted()
    if (this.shuttingDown) throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
    if (this.historyReading) throw new CursorAcpError('ACP_PROCESS_LIMIT', `A ${this.label} history read is already in progress.`)
    this.historyReading = true
    const client = this.makeClient()
    let stopping: Promise<void> | undefined
    const stop = () => stopping ??= client.close()
    const onAbort = () => { void stop().catch(() => undefined) }
    this.historyStop = stop
    const updates: Parameters<typeof acpHistoryEvents>[0] = []
    let bytes = 0
    let count = 0
    let overflow = false
    client.onInbound(message => {
      // A history reader has no authority to run tools or wait for user approval.
      if (message.kind === 'request') {
        void (message.method === 'session/request_permission'
          ? client.respond(message.id, { outcome: { outcome: 'cancelled' } })
          : client.respondError(message.id, -32601, 'History reader does not support requests.')).catch(() => undefined)
        return
      }
      if (message.method !== 'session/update' || (message.params as { sessionId?: string } | null)?.sessionId !== sessionId || overflow) return
      bytes += Buffer.byteLength(JSON.stringify(message))
      count++
      if (bytes > 8 * 1024 * 1024 || count > 10000) {
        overflow = true
        void stop().catch(() => undefined)
      } else updates.push(message)
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      await client.start()
      signal?.throwIfAborted()
      if (this.shuttingDown) throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
      const result = await client.call('session/load', { sessionId, cwd, mcpServers: [] })
      signal?.throwIfAborted()
      this.assertLoaded(result, sessionId)
      if (overflow) throw new CursorAcpError('ACP_HISTORY_TOO_LARGE', `${this.label} history exceeds the transfer limit.`)
      await this.populateHistoryMetadata(sessionId, (method, params) => client.call(method, params), signal)
      return acpHistoryEvents(this.filterHistoryUpdates(updates), sessionId, this.modelLabel)
    } catch (error) {
      signal?.throwIfAborted()
      if (overflow) throw new CursorAcpError('ACP_HISTORY_TOO_LARGE', `${this.label} history exceeds the transfer limit.`)
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
      try { await stop() } finally { this.historyStop = undefined; this.historyReading = false }
    }
  }

  override async close(): Promise<void> {
    this.shuttingDown = true
    this.clearAllLoadSuppressions()
    this.liveHistoryCollectors.clear()
    this.historyMetadata.clear()
    await Promise.all([super.close(), this.historyStop?.()])
    this.live.clear()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
