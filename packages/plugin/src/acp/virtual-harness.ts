import type { ApiProxy, RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { AgentAcpClient } from '@dsh-remote/client-core'
import type { AgentAcpFrameData, AgentAcpStreamClosedData } from '@dsh-remote/protocol'
import type {
  RemoteTypertGatewayTarget,
  TypertGatewayRequest,
  TypertRpcResult,
} from '../typert-gateway-contract.js'

const CURSOR_SESSION_PREFIX = 'cursor:'
const CURSOR_WORKSPACE_PREFIX = 'cursor:cwd:'
const CURSOR_PROVIDER = 'cursor'
const CURSOR_MODEL = 'cursor'

type JsonRecord = Record<string, unknown>

export interface AcpVirtualWorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  sessionCount: number
  createdAt: string
  updatedAt: string
}

interface AcpSessionState {
  sessionId: string
  acpSessionId: string
  cwd: string
  title?: string
  blank: boolean
  running: boolean
  createdAt: number
  updatedAt: number
  events: Array<{ type: 'event'; event: NativeEvent }>
}

interface NativeEvent {
  type: string
  seq: number
  time: number
  data: unknown
  surfaceOp?: 'append' | { op: 'replace'; start: number; end: number }
}

interface FollowState {
  sessionId: string
  acpSessionId: string
  queue: AsyncValueQueue
  nextSeq: number
  turn: number
  stepOpen: boolean
  streamActive: boolean
  blockIndex?: number
  close?: () => Promise<void>
}

interface PendingApproval {
  requestHandle: string
  sessionId: string
}

interface AcpClientLike {
  createSession(cwd: string, mode?: 'agent' | 'plan' | 'ask', signal?: AbortSignal): Promise<{ sessionId: string; cwd?: string }>
  prompt(sessionId: string, text: string, signal?: AbortSignal): Promise<unknown>
  cancel(sessionId: string, signal?: AbortSignal): Promise<unknown>
  listDirectory(path: string, signal?: AbortSignal): Promise<unknown>
  openStream(
    sessionId: string,
    onFrame: (frame: AgentAcpFrameData) => void,
    onClosed?: (closed: AgentAcpStreamClosedData) => void,
    signal?: AbortSignal,
  ): Promise<{ close(): Promise<void> }>
  respond(
    requestHandle: string,
    decision: 'allow-once' | 'allow-always' | 'reject-once' | 'cancel',
    result?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>
}

/** Build the stable ACP/Cursor virtual Workspace id for an absolute Host cwd. */
export function acpCwdWorkspaceId(path: string): string {
  return `${CURSOR_WORKSPACE_PREFIX}${encodeURIComponent(path)}`
}

export function createAcpWorkspaceView(path: string, title?: string): AcpVirtualWorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: acpCwdWorkspaceId(path),
    path,
    title: label,
    sessionIds: [],
    sessionCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** ACP/Cursor has no Host-side project catalog; discovery starts empty until create/open. */
export async function discoverAcpVirtualWorkspaces(
  _client?: AcpClientLike,
  _signal?: AbortSignal,
): Promise<AcpVirtualWorkspaceView[]> {
  return []
}

/**
 * Plugin-owned virtual Harness target for Agent ACP (Cursor adapter). Projects
 * cwd workspaces and ACP sessions onto the native DSH Workspace / Session /
 * Composer surface without writing DSH SessionStore.
 */
export class AcpVirtualHarness implements RemoteTypertGatewayTarget {
  readonly api: ApiProxy

  private readonly workspaceById = new Map<string, AcpVirtualWorkspaceView>()
  private readonly sessions = new Map<string, AcpSessionState>()
  private readonly workspaceStreams = new Set<AsyncValueQueue>()
  private readonly controlStreams = new Set<AsyncValueQueue>()
  private readonly eventStreams = new Map<string, AsyncValueQueue>()
  private readonly rcMuxStreams = new Set<AsyncValueQueue>()
  private readonly rcHostStreams = new Set<AsyncValueQueue>()
  private readonly follows = new Set<FollowState>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private selectedWorkspaceId?: string
  private lastProjectionSeq = 0
  private closed = false

  constructor(
    private readonly client: AcpClientLike,
    private readonly host: { deviceId: string; name: string },
  ) {
    this.api = this.createApiProxy()
  }

  static remote(
    core: ConstructorParameters<typeof AgentAcpClient>[0],
    host: { deviceId: string; name: string },
  ): AcpVirtualHarness {
    return new AcpVirtualHarness(new AgentAcpClient(core), host)
  }

  async workspaces(): Promise<AcpVirtualWorkspaceView[]> {
    return [...this.workspaceById.values()]
  }

  async selectWorkspace(workspaceId: string): Promise<AcpVirtualWorkspaceView> {
    const workspace = this.workspaceById.get(workspaceId) ?? recreateWorkspaceFromId(workspaceId)
    if (workspace === undefined) throw new Error('The selected Cursor workspace is no longer available.')
    this.workspaceById.set(workspace.workspaceId, workspace)
    this.selectedWorkspaceId = workspace.workspaceId
    return workspace
  }

  async selectOrCreateWorkspace(path: string): Promise<AcpVirtualWorkspaceView> {
    const trimmed = path.trim()
    if (trimmed.length === 0) throw new Error('A Cursor working directory is required.')
    const existing = [...this.workspaceById.values()].find(item => item.path === trimmed)
    const workspace = existing ?? createAcpWorkspaceView(trimmed)
    this.workspaceById.set(workspace.workspaceId, workspace)
    this.selectedWorkspaceId = workspace.workspaceId
    return workspace
  }

