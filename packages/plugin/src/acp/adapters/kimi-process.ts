import type { SafeLogger } from '../../logging.js'
import type { CursorAcpInbound, CursorAcpOptions, SpawnCursorAcp } from './cursor-process.js'
import { ClaudeAcpClient } from './claude-process.js'

/** Default executables on PATH; a Host may override either through `acp.backends`. */
export const KIMI_ACP_COMMAND = 'kimi'
export const KIMI_ACP_ARGS = ['acp'] as const

const MAX_CACHED_HISTORIES = 32
const KIMI_SYSTEM_REMINDER_RE = /^\s*<system-reminder>(?:(?!<\/system-reminder>)[\s\S])*<\/system-reminder>\s*$/
const TURN_RESET_UPDATES = new Set([
  'agent_message',
  'agent_message_chunk',
  'agent_thought',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
])

/**
 * Host-local Kimi Code CLI (`kimi acp`).
 *
 * Kimi speaks standard Agent Client Protocol over stdio (`session/new`, `session/list`,
 * `session/load` with history replay, `session/prompt`, `session/cancel`, `session/set_mode`,
 * and `session/set_config_option` for model and thinking level). Credentials are resolved
 * from the Host's own Kimi login/configuration (`kimi login`), so no interactive login runs here.
 */
export class KimiAcpClient extends ClaudeAcpClient {
  private readonly activePromptCounts = new Map<string, number>()
  private readonly liveHistoryPromises = new Map<string, Promise<unknown[]>>()
  private readonly unloadedHistoryPromises = new Map<string, Promise<unknown[]>>()
  private readonly lastKnownHistory = new Map<string, unknown[]>()

  constructor(
    binary: string = KIMI_ACP_COMMAND,
    logger?: SafeLogger,
    spawnAcp?: SpawnCursorAcp,
    options: Pick<CursorAcpOptions, 'args' | 'cwd'> = {},
  ) {
    super(binary, logger, spawnAcp, { ...options, args: options.args ?? [...KIMI_ACP_ARGS] }, 'kimi')
    super.onUnavailable(() => {
      this.activePromptCounts.clear()
      this.lastKnownHistory.clear()
    })
  }

  override async call(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const id = isRecord(params) && typeof params.sessionId === 'string' ? params.sessionId : undefined
    if (method === 'session/prompt' && id !== undefined) {
      while (this.liveHistoryPromises.has(id) || this.unloadedHistoryPromises.has(id)) {
        await (this.liveHistoryPromises.get(id) ?? this.unloadedHistoryPromises.get(id))?.catch(() => undefined)
      }
      this.activePromptCounts.set(id, (this.activePromptCounts.get(id) ?? 0) + 1)
      try {
        return await super.call(method, params, timeoutMs)
      } finally {
        const remaining = (this.activePromptCounts.get(id) ?? 1) - 1
        if (remaining <= 0) this.activePromptCounts.delete(id)
        else this.activePromptCounts.set(id, remaining)
      }
    }
    if (method === 'session/load' && id !== undefined) {
      while (this.unloadedHistoryPromises.has(id)) {
        await this.unloadedHistoryPromises.get(id)?.catch(() => undefined)
      }
      return super.call(method, params, timeoutMs)
    }
    const result = await super.call(method, params, timeoutMs)
    if (method === 'session/delete' && id !== undefined) {
      this.lastKnownHistory.delete(id)
    }
    return result
  }

