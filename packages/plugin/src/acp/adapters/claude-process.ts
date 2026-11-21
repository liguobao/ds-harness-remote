import { Buffer } from 'node:buffer'
import type { AcpAvailableCommand, AcpSessionModes } from '@dsh-remote/protocol'
import type { SafeLogger } from '../../logging.js'
import { CursorAcpClient, CursorAcpError, type CursorAcpOptions, type SpawnCursorAcp, type CursorAcpInboundHandler } from './cursor-process.js'
import { acpHistoryEvents } from '../history-events.js'

const DEFAULT_LOAD_TOMBSTONE_TTL_MS = 60_000
const MAX_LOAD_TOMBSTONE_TTL_MS = 5 * 60_000
const MAX_LOAD_TOMBSTONES = 256
const MAX_HISTORY_METADATA = 64
const HISTORY_STANDBY_IDLE_MS = 5 * 60_000
const MAX_HISTORY_REPLAY_BYTES = 8 * 1024 * 1024
const MAX_HISTORY_REPLAY_COUNT = 10_000
const MAX_REPLAY_TOOL_FIELD_CHARS = 8 * 1024

function truncateReplayString(value: string): string {
  return value.length > MAX_REPLAY_TOOL_FIELD_CHARS
    ? `${value.slice(0, MAX_REPLAY_TOOL_FIELD_CHARS)}\n[Truncated]`
    : value
}

function compactHistoryReplayUpdate(update: Record<string, unknown>): Record<string, unknown> {
  const kind = update.sessionUpdate
  if (kind !== 'tool_call' && kind !== 'tool_call_update') return update
  let next: Record<string, unknown> | undefined
  const ensureCopy = () => (next ??= { ...update })
  if (update.rawInput !== undefined && update.args !== undefined) {
    delete ensureCopy().args
  }
  if (Array.isArray(update.content) && update.content.length > 0 && update.rawOutput !== undefined) {
    if (!isRecord(update.rawOutput) || update.rawOutput.isError !== true) {
      delete ensureCopy().rawOutput
    }
  }
  const target = next ?? update
  if (typeof target.rawOutput === 'string' && target.rawOutput.length > MAX_REPLAY_TOOL_FIELD_CHARS) {
    ensureCopy().rawOutput = truncateReplayString(target.rawOutput)
  }
  if (Array.isArray(target.content)) {
    let contentChanged = false
    const compactContent = target.content.map(item => {
      if (!isRecord(item)) return item
      if (typeof item.text === 'string' && item.text.length > MAX_REPLAY_TOOL_FIELD_CHARS) {
        contentChanged = true
        return { ...item, text: truncateReplayString(item.text) }
      }
      if (isRecord(item.content) && typeof item.content.text === 'string' && item.content.text.length > MAX_REPLAY_TOOL_FIELD_CHARS) {
        contentChanged = true
        return {
          ...item,
          content: {
            ...item.content,
            text: truncateReplayString(item.content.text),
          },
        }
      }
      if (item.type === 'diff') {
        const oldLong = typeof item.oldText === 'string' && item.oldText.length > MAX_REPLAY_TOOL_FIELD_CHARS
        const newLong = typeof item.newText === 'string' && item.newText.length > MAX_REPLAY_TOOL_FIELD_CHARS
        if (oldLong || newLong) {
          contentChanged = true
          return {
            ...item,
            ...(oldLong ? { oldText: truncateReplayString(item.oldText as string) } : {}),
            ...(newLong ? { newText: truncateReplayString(item.newText as string) } : {}),
          }
        }
      }
      return item
    })
    if (contentChanged) ensureCopy().content = compactContent
  }
  return next ?? update
}