  async preferredSessionId(): Promise<string | undefined> {
    const selected = this.selectedWorkspaceId === undefined
      ? undefined
      : this.workspaceById.get(this.selectedWorkspaceId)
    const sessionIds = selected?.sessionIds ?? []
    for (let index = sessionIds.length - 1; index >= 0; index -= 1) {
      const sessionId = sessionIds[index]!
      const session = this.sessions.get(sessionId)
      if (session !== undefined && !session.running) return sessionId
    }
    return sessionIds.at(-1)
  }

  async invoke(request: TypertGatewayRequest): Promise<unknown> {
    const result = await this.dispatch(
      `${request.namespace}/${request.method}`,
      { args: request.args },
      request.signal ?? new AbortController().signal,
    )
    if (result.ok) return result.value
    throw Object.assign(new Error(result.error.message), {
      isDSHRemoteError: true as const,
      code: result.error.code,
      details: result.error.details,
    })
  }

  async dispatch(endpoint: string, payload: unknown, signal: AbortSignal): Promise<TypertRpcResult> {
    try {
      const args = carrierArgs(payload)
      switch (endpoint) {
        case '$events/result': return business(await this.answerRemoteEvent(args, signal))
        case 'workspace/list': return business(success({
          items: this.visibleWorkspaces().map(nativeWorkspace),
          archivedSessionIds: [],
        }))
        case 'workspace/create': return business(await this.createWorkspace(requestArg(args)))
        case 'workspace/rename': return business(await this.renameWorkspace(requestArg(args)))
        case 'workspace/delete': return business(failure('workspace-read-only', 'Cursor virtual Workspaces cannot be deleted from Desktop yet.'))
        case 'workspace/insertBefore': return business({
          workspaceIds: this.visibleWorkspaces().map(item => item.workspaceId),
        })
        case 'workspace/insertSessionBefore': return business(await this.workspaceForSession(requestArg(args)))
        case 'workspace/archiveSession': return business(await this.archiveSession(requestArg(args)))
        case 'session/list': return business(success({ items: this.sessionSummaries() }))
        case 'session/search': return business(success({ items: [], hasMore: false }))
        case 'session/create': return business(await this.createSession(requestArg(args), signal))
        case 'session/fork': return business(failure('bad-request', 'Cursor Remote does not support session fork yet.'))
        case 'session/history': return business(await this.sessionHistory(requestArg(args)))
        case 'session/page': return business(await this.sessionPage(requestArg(args)))
        case 'session/prompt': return business(await this.prompt(requestArg(args), signal))
        case 'session/cancel': return business(await this.cancel(requestArg(args), signal))
        case 'session/rename': return business(await this.renameSession(requestArg(args)))
        case 'session/updateQueue': return business(failure('queue-item-not-found', 'Cursor does not expose a DSH inbox queue.'))
        case 'session/attachment': return business(failure('attachment-error', 'Cursor Remote accepts text prompts only.'))
        case 'session/modelCatalog': return business(success(modelCatalog()))
        case 'session/models': {
          nativeAcpId(requiredString(requestArg(args).sessionId, 'sessionId'))
          return business(success({
            current: { provider: CURSOR_PROVIDER, model: CURSOR_MODEL },
            routable: false,
            groups: modelCatalog().groups,
            failures: [],
          }))
        }
        case 'session/selectModel': return business(failure('bad-request', 'Cursor Remote does not expose model selection yet.'))
        case 'session/canOpenWorkspacePath': return business(this.selectedWorkspaceId !== undefined)
        case 'session/openWorkspacePath': return business(failure('bad-request', 'Opening Host paths is unavailable in Cursor mode.'))
        case 'host/describe': return business(success(this.describeHost()))
        case 'host/listDirectory':
        case 'directoryPicker/list': return business(await this.listDirectory(requestArg(args), signal))
        case 'skills/list': return business(success({ items: [] }))
        case 'commands/list': return business([])
        case 'commands/execute': return business(undefined)
        default:
          return fail('method-not-found', `Cursor virtual Harness does not implement ${endpoint}.`)
      }
    } catch (error) {
      return failFrom(error)
    }
  }

