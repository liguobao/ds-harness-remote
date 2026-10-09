import { ACP_TOOL_CALL_ENDPOINTS, ACP_TOOL_STREAM_ENDPOINTS, type AcpSessionModels, type AgentAcpStreamOpenParams } from '@dsh-remote/protocol'
import { parseAcpImage, acpImageContent, acpImageLimits, type AcpImage } from './image-content.js'
import type { ApiProxy, RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { AgentAcpClient } from '@dsh-remote/client-core'
import type { AgentAcpFrameData, AgentAcpStreamClosedData } from '@dsh-remote/protocol'
import type {
  RemoteTypertGatewayTarget,
  TypertGatewayRequest,
  TypertRpcResult,
} from '../typert-gateway-contract.js'

const CURSOR_SESSION_PREFIX = 'cursor:'
const ACP_SESSION_PREFIX = 'acp:'
const CURSOR_WORKSPACE_PREFIX = 'cursor:cwd:'
const AGY_WORKSPACE_PREFIX = 'antigravity:cwd:'
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
  titleOverridden?: boolean
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

interface AssistantStreamAttempt {
  attemptId: string
  startedAfterSeq: number
  nextIndex: number
  stream: Array<{ type: 'chunk'; time: number; chunk: JsonRecord }>
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
  reasoningBlockIndex?: number
  assistantStreamRevision: number
  assistantAttempt?: AssistantStreamAttempt
  accumulatedText: string
  activeToolCalls: Set<string>
  close?: () => Promise<void>
}

interface PendingApproval {
  requestHandle: string
  sessionId: string
}

export interface AcpClientLike {
  sessionModels?(sessionId: string, backend: 'antigravity', signal?: AbortSignal): Promise<AcpSessionModels>
  selectModel?(sessionId: string, backend: 'antigravity', selection: AcpModelSelection, signal?: AbortSignal): Promise<AcpModelSelection>
  workspaceToolCall?(sessionId: string, backend: 'cursor' | 'antigravity', endpoint: typeof ACP_TOOL_CALL_ENDPOINTS[number], args: JsonRecord, signal?: AbortSignal): Promise<unknown>
  createSession(
    cwd: string,
    mode?: 'agent' | 'plan' | 'ask',
    backend?: 'cursor' | 'antigravity',
    signal?: AbortSignal,
  ): Promise<{ sessionId: string; cwd?: string }>
  prompt(sessionId: string, text: string, signal?: AbortSignal, images?: AcpImage[], backend?: 'cursor' | 'antigravity'): Promise<unknown>
  cancel(sessionId: string, signal?: AbortSignal): Promise<unknown>
  listDirectory(path: string, signal?: AbortSignal): Promise<unknown>
  listWorkspaces?(backend?: string, signal?: AbortSignal): Promise<Array<{ path: string; title?: string; sessionCount?: number }>>
  listSessions?(path: string, backend?: string, limit?: number, signal?: AbortSignal): Promise<Array<{ conversationId: string; title: string; createdAt: number; updatedAt: number }>>
  loadSessionHistory?(sessionId: string, backend?: string, signal?: AbortSignal): Promise<unknown[]>
  openStream(
    sessionId: string,
    onFrame: (frame: AgentAcpFrameData) => void,
    onClosed?: (closed: AgentAcpStreamClosedData) => void,
    signal?: AbortSignal,
    tool?: AgentAcpStreamOpenParams['tool'],
  ): Promise<{ close(): Promise<void> }>
  respond(
    requestHandle: string,
    decision: 'allow-once' | 'allow-always' | 'reject-once' | 'cancel',
    result?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>
}

/** Build a backend-scoped virtual Workspace id for an absolute Host cwd. */
export function acpCwdWorkspaceId(path: string, backend: 'cursor' | 'antigravity'): string {
  if (backend !== 'cursor' && backend !== 'antigravity') throw new Error('An explicit ACP workspace backend is required.')
  return `${backend === 'antigravity' ? AGY_WORKSPACE_PREFIX : CURSOR_WORKSPACE_PREFIX}${encodeURIComponent(path)}`
}

export function createAcpWorkspaceView(path: string, backend: 'cursor' | 'antigravity', title?: string): AcpVirtualWorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: acpCwdWorkspaceId(path, backend),
    path,
    title: label,
    sessionIds: [],
    sessionCount: 0,
    createdAt: now,
    updatedAt: now,
  }
}

/** Discover ACP virtual workspaces visible on the Host. */
export async function discoverAcpVirtualWorkspaces(
  client: AcpClientLike,
  backend: 'cursor' | 'antigravity',
  signal?: AbortSignal,
): Promise<AcpVirtualWorkspaceView[]> {
  if (client?.listWorkspaces !== undefined) {
    try {
      const items = await client.listWorkspaces(backend, signal)
      if (Array.isArray(items) && items.length > 0) {
        return items
          .filter(item => typeof item?.path === 'string' && item.path.trim() !== '')
          .map(item => {
            const view = createAcpWorkspaceView(item.path, backend, item.title)
            if (typeof item.sessionCount === 'number') view.sessionCount = item.sessionCount
            return view
          })
      }
    } catch {
      // Discovery is optional; an unavailable Host returns no workspaces.
    }
  }
  return []
}