interface HistoryStandby {
  client: CursorAcpClient
  ready: Promise<CursorAcpClient>
  idleTimer?: ReturnType<typeof setTimeout>
}

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
  private loadGen = 0
  private pendingNew = 0
  private historyStop?: () => Promise<void>
  private historyReading = false
  private shuttingDown = false
  private readonly prewarmHistoryReader: boolean
  private historyStandby?: HistoryStandby
  private readonly historyMetadata = new Map<string, { models?: unknown; modes?: AcpSessionModes; commands?: AcpAvailableCommand[] }>()
  private readonly makeClient: () => CursorAcpClient

  constructor(binary = 'claude-agent-acp', logger?: SafeLogger, spawnAcp?: SpawnCursorAcp,
    options: Pick<CursorAcpOptions, 'args' | 'cwd'> & { prewarmHistoryReader?: boolean } = {}, backend: string = 'claude') {
    const { prewarmHistoryReader = false, ...processOptions } = options
    const config = { ...processOptions, args: processOptions.args ?? [], authenticationMethod: null, modelBackend: backend, backend }
    super(binary, logger, spawnAcp, config)
    this.prewarmHistoryReader = prewarmHistoryReader
    this.makeClient = () => new CursorAcpClient(binary, logger, spawnAcp, config)
    this.modelLabel = backend
    super.onUnavailable(() => {
      this.live.clear()
      this.clearAllLoadSuppressions()
      void this.disposeHistoryStandby()
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
        }
        return
      }
      for (const handler of this.claudeInboundHandlers) handler(message)
    })
  }

  /** History events and model catalogs are labelled with the backend that produced them. */
  private readonly modelLabel: string
  private get label(): string {
    return this.modelLabel === 'hermes' ? 'Hermes' : this.modelLabel === 'antigravity' ? 'Antigravity' : this.modelLabel === 'claude' ? 'Claude' : this.modelLabel
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
      if (this.live.has(id)) return this.live.get(id)
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
        if (this.modelLabel === 'antigravity') {
          this.armLoadTombstone(id, gen, 1_500)
        } else {
          this.clearLoadSuppression(id, gen)
        }
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
    if ((method === 'dsh/selectModel' || method === 'session/set_mode') && typeof id === 'string') {
      this.historyMetadata.delete(id)
    }
    if (method === 'session/prompt' && typeof id === 'string') {
      this.clearLoadSuppression(id)
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
    const ttl = Math.min(Math.max(timeoutMs ?? DEFAULT_LOAD_TOMBSTONE_TTL_MS, 250), MAX_LOAD_TOMBSTONE_TTL_MS)
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

  /**
   * Native `agy acp` resolves the `session/load` JSON-RPC response before its
   * asynchronous `session/update` replay finishes flushing over stdout. Drain
   * post-response replay frames until a short quiet window elapses.
   */
  private async awaitReplayQuiescence(
    getCount: () => number,
    shouldStop: () => boolean,
  ): Promise<void> {
    if (this.modelLabel !== 'antigravity' || shouldStop()) return
    const quietWindowMs = 35
    const maxDrainMs = 2_000
    const deadline = Date.now() + maxDrainMs
    let previous = getCount()
    while (!shouldStop() && Date.now() < deadline) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, quietWindowMs)
        timer.unref?.()
      })
      const current = getCount()
      if (current === previous) break
      previous = current
    }
  }

  isSessionLoaded(sessionId: string): boolean {
    return this.live.has(sessionId)
  }

  invalidateHistoryMetadata(sessionId: string): void {
    this.historyMetadata.delete(sessionId)
  }

  lastHistoryMetadata(sessionId: string): { models?: unknown; modes?: AcpSessionModes; commands?: AcpAvailableCommand[] } | undefined {
    return this.historyMetadata.get(sessionId)
  }

  /** Prepare one clean initialized reader process in the background for fast first-open history reads. */
  prewarmHistory(): void {
    if (!this.prewarmHistoryReader || this.shuttingDown || !this.isReady() || this.historyStandby !== undefined) return
    const client = this.makeClient()
    const standby: HistoryStandby = {
      client,
      ready: Promise.resolve(client),
    }
    const clearStandby = () => {
      if (this.historyStandby !== standby) return false
      if (standby.idleTimer !== undefined) clearTimeout(standby.idleTimer)
      this.historyStandby = undefined
      return true
    }
    client.onUnavailable(() => {
      clearStandby()
    })
    standby.idleTimer = setTimeout(() => {
      if (clearStandby()) void client.close().catch(() => undefined)
    }, HISTORY_STANDBY_IDLE_MS)
    standby.idleTimer.unref?.()
    standby.ready = client.start().then(
      () => {
        if (this.shuttingDown || !this.isReady()) {
          clearStandby()
          throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
        }
        return client
      },
      async error => {
        clearStandby()
        await client.close().catch(() => undefined)
        throw error
      },
    )
    void standby.ready.catch(() => undefined)
    this.historyStandby = standby
  }

  private disposeHistoryStandby(): Promise<void> {
    const standby = this.historyStandby
    if (!standby) return Promise.resolve()
    this.historyStandby = undefined
    if (standby.idleTimer !== undefined) clearTimeout(standby.idleTimer)
    return standby.client.close().catch(() => undefined)
  }

  /** One temporary process, separate from all live sessions (including active prompts). */
  async history(sessionId: string, cwd: string): Promise<unknown[]> {
    if (this.shuttingDown) throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
    if (this.historyReading) throw new CursorAcpError('ACP_PROCESS_LIMIT', `A ${this.label} history read is already in progress.`)
    this.historyReading = true
    let activeClient: CursorAcpClient | undefined
    let stopping: Promise<void> | undefined
    let stopRequested = false
    const stop = () => {
      stopRequested = true
      return stopping ??= (activeClient ? activeClient.close() : Promise.resolve())
    }
    this.historyStop = stop
    const updates: Parameters<typeof acpHistoryEvents>[0] = []
    let bytes = 0
    let count = 0
    let overflow = false
    let unsubscribeInbound: (() => void) | undefined
    const attachHandlers = (target: CursorAcpClient) => target.onInbound(message => {
      // A history reader has no authority to run tools or wait for user approval.
      if (message.kind === 'request') {
        void (message.method === 'session/request_permission'
          ? target.respond(message.id, { outcome: { outcome: 'cancelled' } })
          : target.respondError(message.id, -32601, 'History reader does not support requests.')).catch(() => undefined)
        return
      }
      if (message.method !== 'session/update' || (message.params as { sessionId?: string } | null)?.sessionId !== sessionId || overflow) return
      const params = message.params as { sessionId?: string; update?: unknown }
      const compactedMessage = isRecord(params.update)
        ? { ...message, params: { ...params, update: compactHistoryReplayUpdate(params.update) } }
        : message
      bytes += Buffer.byteLength(JSON.stringify(compactedMessage))
      count++
      if (bytes > MAX_HISTORY_REPLAY_BYTES || count > MAX_HISTORY_REPLAY_COUNT) {
        overflow = true
        void stop().catch(() => undefined)
      } else updates.push(compactedMessage)
    })
    const takeHistoryClient = async (): Promise<CursorAcpClient> => {
      const standby = this.historyStandby
      if (standby !== undefined) {
        this.historyStandby = undefined
        if (standby.idleTimer !== undefined) clearTimeout(standby.idleTimer)
        activeClient = standby.client
        try {
          const warmed = await standby.ready
          if (!stopRequested && !this.shuttingDown && warmed.isReady()) return warmed
          await warmed.close().catch(() => undefined)
        } catch {
          // Fall back to starting a fresh history reader.
        }
      }
      if (stopRequested || this.shuttingDown) {
        throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
      }
      const fresh = this.makeClient()
      activeClient = fresh
      await fresh.start()
      return fresh
    }
    try {
      const client = await takeHistoryClient()
      if (stopRequested || this.shuttingDown) throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
      unsubscribeInbound = attachHandlers(client)
      const result = await client.call('session/load', { sessionId, cwd, mcpServers: [] })
      this.assertLoaded(result, sessionId)
      if (overflow) throw new CursorAcpError('ACP_HISTORY_TOO_LARGE', `${this.label} history exceeds the transfer limit.`)
      await this.awaitReplayQuiescence(
        () => count,
        () => overflow || stopRequested || this.shuttingDown,
      )
      if (overflow) throw new CursorAcpError('ACP_HISTORY_TOO_LARGE', `${this.label} history exceeds the transfer limit.`)
      const [modelsRaw, modesRaw, commandsRaw] = await Promise.all([
        client.call('dsh/sessionModels', { sessionId }).catch(() => undefined),
        client.call('dsh/sessionModes', { sessionId }).catch(() => undefined),
        client.call('dsh/sessionCommands', { sessionId }).catch(() => undefined),
      ])
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
      return acpHistoryEvents(updates, sessionId, this.modelLabel)
    } catch (error) {
      if (overflow) throw new CursorAcpError('ACP_HISTORY_TOO_LARGE', `${this.label} history exceeds the transfer limit.`)
      throw error
    } finally {
      unsubscribeInbound?.()
      try { await stop() } finally { this.historyStop = undefined; this.historyReading = false }
      if (!this.shuttingDown && this.isReady()) this.prewarmHistory()
    }
  }

  override async close(): Promise<void> {
    this.shuttingDown = true
    this.clearAllLoadSuppressions()
    this.historyMetadata.clear()
    await Promise.all([super.close(), this.historyStop?.(), this.disposeHistoryStandby()])
    this.live.clear()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
