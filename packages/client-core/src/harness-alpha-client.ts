import { RemoteGatewayError, RemoteTypertGateway, createRemoteId, type RemoteGatewayResult, type RemoteGatewayStream } from './remote-gateway.js'
import type { RemoteClientCore } from './index.js'

export interface HarnessAlphaHostInfo {
  clientVersion?: string
  harnessVersion?: string
  sessionFormat?: 3
}

export interface HarnessClientFrame {
  rpcId: string
  payload: Record<string, unknown>
}

export interface HarnessModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface HarnessModelProviderGroup {
  id: string
  name: string
  models: Array<{
    id: string
    name: string
    description?: string
    reasoning?: {
      efforts: Array<{ id: string; name: string; description?: string }>
      defaultEffort?: string
    }
  }>
}

export interface HarnessSessionModels {
  current: HarnessModelSelection
  routable: boolean
  groups: HarnessModelProviderGroup[]
  failures: Array<{ id: string; name: string; message: string }>
}

export interface HarnessRemoteSession {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  title?: string
  parentSessionId?: string
  origin?: 'subagent'
  cwd?: string
  agentPreset?: string
  projections?: {
    asOfSeq?: number
    values?: Record<string, unknown>
  }
}

export interface HarnessWorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  createdAt: string
  updatedAt: string
}

export interface HarnessWorkspaceList {
  items: HarnessWorkspaceView[]
  archivedSessionIds: string[]
}

export interface HarnessDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

export interface HarnessDirectoryListing {
  path: string
  home: string
  crumbs: HarnessDirectoryEntry[]
  entries: HarnessDirectoryEntry[]
  truncated: boolean
}

export interface HarnessHostDescriptor {
  version: string
  cwd: string
  provider?: string
  model?: string
  attachedSessions: number
  canOpenPath: boolean
}

export interface HarnessPromptImage {
  mediaType: string
  data: string
  name?: string
}

export interface HarnessQuestionAnswer {
  answers: Array<{ id: string; selected: string[]; custom?: string }>
}

export interface HarnessSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  sourceEventSeqs?: number[]
  surfaceOp?: HarnessSurfaceOp
  ignorable?: true
}

export type HarnessSurfaceOp =
  | 'append'
  | { op: 'replace'; start: number; end: number }
  | { op: 'replace'; startSeq: number; endSeq: number }

export interface HarnessHistoryEntry {
  event: HarnessSessionEvent
  view?: { for: 'call' | 'result'; view: unknown }
}

export interface HarnessSessionHistoryPage {
  events: HarnessHistoryEntry[]
  hasMore: boolean
}

type RemoteEventKind = 'approval/request' | 'user-questions/request'

interface PendingRemoteEvent {
  event: RemoteEventKind
  eventId: string
  sessionId: string
}

type StreamHandle = {
  controller: AbortController
  stream?: RemoteGatewayStream
  iterator?: AsyncIterator<unknown>
}

interface AssistantStreamState {
  attemptId: string
  startedAfterSeq: number
  turn: number
  step: number
  nextIndex: number
}

type SessionFollowHandle = StreamHandle & {
  sessionId: string
  assistant?: AssistantStreamState
}

const LEGACY_AGENT_PRESET = 'code'
const LEGACY_AGENT_PRESET_TARGET = 'ptc'

export class HarnessAlphaClient {
  readonly mode = 'remote' as const

  private readonly gateway: RemoteTypertGateway
  private readonly sessionsCache = new Map<string, HarnessRemoteSession>()
  private readonly selectedModels = new Map<string, HarnessModelSelection>()
  private readonly followCursors = new Map<string, number>()
  private readonly pendingEvents = new Map<string, PendingRemoteEvent>()
  private events?: StreamHandle
  private control?: StreamHandle
  private sessionFollow?: SessionFollowHandle
  private eventClientId?: string
  private eventHostHome?: string

