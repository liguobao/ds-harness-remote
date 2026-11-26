import type { AcpAuthDiagnostic, AcpAuthMethod, AcpAvailableCommand } from '@dsh-remote/protocol'
import {
  buildAuthDiagnosticFromMetadata,
  detectUpstreamAuthFailure,
  parseAvailableCommands,
  parseInitializeMetadata,
  type AcpInitializeMetadata,
} from './auth-diagnostics.js'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawnCommand } from '../windows-spawn.js'
import { Buffer } from 'node:buffer'
import { realpath } from 'node:fs/promises'
import type { SafeLogger } from '../../logging.js'
import { PLUGIN_VERSION } from '../../version.js'
import type { CursorAcpInbound, CursorAcpLike } from './cursor-process.js'
import { AcpHistoryAccumulator } from '../history-events.js'
import { AcpSessionModelState } from './session-models.js'
import { OpencodeNativeApi, opencodeHasNativeApi, opencodeLoopbackPort, opencodePrivateArgs } from './opencode-native-api.js'

const ACP_REQUEST_TIMEOUT_MS = 60_000
/** Loading large `opencode.db` transcripts over `session/load` regularly exceeds 60s. */
const ACP_HISTORY_LOAD_TIMEOUT_MS = 120_000
/** Full agent turns (tools + streaming) routinely exceed the short RPC budget. */
const ACP_PROMPT_TIMEOUT_MS = 10 * 60_000
const ACP_START_TIMEOUT_MS = 20_000
const MAX_ACP_LINE_BYTES = 288 * 1024 * 1024
const ACP_HISTORY_MAX_BYTES = 8 * 1024 * 1024
const ACP_HISTORY_HARD_MAX_BYTES = 16 * 1024 * 1024
const ACP_HISTORY_MAX_EVENTS = 10_000
const ACP_HISTORY_HARD_MAX_EVENTS = 20_000
const ACP_HISTORY_MAX_RAW_BYTES = 256 * 1024 * 1024
const ACP_HISTORY_MAX_RAW_UPDATES = 500_000
const MAX_STDERR_CAPTURE_BYTES = 4 * 1024
const MAX_OPENCODE_SESSION_LIST = 1000

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type OpencodeAcpNotification = CursorAcpNotification
export type OpencodeAcpRequest = CursorAcpRequest
export type OpencodeAcpInbound = CursorAcpInbound
export type OpencodeAcpInboundHandler = (message: CursorAcpInbound) => void
export type OpencodeAcpUnavailableHandler = (code: string) => void
export type SpawnOpencodeAcp = (binary: string) => ChildProcessWithoutNullStreams

export interface CursorAcpNotification {
  kind: 'notification'
  method: string
  params: unknown
}

export interface CursorAcpRequest {
  kind: 'request'
  id: string | number
  method: string
  params: unknown
}

export type OpencodeAcpLike = CursorAcpLike

export class OpencodeAcpError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'OpencodeAcpError'
  }
}

/**
 * Host-local stdio client for one OpenCode CLI ACP process (`opencode acp`).
 * OpenCode natively supports standard Agent Client Protocol (ACP) over stdio.
 */
export class OpencodeAcpClient implements CursorAcpLike {
  private process?: ChildProcessWithoutNullStreams
  private nextId = 1
  private readonly pending = new Map<string | number, PendingRequest>()
  private readonly inboundHandlers = new Set<OpencodeAcpInboundHandler>()
  private readonly unavailableHandlers = new Set<OpencodeAcpUnavailableHandler>()
  private stdoutBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private stderrBytes = 0
  private ready = false
  private closed = false
  private failureNotified = false
  private startPromise?: Promise<void>
  private historyBusy = false
  private historyStop?: () => Promise<void>
  private readonly startupAbort = new AbortController()
  private nativeApi?: OpencodeNativeApi
  private readonly archivedSessions = new Set<string>()
  private readonly archivingSessions = new Set<string>()
  private readonly sessionCommands = new Map<string, AcpAvailableCommand[]>()
  private initMetadata?: AcpInitializeMetadata
  private lastAuthDiagnostic?: AcpAuthDiagnostic

