import { CursorAcpClient, CursorAcpError, type CursorAcpLike, type CursorAcpInbound, type CursorAcpInboundHandler, type CursorAcpUnavailableHandler } from './cursor-process.js'
import type { SafeLogger } from '../../logging.js'
import { acpHistoryEvents } from '../history-events.js'

/** One process per session: Cursor shares model settings within a process; Pi also needs isolated wrappers. */
export class IsolatedAcpClient implements CursorAcpLike {
  private catalog?: CursorAcpLike
  private readonly clients = new Map<string, CursorAcpLike>()
  private readonly starting = new Set<CursorAcpLike>()
  private readonly inbound = new Set<CursorAcpInboundHandler>()
  private readonly unavailable = new Set<CursorAcpUnavailableHandler>()
  private closed = false
  private readonly all = new Set<CursorAcpLike>()
  private readonly callbacks = new Map<string, { client: CursorAcpLike; id: string | number }>()
  private nextCallback = 0
  private readonly configurations = new Map<string, Record<string, any>>()
  private readonly busy = new Set<string>()
  private readonly loading = new Map<string, Promise<unknown>>()
  private historyBusy = false
  constructor(private readonly binary: string, private readonly logger?: SafeLogger,
    private readonly options: { args?: string[]; cwd?: string; backend?: 'pi' | 'cursor' } = {},
    private readonly factory: () => CursorAcpLike = () => new CursorAcpClient(binary, logger, undefined,
      { ...options, backend: options.backend ?? 'pi', args: options.args ?? (options.backend === 'cursor' ? ['acp'] : []), authenticationMethod: options.backend === 'cursor' ? 'cursor_login' : null })) {}

  private get backend(): 'pi' | 'cursor' { return this.options.backend ?? 'pi' }
  private get label(): string { return this.backend === 'cursor' ? 'Cursor' : 'Pi' }