  constructor(
    core: RemoteClientCore,
    private readonly host: HarnessAlphaHostInfo = {},
    private readonly onFrame?: (frame: HarnessClientFrame) => void,
  ) {
    this.gateway = new RemoteTypertGateway(core)
  }

  start(): void {
    if (this.events === undefined) {
      const handle = { controller: new AbortController() }
      this.events = handle
      void this.pumpEvents(handle).catch(error => this.emitStreamFailure(handle, this.events, error))
    }
    if (this.control === undefined) {
      const handle = { controller: new AbortController() }
      this.control = handle
      void this.pumpControl(handle).catch(error => this.emitStreamFailure(handle, this.control, error))
    }
  }

  async close(notifyRemote = true): Promise<void> {
    await Promise.all([
      this.closeHandle(this.sessionFollow, notifyRemote),
      this.closeHandle(this.events, notifyRemote),
      this.closeHandle(this.control, notifyRemote),
    ])
    this.sessionFollow = undefined
    this.events = undefined
    this.control = undefined
    this.pendingEvents.clear()
    this.eventClientId = undefined
  }

  async sessionList(): Promise<HarnessRemoteSession[]> {
    const result = await this.callValue<{ items: HarnessRemoteSession[] }>('session/list', { _request: {} })
    const items = Array.isArray(result.items) ? result.items.map(item => normalizeSession(item)).filter((item): item is HarnessRemoteSession => item !== undefined) : []
    for (const item of items) this.sessionsCache.set(item.sessionId, item)
    return items
  }

  async sessionCreate(workspaceId?: string, cwd?: string): Promise<{ sessionId: string }> {
    const result = await this.callValue<{ sessionId: string }>('session/create', {
      request: workspaceId !== undefined
        ? { workspaceId }
        : cwd !== undefined
          ? { cwd }
          : {},
    })
    if (typeof result.sessionId !== 'string') {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid session creation result.')
    }
    return result
  }