  async open(endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const args = carrierArgs(payload)
    if (endpoint === 'workspace/follow') return this.workspaceFollow(signal)
    if (endpoint === 'session/control') return this.sessionControl(signal)
    if (endpoint === 'session/follow') return this.sessionFollow(requestArg(args), signal)
    if (endpoint === '$events') return this.remoteEvents(signal)
    throw Object.assign(new Error(`Cursor virtual Harness does not implement stream ${endpoint}.`), {
      isDSHRemoteError: true as const,
      code: 'method-not-found',
      details: {},
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const stream of this.workspaceStreams) stream.close()
    for (const stream of this.controlStreams) stream.close()
    for (const stream of this.eventStreams.values()) stream.close()
    for (const stream of this.rcMuxStreams) stream.close()
    for (const stream of this.rcHostStreams) stream.close()
    this.workspaceStreams.clear()
    this.controlStreams.clear()
    this.eventStreams.clear()
    this.rcMuxStreams.clear()
    this.rcHostStreams.clear()
    const follows = [...this.follows]
    this.follows.clear()
    for (const follow of follows) {
      follow.queue.close()
      await follow.close?.().catch(() => undefined)
    }
    this.pendingApprovals.clear()
  }

  private visibleWorkspaces(): AcpVirtualWorkspaceView[] {
    if (this.selectedWorkspaceId === undefined) return [...this.workspaceById.values()]
    const selected = this.workspaceById.get(this.selectedWorkspaceId)
    if (selected === undefined) return [...this.workspaceById.values()]
    return [
      selected,
      ...[...this.workspaceById.values()].filter(item => item.workspaceId !== selected.workspaceId),
    ]
  }

  private async createWorkspace(request: JsonRecord): Promise<unknown> {
    const path = string(request.path)?.trim()
    if (path === undefined || path.length === 0) return failure('bad-request', 'A Cursor working directory is required.')
    const workspace = await this.selectOrCreateWorkspace(path)
    this.publishWorkspaceBaseline()
    return success({ workspace: nativeWorkspace(workspace), created: true })
  }

  private async renameWorkspace(request: JsonRecord): Promise<unknown> {
    const workspaceId = requiredString(request.workspaceId, 'workspaceId')
    const title = string(request.title)?.trim()
    const workspace = this.workspaceById.get(workspaceId)
    if (workspace === undefined) return failure('workspace-not-found', 'The Cursor virtual Workspace was not found.')
    if (title === undefined || title.length === 0) return failure('bad-request', 'A Workspace name is required.')
    const next = { ...workspace, title, updatedAt: new Date().toISOString() }
    this.workspaceById.set(workspaceId, next)
    this.publishWorkspaceBaseline()
    return success({ workspace: nativeWorkspace(next) })
  }

  private async workspaceForSession(request: JsonRecord): Promise<unknown> {
    const sessionId = string(request.sessionId)
    const workspace = [...this.workspaceById.values()].find(item => sessionId !== undefined && item.sessionIds.includes(sessionId))
    return workspace === undefined
      ? failure('workspace-not-found', 'The Cursor virtual Workspace was not found.')
      : success({ workspace: nativeWorkspace(workspace) })
  }

  private async archiveSession(request: JsonRecord): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    this.sessions.delete(sessionId)
    for (const [workspaceId, workspace] of this.workspaceById) {
      if (!workspace.sessionIds.includes(sessionId)) continue
      const sessionIds = workspace.sessionIds.filter(id => id !== sessionId)
      this.workspaceById.set(workspaceId, {
        ...workspace,
        sessionIds,
        sessionCount: sessionIds.length,
        updatedAt: new Date().toISOString(),
      })
    }
    this.emitRemoteEvent('api-session/removed', [sessionId])
    this.publishWorkspaceBaseline()
    return success({ archivedSessionIds: [sessionId] })
  }

  private async createSession(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const workspaceId = string(request.workspaceId) ?? this.selectedWorkspaceId
    const workspace = workspaceId === undefined ? undefined : this.workspaceById.get(workspaceId)
    const cwd = string(request.cwd) ?? workspace?.path
    if (cwd === undefined) return failure('workspace-not-found', 'The Cursor virtual Workspace was not found.')
    const created = await this.client.createSession(cwd, 'agent', signal)
    const session = this.registerSession(created.sessionId, cwd, workspace?.title)
    this.attachSessionToWorkspace(cwd, session.sessionId)
    this.publishWorkspaceBaseline()
    const seq = this.nextProjectionSeq()
    this.emitRemoteEvent('api-session/added', [this.sessionSummary(session, seq)])
    return success({ sessionId: session.sessionId })
  }

  private async prompt(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const session = this.sessions.get(sessionId)
    if (session === undefined) return failure('session-not-found', 'The Cursor Session was not found.')
    const text = extractPromptText(array(request.content))
    if (text === undefined) return failure('attachment-error', 'Cursor Remote accepts text prompts only.')
    await this.ensureFollow(session)
    const userEvent = this.appendHistory(session, {
      type: 'user/message',
      seq: session.events.length,
      time: Date.now(),
      data: { text },
      surfaceOp: 'append',
    })
    for (const follow of this.follows) {
      if (follow.sessionId !== sessionId) continue
      follow.queue.push({ type: 'event', event: { ...userEvent, seq: follow.nextSeq++ } })
    }
    session.blank = false
    session.running = true
    session.updatedAt = Date.now()
    this.emitRemoteEvent('api-session/status', [sessionId, true])
    await this.client.prompt(session.acpSessionId, text, signal)
    return success({ accepted: true })
  }

  private async cancel(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const session = this.sessions.get(sessionId)
    if (session === undefined) return failure('session-not-found', 'The Cursor Session was not found.')
    await this.client.cancel(session.acpSessionId, signal)
    session.running = false
    this.emitRemoteEvent('api-session/status', [sessionId, false])
    return success({ accepted: true })
  }

  private async renameSession(request: JsonRecord): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const title = string(request.title)?.trim()
    const session = this.sessions.get(sessionId)
    if (session === undefined) return failure('session-not-found', 'The Cursor Session was not found.')
    if (title === undefined) return failure('bad-request', 'A Session title is required.')
    session.title = title
    session.updatedAt = Date.now()
    this.publishProjection(sessionId, 'title', title)
    return success({ sessionId })
  }