  /**
   * Kimi holds an exclusive per-session lock inside the active `kimi acp` process: spawning
   * a second process to `session/load` fails while the session is already loaded here.
   * Replay via suppressed `session/load` on the live process when idle, serialize with
   * initial/unloaded `session/load`, or return the last known snapshot during streaming prompts.
   */
  override async history(sessionId: string, cwd: string, signal?: AbortSignal): Promise<unknown[]> {
    signal?.throwIfAborted()
    while (true) {
      if ((this.activePromptCounts.get(sessionId) ?? 0) > 0) {
        return [...(this.lastKnownHistory.get(sessionId) ?? [])]
      }
      const pendingLoad = this.pendingSessionLoad(sessionId)
      if (pendingLoad) {
        await raceAbortSignal(pendingLoad.catch(() => undefined), signal)
        continue
      }
      const inFlightLive = this.liveHistoryPromises.get(sessionId)
      if (inFlightLive) {
        return [...(await raceAbortSignal(inFlightLive, signal))]
      }
      if (this.isSessionLoaded(sessionId)) {
        const read = this.startHistoryRead(
          this.liveHistoryPromises,
          sessionId,
          () => this.readLiveHistory(sessionId, cwd),
        )
        return [...(await raceAbortSignal(read, signal))]
      }
      const inFlightUnloaded = this.unloadedHistoryPromises.get(sessionId)
      if (inFlightUnloaded) {
        return [...(await raceAbortSignal(inFlightUnloaded, signal))]
      }
      const read = this.startHistoryRead(
        this.unloadedHistoryPromises,
        sessionId,
        () => super.history(sessionId, cwd),
      )
      return [...(await raceAbortSignal(read, signal))]
    }
  }

  override async close(): Promise<void> {
    this.activePromptCounts.clear()
    this.lastKnownHistory.clear()
    await super.close()
  }

  private startHistoryRead(
    registry: Map<string, Promise<unknown[]>>,
    sessionId: string,
    run: () => Promise<unknown[]>,
  ): Promise<unknown[]> {
    const read = run()
      .then(events => {
        this.rememberHistory(sessionId, events)
        return events
      })
      .finally(() => {
        if (registry.get(sessionId) === read) registry.delete(sessionId)
      })
    void read.catch(() => undefined)
    registry.set(sessionId, read)
    return read
  }

  private rememberHistory(sessionId: string, events: unknown[]): void {
    this.lastKnownHistory.delete(sessionId)
    this.lastKnownHistory.set(sessionId, [...events])
    while (this.lastKnownHistory.size > MAX_CACHED_HISTORIES) {
      const oldest = this.lastKnownHistory.keys().next().value
      if (oldest === undefined) break
      this.lastKnownHistory.delete(oldest)
    }
  }

  /**
   * During `session/load` replay, Kimi emits a synthetic trailing `user_message_chunk`
   * containing `<system-reminder>...</system-reminder>` after the user's message chunks.
   * Strip that injected reminder only when preceded by user content in the same turn so a
   * literal `<system-reminder>` pasted as the sole user prompt is preserved.
   */
  protected override filterHistoryUpdates(updates: CursorAcpInbound[]): CursorAcpInbound[] {
    const filtered: CursorAcpInbound[] = []
    let hasUserChunkInTurn = false
    for (const message of updates) {
      if (message.kind !== 'notification' || message.method !== 'session/update' || !isRecord(message.params)) {
        filtered.push(message)
        continue
      }
      const update = isRecord(message.params.update) ? message.params.update : undefined
      const kind = typeof update?.sessionUpdate === 'string' ? update.sessionUpdate : undefined
      if (kind === 'user_message_chunk') {
        const content = isRecord(update?.content) ? update.content : undefined
        const isText = content?.type === 'text' && typeof content.text === 'string'
        const hasNonEmptyText = isText && (content.text as string).trim().length > 0
        const isImage = content?.type === 'image' && typeof content.mimeType === 'string' && typeof content.data === 'string'
        if (isText && hasUserChunkInTurn && KIMI_SYSTEM_REMINDER_RE.test(content.text as string)) {
          continue
        }
        if (hasNonEmptyText || isImage) hasUserChunkInTurn = true
        filtered.push(message)
        continue
      }
      if (kind !== undefined && TURN_RESET_UPDATES.has(kind)) {
        hasUserChunkInTurn = false
      }
      filtered.push(message)
    }
    return filtered
  }
}

function raceAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortReasonError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReasonError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value) },
      error => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

function abortReasonError(signal: AbortSignal): unknown {
  try {
    signal.throwIfAborted()
  } catch (error) {
    return error
  }
  return new Error('Aborted')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