  async sessionModels(sessionId: string): Promise<HarnessSessionModels> {
    const catalog = await this.callValue<{
      default: HarnessModelSelection
      routableProviders?: string[]
      groups: HarnessModelProviderGroup[]
      failures?: Array<{ id: string; name: string; message: string }>
    }>('session/modelCatalog', {})
    if (typeof catalog.default?.provider !== 'string' || typeof catalog.default?.model !== 'string' || !Array.isArray(catalog.groups)) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid model catalog.')
    }
    const projected = modelSelectionFromSession(this.sessionsCache.get(sessionId))
    const current = this.selectedModels.get(sessionId) ?? projected ?? catalog.default
    const routable = Array.isArray(catalog.routableProviders)
      ? catalog.routableProviders.includes(current.provider)
      : catalog.groups.length > 0
    return {
      current,
      routable,
      groups: catalog.groups,
      failures: Array.isArray(catalog.failures) ? catalog.failures : [],
    }
  }

  async sessionSelectModel(sessionId: string, selection: HarnessModelSelection): Promise<HarnessModelSelection> {
    const result = await this.callValue<{ selected: HarnessModelSelection }>('session/selectModel', {
      request: {
        sessionId,
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      },
    })
    if (typeof result.selected?.provider !== 'string' || typeof result.selected?.model !== 'string') {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid model selection.')
    }
    this.selectedModels.set(sessionId, result.selected)
    return result.selected
  }

  async sessionSelectPermission(sessionId: string, preset: string): Promise<void> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(preset)) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'Harness returned an invalid permission preset.')
    }
    const execution = await this.callValue<{
      result: { kind: 'success' | 'error'; text?: string }
    } | undefined>('commands/execute', { agentId: sessionId, line: `/permission ${preset}`, images: [] })
    if (execution === undefined) throw new RemoteGatewayError('UNSUPPORTED', 'The Host does not provide the permission command.')
    if (execution.result.kind === 'error') {
      throw new RemoteGatewayError('COMMAND_FAILED', execution.result.text ?? 'The Host rejected the permission preset.')
    }
  }

  async sessionHistory(sessionId: string, beforeSeq?: number, maxMessages = 60): Promise<HarnessSessionHistoryPage> {
    if (beforeSeq !== undefined) {
      const throughSeq = this.followCursors.get(sessionId) ?? beforeSeq
      const page = await this.callValue<{ records: unknown[]; hasMore: boolean }>('session/page', {
        request: {
          address: { kind: 'session', sessionId },
          throughSeq,
          beforeSeq,
          maxMessages,
        },
      })
      return {
        events: historyEntriesFromRecords(Array.isArray(page.records) ? page.records : []),
        hasMore: page.hasMore === true,
      }
    }

    await this.closeSessionFollow()
    const handle: SessionFollowHandle = { sessionId, controller: new AbortController() }
    this.sessionFollow = handle
    const source = await this.gateway.open('session/follow', {
      args: {
        request: {
          address: { kind: 'session', sessionId },
          maxMessages,
          ...(this.host.sessionFormat === 3 ? { assistantStream: true as const } : {}),
        },
      },
    }, handle.controller.signal)
    handle.stream = source
    const iterator = source[Symbol.asyncIterator]()
    handle.iterator = iterator
    const first = await iterator.next()
    if (first.done || !isRecord(first.value) || first.value.type !== 'snapshot') {
      await this.closeSessionFollow()
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid session follow snapshot.')
    }
    const snapshot = first.value
    const cursor = typeof snapshot.cursor === 'number' ? snapshot.cursor : undefined
    if (cursor !== undefined) this.followCursors.set(sessionId, cursor)
    if (this.host.sessionFormat === 3) handle.assistant = assistantStreamBaseline(snapshot.assistantStream)
    this.applyProjectionBaseline(sessionId, snapshot.projections)
    void this.pumpSessionFollow(handle, iterator).catch(error => this.emitStreamFailure(handle, this.sessionFollow, error))
    return {
      events: historyEntriesFromRecords(Array.isArray(snapshot.records) ? snapshot.records : []),
      hasMore: snapshot.hasMore === true,
    }
  }

  async sessionPrompt(sessionId: string, text: string, requestId = createRemoteId(), images: HarnessPromptImage[] = []): Promise<void> {
    const timeZone = clientTimeZone()
    const content = [
      ...(text.length === 0 ? [] : [{ type: 'text' as const, text }]),
      ...images.map(image => ({
        type: 'image' as const,
        mediaType: image.mediaType,
        data: image.data,
        ...(image.name === undefined ? {} : { name: image.name }),
      })),
    ]
    await this.callValue('session/prompt', {
      request: {
        requestId,
        sessionId,
        mode: 'queue',
        content,
        ...(timeZone === undefined ? {} : { clientTimeZone: timeZone }),
      },
    })
  }

  async sessionCancel(sessionId: string): Promise<void> {
    const result = await this.callValue<{ accepted: true }>('session/cancel', { request: { sessionId } })
    if (result.accepted !== true) throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host did not accept the stop request.')
  }

  async hostDescribe(): Promise<HarnessHostDescriptor> {
    if (this.sessionsCache.size === 0) await this.sessionList().catch(() => [])
    const canOpenPath = await this.callValue<boolean>('session/canOpenWorkspacePath', {}).catch(() => false)
    return {
      version: this.host.harnessVersion ?? this.host.clientVersion ?? 'v0.1.2-rc.1',
      cwd: this.eventHostHome ?? '',
      attachedSessions: this.sessionsCache.size,
      canOpenPath,
    }
  }

  async hostListDirectory(path?: string): Promise<HarnessDirectoryListing> {
    const result = await this.callValue<HarnessDirectoryListing>('directoryPicker/list', path === undefined ? {} : { path })
    if (typeof result.path !== 'string' || !Array.isArray(result.entries)) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid directory listing.')
    }
    return result
  }

  async workspaceList(): Promise<HarnessWorkspaceList> {
    const source = await this.gateway.open('workspace/follow', { args: {} })
    const iterator = source[Symbol.asyncIterator]()
    try {
      const first = await iterator.next()
      if (first.done || !isRecord(first.value) || first.value.type !== 'baseline' || !isRecord(first.value.value)) {
        throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid workspace baseline.')
      }
      return normalizeWorkspaceList(first.value.value)
    } finally {
      await iterator.return?.()
    }
  }

  async workspaceCreate(path: string): Promise<{ workspace: HarnessWorkspaceView; created: boolean }> {
    const result = await this.callValue<{ workspace: HarnessWorkspaceView; created: boolean }>('workspace/create', { request: { path } })
    if (typeof result.workspace?.workspaceId !== 'string') {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid workspace.')
    }
    return result
  }

  async workspaceRename(workspaceId: string, title: string): Promise<HarnessWorkspaceView> {
    const result = await this.callValue<{ workspace: HarnessWorkspaceView }>('workspace/rename', { request: { workspaceId, title } })
    if (typeof result.workspace?.workspaceId !== 'string') {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host returned an invalid workspace.')
    }
    return result.workspace
  }

  async workspaceDelete(workspaceId: string): Promise<void> {
    await this.callValue('workspace/delete', { request: { workspaceId } })
  }

  async workspaceArchiveSession(sessionId: string): Promise<string[]> {
    const result = await this.callValue<{ archivedSessionIds: string[] }>('workspace/archiveSession', { request: { sessionId } })
    return Array.isArray(result.archivedSessionIds) ? result.archivedSessionIds : []
  }

  async workspaceInsertBefore(workspaceId: string, beforeWorkspaceId?: string): Promise<string[]> {
    const result = await this.callValue<{ workspaceIds: string[] }>('workspace/insertBefore', {
      request: {
        workspaceId,
        ...(beforeWorkspaceId === undefined ? {} : { beforeWorkspaceId }),
      },
    })
    return Array.isArray(result.workspaceIds) ? result.workspaceIds : []
  }

  async respondApproval(frameRpcId: string, sessionId: string, approvalId: string, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const eventId = this.pendingEvents.has(frameRpcId) ? frameRpcId : approvalId
    await this.respondEvent(eventId, { kind: 'result', value: outcome })
    this.pendingEvents.delete(eventId)
    this.emitFrame({
      rpcId: '',
      payload: { type: 'approval/resolved', sessionId, approvalId, outcome },
    })
  }

  async respondQuestion(frameRpcId: string, sessionId: string, answer: HarnessQuestionAnswer): Promise<void> {
    await this.respondEvent(frameRpcId, { kind: 'result', value: answer })
    this.pendingEvents.delete(frameRpcId)
    this.emitFrame({
      rpcId: '',
      payload: { type: 'question/resolved', sessionId, questionRpcId: frameRpcId, outcome: 'answered' },
    })
  }

  private async respondEvent(eventId: string, outcome: { kind: 'result'; value?: unknown } | { kind: 'rejected'; error: unknown }): Promise<void> {
    if (this.eventClientId === undefined) {
      throw new RemoteGatewayError('INVALID_MESSAGE', 'The Host event stream is not ready.')
    }
    await this.gateway.call('$events/result', {
      args: {
        clientId: this.eventClientId,
        eventId,
        outcome,
      },
    })
  }

  private async callValue<T>(endpoint: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const value = await this.gateway.call<T | RemoteGatewayResult<T>>(endpoint, { args }, signal)
    if (isRecord(value) && value.ok === true) return value.value as T
    if (isRecord(value) && value.ok === false && isRecord(value.error)) {
      const error = value.error
      throw new RemoteGatewayError(
        typeof error.code === 'string' ? error.code : 'internal',
        typeof error.message === 'string' ? error.message : 'The Host rejected the Remote request.',
        isRecord(error.details) ? error.details : {},
      )
    }
    return value as T
  }

  private async pumpEvents(handle: StreamHandle): Promise<void> {
    const source = await this.gateway.open('$events', { args: {} }, handle.controller.signal)
    handle.stream = source
    const iterator = source[Symbol.asyncIterator]()
    handle.iterator = iterator
    while (this.events === handle) {
      const next = await iterator.next()
      if (next.done) return
      this.routeEventFrame(next.value)
    }
  }

  private async pumpControl(handle: StreamHandle): Promise<void> {
    const source = await this.gateway.open('session/control', { args: {} }, handle.controller.signal)
    handle.stream = source
    const iterator = source[Symbol.asyncIterator]()
    handle.iterator = iterator
    while (this.control === handle) {
      const next = await iterator.next()
      if (next.done) return
      this.routeControlFrame(next.value)
    }
  }

  private async pumpSessionFollow(
    handle: SessionFollowHandle,
    iterator: AsyncIterator<unknown>,
  ): Promise<void> {
    while (this.sessionFollow === handle) {
      const next = await iterator.next()
      if (next.done) return
      for (const entry of this.entriesFromSessionFollow(handle, next.value)) {
        this.emitFrame({
          rpcId: '',
          payload: {
            type: 'session/event',
            sessionId: handle.sessionId,
            event: entry.event,
            ...(entry.view === undefined ? {} : { view: entry.view }),
          },
        })
      }
    }
  }

  private entriesFromSessionFollow(handle: SessionFollowHandle, value: unknown): HarnessHistoryEntry[] {
    if (this.host.sessionFormat !== 3 || !isRecord(value) || value.type !== 'assistant-stream') {
      return entriesFromFollowValue(value)
    }
    const frame = isRecord(value.frame) ? value.frame : undefined
    if (frame === undefined || typeof frame.type !== 'string') return []
    if (frame.type === 'start') {
      handle.assistant = assistantStreamAttempt(frame, 0)
      return []
    }
    const attempt = handle.assistant
    if (frame.type === 'end') {
      if (attempt !== undefined && frame.attemptId === attempt.attemptId) handle.assistant = undefined
      return []
    }
    if (frame.type !== 'chunk' || attempt === undefined
      || frame.attemptId !== attempt.attemptId
      || frame.index !== attempt.nextIndex
      || typeof frame.time !== 'number'
      || !isRecord(frame.chunk)) return []
    attempt.nextIndex += 1
    return [{
      event: {
        type: 'assistant/chunk',
        seq: attempt.startedAfterSeq + 1 - 1 / (attempt.nextIndex + 1),
        time: frame.time,
        data: { turn: attempt.turn, step: attempt.step, chunk: frame.chunk },
      },
    }]
  }

  private routeEventFrame(value: unknown): void {
    if (!isRecord(value) || typeof value.type !== 'string') return
    if (value.type === 'ready') {
      this.eventClientId = typeof value.clientId === 'string' ? value.clientId : undefined
      const host = isRecord(value.host) ? value.host : undefined
      this.eventHostHome = typeof host?.home === 'string' ? host.home : undefined
      return
    }
    if (value.type === 'waterfall' && typeof value.eventId === 'string' && typeof value.agentId === 'string' && isRecord(value.request)) {
      this.routeWaterfall(value.event, value.eventId, value.agentId, value.request)
      return
    }
    if (value.type === 'cancel' && typeof value.eventId === 'string') this.cancelRemoteEvent(value.eventId)
  }

  private routeWaterfall(event: unknown, eventId: string, sessionId: string, request: Record<string, unknown>): void {
    if (event === 'approval/request') {
      this.pendingEvents.set(eventId, { event, eventId, sessionId })
      this.emitFrame({
        rpcId: eventId,
        payload: {
          type: 'approval/requested',
          sessionId,
          approvalId: eventId,
          toolName: typeof request.toolName === 'string' ? request.toolName : 'Harness tool',
          ...(typeof request.callId === 'string' ? { callId: request.callId } : {}),
          ...(typeof request.reason === 'string' ? { reason: request.reason } : {}),
        },
      })
      return
    }
    if (event === 'user-questions/request') {
      this.pendingEvents.set(eventId, { event, eventId, sessionId })
      this.emitFrame({
        rpcId: eventId,
        payload: {
          type: 'question/requested',
          sessionId,
          questions: Array.isArray(request.questions) ? request.questions : [],
        },
      })
    }
  }

  private cancelRemoteEvent(eventId: string): void {
    const pending = this.pendingEvents.get(eventId)
    if (pending === undefined) return
    this.pendingEvents.delete(eventId)
    if (pending.event === 'approval/request') {
      this.emitFrame({
        rpcId: '',
        payload: { type: 'approval/resolved', sessionId: pending.sessionId, approvalId: eventId, outcome: 'cancelled' },
      })
      return
    }
    this.emitFrame({
      rpcId: '',
      payload: { type: 'question/resolved', sessionId: pending.sessionId, questionRpcId: eventId, outcome: 'cancelled' },
    })
  }

  private routeControlFrame(value: unknown): void {
    if (!isRecord(value) || typeof value.type !== 'string') return
    if (value.type === 'baseline' && isRecord(value.value) && isRecord(value.value.projections)) {
      for (const [sessionId, block] of Object.entries(value.value.projections)) this.applyProjectionBaseline(sessionId, block)
      return
    }
    if (value.type === 'projection' && typeof value.sessionId === 'string' && typeof value.key === 'string') {
      this.applyProjection(value.sessionId, value.key, value.value, typeof value.seq === 'number' ? value.seq : undefined)
    }
  }

  private applyProjectionBaseline(sessionId: string, block: unknown): void {
    if (!isRecord(block) || !isRecord(block.values)) return
    const seq = typeof block.asOfSeq === 'number' ? block.asOfSeq : undefined
    const values = normalizeProjectionValues(block.values)
    const cached = this.sessionsCache.get(sessionId)
    if (cached !== undefined) {
      this.sessionsCache.set(sessionId, {
        ...cached,
        projections: { asOfSeq: seq, values: { ...cached.projections?.values, ...values } },
      })
    }
    for (const [key, value] of Object.entries(values)) this.applyProjection(sessionId, key, value, seq)
  }

  private applyProjection(sessionId: string, key: string, value: unknown, seq?: number): void {
    const projectedValue = normalizeProjectionValue(key, value)
    const cached = this.sessionsCache.get(sessionId)
    if (cached !== undefined) {
      this.sessionsCache.set(sessionId, {
        ...cached,
        projections: {
          asOfSeq: seq ?? cached.projections?.asOfSeq,
          values: { ...cached.projections?.values, [key]: projectedValue },
        },
      })
    }
    if (key === 'modelSelection') {
      const selection = modelSelectionFromValue(projectedValue)
      if (selection !== undefined) this.selectedModels.set(sessionId, selection)
    }
    this.emitFrame({
      rpcId: '',
      payload: { type: 'session/projection', sessionId, key, value: projectedValue, ...(seq === undefined ? {} : { seq }) },
    })
  }

  private emitStreamFailure(handle: StreamHandle, active: StreamHandle | undefined, error: unknown): void {
    if (active !== handle || handle.controller.signal.aborted) return
    const failure = this.gateway.failure(error)
    this.emitFrame({ rpcId: '', payload: { type: 'stream/closed', reason: 'failed', error: failure } })
  }

  private emitFrame(frame: HarnessClientFrame): void {
    this.onFrame?.(frame)
  }

  private async closeSessionFollow(): Promise<void> {
    const follow = this.sessionFollow
    this.sessionFollow = undefined
    await this.closeHandle(follow, true)
  }

  private async closeHandle(handle: StreamHandle | undefined, notifyRemote: boolean): Promise<void> {
    if (handle === undefined) return
    if (handle.stream !== undefined) {
      await handle.stream.close(notifyRemote).catch(() => undefined)
      handle.controller.abort()
      return
    }
    handle.controller.abort()
  }
}