  private async sessionHistory(request: JsonRecord): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const session = this.sessions.get(sessionId)
    if (session === undefined) return failure('session-not-found', 'The Cursor Session was not found.')
    return success(this.historyPage(session, undefined, optionalPositiveInteger(request.maxMessages) ?? 50))
  }

  private async sessionPage(request: JsonRecord): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const session = this.sessions.get(sessionId)
    if (session === undefined) return failure('session-not-found', 'The Cursor Session was not found.')
    return success(this.historyPage(session, optionalInteger(request.beforeSeq), optionalPositiveInteger(request.limit) ?? 50))
  }

  private historyPage(session: AcpSessionState, beforeSeq: number | undefined, limit: number) {
    const filtered = beforeSeq === undefined
      ? session.events
      : session.events.filter(entry => entry.event.seq < beforeSeq)
    const records = filtered.slice(Math.max(0, filtered.length - limit))
    const cursor = records[0]?.event.seq ?? -1
    return {
      header: {
        version: 1,
        id: session.sessionId,
        createdAt: session.createdAt,
        cwd: session.cwd,
      },
      cursor,
      nextTurn: 1,
      records,
      hasMore: filtered.length > records.length,
      ...(session.running ? { activeTurnId: 'cursor-live' } : {}),
    }
  }

  private describeHost(): JsonRecord {
    const workspace = this.selectedWorkspaceId === undefined
      ? undefined
      : this.workspaceById.get(this.selectedWorkspaceId)
    return {
      version: 'Cursor Remote',
      cwd: workspace?.path ?? '',
      home: workspace?.path ?? '',
      provider: 'Cursor',
      model: CURSOR_MODEL,
      attachedSessions: this.sessions.size,
      canOpenPath: workspace !== undefined,
    }
  }

  private async listDirectory(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const workspace = this.selectedWorkspaceId === undefined
      ? undefined
      : this.workspaceById.get(this.selectedWorkspaceId)
    if (workspace === undefined) return failure('workspace-not-found', 'The Cursor virtual Workspace was not found.')
    const path = string(request.path) ?? workspace.path
    return success(await this.client.listDirectory(path, signal))
  }

  private async answerRemoteEvent(args: JsonRecord, signal: AbortSignal): Promise<undefined> {
    const eventId = string(args.eventId)
    const outcome = record(args.outcome)
    if (eventId === undefined) throw new Error('The Cursor approval result is missing its event id.')
    const pending = this.pendingApprovals.get(eventId)
    if (pending === undefined) return undefined
    this.pendingApprovals.delete(eventId)
    const decision = outcome.kind === 'result' && outcome.value === 'allowed-once'
      ? 'allow-once'
      : outcome.kind === 'result' && outcome.value === 'cancelled'
        ? 'cancel'
        : 'reject-once'
    await this.client.respond(pending.requestHandle, decision, undefined, signal)
    return undefined
  }

  private async workspaceFollow(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const queue = new AsyncValueQueue(signal)
    this.workspaceStreams.add(queue)
    queue.push({
      type: 'baseline',
      value: {
        items: this.visibleWorkspaces().map(nativeWorkspace),
        archivedSessionIds: [],
      },
    })
    return queue.iterate(() => this.workspaceStreams.delete(queue))
  }

  private async sessionControl(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const queue = new AsyncValueQueue(signal)
    this.controlStreams.add(queue)
    queue.push({ type: 'ready' })
    return queue.iterate(() => this.controlStreams.delete(queue))
  }

  private async remoteEvents(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const id = `cursor-events:${Date.now()}:${Math.random()}`
    const queue = new AsyncValueQueue(signal)
    this.eventStreams.set(id, queue)
    return queue.iterate(() => this.eventStreams.delete(id))
  }

  private async sessionFollow(request: JsonRecord, signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const sessionId = sessionIdFromAddress(record(request.address))
    const session = this.sessions.get(sessionId)
    if (session === undefined) throw new Error('The Cursor Session was not found.')
    const history = this.historyPage(session, undefined, optionalPositiveInteger(request.maxMessages) ?? 50)
    const queue = new AsyncValueQueue(signal)
    const follow: FollowState = {
      sessionId,
      acpSessionId: session.acpSessionId,
      queue,
      nextSeq: Math.max(0, ...session.events.map(entry => entry.event.seq)) + 1,
      turn: 1,
      stepOpen: session.running,
      streamActive: false,
    }
    this.follows.add(follow)
    queue.push({
      type: 'snapshot',
      header: history.header,
      cursor: history.cursor,
      records: history.records,
      hasMore: history.hasMore,
      projections: {
        asOfSeq: history.cursor,
        values: {
          title: session.title ?? null,
          sessionListMetadata: { blank: session.blank, lastPromptAt: null },
          modelSelection: {
            lastUsed: { provider: CURSOR_PROVIDER, model: CURSOR_MODEL },
            next: { provider: CURSOR_PROVIDER, model: CURSOR_MODEL },
          },
          imageLimits: {
            maxImageBytes: 0,
            maxImagesPerMessage: 0,
            mediaTypes: [],
          },
        },
      },
    })
    try {
      const stream = await this.client.openStream(
        session.acpSessionId,
        frame => this.acceptAcpFrame(follow, frame),
        () => {
          session.running = false
          this.emitRemoteEvent('api-session/status', [sessionId, false])
          this.closeFollowAfterRemoteStreamClosed(follow)
        },
        signal,
      )
      follow.close = () => stream.close()
    } catch (error) {
      this.follows.delete(follow)
      queue.close()
      throw error
    }
    return queue.iterate(() => {
      this.follows.delete(follow)
      void follow.close?.().catch(() => undefined)
    })
  }

  private async ensureFollow(session: AcpSessionState): Promise<void> {
    if ([...this.follows].some(follow => follow.sessionId === session.sessionId)) return
    // Native UI opens session/follow; prompts before follow still work via Host stream open on demand.
    const controller = new AbortController()
    const queue = new AsyncValueQueue(controller.signal)
    const follow: FollowState = {
      sessionId: session.sessionId,
      acpSessionId: session.acpSessionId,
      queue,
      nextSeq: Math.max(0, ...session.events.map(entry => entry.event.seq)) + 1,
      turn: 1,
      stepOpen: false,
      streamActive: false,
    }
    this.follows.add(follow)
    const stream = await this.client.openStream(
      session.acpSessionId,
      frame => this.acceptAcpFrame(follow, frame),
      () => this.closeFollowAfterRemoteStreamClosed(follow),
    )
    follow.close = async () => {
      controller.abort()
      await stream.close()
    }
  }

  private acceptAcpFrame(follow: FollowState, frame: AgentAcpFrameData): void {
    const method = frame.frame.method
    const params = record(frame.frame.params)
    if (method === 'session/update') {
      this.acceptSessionUpdate(follow, params)
      return
    }
    if (method === 'session/request_permission' || method === 'cursor/ask_question' || method === 'cursor/create_plan') {
      this.acceptApproval(follow, params, method)
    }
  }

  private acceptSessionUpdate(follow: FollowState, params: JsonRecord): void {
    const update = isRecord(params.update) ? params.update : params
    const kind = string(update.sessionUpdate) ?? string(update.type)
    const session = this.sessions.get(follow.sessionId)
    if (kind === 'agent_message_chunk' || kind === 'agent_message') {
      const text = extractText(update)
      if (text === undefined || text.length === 0) return
      this.appendAssistantDelta(follow, text)
      return
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      const toolName = string(update.title) ?? string(update.toolName) ?? string(update.name) ?? 'tool'
      const status = string(update.status)
      this.pushEvent(follow, 'tool/call', {
        turn: follow.turn,
        step: 1,
        toolCallId: string(update.toolCallId) ?? toolName,
        toolName,
        status: status === 'completed' ? 'finished' : status === 'failed' ? 'failed' : 'running',
      })
      if (session !== undefined) session.updatedAt = Date.now()
      return
    }
    if (kind === 'agent_thought_chunk') {
      const text = extractText(update)
      if (text === undefined || text.length === 0) return
      this.appendReasoningDelta(follow, text)
      return
    }
    if (kind === 'prompt_completed' || kind === 'prompt_failed') {
      const hasLiveContent = follow.stepOpen || follow.streamActive
      if (!hasLiveContent && Array.isArray(update.catchUp)) {
        for (const item of update.catchUp) {
          if (!isRecord(item) || typeof item.method !== 'string') continue
          const params = isRecord(item.params) ? item.params : {}
          if (item.method === 'session/update') this.acceptSessionUpdate(follow, params)
        }
      }
      if (session !== undefined) {
        session.running = false
        session.updatedAt = Date.now()
        this.emitRemoteEvent('api-session/status', [follow.sessionId, false])
      }
      this.closeFollowAfterRemoteStreamClosed(follow)
    }
  }

  private acceptApproval(follow: FollowState, params: JsonRecord, method: string): void {
    const requestHandle = string(params.requestHandle)
    if (requestHandle === undefined) return
    this.pendingApprovals.set(requestHandle, { requestHandle, sessionId: follow.sessionId })
    const toolName = method === 'cursor/create_plan'
      ? (string(params.name) ?? 'plan')
      : method === 'cursor/ask_question'
        ? (string(params.title) ?? 'question')
        : (string(params.toolName) ?? 'permission')
    const reason = method === 'cursor/create_plan'
      ? string(params.overview) ?? string(params.plan)
      : method === 'cursor/ask_question'
        ? summarizeQuestions(params)
        : string(params.reason)
    this.emitApproval({
      eventId: requestHandle,
      agentId: follow.sessionId,
      request: {
        toolName,
        ...(reason === undefined ? {} : { reason }),
      },
    })
  }

  private appendAssistantDelta(follow: FollowState, delta: string): void {
    if (!follow.stepOpen) {
      follow.turn += 1
      follow.stepOpen = true
      this.pushEvent(follow, 'turn/start', { turn: follow.turn })
      this.pushEvent(follow, 'step/start', { turn: follow.turn, step: 1 })
    }
    if (follow.blockIndex === undefined) {
      follow.blockIndex = 0
      follow.streamActive = true
      this.pushEvent(follow, 'assistant/chunk', {
        turn: follow.turn,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      })
    }
    this.pushEvent(follow, 'assistant/chunk', {
      turn: follow.turn,
      step: 1,
      chunk: { type: 'text-delta', index: follow.blockIndex, text: delta },
    })
  }

  private appendReasoningDelta(follow: FollowState, delta: string): void {
    if (!follow.stepOpen) {
      follow.turn += 1
      follow.stepOpen = true
      this.pushEvent(follow, 'turn/start', { turn: follow.turn })
      this.pushEvent(follow, 'step/start', { turn: follow.turn, step: 1 })
    }
    const index = (follow.blockIndex ?? -1) + 1
    follow.blockIndex = index
    this.pushEvent(follow, 'assistant/chunk', {
      turn: follow.turn,
      step: 1,
      chunk: { type: 'block-start', index, blockType: 'reasoning' },
    })
    this.pushEvent(follow, 'assistant/chunk', {
      turn: follow.turn,
      step: 1,
      chunk: { type: 'reasoning-delta', index, text: delta },
    })
  }

  private closeFollowAfterRemoteStreamClosed(follow: FollowState): void {
    if (follow.streamActive && follow.blockIndex !== undefined) {
      this.pushEvent(follow, 'assistant/chunk', {
        turn: follow.turn,
        step: 1,
        chunk: { type: 'block-end', index: follow.blockIndex, block: { type: 'text', text: '' } },
      })
      this.pushEvent(follow, 'assistant/chunk', {
        turn: follow.turn,
        step: 1,
        chunk: { type: 'finish', reason: { kind: 'stop' } },
      })
    }
    follow.streamActive = false
    follow.stepOpen = false
    follow.blockIndex = undefined
  }

  private pushEvent(follow: FollowState, type: string, data: unknown): number {
    const seq = follow.nextSeq++
    const event: NativeEvent = {
      type,
      seq,
      time: Date.now(),
      data,
      ...(isSurfaceEvent(type) ? { surfaceOp: 'append' as const } : {}),
    }
    const session = this.sessions.get(follow.sessionId)
    if (session !== undefined) this.appendHistory(session, event)
    follow.queue.push({ type: 'event', event })
    this.broadcastRcMux({
      type: 'session/event',
      sessionId: follow.sessionId,
      event,
    })
    return seq
  }

  private appendHistory(session: AcpSessionState, event: NativeEvent): NativeEvent {
    const next = { ...event, seq: session.events.length }
    session.events.push({ type: 'event', event: next })
    return next
  }

  private registerSession(acpSessionId: string, cwd: string, title?: string): AcpSessionState {
    const now = Date.now()
    const session: AcpSessionState = {
      sessionId: `${CURSOR_SESSION_PREFIX}${acpSessionId}`,
      acpSessionId,
      cwd,
      ...(title === undefined ? {} : { title }),
      blank: true,
      running: false,
      createdAt: now,
      updatedAt: now,
      events: [],
    }
    this.sessions.set(session.sessionId, session)
    return session
  }

  private attachSessionToWorkspace(cwd: string, sessionId: string): void {
    const workspace = [...this.workspaceById.values()].find(item => item.path === cwd)
      ?? createAcpWorkspaceView(cwd)
    const sessionIds = [sessionId, ...workspace.sessionIds.filter(id => id !== sessionId)]
    const next = {
      ...workspace,
      sessionIds,
      sessionCount: sessionIds.length,
      updatedAt: new Date().toISOString(),
    }
    this.workspaceById.set(next.workspaceId, next)
    if (this.selectedWorkspaceId === undefined) this.selectedWorkspaceId = next.workspaceId
  }

  private sessionSummaries(): unknown[] {
    const selected = this.selectedWorkspaceId === undefined
      ? undefined
      : this.workspaceById.get(this.selectedWorkspaceId)
    const allowed = new Set(selected?.sessionIds ?? [...this.sessions.keys()])
    return [...this.sessions.values()]
      .filter(session => allowed.has(session.sessionId))
      .map(session => this.sessionSummary(session, 0))
  }

  private sessionSummary(session: AcpSessionState, asOfSeq: number): JsonRecord {
    return {
      sessionId: session.sessionId,
      running: session.running,
      blank: session.blank,
      cwd: session.cwd,
      updatedAt: session.updatedAt,
      projections: {
        asOfSeq,
        values: {
          title: session.title ?? null,
          sessionListMetadata: { blank: session.blank, lastPromptAt: null },
          modelSelection: {
            lastUsed: { provider: CURSOR_PROVIDER, model: CURSOR_MODEL },
            next: { provider: CURSOR_PROVIDER, model: CURSOR_MODEL },
          },
          imageLimits: {
            maxImageBytes: 0,
            maxImagesPerMessage: 0,
            mediaTypes: [],
          },
        },
      },
    }
  }

  private publishWorkspaceBaseline(): void {
    for (const queue of this.workspaceStreams) {
      for (const workspace of this.visibleWorkspaces()) {
        queue.push({ type: 'upsert', workspace: nativeWorkspace(workspace) })
      }
      queue.push({ type: 'archived', archivedSessionIds: [] })
    }
  }

  private publishProjection(sessionId: string, key: string, value: unknown): void {
    const seq = this.nextProjectionSeq()
    for (const queue of this.controlStreams) {
      queue.push({ type: 'projection', sessionId, key, value, asOfSeq: seq })
    }
  }

  private emitRemoteEvent(event: string, args: unknown[]): void {
    for (const queue of this.eventStreams.values()) queue.push({ type: 'emit', event, args })
    const sessionId = typeof args[0] === 'string' ? args[0] : undefined
    if (event === 'api-session/status' && sessionId !== undefined && typeof args[1] === 'boolean') {
      this.broadcastRcHost({ type: 'host/session-status', sessionId, running: args[1] })
    } else if (event === 'api-session/removed' && sessionId !== undefined) {
      this.broadcastRcHost({ type: 'host/session-removed', sessionId })
    } else if (event === 'api-session/added' && isRecord(args[0])) {
      const summary = args[0]
      this.broadcastRcHost({
        type: 'host/session-added',
        sessionId: summary.sessionId,
        blank: summary.blank === true,
        ...(typeof summary.cwd === 'string' ? { cwd: summary.cwd } : {}),
      })
    }
  }

  private emitApproval(input: { eventId: string; agentId: string; request: JsonRecord }): void {
    for (const queue of this.eventStreams.values()) queue.push({
      type: 'waterfall',
      event: 'approval/request',
      eventId: input.eventId,
      agentId: input.agentId,
      request: input.request,
    })
    this.broadcastRcMux({
      type: 'approval/requested',
      sessionId: input.agentId,
      approvalId: input.eventId,
      toolName: string(input.request.toolName) ?? 'Cursor',
      ...(typeof input.request.reason === 'string' ? { reason: input.request.reason } : {}),
    }, input.eventId)
  }

  private nextProjectionSeq(): number {
    this.lastProjectionSeq += 1
    return this.lastProjectionSeq
  }

  private createApiProxy(): ApiProxy {
    const call = (endpoint: string) => async (request: RpcRequest<unknown>, signal?: AbortSignal): Promise<RpcResponse<unknown>> => {
      const payload = endpoint === 'session.prompt' && isRecord(request.payload)
        ? { ...request.payload, requestId: String(request.rpcId) }
        : request.payload
      const result = await this.dispatch(rcEndpoint(endpoint), { args: { request: payload } }, signal ?? new AbortController().signal)
      return {
        rpcId: request.rpcId,
        result: (result.ok
          ? success(result.value)
          : failure(result.error.code, result.error.message, result.error.details)) as never,
      }
    }
    return {
      sessions: {
        list: call('session.list') as never,
        search: call('session.search') as never,
        create: call('session.create') as never,
        history: call('session.history') as never,
        models: call('session.models') as never,
        selectModel: call('session.selectModel') as never,
        rename: call('session.rename') as never,
        fork: call('session.fork') as never,
        prompt: call('session.prompt') as never,
        attachment: call('session.attachment') as never,
        updateQueue: call('session.updateQueue') as never,
        cancel: call('session.cancel') as never,
      },
      workspace: {
        list: call('workspace.list') as never,
        create: call('workspace.create') as never,
        rename: call('workspace.rename') as never,
        delete: call('workspace.delete') as never,
        insertBefore: call('workspace.insertBefore') as never,
        insertSessionBefore: call('workspace.insertSessionBefore') as never,
        archiveSession: call('workspace.archiveSession') as never,
      },
      subagents: {} as ApiProxy['subagents'],
      host: {
        describe: call('host.describe') as never,
        listDirectory: call('host.listDirectory') as never,
      } as unknown as ApiProxy['host'],
      skills: { list: call('skills.list') as never },
      agentPresets: {} as ApiProxy['agentPresets'],
      goals: {} as ApiProxy['goals'],
      settings: {} as ApiProxy['settings'],
      credentials: {} as ApiProxy['credentials'],
      llm: {} as ApiProxy['llm'],
      events: {
        mux: ((request: RpcRequest<unknown>, signal: AbortSignal) => this.rcMux(request, signal)) as never,
        host: ((request: RpcRequest<unknown>, signal: AbortSignal) => this.rcHost(request, signal)) as never,
      },
      downloads: {} as ApiProxy['downloads'],
      respond: async message => {
        const pending = this.pendingApprovals.get(String(message.rpcId))
          ?? [...this.pendingApprovals.values()].find(item => item.requestHandle === String(message.rpcId))
        if (pending === undefined) return { accepted: false, reason: 'not-pending' }
        const result = message.result
        const outcome = result.ok ? result.value : undefined
        const decision = outcome === 'allowed-once' ? 'allow-once' : outcome === 'cancelled' ? 'cancel' : 'reject-once'
        await this.client.respond(pending.requestHandle, decision)
        this.pendingApprovals.delete(pending.requestHandle)
        return { accepted: true }
      },
    }
  }

  private async *rcMux(request: RpcRequest<unknown>, signal: AbortSignal): AsyncIterable<unknown> {
    const queue = new AsyncValueQueue(signal)
    this.rcMuxStreams.add(queue)
    for (const session of this.sessions.values()) {
      queue.push({
        rpcId: `${String(request.rpcId)}:${session.sessionId}:subscribed`,
        payload: { type: 'session/subscribed', sessionId: session.sessionId, lastSeq: -1 },
      })
    }
    try {
      yield* queue
    } finally {
      this.rcMuxStreams.delete(queue)
      queue.close()
    }
  }

  private async *rcHost(_request: RpcRequest<unknown>, signal: AbortSignal): AsyncIterable<unknown> {
    const queue = new AsyncValueQueue(signal)
    this.rcHostStreams.add(queue)
    try {
      yield* queue
    } finally {
      this.rcHostStreams.delete(queue)
      queue.close()
    }
  }

  private broadcastRcMux(payload: unknown, rpcId = `cursor-mux:${Date.now()}:${Math.random()}`): void {
    for (const queue of this.rcMuxStreams) queue.push({ rpcId, payload })
  }

  private broadcastRcHost(payload: unknown): void {
    const frame = { rpcId: `cursor-host:${Date.now()}:${Math.random()}`, payload }
    for (const queue of this.rcHostStreams) queue.push(frame)
  }
}