  constructor(
    private readonly binary: string = 'opencode',
    private readonly logger?: SafeLogger,
    private readonly spawnAcp?: SpawnOpencodeAcp,
    private readonly options: { args?: string[]; cwd?: string; historyReader?: boolean } = {},
  ) {}

  diagnostics(): AcpAuthDiagnostic {
    return buildAuthDiagnosticFromMetadata('opencode', this.initMetadata, this.lastAuthDiagnostic, this.ready)
  }

  capabilities(): AcpInitializeMetadata['agentCapabilities'] {
    return this.initMetadata?.agentCapabilities ?? {}
  }

  authMethods(): AcpAuthMethod[] {
    return this.initMetadata?.authMethods ?? []
  }

  start(): Promise<void> {
    if (this.closed) return Promise.reject(new OpencodeAcpError('OPENCODE_CLOSED', 'The OpenCode domain is closed.'))
    if (this.ready) return Promise.resolve()
    this.startPromise ??= this.startOnce().finally(() => { this.startPromise = undefined })
    return this.startPromise
  }

  isReady(): boolean { return this.ready }

  async isSessionArchived(sessionId: string, cwd: string): Promise<boolean> {
    if (!this.nativeApi) return this.archivedSessions.has(sessionId)
    const archived = await this.nativeApi.isArchived(sessionId, cwd)
    if (archived) this.archivedSessions.add(sessionId)
    else this.archivedSessions.delete(sessionId)
    return archived
  }

  async archiveSession(sessionId: string, cwd: string): Promise<void> {
    if (!this.ready || !this.nativeApi) throw new OpencodeAcpError('OPENCODE_ARCHIVE_UNAVAILABLE', 'The Host OpenCode native API is unavailable.')
    if (this.busy.has(sessionId) || this.loads.has(sessionId) || this.archivingSessions.has(sessionId)) throw new OpencodeAcpError('PROMPT_IN_PROGRESS', 'Stop the OpenCode reply before archiving.')
    this.archivingSessions.add(sessionId)
    try {
      await this.nativeApi.archive(sessionId, cwd)
      this.archivedSessions.add(sessionId)
    } finally { this.archivingSessions.delete(sessionId) }
  }

  /**
   * Replay a saved session in one temporary ACP process so a history read never
   * interrupts a live turn. OpenCode emits the transcript as `session/update`
   * notifications before `session/load` resolves; fold incrementally and keep
   * a bounded trailing turn window within the transfer budget.
   */
  async history(sessionId: string, cwd: string): Promise<unknown[]> {
    if (this.closed) throw new OpencodeAcpError('OPENCODE_CLOSED', 'The OpenCode domain is closed.')
    if (this.historyBusy) throw new OpencodeAcpError('OPENCODE_HISTORY_BUSY', 'An OpenCode history read is already in progress.')
    this.historyBusy = true
    const client = new OpencodeAcpClient(this.binary, this.logger, this.spawnAcp, { ...this.options, historyReader: true })
    let stopping: Promise<void> | undefined
    const stop = () => stopping ??= client.close()
    this.historyStop = stop
    const accumulator = new AcpHistoryAccumulator(sessionId, 'opencode', {
      maxBytes: ACP_HISTORY_MAX_BYTES,
      hardMaxBytes: ACP_HISTORY_HARD_MAX_BYTES,
      maxEvents: ACP_HISTORY_MAX_EVENTS,
      hardMaxEvents: ACP_HISTORY_HARD_MAX_EVENTS,
    })
    let rawBytes = 0
    let rawCount = 0
    let overflow = false
    const unsubscribe = client.onInbound(message => {
      // A history reader has no authority to run tools or wait for approval.
      if (message.kind === 'request') {
        void client.respondError(message.id, -32601, 'History reader does not support requests.').catch(() => undefined)
        return
      }
      if (message.method !== 'session/update'
        || (message.params as { sessionId?: string } | null)?.sessionId !== sessionId
        || overflow) return
      rawCount++
      rawBytes += Buffer.byteLength(JSON.stringify(message))
      if (rawBytes > ACP_HISTORY_MAX_RAW_BYTES || rawCount > ACP_HISTORY_MAX_RAW_UPDATES || !accumulator.push(message)) {
        overflow = true
        void stop().catch(() => undefined)
      }
    })
    try {
      await client.start()
      if (this.closed) throw new OpencodeAcpError('OPENCODE_CLOSED', 'OpenCode ACP was closed.')
      await client.call('session/load', { sessionId, cwd, mcpServers: [] }, ACP_HISTORY_LOAD_TIMEOUT_MS)
      if (this.closed) throw new OpencodeAcpError('OPENCODE_CLOSED', 'OpenCode ACP was closed.')
      if (overflow) throw new OpencodeAcpError('OPENCODE_HISTORY_TOO_LARGE', 'OpenCode history exceeds the transfer limit.')
      const folded = accumulator.finish()
      if (folded.overflow) throw new OpencodeAcpError('OPENCODE_HISTORY_TOO_LARGE', 'OpenCode history exceeds the transfer limit.')
      if (folded.truncated) {
        this.logger?.info('OpenCode history truncated to recent turns within transfer budget', {
          retainedEvents: folded.events.length,
        })
      }
      return folded.events
    } catch (error) {
      if (overflow) throw new OpencodeAcpError('OPENCODE_HISTORY_TOO_LARGE', 'OpenCode history exceeds the transfer limit.')
      throw error
    } finally {
      unsubscribe()
      try { await stop() } finally { this.historyStop = undefined; this.historyBusy = false }
    }
  }