function normalizeSession(value: unknown): HarnessRemoteSession | undefined {
  if (!isRecord(value)
    || typeof value.sessionId !== 'string'
    || typeof value.updatedAt !== 'number'
    || typeof value.running !== 'boolean'
    || typeof value.blank !== 'boolean') return undefined
  const session = value as unknown as HarnessRemoteSession
  return {
    ...session,
    ...(session.agentPreset === undefined ? {} : { agentPreset: normalizeAgentPreset(session.agentPreset) as string }),
    ...(session.projections === undefined
      ? {}
      : {
          projections: {
            ...session.projections,
            ...(isRecord(session.projections.values)
              ? { values: normalizeProjectionValues(session.projections.values) }
              : {}),
          },
        }),
  }
}

function normalizeProjectionValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, normalizeProjectionValue(key, value)]),
  )
}

function normalizeProjectionValue(key: string, value: unknown): unknown {
  return key === 'agentPreset' ? normalizeAgentPreset(value) : value
}

function normalizeAgentPreset(value: unknown): unknown {
  return value === LEGACY_AGENT_PRESET ? LEGACY_AGENT_PRESET_TARGET : value
}

function normalizeWorkspaceList(value: Record<string, unknown>): HarnessWorkspaceList {
  return {
    items: Array.isArray(value.items)
      ? value.items.filter(item => isRecord(item) && typeof item.workspaceId === 'string') as HarnessWorkspaceView[]
      : [],
    archivedSessionIds: Array.isArray(value.archivedSessionIds)
      ? value.archivedSessionIds.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

function historyEntriesFromRecords(records: unknown[]): HarnessHistoryEntry[] {
  return records.flatMap(record => {
    if (!isRecord(record)) return []
    if (record.type === 'event' && isRecord(record.event)) return historyEntryFromEvent(record.event)
    if (record.type === 'chunks' && isRecord(record.event)) return entriesFromChunkRun(record.event)
    return []
  })
}

function entriesFromFollowValue(value: unknown): HarnessHistoryEntry[] {
  if (!isRecord(value)) return []
  if (value.type === 'event' && isRecord(value.event)) return historyEntryFromEvent(value.event)
  if (value.type === 'chunks' && isRecord(value.event)) return entriesFromChunkRun(value.event)
  return []
}

function historyEntryFromEvent(event: Record<string, unknown>): HarnessHistoryEntry[] {
  if (typeof event.type !== 'string' || typeof event.seq !== 'number' || typeof event.time !== 'number') return []
  const surfaceOp = normalizeSurfaceOp(event.surfaceOp)
  return [{
    event: {
      type: event.type,
      seq: event.seq,
      time: event.time,
      data: isRecord(event.data) ? event.data : {},
      ...(Array.isArray(event.sourceEventSeqs) ? { sourceEventSeqs: event.sourceEventSeqs.filter((item): item is number => typeof item === 'number') } : {}),
      ...(surfaceOp === undefined ? {} : { surfaceOp }),
      ...(event.ignorable === true ? { ignorable: true } : {}),
    },
  }]
}

function normalizeSurfaceOp(value: unknown): HarnessSurfaceOp | undefined {
  if (value === 'append') return value
  if (!isRecord(value) || value.op !== 'replace') return undefined
  if (typeof value.startSeq === 'number' && typeof value.endSeq === 'number') {
    return { op: 'replace', startSeq: value.startSeq, endSeq: value.endSeq }
  }
  if (typeof value.start === 'number' && typeof value.end === 'number') {
    return { op: 'replace', start: value.start, end: value.end }
  }
  return undefined
}

function assistantStreamBaseline(value: unknown): AssistantStreamState | undefined {
  if (!isRecord(value) || !isRecord(value.activeAttempt)) return undefined
  return assistantStreamAttempt(value.activeAttempt)
}

function assistantStreamAttempt(value: Record<string, unknown>, defaultNextIndex?: number): AssistantStreamState | undefined {
  const nextIndex = typeof value.nextIndex === 'number' ? value.nextIndex : defaultNextIndex
  return typeof value.attemptId === 'string'
    && typeof value.startedAfterSeq === 'number'
    && typeof value.turn === 'number'
    && typeof value.step === 'number'
    && nextIndex !== undefined
    ? {
        attemptId: value.attemptId,
        startedAfterSeq: value.startedAfterSeq,
        turn: value.turn,
        step: value.step,
        nextIndex,
      }
    : undefined
}

function entriesFromChunkRun(event: Record<string, unknown>): HarnessHistoryEntry[] {
  if (typeof event.type !== 'string' || typeof event.seq !== 'number' || typeof event.time !== 'number' || !isRecord(event.data)) return []
  const seq = event.seq
  const data = event.data
  const turn = typeof data.turn === 'number' ? data.turn : undefined
  const step = typeof data.step === 'number' ? data.step : undefined
  const chunkIndex = typeof data.index === 'number' ? data.index : undefined
  const base = {
    ...(turn === undefined ? {} : { turn }),
    ...(step === undefined ? {} : { step }),
  }
  const dt = Array.isArray(data.dt) ? data.dt.filter((item): item is number => typeof item === 'number') : []
  if (event.type === 'chunkrow/text-chunks' || event.type === 'chunkrow/reasoning-chunks') {
    const texts = Array.isArray(data.texts) ? data.texts.filter((item): item is string => typeof item === 'string') : []
    let time = event.time
    return texts.map((text, offset) => {
      if (offset > 0) time += dt[offset - 1] ?? 0
      return {
        event: {
          type: 'assistant/chunk',
          seq: seq + offset,
          time,
          data: {
            ...base,
            chunk: {
              type: event.type === 'chunkrow/text-chunks' ? 'text-delta' : 'reasoning-delta',
              ...(chunkIndex === undefined ? {} : { index: chunkIndex }),
              text,
            },
          },
        },
      }
    })
  }
  if (event.type !== 'chunkrow/tool-call-chunks') return []
  const args = Array.isArray(data.args) ? data.args.filter((item): item is string => typeof item === 'string') : []
  let time = event.time
  return args.map((text, offset) => {
    if (offset > 0) time += dt[offset - 1] ?? 0
    return {
      event: {
        type: 'assistant/chunk',
        seq: seq + offset,
        time,
        data: {
          ...base,
          chunk: {
            type: 'tool-call-delta',
            ...(chunkIndex === undefined ? {} : { index: chunkIndex }),
              id: typeof data.id === 'string' ? data.id : undefined,
            name: typeof data.name === 'string' ? data.name : undefined,
            argumentsDelta: text,
          },
        },
      },
    }
  })
}

function modelSelectionFromSession(session: HarnessRemoteSession | undefined): HarnessModelSelection | undefined {
  return modelSelectionFromValue(session?.projections?.values?.modelSelection)
}

function modelSelectionFromValue(value: unknown): HarnessModelSelection | undefined {
  if (!isRecord(value)) return undefined
  const candidates = [value.next, value.lastUsed, value]
  for (const candidate of candidates) {
    if (!isRecord(candidate) || typeof candidate.provider !== 'string' || typeof candidate.model !== 'string') continue
    return {
      provider: candidate.provider,
      model: candidate.model,
      ...(typeof candidate.reasoningEffort === 'string' ? { reasoningEffort: candidate.reasoningEffort } : {}),
    }
  }
  return undefined
}

function clientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