function recreateWorkspaceFromId(workspaceId: string): AcpVirtualWorkspaceView | undefined {
  if (!workspaceId.startsWith(CURSOR_WORKSPACE_PREFIX)) return undefined
  try {
    const path = decodeURIComponent(workspaceId.slice(CURSOR_WORKSPACE_PREFIX.length))
    if (path.length === 0) return undefined
    return createAcpWorkspaceView(path)
  } catch {
    return undefined
  }
}

function nativeWorkspace(view: AcpVirtualWorkspaceView): Omit<AcpVirtualWorkspaceView, 'sessionCount'> {
  return {
    workspaceId: view.workspaceId,
    path: view.path,
    title: view.title,
    sessionIds: view.sessionIds,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  }
}

function modelCatalog() {
  return {
    default: { provider: CURSOR_PROVIDER, model: CURSOR_MODEL },
    groups: [{
      id: CURSOR_PROVIDER,
      name: 'Cursor',
      models: [{ id: CURSOR_MODEL, name: 'Cursor' }],
    }],
  }
}

function extractPromptText(content: unknown[]): string | undefined {
  const parts = content.flatMap(part => {
    const item = record(part)
    if (item.type === 'text' && typeof item.text === 'string') return [item.text]
    return []
  })
  const text = parts.join('')
  return text.length === 0 ? undefined : text
}