  async start(): Promise<void> {
    this.catalog = await this.create()
    this.catalog.onUnavailable(code => { for (const handler of this.unavailable) handler(code) })
  }
  isReady(): boolean { return !this.closed && this.catalog?.isReady() === true }
  private async create(history = false): Promise<CursorAcpLike> {
    if (this.closed) throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
    if (this.all.size >= (history ? 32 : 31)) throw new CursorAcpError('ACP_PROCESS_LIMIT', `Too many ${this.label} ACP sessions are active.`)
    const client = this.factory()
    this.starting.add(client)
    this.all.add(client)
    try {
      await client.start()
      if (this.closed) throw new CursorAcpError('ACP_CLOSED', `${this.label} ACP is closed.`)
      return client
    } catch (error) { await this.dispose(client); throw error }
    finally { this.starting.delete(client) }
  }
  async call(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const p = params as Record<string, unknown>
    if (method === 'session/load' && typeof p.sessionId === 'string') {
      const previous = this.loading.get(p.sessionId)
      if (previous) return previous
      const promise = this.callOnce(method, params, timeoutMs)
      this.loading.set(p.sessionId, promise)
      try { return await promise } finally { this.loading.delete(p.sessionId) }
    }
    return this.callOnce(method, params, timeoutMs)
  }
  private async callOnce(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const p = params as Record<string, unknown>
    if (method === 'session/list') return this.catalog!.call(method, params, timeoutMs)
    if (method === 'session/new' || method === 'session/load') {
      const known = typeof p.sessionId === 'string' ? this.clients.get(p.sessionId) : undefined
      // Loading a live session must not restart or cancel an in-flight turn.
      if (known) return { sessionId: p.sessionId }
      const client = await this.create()
      let boundId = typeof p.sessionId === 'string' ? p.sessionId : undefined
      const queued: CursorAcpInbound[] = []
      let replaying = method === 'session/load'
      const replayConfiguration: Record<string, any> = {}
      const receive = (message: CursorAcpInbound) => {
        // Initial load replays history, not a live turn. Keep only configuration
        // state and reject callbacks before this wrapper has a committed session.
        if (replaying) {
          if (message.kind === 'request') {
            void client.respondError(message.id, -32600, `${this.label} session is not loaded.`).catch(() => undefined)
          } else if ((message.params as { sessionId?: string } | undefined)?.sessionId === boundId) {
            this.updateConfiguration(boundId!, message, replayConfiguration)
          }
          return
        }
        const incomingId = (message.params as { sessionId?: string } | undefined)?.sessionId
        if (!boundId) { if (queued.length < 200) queued.push(message); return }
        if (incomingId !== boundId) return
        this.updateConfiguration(boundId, message)
        if (message.kind === 'request') {
          const id = `${this.backend}-callback:${++this.nextCallback}`
          this.callbacks.set(id, { client, id: message.id })
          message = { ...message, id }
        }
        for (const handler of this.inbound) handler(message)
      }
      client.onInbound(receive)
      client.onUnavailable(() => {
        if (boundId && this.clients.get(boundId) === client) { this.clients.delete(boundId); this.configurations.delete(boundId) }
        void this.dispose(client).catch(() => undefined)
      })
      try {
        const result = await client.call(method, params, timeoutMs)
        const id = method === 'session/load' ? p.sessionId : (result as Record<string, unknown>).sessionId
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,240}$/.test(id) || this.clients.has(id) || this.closed
          || (method === 'session/load' && typeof (result as Record<string, unknown>).sessionId === 'string' && (result as Record<string, unknown>).sessionId !== id)) throw new CursorAcpError('ACP_INVALID_SESSION', `${this.label} returned an invalid session.`)
        this.clients.set(id, client)
        const config = { ...(result as Record<string, any>) }
        this.updateConfiguration(id, { kind: 'notification', method: 'session/update', params: {
          update: { sessionUpdate: 'config_option_update', configOptions: config.configOptions },
        } }, config)
        for (const key of ['models', 'modes']) {
          if (replayConfiguration[key]) config[key] = { ...config[key], ...replayConfiguration[key] }
        }
        this.configurations.set(id, config)
        boundId = id
        replaying = false
        for (const message of queued) receive(message)
        return { ...(result as object), sessionId: id }
      } catch (error) { await this.dispose(client); throw error }
    }
    const client = this.clients.get(String(p.sessionId))
    if (!client) throw new CursorAcpError('ACP_SESSION_NOT_LOADED', `Load the ${this.label} session before using it.`)
    const id = String(p.sessionId)
    if (this.backend === 'cursor' && (method === 'dsh/sessionModels' || method === 'dsh/selectModel')) return client.call(method, params, timeoutMs)
    if (method === 'dsh/sessionModels') return this.models(id)
    if (method === 'dsh/selectModel') {
      if (this.busy.has(id)) throw new CursorAcpError('PROMPT_IN_PROGRESS', `Stop the ${this.label} reply before changing its model.`)
      const config = this.configurations.get(id)!
      if (!config?.models?.availableModels?.some((item: any) => item.modelId === p.model)
        || (p.reasoningEffort !== undefined && !config?.modes?.availableModes?.some((item: any) => item.id === p.reasoningEffort))) {
        throw new CursorAcpError('INVALID_MESSAGE', `The ${this.label} model or thinking level is not available.`)
      }
      this.busy.add(id)
      try {
        const modelResult = await client.call('session/set_config_option', { sessionId: id, configId: 'model', value: p.model })
        this.updateConfiguration(id, { kind: 'notification', method: 'session/update', params: { update: { sessionUpdate: 'config_option_update', configOptions: (modelResult as { configOptions?: unknown }).configOptions } } })
        if (this.configurations.get(id)?.models?.currentModelId !== p.model) throw new CursorAcpError('ACP_MODEL_NOT_CONFIRMED', `${this.label} did not confirm the model change.`)
        if (p.reasoningEffort !== undefined) {
          if (!this.configurations.get(id)?.modes?.availableModes?.some((item: any) => item.id === p.reasoningEffort)) throw new CursorAcpError('INVALID_MESSAGE', 'The selected model does not support this thinking level.')
          const thinkingResult = await client.call('session/set_config_option', { sessionId: id, configId: 'thought_level', value: p.reasoningEffort })
          this.updateConfiguration(id, { kind: 'notification', method: 'session/update', params: { update: { sessionUpdate: 'config_option_update', configOptions: (thinkingResult as { configOptions?: unknown }).configOptions } } })
          if (this.configurations.get(id)?.modes?.currentModeId !== p.reasoningEffort) throw new CursorAcpError('ACP_MODEL_NOT_CONFIRMED', `${this.label} did not confirm the thinking change.`)
        }
        return { selected: this.models(id).current }
      } finally { this.busy.delete(id) }
    }
    if (method === 'session/prompt') {
      if (this.busy.has(id)) throw new CursorAcpError('PROMPT_IN_PROGRESS', `The ${this.label} session is busy.`)
      this.busy.add(id)
      try { return await client.call(method, params, timeoutMs) } finally { this.busy.delete(id) }
    }
    return client.call(method, params, timeoutMs)
  }
  private updateConfiguration(id: string, message: CursorAcpInbound, initial?: Record<string, any>) {
    if (message.method !== 'session/update') return
    const update = (message.params as { update?: Record<string, any> }).update
    const config = initial ?? this.configurations.get(id)
    if (!update || !config) return
    if (update.sessionUpdate === 'current_mode_update' && typeof update.currentModeId === 'string') config.modes = { ...config.modes, currentModeId: update.currentModeId }
    if (update.sessionUpdate === 'config_option_update' && Array.isArray(update.configOptions)) {
      for (const option of update.configOptions) {
        if (option?.type !== 'select' || !Array.isArray(option.options)) continue
        const options = option.options.flatMap((item: any) => Array.isArray(item?.options) ? item.options : [item])
          .filter((item: any) => typeof item?.value === 'string' && typeof item?.name === 'string')
        if (option.id === 'model') config.models = { currentModelId: option.currentValue,
          availableModels: options.map((item: any) => ({ modelId: item.value, name: item.name })) }
        if (option.id === 'thought_level') config.modes = { currentModeId: option.currentValue,
          availableModes: options.map((item: any) => ({ id: item.value, name: item.name })) }
      }
    }
  }
  private models(id: string) {
    const config = this.configurations.get(id)
    const modes = config?.modes
    return { current: { provider: 'pi', model: config?.models?.currentModelId ?? '', reasoningEffort: modes?.currentModeId },
      routable: true, failures: [], groups: [{ id: 'pi', name: `${this.label}`, models: (config?.models?.availableModels ?? []).map((model: any) => ({
        id: model.modelId, name: model.name, ...(modes?.availableModes?.length ? { reasoning: { efforts: modes.availableModes.map((mode: any) => ({ id: mode.id, name: mode.name })), defaultEffort: modes.currentModeId } } : {}),
      })) }] }
  }

  /** A separate wrapper prevents history reads from interrupting active sessions. */
  async history(sessionId: string, cwd: string): Promise<unknown[]> {
    if (this.historyBusy) throw new CursorAcpError('ACP_PROCESS_LIMIT', `A ${this.label} history read is already in progress.`)
    this.historyBusy = true
    let client: CursorAcpLike
    try { client = await this.create(true) }
    catch (error) { this.historyBusy = false; throw error }
    const updates: CursorAcpInbound[] = []
    let bytes = 0
    let count = 0
    client.onInbound(message => {
      if (message.kind !== 'notification' || message.method !== 'session/update' || (message.params as { sessionId?: string } | null)?.sessionId !== sessionId) return
      count++
      bytes += Buffer.byteLength(JSON.stringify(message))
      if (bytes <= 8 * 1024 * 1024 && count <= 10000) updates.push(message)
    })
    try {
      const result = await client.call('session/load', { sessionId, cwd, mcpServers: [] })
      const loadedId = (result as { sessionId?: unknown } | null)?.sessionId
      if (loadedId !== undefined && loadedId !== sessionId) throw new CursorAcpError('ACP_INVALID_SESSION', `${this.label} returned an invalid history session.`)
      if (bytes > 8 * 1024 * 1024 || count > 10000) throw new CursorAcpError('ACP_HISTORY_TOO_LARGE', `${this.label} history exceeds the transfer limit.`)
      return acpHistoryEvents(updates, sessionId, this.backend)
    }
    finally { try { await this.dispose(client) } finally { this.historyBusy = false } }
  }
  async respond(id: string | number, result: unknown): Promise<void> {
    const pending = this.callbacks.get(String(id))
    if (!pending) throw new CursorAcpError('ACP_CALLBACK_NOT_FOUND', `The ${this.label} callback is unavailable.`)
    this.callbacks.delete(String(id)); await pending.client.respond(pending.id, result)
  }
  async respondError(id: string | number, code: number, message: string): Promise<void> {
    const pending = this.callbacks.get(String(id))
    if (!pending) return
    this.callbacks.delete(String(id)); await pending.client.respondError(pending.id, code, message)
  }
  onInbound(handler: CursorAcpInboundHandler): () => void { this.inbound.add(handler); return () => this.inbound.delete(handler) }
  onUnavailable(handler: CursorAcpUnavailableHandler): () => void { this.unavailable.add(handler); return () => this.unavailable.delete(handler) }
  private async dispose(client: CursorAcpLike): Promise<void> {
    await client.close()
    this.all.delete(client)
    for (const [key, pending] of this.callbacks) if (pending.client === client) this.callbacks.delete(key)
  }
  async close(): Promise<void> {
    this.closed = true
    const clients = this.all
    await Promise.all([...clients].map(client => this.dispose(client)))
    this.clients.clear()
    this.all.clear()
    this.callbacks.clear()
  }
}