/**
 * Browser-safe, in-memory Harness projection for the independent Agent ACP domain. Projects
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
  private readonly selectedModels = new Map<string, AcpModelSelection>()
  private lastProjectionSeq = 0
  private readonly imageAttachments = new Map<string, { sessionId: string; attachment: unknown; data: string }>()
  private closed = false

  constructor(
    private readonly client: AcpClientLike,
    private readonly host: { deviceId: string; name: string },
    readonly backend: 'cursor' | 'antigravity' = 'cursor',
    /**
     * Host gateway used for endpoints this virtual Harness does not project
     * (settings, plugins, models, credentials, …). A real Harness workspace
     * serves them from the Host; without this fallback the native Client would
     * see `method-not-found` for every global surface and can fail its render.
     */
    private readonly hostCarrier?: RemoteTypertGatewayTarget,
  ) {
    this.api = this.createApiProxy()
  }

  static remote(
    core: ConstructorParameters<typeof AgentAcpClient>[0],
    host: { deviceId: string; name: string },
    backend: 'cursor' | 'antigravity' = 'cursor',
    capabilities: readonly string[] = [],
    hostCarrier?: RemoteTypertGatewayTarget,
  ): AcpVirtualHarness {
    return new AcpVirtualHarness(new AgentAcpClient(core, capabilities), host, backend, hostCarrier)
  }

  async workspaces(): Promise<AcpVirtualWorkspaceView[]> {
    return [...this.workspaceById.values()]
  }

  private backendLabel(): string {
    return this.backend === 'antigravity' ? 'Antigravity' : 'Cursor'
  }

  async selectWorkspace(workspaceId: string): Promise<AcpVirtualWorkspaceView> {
    const workspace = this.workspaceById.get(workspaceId) ?? recreateWorkspaceFromId(workspaceId, this.backend)
    if (workspace === undefined) throw new Error(`The selected ${this.backendLabel()} workspace is no longer available.`)
    this.workspaceById.set(workspace.workspaceId, workspace)
    this.selectedWorkspaceId = workspace.workspaceId
    await this.discoverAndAttachSessions(workspace)
    if (workspace.sessionIds.length === 0) {
      await this.ensureInitialSession(workspace)
    }
    this.publishWorkspaceBaseline()
    return this.workspaceById.get(workspace.workspaceId) ?? workspace
  }

  async selectOrCreateWorkspace(path: string): Promise<AcpVirtualWorkspaceView> {
    const trimmed = path.trim()
    if (trimmed.length === 0) throw new Error(`A ${this.backendLabel()} working directory is required.`)
    const existing = [...this.workspaceById.values()].find(item => item.path === trimmed)
    const workspace = existing ?? createAcpWorkspaceView(trimmed, this.backend)
    this.workspaceById.set(workspace.workspaceId, workspace)
    this.selectedWorkspaceId = workspace.workspaceId
    await this.discoverAndAttachSessions(workspace)
    if (workspace.sessionIds.length === 0) {
      await this.ensureInitialSession(workspace)
    }
    this.publishWorkspaceBaseline()
    return this.workspaceById.get(workspace.workspaceId) ?? workspace
  }

  async preferredSessionId(): Promise<string | undefined> {
    const selected = this.selectedWorkspaceId === undefined
      ? undefined
      : this.workspaceById.get(this.selectedWorkspaceId)
    const sessionIds = selected?.sessionIds ?? []
    let bestSessionId: string | undefined
    let bestUpdatedAt = -1
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId)
      if (session !== undefined && !session.running && !session.blank && session.updatedAt > bestUpdatedAt) {
        bestUpdatedAt = session.updatedAt
        bestSessionId = sessionId
      }
    }
    if (bestSessionId !== undefined) return bestSessionId
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId)
      if (session !== undefined && !session.running) return sessionId
    }
    return sessionIds[0] ?? sessionIds.at(-1)
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
      if (ACP_TOOL_CALL_ENDPOINTS.some(item => item === endpoint)) {
        if (!this.client.workspaceToolCall) return business(failure('method-not-found', 'The Host does not support ACP workspace tools.'))
        const sessionId = requiredString(args.workspaceFileScopeId ?? args.agentId ?? args.sessionId, 'sessionId')
        return business(await this.client.workspaceToolCall(nativeAcpId(sessionId, this.backend), this.backend, endpoint as typeof ACP_TOOL_CALL_ENDPOINTS[number], args, signal))
      }
      switch (endpoint) {
        case '$events/result': return business(await this.answerRemoteEvent(args, signal))
        case 'workspace/list': return business(success({
          items: this.visibleWorkspaces().map(nativeWorkspace),
          archivedSessionIds: [],
          pinnedSessionIds: [],
        }))
        case 'workspace/create': return business(await this.createWorkspace(requestArg(args)))
        case 'workspace/rename': return business(await this.renameWorkspace(requestArg(args)))
        case 'workspace/delete': return business(failure('workspace-read-only', `${this.backendLabel()} virtual Workspaces cannot be deleted from Desktop yet.`))
        case 'workspace/insertBefore': return business({
          workspaceIds: this.visibleWorkspaces().map(item => item.workspaceId),
        })
        case 'workspace/insertSessionBefore': return business(await this.workspaceForSession(requestArg(args)))
        case 'workspace/archiveSession': return business(await this.archiveSession(requestArg(args)))
        case 'session/list': return business(success({ items: await this.handleSessionList() }))
        case 'session/search': return business(success({ items: [], hasMore: false }))
        case 'session/create': return business(await this.createSession(requestArg(args), signal))
        case 'session/fork': return business(failure('bad-request', `${this.backendLabel()} Remote does not support session fork yet.`))
        case 'session/history': return business(await this.sessionHistory(requestArg(args)))
        case 'session/page': return business(await this.sessionPage(requestArg(args)))
        case 'session/prompt': return business(await this.prompt(requestArg(args), signal))
        case 'session/cancel': return business(await this.cancel(requestArg(args), signal))
        case 'session/rename': return business(await this.renameSession(requestArg(args)))
        case 'session/updateQueue': return business(failure('queue-item-not-found', `${this.backendLabel()} does not expose a DSH inbox queue.`))
        case 'session/attachment': return business(await this.attachment(requestArg(args)))
        case 'session/modelCatalog': {
          const sessionId = await this.preferredSessionId()
          if (this.backend !== 'antigravity' || !sessionId) return business(success(modelCatalog(this.backend)))
          const models = await this.hostSessionModels(sessionId)
          return business(success({ default: models.current, routableProviders: models.routable ? [models.current.provider] : [], groups: models.groups, failures: models.failures }))
        }
        case 'session/models': {
          const rawId = extractSessionId(requestArg(args))
          nativeAcpId(rawId, this.backend)
          if (this.backend === 'antigravity') return business(success(await this.hostSessionModels(rawId)))
          const catalog = modelCatalog(this.backend)
          return business(success({
            current: this.modelSelection(rawId),
            routable: true,
            groups: catalog.groups,
            failures: [],
          }))
        }
        case 'session/selectModel': return business(await this.selectModel(requestArg(args)))
        case 'session/canOpenWorkspacePath': return business(this.selectedWorkspaceId !== undefined)
        case 'session/openWorkspacePath': return business(failure('bad-request', `Opening Host paths is unavailable in ${this.backendLabel()} mode.`))
        case 'host/describe': return business(success(this.describeHost()))
        case 'host/listDirectory':
        case 'directoryPicker/list': return business(await this.listDirectory(requestArg(args), signal))
        case 'skills/list': return business(success({ items: [] }))
        case 'commands/list': return business([])
        case 'commands/execute': return business(undefined)
        default:
          return this.hostCarrier === undefined
            ? fail('method-not-found', `${this.backendLabel()} virtual Harness does not implement ${endpoint}.`)
            : await this.hostCarrier.dispatch(endpoint, payload, signal)
      }
    } catch (error) {
      return failFrom(error)
    }
  }

  async open(endpoint: string, payload: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const args = carrierArgs(payload)
    if (ACP_TOOL_STREAM_ENDPOINTS.some(item => item === endpoint)) {
      const sessionId = requiredString(args.workspaceFileScopeId ?? args.agentId ?? args.sessionId, 'sessionId')
      const queue = new AsyncValueQueue(signal)
      const stream = await this.client.openStream(nativeAcpId(sessionId, this.backend), frame => {
        if (frame.frame.method === 'dsh/workspaceTool') queue.push(record(frame.frame.params).value)
      }, () => queue.close(), signal, { backend: this.backend, endpoint: endpoint as typeof ACP_TOOL_STREAM_ENDPOINTS[number], args })
      return queue.iterate(() => { void stream.close().catch(() => undefined) })
    }
    if (endpoint === 'workspace/follow') return this.workspaceFollow(signal)
    if (endpoint === 'session/control') return this.sessionControl(signal)
    if (endpoint === 'session/follow') return this.sessionFollow(requestArg(args), signal)
    if (endpoint === '$events') return this.remoteEvents(signal)
    if (endpoint === 'job/list' || endpoint === 'job/follow') return this.emptyJobStream(endpoint, signal)
    if (this.hostCarrier !== undefined) return this.hostCarrier.open(endpoint, payload, signal)
    throw Object.assign(new Error(`${this.backendLabel()} virtual Harness does not implement stream ${endpoint}.`), {
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
    this.imageAttachments.clear()
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
    const sessionId = extractSessionId(request)
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
    const requestedSessionId = string(request.sessionId)
    const reusable = requestedSessionId === undefined ? undefined : this.sessions.get(requestedSessionId)
    if (reusable !== undefined && reusable.cwd === cwd && reusable.blank && !reusable.running) {
      return success({ sessionId: reusable.sessionId })
    }
    const created = await this.client.createSession(cwd, 'agent', this.backend, signal)
    if (this.backend === 'antigravity' && this.sessions.has(`${ACP_SESSION_PREFIX}${created.sessionId}`)) {
      return failure('session-already-exists', 'The backend returned an existing conversation for a new Session.')
    }
    const session = this.registerSession(created.sessionId, cwd, workspace?.title)
    this.attachSessionToWorkspace(cwd, session.sessionId)
    this.publishWorkspaceBaseline()
    const seq = this.nextProjectionSeq()
    this.emitRemoteEvent('api-session/added', [this.sessionSummary(session, seq)])
    this.publishProjection(session.sessionId, 'title', session.title ?? this.backendLabel(), seq)
    return success({ sessionId: session.sessionId })
  }

  private ensureSessionRegistered(sessionId: string): AcpSessionState | undefined {
    let session = this.sessions.get(sessionId)
    if (session !== undefined) return session
    if (this.backend === 'antigravity' && sessionId.startsWith(ACP_SESSION_PREFIX)) {
      const acpSessionId = sessionId.slice(ACP_SESSION_PREFIX.length)
      const workspace = this.selectedWorkspaceId !== undefined ? this.workspaceById.get(this.selectedWorkspaceId) : undefined
      const cwd = workspace?.path ?? '/'
      session = this.registerSession(acpSessionId, cwd, 'Antigravity', Date.now(), Date.now(), false)
      if (workspace && !workspace.sessionIds.includes(sessionId)) {
        workspace.sessionIds.unshift(sessionId)
        workspace.sessionCount = workspace.sessionIds.length
        this.publishWorkspaceBaseline()
      }
      return session
    }
    return undefined
  }

  private async prompt(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = extractSessionId(request)
    const session = this.ensureSessionRegistered(sessionId) ?? this.sessions.get(sessionId)
    if (session === undefined) return failure('session-not-found', 'The Session was not found.')
    await this.hydrateSession(session)
    const text = extractPromptText(array(request.content))
    let images: AcpImage[]
    try {
      images = array(request.content).filter(part => record(part).type === 'image').map(parseAcpImage)
      if (images.length > 4 || (images.length > 0 && this.backend !== 'antigravity') || array(request.content).some(part => !['text', 'image'].includes(String(record(part).type)))) throw new Error('Unsupported ACP content.')
    } catch { return failure('attachment-error', 'Invalid or unsupported image attachment.') }
    if (text === undefined && images.length === 0) return failure('attachment-error', 'A prompt or image is required.')
    const imageBlocks = images.map(image => acpImageContent(image, `agy-image:${crypto.randomUUID()}.${image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType.slice(6)}`))
    this.cacheImageAttachments(sessionId, imageBlocks)
    const requestId = typeof request.requestId === 'string' && request.requestId.length > 0
      ? request.requestId
      : undefined
    await this.ensureFollow(session)
    const follow = [...this.follows].find(f => f.sessionId === sessionId)
    if (follow !== undefined) {
      follow.turn += 1
      follow.stepOpen = true
      this.pushEvent(follow, 'turn/start', { turn: follow.turn })
      this.pushEvent(follow, 'step/start', { turn: follow.turn, step: 1 })
      this.pushEvent(follow, 'user/message', {
        id: `user:${Date.now()}`,
        role: 'user',
        content: [...(text ? [{ type: 'text', text }] : []), ...imageBlocks],
        source: requestId ? { kind: 'user', rpcId: requestId } : { kind: 'user' },
      })
    }
    session.blank = false
    session.running = true
    session.updatedAt = Date.now()
    this.emitRemoteEvent('api-session/status', [sessionId, true])
    await this.client.prompt(session.acpSessionId, text ?? '', signal, images, this.backend)
    return success({ accepted: true })
  }

  private async cancel(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = extractSessionId(request)
    const session = this.ensureSessionRegistered(sessionId) ?? this.sessions.get(sessionId)
    if (session === undefined) return failure('session-not-found', 'The Session was not found.')
    await this.client.cancel(session.acpSessionId, signal)
    session.running = false
    for (const follow of this.follows) {
      if (follow.sessionId === sessionId) {
        this.closeFollowAfterRemoteStreamClosed(follow)
      }
    }
    this.emitRemoteEvent('api-session/status', [sessionId, false])
    return success({ accepted: true })
  }

  private async renameSession(request: JsonRecord): Promise<unknown> {
    const sessionId = extractSessionId(request)
    const title = string(request.title)?.trim()
    const session = this.ensureSessionRegistered(sessionId) ?? this.sessions.get(sessionId)
    if (session === undefined) return failure('session-not-found', 'The Session was not found.')
    if (title === undefined) return failure('bad-request', 'A Session title is required.')
    session.title = title
    session.titleOverridden = true
    session.updatedAt = Date.now()
    this.publishProjection(sessionId, 'title', title)
    return success({ sessionId })
  }

  private cacheImageAttachments(sessionId: string, content: unknown[]): void {
    for (const value of content) {
      const block = record(value)
      const attachment = record(block.attachment)
      if (block.type === 'image' && typeof attachment.attachmentId === 'string' && typeof block.data === 'string') {
        this.imageAttachments.set(attachment.attachmentId, { sessionId, attachment, data: block.data })
      }
    }
  }

  private async attachment(request: JsonRecord): Promise<unknown> {
    const sessionId = extractSessionId(request)
    const attachmentId = string(request.attachmentId)
    const session = this.ensureSessionRegistered(sessionId)
    if (this.backend !== 'antigravity' || session === undefined || !attachmentId?.startsWith('agy-image:')) return failure('attachment-error', 'The image is not referenced by this AGY Session.')
    await this.hydrateSession(session)
    const cached = this.imageAttachments.get(attachmentId)
    return cached?.sessionId === sessionId ? success({ attachment: cached.attachment, data: cached.data }) : failure('attachment-error', 'The AGY image is unavailable or expired.')
  }

  private async hydrateSession(session: AcpSessionState): Promise<void> {
    if (this.backend !== 'antigravity' || session.blank || session.events.length > 0) return
    let events: unknown[] = []
    if (this.client.loadSessionHistory !== undefined) {
      try {
        events = await this.client.loadSessionHistory(session.sessionId, this.backend)
      } catch {
        // Keep the projection empty until remote history is available.
      }
    }
    if (events.length > 0) {
      session.events = events as unknown as Array<{ type: 'event'; event: NativeEvent }>
      session.blank = false
      session.updatedAt = Date.now()
      for (const event of session.events) this.cacheImageAttachments(session.sessionId, array(record(event.event.data).content ?? record(record(event.event.data).message).content))
    }
  }

  private async sessionHistory(request: JsonRecord): Promise<unknown> {
    const sessionId = extractSessionId(request)
    const session = this.ensureSessionRegistered(sessionId) ?? this.sessions.get(sessionId)
    if (session === undefined) return failure('session-not-found', 'The Session was not found.')
    await this.hydrateSession(session)
    const page = this.historyPage(session, {
      beforeSeq: optionalInteger(request.beforeSeq),
      limit: optionalPositiveInteger(request.maxMessages) ?? 50,
    })
    return success({
      ...page,
      events: page.records.map(entry => ({ event: entry.event })),
      projections: {
        asOfSeq: page.cursor,
        values: {
          title: session.title ?? (this.backend === 'antigravity' ? 'Antigravity' : 'Cursor'),
          sessionListMetadata: { blank: session.blank && session.events.length === 0, lastPromptAt: null },
          modelSelection: this.modelSelectionProjection(sessionId),
          imageLimits: acpImageLimits(this.backend),
        },
      },
    })
  }

  private async sessionPage(request: JsonRecord): Promise<unknown> {
    const sessionId = extractSessionId(request)
    const session = this.ensureSessionRegistered(sessionId) ?? this.sessions.get(sessionId)
    if (session === undefined) return failure('session-not-found', 'The Session was not found.')
    await this.hydrateSession(session)
    const page = this.historyPage(session, {
      beforeSeq: optionalInteger(request.beforeSeq),
      throughSeq: optionalInteger(request.throughSeq),
      limit: optionalPositiveInteger(request.limit) ?? optionalPositiveInteger(request.maxMessages) ?? 50,
    })
    return success({ records: page.records, hasMore: page.hasMore })
  }

  private historyPage(
    session: AcpSessionState,
    options: { beforeSeq?: number; throughSeq?: number; limit?: number } = {},
  ) {
    const lastSessionSeq = session.events.at(-1)?.event.seq ?? -1
    const throughSeq = Math.min(options.throughSeq ?? lastSessionSeq, lastSessionSeq)
    const endSeq = Math.min(throughSeq, options.beforeSeq === undefined ? throughSeq : options.beforeSeq - 1)
    const window = endSeq < 0 ? [] : session.events.filter(entry => entry.event.seq <= endSeq)
    const limit = options.limit ?? 50
    const records = window.slice(Math.max(0, window.length - limit))
    const cursor = records.at(-1)?.event.seq ?? -1
    return {
      header: {
        version: 3,
        id: session.sessionId,
        createdAt: session.createdAt,
        cwd: session.cwd,
        isSeeded: false,
      },
      cursor,
      nextTurn: Math.max(0, ...session.events.map(entry => isRecord(entry.event.data) && typeof entry.event.data.turn === 'number' ? entry.event.data.turn : 0)) + 1,
      records,
      hasMore: window.length > records.length,
      ...(session.running ? { activeTurnId: 'cursor-live' } : {}),
      assistantStream: { revision: 0 },
    }
  }

  private describeHost(): JsonRecord {
    const workspace = this.selectedWorkspaceId === undefined
      ? undefined
      : this.workspaceById.get(this.selectedWorkspaceId)
    const name = this.backendLabel()
    return {
      version: `${name} Remote`,
      cwd: workspace?.path ?? '',
      home: workspace?.path ?? '',
      provider: name,
      model: modelCatalog(this.backend).default.model,
      attachedSessions: this.sessions.size,
      canOpenPath: workspace !== undefined,
    }
  }

  private async listDirectory(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const workspace = this.selectedWorkspaceId === undefined
      ? undefined
      : this.workspaceById.get(this.selectedWorkspaceId)
    if (workspace === undefined) return failure('workspace-not-found', `The ${this.backendLabel()} virtual Workspace was not found.`)
    const path = string(request.path) ?? workspace.path
    return success(await this.client.listDirectory(path, signal))
  }

  private async answerRemoteEvent(args: JsonRecord, signal: AbortSignal): Promise<undefined> {
    const eventId = string(args.eventId)
    const outcome = record(args.outcome)
    if (eventId === undefined) throw new Error(`The ${this.backendLabel()} approval result is missing its event id.`)
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
        pinnedSessionIds: [],
      },
    })
    return queue.iterate(() => this.workspaceStreams.delete(queue))
  }

  private async sessionControl(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const queue = new AsyncValueQueue(signal)
    this.controlStreams.add(queue)
    // Session Controller treats the first control frame as the opening
    // snapshot. Without it the Client-side RemoteSnapshotStream never moves
    // to `ready`, so a workspace selected through the Remote modal remains
    // stuck on the empty shell after the page reload.
    queue.push({ type: 'baseline', value: { projections: {} } })
    return queue.iterate(() => this.controlStreams.delete(queue))
  }

  /**
   * Background jobs belong to the Host Harness session, not to a backend-scoped
   * virtual Workspace. The native session header mounts a job roster stream as
   * soon as a Session opens, so answer it with an authoritative empty roster
   * instead of a terminal `method-not-found` failure that tears the page down.
   */
  private emptyJobStream(endpoint: 'job/list' | 'job/follow', signal: AbortSignal): AsyncIterable<unknown> {
    const queue = new AsyncValueQueue(signal)
    if (endpoint === 'job/list') queue.push({ type: 'rows', jobs: [] })
    return queue.iterate(() => queue.close())
  }

  private async remoteEvents(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const id = `cursor-events:${Date.now()}:${Math.random()}`
    const queue = new AsyncValueQueue(signal)
    this.eventStreams.set(id, queue)
    const workspace = this.selectedWorkspaceId === undefined
      ? undefined
      : this.workspaceById.get(this.selectedWorkspaceId)
    queue.push({
      type: 'ready',
      clientId: id,
      host: { home: workspace?.path ?? '/' },
    })
    return queue.iterate(() => this.eventStreams.delete(id))
  }

  private async sessionFollow(request: JsonRecord, signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const sessionId = extractSessionId(request)
    const session = this.ensureSessionRegistered(sessionId) ?? this.sessions.get(sessionId)
    if (session === undefined) throw new Error('The Session was not found.')
    await this.hydrateSession(session)
    const history = this.historyPage(session, {
      limit: optionalPositiveInteger(request.maxMessages) ?? 50,
    })
    const queue = new AsyncValueQueue(signal)
    const follow: FollowState = {
      sessionId,
      acpSessionId: session.acpSessionId,
      queue,
      nextSeq: session.events.length,
      turn: Math.max(0, ...session.events.map(entry => (isRecord(entry.event.data) && typeof entry.event.data.turn === 'number' ? entry.event.data.turn : 0))),
      stepOpen: session.running,
      streamActive: false,
      assistantStreamRevision: 0,
      accumulatedText: '',
      activeToolCalls: new Set(),
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
          title: session.title ?? (this.backend === 'antigravity' ? 'Antigravity' : 'Cursor'),
          sessionListMetadata: { blank: session.blank && session.events.length === 0, lastPromptAt: null },
          modelSelection: this.modelSelectionProjection(sessionId),
          imageLimits: acpImageLimits(this.backend),
        },
      },
      assistantStream: { revision: 0 },
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
      nextSeq: session.events.length === 0 ? 0 : Math.max(...session.events.map(entry => entry.event.seq)) + 1,
      turn: Math.max(0, ...session.events.map(entry => (isRecord(entry.event.data) && typeof entry.event.data.turn === 'number' ? entry.event.data.turn : 0))),
      stepOpen: false,
      streamActive: false,
      assistantStreamRevision: 0,
      accumulatedText: '',
      activeToolCalls: new Set(),
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
    if (kind === 'model_selection' && isRecord(update.selected)
      && update.selected.provider === this.backend && typeof update.selected.model === 'string') {
      this.selectedModels.set(follow.sessionId, update.selected as unknown as AcpModelSelection)
      this.publishProjection(follow.sessionId, 'modelSelection', this.modelSelectionProjection(follow.sessionId), this.nextProjectionSeq())
      return
    }
    if (kind === 'agent_message_chunk' || kind === 'agent_message') {
      const text = extractText(update)
      if (text === undefined || text.length === 0) return
      this.appendAssistantDelta(follow, text)
      return
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      const toolName = string(update.title) ?? string(update.toolName) ?? string(update.name) ?? 'tool'
      const status = string(update.status)
      const callId = string(update.toolCallId) ?? string(update.callId) ?? toolName
      const terminal = status === 'completed' || status === 'failed'
      if (kind === 'tool_call_update' && !terminal) return
      if (kind === 'tool_call' && follow.activeToolCalls.has(callId)) return
      this.pushEvent(follow, 'tool/call', {
        turn: follow.turn,
        step: 1,
        callId,
        name: toolName,
        arguments: typeof update.parameters === 'object' && update.parameters !== null
          ? JSON.stringify(update.parameters)
          : typeof update.rawInput === 'object' && update.rawInput !== null
            ? JSON.stringify(update.rawInput)
            : '{}',
        toolCallId: callId,
        toolName,
        status: status === 'completed' ? 'finished' : status === 'failed' ? 'failed' : 'running',
      })
      if (terminal) follow.activeToolCalls.delete(callId)
      else follow.activeToolCalls.add(callId)
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
        if (kind === 'prompt_completed') void this.refreshSessionTitle(session)
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

  private pushAssistantChunk(follow: FollowState, chunk: JsonRecord): void {
    let attempt = follow.assistantAttempt
    if (attempt === undefined) {
      attempt = {
        attemptId: `cursor-attempt:${follow.turn}:${follow.nextSeq}`,
        startedAfterSeq: follow.nextSeq - 1,
        nextIndex: 0,
        stream: [],
      }
      follow.assistantAttempt = attempt
      follow.assistantStreamRevision += 1
      follow.queue.push({
        type: 'assistant-stream',
        frame: {
          type: 'start',
          attemptId: attempt.attemptId,
          revision: follow.assistantStreamRevision,
          startedAfterSeq: attempt.startedAfterSeq,
          turn: follow.turn,
          step: 1,
        },
      })
    }
    const time = Date.now()
    const index = attempt.nextIndex++
    // Durable streams use AssistantStreamRecord, unlike the timed chunks in
    // the live feed. Without this discriminator the native reader treats a
    // raw chunk as a packed run and throws while settling the conversation.
    attempt.stream.push({ type: 'chunk', time, chunk })
    follow.assistantStreamRevision += 1
    follow.queue.push({
      type: 'assistant-stream',
      frame: {
        type: 'chunk',
        attemptId: attempt.attemptId,
        revision: follow.assistantStreamRevision,
        index,
        time,
        chunk,
      },
    })
  }

  private endAssistantAttempt(
    follow: FollowState,
    outcome: { kind: 'abandoned' } | { kind: 'committed'; eventType: 'assistant/message'; seq: number },
  ): void {
    const attempt = follow.assistantAttempt
    if (attempt === undefined) return
    follow.assistantAttempt = undefined
    follow.assistantStreamRevision += 1
    follow.queue.push({
      type: 'assistant-stream',
      frame: {
        type: 'end',
        attemptId: attempt.attemptId,
        revision: follow.assistantStreamRevision,
        index: attempt.nextIndex,
        outcome,
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
      follow.blockIndex = (follow.reasoningBlockIndex ?? -1) + 1
      follow.streamActive = true
      this.pushAssistantChunk(follow, { type: 'block-start', index: follow.blockIndex, blockType: 'text' })
    }
    follow.accumulatedText += delta
    this.pushAssistantChunk(follow, { type: 'text-delta', index: follow.blockIndex, text: delta })
  }

  private appendReasoningDelta(follow: FollowState, delta: string): void {
    if (!follow.stepOpen) {
      follow.turn += 1
      follow.stepOpen = true
      this.pushEvent(follow, 'turn/start', { turn: follow.turn })
      this.pushEvent(follow, 'step/start', { turn: follow.turn, step: 1 })
    }
    if (follow.reasoningBlockIndex === undefined) {
      follow.reasoningBlockIndex = (follow.blockIndex ?? -1) + 1
      follow.streamActive = true
      this.pushAssistantChunk(follow, { type: 'block-start', index: follow.reasoningBlockIndex, blockType: 'reasoning' })
    }
    this.pushAssistantChunk(follow, { type: 'reasoning-delta', index: follow.reasoningBlockIndex, text: delta })
  }

  private closeFollowAfterRemoteStreamClosed(follow: FollowState): void {
    if (follow.streamActive) {
      if (follow.reasoningBlockIndex !== undefined) {
        this.pushAssistantChunk(follow, {
          type: 'block-end',
          index: follow.reasoningBlockIndex,
          block: { type: 'reasoning', text: '' },
        })
        follow.reasoningBlockIndex = undefined
      }
      if (follow.blockIndex !== undefined) {
        const fullText = follow.accumulatedText
        this.pushAssistantChunk(follow, {
          type: 'block-end',
          index: follow.blockIndex,
          block: { type: 'text', text: fullText },
        })
      }
      this.pushAssistantChunk(follow, {
        type: 'finish',
        reason: { kind: 'stop' },
      })
      const fullText = follow.accumulatedText
      const selection = this.modelSelection(follow.sessionId)
      const stream = follow.assistantAttempt?.stream ?? []
      const assistantMessageSeq = this.pushEvent(follow, 'assistant/message', {
        turn: follow.turn,
        step: 1,
        message: {
          id: `${follow.sessionId}:${follow.turn}`,
          role: 'assistant',
          content: [{ type: 'text', text: fullText }],
          source: { kind: 'model', provider: selection.provider, model: selection.model },
        },
        stream,
      })
      this.endAssistantAttempt(follow, {
        kind: 'committed',
        eventType: 'assistant/message',
        seq: assistantMessageSeq,
      })
      this.pushEvent(follow, 'step/end', { turn: follow.turn, step: 1 })
      this.pushEvent(follow, 'turn/end', { turn: follow.turn, reason: { kind: 'completed' } })
    } else if (follow.stepOpen) {
      this.pushEvent(follow, 'step/end', { turn: follow.turn, step: 1 })
      this.pushEvent(follow, 'turn/end', { turn: follow.turn, reason: { kind: 'completed' } })
    }
    follow.streamActive = false
    follow.stepOpen = false
    follow.blockIndex = undefined
    follow.reasoningBlockIndex = undefined
    follow.accumulatedText = ''
  }

  private pushEvent(follow: FollowState, type: string, data: unknown): number {
    const session = this.sessions.get(follow.sessionId)
    const seq = session !== undefined ? session.events.length : follow.nextSeq++
    const event: NativeEvent = {
      type,
      seq,
      time: Date.now(),
      data,
      ...(isSurfaceEvent(type) ? { surfaceOp: 'append' as const } : {}),
    }
    if (session !== undefined) {
      session.events.push({ type: 'event', event })
    }
    for (const f of this.follows) {
      if (f.sessionId === follow.sessionId) {
        f.queue.push({ type: 'event', event })
        f.nextSeq = seq + 1
      }
    }
    this.broadcastRcMux({
      type: 'session/event',
      sessionId: follow.sessionId,
      event,
    })
    return seq
  }


  private registerSession(
    acpSessionId: string,
    cwd: string,
    title?: string,
    createdAt: number = Date.now(),
    updatedAt: number = Date.now(),
    blank: boolean = true,
  ): AcpSessionState {
    const session: AcpSessionState = {
      sessionId: `${this.backend === 'antigravity' ? ACP_SESSION_PREFIX : CURSOR_SESSION_PREFIX}${acpSessionId}`,
      acpSessionId,
      cwd,
      ...(title === undefined ? {} : { title }),
      blank,
      running: false,
      createdAt,
      updatedAt,
      events: [],
    }
    this.sessions.set(session.sessionId, session)
    return session
  }

  private applyDiscoveredTitle(session: AcpSessionState, title: string): void {
    const next = title.trim()
    if (this.closed || session.titleOverridden || !next || next === 'Untitled Session' || next === session.title) return
    session.title = next
    this.publishProjection(session.sessionId, 'title', next)
  }

  private async refreshSessionTitle(session: AcpSessionState): Promise<void> {
    if (this.backend !== 'antigravity' || this.closed || session.titleOverridden || this.client.listSessions === undefined) return
    try {
      const items = await this.client.listSessions(session.cwd, this.backend, 30)
      const current = items.find(item => item.conversationId === session.acpSessionId)
      if (current !== undefined && this.sessions.get(session.sessionId) === session) this.applyDiscoveredTitle(session, current.title)
    } catch {
      // Title discovery must not delay or fail an already completed turn.
    }
  }

  private async discoverAndAttachSessions(workspace: AcpVirtualWorkspaceView): Promise<void> {
    if (this.backend !== 'antigravity') return
    try {
      let discovered: Array<{ conversationId: string; title: string; createdAt: number; updatedAt: number }> = []
      if (this.client.listSessions !== undefined) {
        try {
          discovered = await this.client.listSessions(workspace.path, this.backend, 30)
        } catch {
          // Keep the projection empty until remote history is available.
        }
      }
      for (const item of discovered) {
        const sessionId = `${ACP_SESSION_PREFIX}${item.conversationId}`
        if (!this.sessions.has(sessionId)) {
          this.registerSession(item.conversationId, workspace.path, item.title, item.createdAt, item.updatedAt, false)
        }
        const existing = this.sessions.get(sessionId)
        if (existing !== undefined) this.applyDiscoveredTitle(existing, item.title)
        if (!workspace.sessionIds.includes(sessionId)) {
          workspace.sessionIds.push(sessionId)
        }
      }
      workspace.sessionCount = workspace.sessionIds.length
      workspace.updatedAt = new Date().toISOString()
    } catch {
      // 容错降级
    }
  }

  private attachSessionToWorkspace(cwd: string, sessionId: string): void {
    const workspace = [...this.workspaceById.values()].find(item => item.path === cwd)
      ?? createAcpWorkspaceView(cwd, this.backend)
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

  private async ensureInitialSession(workspace: AcpVirtualWorkspaceView): Promise<AcpSessionState> {
    const cwd = workspace.path
    const created = await this.client.createSession(cwd, 'agent', this.backend)
    const sessionId = created.sessionId
    const title = this.backend === 'antigravity' ? 'Antigravity' : workspace.title
    const session = this.registerSession(sessionId, cwd, title)
    this.attachSessionToWorkspace(cwd, session.sessionId)
    this.emitRemoteEvent('api-session/added', [this.sessionSummary(session, 0)])
    this.publishWorkspaceBaseline()
    return session
  }

  private async handleSessionList(): Promise<unknown[]> {
    for (const workspace of this.workspaceById.values()) {
      await this.discoverAndAttachSessions(workspace)
      if (workspace.sessionIds.length === 0) {
        await this.ensureInitialSession(workspace)
      }
    }
    return this.sessionSummaries()
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
      agentAvailable: true,
      running: session.running,
      blank: session.blank,
      cwd: session.cwd,
      updatedAt: session.updatedAt,
      projections: {
        kind: 'sequenced',
        asOfSeq,
        values: {
          title: session.title ?? (this.backend === 'antigravity' ? 'Antigravity' : 'Cursor'),
          sessionListMetadata: { blank: session.blank, lastPromptAt: null },
          modelSelection: this.modelSelectionProjection(session.sessionId),
          imageLimits: acpImageLimits(this.backend),
        },
      },
    }
  }

  private modelSelection(sessionId: string): AcpModelSelection {
    return this.selectedModels.get(sessionId) ?? modelCatalog(this.backend).default
  }

  private modelSelectionProjection(sessionId: string): { lastUsed: AcpModelSelection; next: AcpModelSelection } {
    const selection = this.modelSelection(sessionId)
    return { lastUsed: selection, next: selection }
  }

  private async hostSessionModels(sessionId: string): Promise<AcpSessionModels> {
    if (this.backend !== 'antigravity' || !this.client.sessionModels) return { current: { provider: this.backend, model: 'host-settings' }, routable: true, groups: [], failures: [] }
    const models = await this.client.sessionModels(nativeAcpId(sessionId, this.backend), 'antigravity')
    this.selectedModels.set(sessionId, models.current)
    return models
  }

  private async selectModel(request: JsonRecord): Promise<unknown> {
    const sessionId = extractSessionId(request)
    nativeAcpId(sessionId, this.backend)
    const provider = requiredString(request.provider, 'provider')
    const model = requiredString(request.model, 'model')
    const reasoningEffort = string(request.reasoningEffort)
    const catalog = this.backend === 'antigravity' ? await this.hostSessionModels(sessionId) : modelCatalog(this.backend)
    const group = catalog.groups.find(g => g.id === provider)
    const targetModel = group?.models.find(m => m.id === model)
    if (group === undefined || targetModel === undefined) {
      return failure('model-unavailable', `The selected ${this.backend} model is unavailable on this Host.`)
    }
    const supportedEfforts = targetModel.reasoning?.efforts.map(effort => effort.id) ?? []
    if (reasoningEffort !== undefined && !supportedEfforts.includes(reasoningEffort)) {
      return failure('model-unavailable', `The selected reasoning effort is unavailable for this ${this.backend} model.`)
    }
    const selected: AcpModelSelection = {
      provider,
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    }
    if (this.backend === 'antigravity') {
      if (!this.client.selectModel) return failure('model-unavailable', 'The Host does not support ACP model selection.')
      const confirmed = await this.client.selectModel(nativeAcpId(sessionId, this.backend), 'antigravity', selected)
      this.selectedModels.set(sessionId, confirmed)
    } else return failure('model-unavailable', 'Cursor model selection follows Host settings.')
    const seq = this.nextProjectionSeq()
    this.publishProjection(sessionId, 'modelSelection', this.modelSelectionProjection(sessionId), seq)
    return success({ selected: this.modelSelection(sessionId) })
  }

  private publishWorkspaceBaseline(): void {
    for (const queue of this.workspaceStreams) {
      for (const workspace of this.visibleWorkspaces()) {
        queue.push({ type: 'upsert', workspace: nativeWorkspace(workspace) })
      }
      queue.push({ type: 'archived', archivedSessionIds: [] })
    }
  }

  private publishProjection(sessionId: string, key: string, value: unknown, seq = this.nextProjectionSeq()): void {
    for (const queue of this.controlStreams) {
      queue.push({ type: 'projection', sessionId, key, value, asOfSeq: seq, seq })
    }
    this.broadcastRcMux({ type: 'session/projection', sessionId, key, value, seq })
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
      toolName: string(input.request.toolName) ?? this.backendLabel(),
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

function recreateWorkspaceFromId(workspaceId: string, backend: 'cursor' | 'antigravity'): AcpVirtualWorkspaceView | undefined {
  const prefix = backend === 'antigravity' ? AGY_WORKSPACE_PREFIX : CURSOR_WORKSPACE_PREFIX
  if (!workspaceId.startsWith(prefix)) return undefined
  try {
    const path = decodeURIComponent(workspaceId.slice(prefix.length))
    if (path.length > 0) return createAcpWorkspaceView(path, backend)
  } catch {
    return undefined
  }
  return undefined
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

export interface AcpModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface AcpModelView {
  id: string
  name: string
  description?: string
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>
    defaultEffort?: string
  }
}

const CURSOR_MODELS: AcpModelView[] = [
  { id: 'auto', name: 'Auto' },
  { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet' },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'o3-mini', name: 'o3-mini' },
  { id: 'deepseek-r1', name: 'DeepSeek R1' },
]

export function modelCatalog(backend: 'cursor' | 'antigravity' = 'cursor'): {
  default: AcpModelSelection
  routableProviders: string[]
  groups: Array<{ id: string; name: string; models: AcpModelView[] }>
  failures: Array<{ id: string; name: string; message: string }>
} {
  const provider = backend === 'antigravity' ? 'antigravity' : CURSOR_PROVIDER
  const name = backend === 'antigravity' ? 'Antigravity' : 'Cursor'
  const models = backend === 'antigravity' ? [] : CURSOR_MODELS
  const defaultModel = models[0]?.id ?? 'host-settings'
  return {
    default: { provider, model: defaultModel },
    routableProviders: [provider],
    groups: [{
      id: provider,
      name,
      models,
    }],
    failures: [],
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
  if (typeof address.sessionId === 'string' && address.sessionId.length > 0) return address.sessionId
  if (typeof address.childSessionId === 'string' && address.childSessionId.length > 0) return address.childSessionId
  if (address.kind === 'session' && typeof address.sessionId === 'string' && address.sessionId.length > 0) {
    return address.sessionId
  }
  throw new Error('The sessionId is required.')
}

function extractSessionId(request: JsonRecord): string {
  if (typeof request.sessionId === 'string' && request.sessionId.length > 0) return request.sessionId
  if (isRecord(request.address)) return sessionIdFromAddress(request.address)
  throw new Error('The sessionId is required.')
}

function nativeAcpId(sessionId: string, backend: 'cursor' | 'antigravity'): string {
  const prefix = backend === 'antigravity' ? ACP_SESSION_PREFIX : CURSOR_SESSION_PREFIX
  if (!sessionId.startsWith(prefix) || sessionId.length === prefix.length) {
    throw new Error('The selected Session does not belong to the virtual harness.')
  }
  return sessionId.slice(prefix.length)
}

function isSurfaceEvent(type: string): boolean {
  return type === 'user/message' || type === 'assistant/message' || type === 'tool/result'
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
      message: string(value.error.message) ?? 'The virtual Harness request failed.',
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
  if (parsed === undefined) throw new Error('The History cursor is invalid.')
  return parsed
}

function optionalPositiveInteger(value: unknown): number | undefined {
  const parsed = optionalInteger(value)
  if (parsed !== undefined && parsed <= 0) throw new Error('The History page size is invalid.')
  return parsed
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`The ${field} is required.`)
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