function extractText(update: JsonRecord): string | undefined {
  const content = update.content
  if (typeof content === 'string') return content
  if (isRecord(content) && typeof content.text === 'string') return content.text
  if (Array.isArray(content)) {
    const parts = content
      .map(part => (isRecord(part) && typeof part.text === 'string' ? part.text : undefined))
      .filter((part): part is string => part !== undefined)
    return parts.length === 0 ? undefined : parts.join('')
  }
  return typeof update.text === 'string' ? update.text : undefined
}

function summarizeQuestions(params: JsonRecord): string | undefined {
  if (!Array.isArray(params.questions)) return undefined
  const lines = params.questions
    .map(question => (isRecord(question) ? string(question.prompt) : undefined))
    .filter((line): line is string => line !== undefined)
  return lines.length === 0 ? undefined : lines.join('\n')
}

function sessionIdFromAddress(address: JsonRecord): string {
  if (address.kind === 'session') return requiredString(address.sessionId, 'sessionId')
  return requiredString(address.childSessionId, 'childSessionId')
}

function nativeAcpId(sessionId: string): string {
  if (!sessionId.startsWith(CURSOR_SESSION_PREFIX) || sessionId.length === CURSOR_SESSION_PREFIX.length) {
    throw new Error('The selected Session does not belong to Cursor.')
  }
  return sessionId.slice(CURSOR_SESSION_PREFIX.length)
}