  private readonly models = new Map<string, AcpSessionModelState>()
  private readonly loads = new Map<string, Promise<unknown>>()
  private readonly busy = new Set<string>()

  async call(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    if (!this.ready) throw new OpencodeAcpError('OPENCODE_UNAVAILABLE', 'OpenCode ACP is not ready.')
    const p = isRecord(params) ? params : {}
    const id = typeof p.sessionId === 'string' ? p.sessionId : undefined
    if (id && this.archivingSessions.has(id)) throw new OpencodeAcpError('ACP_SESSION_BUSY', 'The OpenCode session is being archived.')
    if (id && this.archivedSessions.has(id) && ['session/load', 'session/prompt', 'dsh/selectModel'].includes(method)) throw new OpencodeAcpError('ACP_SESSION_ARCHIVED', 'This OpenCode session is archived.')
    const budget = timeoutMs ?? (method === 'session/prompt'
      ? ACP_PROMPT_TIMEOUT_MS
      : method === 'session/load' ? ACP_HISTORY_LOAD_TIMEOUT_MS : ACP_REQUEST_TIMEOUT_MS)
    if (method === 'session/load' && id) {
      // Re-reading models must never replay history into an active conversation.
      if (this.models.has(id)) return { sessionId: id }
      const pending = this.loads.get(id)
      if (pending) return pending
      const load = Promise.resolve().then(() => this.loadSession(method, params, budget, id))
      this.loads.set(id, load)
      try { return await load } finally { this.loads.delete(id) }
    }
    if (method === 'session/new' || method === 'session/fork') return this.loadSession(method, params, budget)
    if (method === 'dsh/sessionCommands') {
      return { commands: id ? [...(this.sessionCommands.get(id) ?? [])] : [] }
    }
    if (method === 'dsh/sessionModels' || method === 'dsh/selectModel') {
      const models = id ? this.models.get(id) : undefined
      if (!models) throw new OpencodeAcpError('ACP_SESSION_NOT_LOADED', 'Load the OpenCode session before selecting its model.')
      if (method === 'dsh/sessionModels') return models.catalog()
      if (this.busy.has(id!)) throw new OpencodeAcpError('PROMPT_IN_PROGRESS', 'Stop the OpenCode reply before changing its model.')
      this.busy.add(id!)
      try {
        const result = await models.select(id!, p.model, p.reasoningEffort, (method, params) => this.request(method, params, budget))
        this.publish({ kind: 'notification', method: 'session/update', params: { sessionId: id,
          update: { sessionUpdate: 'model_selection', selected: result.selected } } })
        return result
      } finally { this.busy.delete(id!) }
    }
    if (method === 'dsh/sessionModes' || method === 'session/set_mode') {
      const models = id ? this.models.get(id) : undefined
      if (!models) throw new OpencodeAcpError('ACP_SESSION_NOT_LOADED', 'Load the OpenCode session before changing its mode.')
      if (method === 'dsh/sessionModes') return models.modesCatalog()
      if (this.busy.has(id!)) throw new OpencodeAcpError('PROMPT_IN_PROGRESS', 'Stop the OpenCode reply before changing its mode.')
      this.busy.add(id!)
      try {
        const result = await models.setMode(id!, p.modeId, (method, params) => this.request(method, params, budget))
        this.publish({ kind: 'notification', method: 'session/update', params: {
          sessionId: id,
          update: { sessionUpdate: 'current_mode_update', currentModeId: result.currentModeId },
        } })
        return result
      } finally { this.busy.delete(id!) }
    }
    if (method === 'session/prompt' && id) {
      if (this.busy.has(id)) throw new OpencodeAcpError('PROMPT_IN_PROGRESS', 'The OpenCode session is busy.')
      this.busy.add(id)
      try { return await this.request(method, params, budget) } finally { this.busy.delete(id) }
    }
    if (method === 'session/cancel') {
      // OpenCode routes session/cancel through the ACP SDK's notification handler only.
      // A request envelope (with id) is answered -32601, so this must never await a reply.
      this.write({ jsonrpc: '2.0', method, params })
      return {}
    }
    const result = await this.request(method, params, budget)
    const nativeApi = this.nativeApi
    if (method === 'session/list' && nativeApi && isRecord(result) && Array.isArray(result.sessions)) {
      // ACP list may return archived native records, including after a restart.
      // Recheck every item against OpenCode; process-local caches are insufficient.
      const rawItems = result.sessions
      const items = rawItems.length > MAX_OPENCODE_SESSION_LIST
        ? [...rawItems]
            .sort((a, b) => {
              const ta = isRecord(a) && typeof a.updatedAt === 'string' ? Date.parse(a.updatedAt) || 0 : 0
              const tb = isRecord(b) && typeof b.updatedAt === 'string' ? Date.parse(b.updatedAt) || 0 : 0
              return tb - ta
            })
            .slice(0, MAX_OPENCODE_SESSION_LIST)
        : rawItems
      const realpathCache = new Map<string, Promise<string | undefined>>()
      const resolveCwd = (rawCwd: string): Promise<string | undefined> => {
        let cached = realpathCache.get(rawCwd)
        if (!cached) {
          cached = realpath(rawCwd).catch(() => undefined)
          realpathCache.set(rawCwd, cached)
        }
        return cached
      }
      const resolved: Array<{ index: number; sessionId: string; cwd: string } | undefined> = new Array(items.length)
      let nextItem = 0
      await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
        for (;;) {
          const index = nextItem++
          if (index >= items.length) return
          const item = items[index]
          if (!isRecord(item) || typeof item.sessionId !== 'string' || typeof item.cwd !== 'string') continue
          const cwd = await resolveCwd(item.cwd)
          if (cwd) resolved[index] = { index, sessionId: item.sessionId, cwd }
        }
      }))
      const groups = new Map<string, Array<{ index: number; sessionId: string; cwd: string }>>()
      for (const item of resolved) {
        if (!item) continue
        const group = groups.get(item.cwd) ?? []
        group.push(item)
        groups.set(item.cwd, group)
      }
      const archivedItems = new Map<number, boolean>()
      const missing: Array<{ index: number; sessionId: string; cwd: string }> = []
      const grouped = [...groups.values()]
      let nextGroup = 0
      await Promise.all(Array.from({ length: Math.min(4, grouped.length) }, async () => {
        for (;;) {
          const group = grouped[nextGroup++]
          if (!group) return
          const batch = group.length > 1
            ? await nativeApi.listArchived(group.map(item => item.sessionId), group[0]!.cwd).catch(() => new Map<string, boolean>())
            : new Map<string, boolean>()
          for (const item of group) {
            const archived = batch.get(item.sessionId)
            if (archived === undefined) missing.push(item)
            else archivedItems.set(item.index, archived)
          }
        }
      }))
      let nextMissing = 0
      await Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
        for (;;) {
          const item = missing[nextMissing++]
          if (!item) return
          try {
            archivedItems.set(item.index, await nativeApi.isArchived(item.sessionId, item.cwd))
          } catch {
            // Keep the prior behavior for an unconfirmed archive state.
          }
        }
      }))
      for (const item of resolved) {
        if (!item || !archivedItems.has(item.index)) continue
        if (archivedItems.get(item.index)) this.archivedSessions.add(item.sessionId)
        else this.archivedSessions.delete(item.sessionId)
      }
      // The gateway retains authority for archived history, but excludes these
      // entries from its public/default catalog.
      const sessions = items.flatMap((item, index) => archivedItems.has(index)
        ? [{ ...(item as Record<string, unknown>), archived: archivedItems.get(index)! }] : [])
      return { ...result, sessions }
    }
    return result
  }

  private async loadSession(method: string, params: unknown, budget: number, sessionId?: string): Promise<unknown> {
    const result = await this.request(method, params, budget)
    const returnedId = isRecord(result) && typeof result.sessionId === 'string' ? result.sessionId : undefined
    const id = sessionId ?? returnedId
    if (!this.ready || !id || (sessionId && returnedId && returnedId !== sessionId)) {
      throw new OpencodeAcpError('ACP_INVALID_SESSION', 'OpenCode returned an invalid session.')
    }
    const models = new AcpSessionModelState('opencode')
    models.update(result)
    this.models.set(id, models)
    return result
  }

  private publish(message: CursorAcpInbound): void {
    for (const handler of this.inboundHandlers) handler(message)
  }

  async respond(id: string | number, result: unknown): Promise<void> {
    this.write({ jsonrpc: '2.0', id, result })
  }

  async respondError(id: string | number, code: number, message: string): Promise<void> {
    this.write({ jsonrpc: '2.0', id, error: { code, message } })
  }

  onInbound(handler: OpencodeAcpInboundHandler): () => void {
    this.inboundHandlers.add(handler)
    return () => this.inboundHandlers.delete(handler)
  }

  onUnavailable(handler: OpencodeAcpUnavailableHandler): () => void {
    this.unavailableHandlers.add(handler)
    return () => this.unavailableHandlers.delete(handler)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.startupAbort.abort()
    this.ready = false
    this.models.clear()
    this.nativeApi?.close()
    this.failPending(new OpencodeAcpError('OPENCODE_CLOSED', 'OpenCode ACP was closed.'))
    const history = this.historyStop?.()
    const child = this.process
    this.process = undefined
    if (child === undefined || child.exitCode !== null || child.killed) { await history; return }
    await Promise.all([history, new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 2_000)
      timer.unref?.()
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })])
  }

  private async startOnce(): Promise<void> {
    if (this.process !== undefined) {
      throw new OpencodeAcpError('OPENCODE_STARTING', 'OpenCode ACP is already starting.')
    }
    this.failureNotified = false
    let child: ChildProcessWithoutNullStreams
    if (this.spawnAcp) {
      try {
        child = this.spawnAcp(this.binary)
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error))
        this.handleProcessFailure('OPENCODE_BINARY_UNAVAILABLE', cause)
        throw new OpencodeAcpError('OPENCODE_BINARY_UNAVAILABLE', 'OpenCode ACP communication failed.', { cause })
      }
    } else {
      const args = this.options.args ?? ['acp']
      const nativeApiSupported = await opencodeHasNativeApi(this.binary, args, this.options.cwd, this.startupAbort.signal)
      const port = nativeApiSupported ? await opencodeLoopbackPort() : undefined
      if (this.closed) throw new OpencodeAcpError('OPENCODE_CLOSED', 'OpenCode ACP was closed.')
      if (port !== undefined) this.nativeApi = new OpencodeNativeApi(`http://127.0.0.1:${port}`)
      try {
        child = spawnCommand(this.binary, opencodePrivateArgs(args, port), {
          cwd: this.options.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
          env: { ...process.env, ...(this.nativeApi ? { OPENCODE_SERVER_USERNAME: 'opencode', OPENCODE_SERVER_PASSWORD: this.nativeApi.password } : {}) },
        })
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error))
        this.handleProcessFailure('OPENCODE_BINARY_UNAVAILABLE', cause)
        throw new OpencodeAcpError('OPENCODE_BINARY_UNAVAILABLE', 'OpenCode ACP communication failed.', { cause })
      }
    }
    this.process = child
    this.stdoutBuffer = Buffer.alloc(0)
    this.stderrBytes = 0
    child.stdout.on('data', chunk => {
      if (this.process === child) this.consumeStdout(Buffer.from(chunk as Uint8Array))
    })
    child.stderr.on('data', chunk => {
      if (this.process !== child) return
      this.stderrBytes = Math.min(MAX_STDERR_CAPTURE_BYTES, this.stderrBytes + Buffer.byteLength(chunk))
    })
    child.on('error', error => {
      if (this.process === child) this.handleProcessFailure('OPENCODE_BINARY_UNAVAILABLE', error)
    })
    child.on('exit', (code, signal) => {
      if (this.process !== child) return
      this.process = undefined
      this.ready = false
      this.nativeApi?.close()
      this.nativeApi = undefined
      this.models.clear()
      void this.historyStop?.().catch(() => undefined)
      this.failPending(new OpencodeAcpError('OPENCODE_ACP_EXITED', 'OpenCode ACP exited unexpectedly.'))
      if (!this.closed) {
        this.logger?.warn('OpenCode ACP exited', {
          code: code ?? 'none',
          signal: signal ?? 'none',
          stderrBytes: this.stderrBytes,
        })
        this.notifyUnavailable('OPENCODE_ACP_EXITED')
      }
    })

    try {
      const initResult = await this.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: {
          name: 'deepseek_harness_remote',
          version: PLUGIN_VERSION,
        },
      }, ACP_START_TIMEOUT_MS)
      this.initMetadata = parseInitializeMetadata(initResult)
      this.lastAuthDiagnostic = undefined
      if (this.closed || this.process !== child) throw new OpencodeAcpError('OPENCODE_CLOSED', 'OpenCode ACP was closed.')
      this.ready = true
      this.logger?.info('OpenCode ACP ready')
    } catch (error) {
      child.kill('SIGTERM')
      if (error instanceof OpencodeAcpError) throw error
      throw new OpencodeAcpError('OPENCODE_INITIALIZE_FAILED', 'OpenCode ACP initialization failed.', { cause: error })
    }
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new OpencodeAcpError('OPENCODE_REQUEST_TIMEOUT', 'OpenCode ACP request timed out.'))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
    })
    try {
      this.write({ jsonrpc: '2.0', id, method, params })
    } catch (error) {
      const pending = this.takePending(id)
      pending?.reject(error instanceof Error ? error : new Error('OpenCode ACP write failed.'))
    }
    return result
  }

  private write(message: unknown): void {
    const child = this.process
    if (child === undefined || child.stdin.destroyed || !child.stdin.writable) {
      throw new OpencodeAcpError('OPENCODE_UNAVAILABLE', 'OpenCode ACP is not available.')
    }
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private consumeStdout(chunk: Buffer): void {
    this.stdoutBuffer = this.stdoutBuffer.length === 0 ? chunk : Buffer.concat([this.stdoutBuffer, chunk])
    if (this.stdoutBuffer.length > MAX_ACP_LINE_BYTES) {
      this.handleProcessFailure(
        'OPENCODE_RESPONSE_TOO_LARGE',
        new Error('OpenCode ACP emitted an oversized JSONL message.'),
      )
      return
    }
    let newline = this.stdoutBuffer.indexOf(0x0a)
    while (newline >= 0) {
      const line = this.stdoutBuffer.subarray(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1)
      if (line.length > 0) this.handleLine(line)
      newline = this.stdoutBuffer.indexOf(0x0a)
    }
  }

  private handleLine(line: Buffer): void {
    let value: unknown
    try {
      value = JSON.parse(line.toString('utf8'))
    } catch {
      this.handleProcessFailure('OPENCODE_INVALID_RESPONSE', new Error('OpenCode ACP emitted invalid JSON.'))
      return
    }
    if (!isRecord(value)) {
      this.handleProcessFailure('OPENCODE_INVALID_RESPONSE', new Error('OpenCode ACP emitted an invalid message.'))
      return
    }
    if ((typeof value.id === 'number' || typeof value.id === 'string') && ('result' in value || 'error' in value)) {
      const pending = this.takePending(value.id)
      if (pending === undefined) return
      if ('error' in value && value.error !== undefined) {
        const authDiagnostic = detectUpstreamAuthFailure('opencode', value.error, this.initMetadata?.authMethods)
        if (authDiagnostic) this.lastAuthDiagnostic = authDiagnostic
        pending.reject(new OpencodeAcpError(
          'OPENCODE_UPSTREAM_ERROR',
          authDiagnostic?.guidance ?? safeUpstreamError(value.error),
        ))
      } else {
        pending.resolve(value.result)
      }
      return
    }
    if (typeof value.method !== 'string' || value.method.length === 0 || value.method.length > 160) return
    const params = value.params ?? {}
    // session/update is always a live notification; never treat it as an approval request.
    const inbound: CursorAcpInbound = value.method !== 'session/update'
      && (typeof value.id === 'string' || typeof value.id === 'number')
      ? { kind: 'request', id: value.id, method: value.method, params }
      : { kind: 'notification', method: value.method, params }
    if (inbound.kind === 'request' && isRecord(params) && typeof params.sessionId === 'string' && this.loads.has(params.sessionId)) {
      void this.respondError(inbound.id, -32600, 'OpenCode session is not loaded.').catch(() => undefined)
      return
    }
    if (inbound.kind === 'notification' && inbound.method === 'session/update' && isRecord(params) && typeof params.sessionId === 'string') {
      this.models.get(params.sessionId)?.update(params.update)
      if (isRecord(params.update) && params.update.sessionUpdate === 'available_commands_update') {
        this.sessionCommands.set(params.sessionId, parseAvailableCommands(params.update))
      }
      // session/load replays belong to the separate history reader, not live UI.
      if (this.loads.has(params.sessionId) && !this.options.historyReader) return
    }
    this.publish(inbound)
  }

  private handleProcessFailure(code: string, cause: Error): void {
    void this.historyStop?.().catch(() => undefined)
    this.nativeApi?.close()
    this.nativeApi = undefined
    this.ready = false
    this.models.clear()
    this.failPending(new OpencodeAcpError(code, 'OpenCode ACP communication failed.', { cause }))
    const child = this.process
    this.process = undefined
    child?.kill('SIGTERM')
    this.logger?.warn('OpenCode ACP communication failed', { code })
    if (!this.closed) this.notifyUnavailable(code)
  }

  private notifyUnavailable(code: string): void {
    if (this.failureNotified) return
    this.failureNotified = true
    for (const handler of this.unavailableHandlers) handler(code)
  }

  private takePending(id: string | number): PendingRequest | undefined {
    const pending = this.pending.get(id)
    if (pending === undefined) return undefined
    this.pending.delete(id)
    clearTimeout(pending.timer)
    return pending
  }

  private failPending(error: Error): void {
    for (const id of [...this.pending.keys()]) this.takePending(id)?.reject(error)
  }
}

function safeUpstreamError(value: unknown): string {
  if (!isRecord(value) || typeof value.message !== 'string') return 'OpenCode ACP rejected the request.'
  const message = value.message.toLowerCase()
  if (message.includes('auth') || message.includes('login') || message.includes('api key')) {
    return 'OpenCode ACP authentication failed.'
  }
  if (message.includes('not initialized')) return 'OpenCode ACP is not initialized.'
  return 'OpenCode ACP rejected the request.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