function isSurfaceEvent(type: string): boolean {
  return type === 'assistant/chunk'
    || type === 'user/message'
    || type === 'tool/call'
    || type === 'tool/result'
}

function carrierArgs(payload: unknown): JsonRecord {
  return record(record(payload).args)
}

function requestArg(args: JsonRecord): JsonRecord {
  return record(args.request ?? args._request ?? args)
}

function rcEndpoint(endpoint: string): string {
  if (endpoint === 'workspace.list') return 'workspace/list'
  return endpoint.replace('.', '/')
}

function success(value: unknown): { ok: true; value: unknown } {
  return { ok: true, value }
}

function failure(code: string, message: string, details: JsonRecord = {}): { ok: false; error: { code: string; message: string; details: JsonRecord } } {
  return { ok: false, error: { code, message, details } }
}

function business(value: unknown): TypertRpcResult {
  if (isRecord(value) && value.ok === false && isRecord(value.error)) {
    return { ok: false, error: {
      code: string(value.error.code) ?? 'internal',
      message: string(value.error.message) ?? 'The Cursor virtual Harness request failed.',
      details: isRecord(value.error.details) ? value.error.details : {},
    } }
  }
  if (isRecord(value) && value.ok === true) return { ok: true, value: value.value }
  return { ok: true, value }
}

function fail(code: string, message: string, details: JsonRecord = {}): TypertRpcResult {
  return { ok: false, error: { code, message, details } }
}

function failFrom(error: unknown): TypertRpcResult {
  const source = error instanceof Error ? error : new Error(String(error))
  const code = 'code' in source && typeof source.code === 'string' ? source.code : 'internal'
  return fail(code, source.message)
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const parsed = integer(value)
  if (parsed === undefined) throw new Error('The Cursor History cursor is invalid.')
  return parsed
}

function optionalPositiveInteger(value: unknown): number | undefined {
  const parsed = optionalInteger(value)
  if (parsed !== undefined && parsed <= 0) throw new Error('The Cursor History page size is invalid.')
  return parsed
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`The Cursor ${field} is required.`)
  return value
}

class AsyncValueQueue implements AsyncIterable<unknown> {
  private readonly values: unknown[] = []
  private readonly waiters: Array<(result: IteratorResult<unknown>) => void> = []
  private closed = false
  private readonly onAbort: () => void

  constructor(private readonly signal: AbortSignal) {
    this.onAbort = () => this.close()
    signal.addEventListener('abort', this.onAbort, { once: true })
    if (signal.aborted) this.close()
  }

  push(value: unknown): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.values.push(value)
    else waiter({ done: false, value })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.signal.removeEventListener('abort', this.onAbort)
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined })
  }

  iterate(dispose: () => void): AsyncIterable<unknown> {
    const queue = this
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
        try {
          yield* queue
        } finally {
          dispose()
          queue.close()
        }
      },
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift()
        continue
      }
      if (this.closed) return
      const next = await new Promise<IteratorResult<unknown>>(resolve => this.waiters.push(resolve))
      if (next.done) return
      yield next.value
    }
  }
}
