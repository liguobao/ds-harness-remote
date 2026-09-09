import type { ApiProxy, RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import {
  CodexRemoteClient,
  deriveCodexCwdWorkspaces,
  projectCodexThread,
  type DisplaySession,
} from '@dsh-remote/client-core'
import type {
  RemoteTypertGatewayTarget,
  TypertGatewayRequest,
  TypertRpcResult,
} from '../typert-gateway-contract.js'
import { codexPermissionPresetFromResponse } from './permissions.js'
import type { CodexPermissionPreset, CodexPermissionSnapshot } from '@dsh-remote/protocol'
import type { HarnessSessionGeneration } from '../harness-version.js'

const CODEX_SESSION_PREFIX = 'codex:'
const CODEX_WORKSPACE_PREFIX = 'codex-workspace:'
const CODEX_PROVIDER = 'codex'
const CODEX_MODEL = 'codex'
const CODEX_PAGE_LIMIT = 100
const MAX_CODEX_PAGES = 32
const MAX_LIVE_TOOL_OUTPUT = 128 * 1024
const DEFAULT_HISTORY_MESSAGES = 50
const SESSION_SEARCH_RESULT_LIMIT = 20
const SESSION_SEARCH_SNIPPET_CODE_POINTS = 240
const CODEX_DEFAULT_PERMISSION = 'workspace-write'
const MAX_CODEX_PROMPT_PARTS = 16
const MAX_CODEX_PROMPT_TEXT = 256 * 1024
const MAX_CODEX_IMAGE_BASE64 = 288 * 1024 * 1024
const CODEX_IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const CODEX_IMAGE_ATTACHMENT_PREFIX = 'codex-image:'
const DATA_IMAGE_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u

type JsonRecord = Record<string, unknown>

export interface CodexVirtualWorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
  sessionCount: number
  createdAt: string
  updatedAt: string
}

export function codexProjectWorkspaceId(projectId: string): string {
  return `${CODEX_WORKSPACE_PREFIX}project:${projectId}`
}

interface CodexProjectRoot {
  path: string
}

interface CodexProject {
  id: string
  name: string
  roots: CodexProjectRoot[]
  position: number
  createdAt: number
  updatedAt: number
}

interface CodexDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

interface CodexDirectoryListing {
  path: string
  home: string
  crumbs: CodexDirectoryEntry[]
  entries: CodexDirectoryEntry[]
  truncated: boolean
}

interface CodexClientLike {
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>
  subscribe(
    threadId: string,
    onFrame: (frame: { method: string; params: unknown }) => void,
    signal?: AbortSignal,
    onClose?: (reason: 'cancelled' | 'completed' | 'failed' | 'peer-disconnected') => void,
  ): Promise<{ close(): Promise<void> }>
  respond(requestHandle: string, decision: 'accept' | 'decline' | 'cancel', signal?: AbortSignal): Promise<void>
}

interface CatalogState {
  threads: JsonRecord[]
  sessions: DisplaySession[]
  projects: CodexProject[]
  workspaces: CodexVirtualWorkspaceView[]
}

interface CodexModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

interface CodexModelView {
  id: string
  name: string
  description?: string
  reasoning?: {
    efforts: Array<{ id: string; name: string; description?: string }>
    defaultEffort?: string
  }
}

interface CodexModelDirectory {
  default: CodexModelSelection
  groups: Array<{ id: string; name: string; models: CodexModelView[] }>
  models: Map<string, CodexModelView>
}

interface NativeEvent {
  type: string
  seq: number
  time: number
  data: unknown
  sourceEventSeqs?: number[]
  surfaceOp?: 'append'
    | { op: 'replace'; start: number; end: number }
    | { op: 'replace'; startSeq: number; endSeq: number }
}

export interface CodexNativeHistory {
  header: {
    version: number
    id: string
    createdAt: number
    cwd?: string
    isSeeded?: boolean
  }
  entries: Array<{ type: 'event'; event: NativeEvent; view?: ToolEventView }>
  lastSeq: number
  nextTurn: number
  activeTurnId?: string
}

export interface CodexNativeHistoryPage extends CodexPermissionSnapshot {
  header: CodexNativeHistory['header']
  cursor: number
  nextTurn: number
  records: CodexNativeHistory['entries']
  hasMore: boolean
  activeTurnId?: string
}

interface StreamedBlock {
  itemId: string
  index: number
  kind: 'text' | 'reasoning'
  text: string
}

interface AssistantStreamAttempt {
  attemptId: string
  startedAfterSeq: number
  nextIndex: number
  stream: Array<{ time: number; chunk: JsonRecord }>
}

interface FollowState {
  sessionId: string
  threadId: string
  queue: AsyncValueQueue
  nextSeq: number
  turn: number
  stepOpen: boolean
  startedItems: Set<string>
  completedItems: Set<string>
  streamedBlocks: Map<string, StreamedBlock>
  nextBlockIndex: number
  streamActive: boolean
  assistantStreamRevision: number
  assistantAttempt?: AssistantStreamAttempt
  liveItems: Map<string, JsonRecord>
  liveToolOutput: Map<string, string>
  liveToolResultSeq: Map<string, number>
  pendingToolImages: JsonRecord[]
  requestId?: string
  activeTurnId?: string
  rcOnly?: boolean
  close?: () => Promise<void>
}

interface PendingApproval {
  requestHandle: string
  sessionId: string
}

interface ToolEventView {
  for: 'call' | 'result'
  view: JsonRecord
}

interface CodexImageAttachmentEntry {
  sessionId: string
  attachment: JsonRecord
  data: string
}

interface ProjectedNativeEvent {
  type: string
  data: unknown
  view?: ToolEventView
}

/** Discover the CodeX projects visible through the Host App Server. */
export async function discoverCodexVirtualWorkspaces(
  client: CodexClientLike,
  signal?: AbortSignal,
): Promise<CodexVirtualWorkspaceView[]> {
  return (await loadCatalog(client, signal)).workspaces
}

/**
 * A plugin-owned virtual Harness target. It projects CodeX Thread/Turn data at
 * the existing ApiProxy/Typert carrier boundary, so every UI layer above the
 * official Workspace and Session controllers remains native DSH.
 */
export class CodexVirtualHarness implements RemoteTypertGatewayTarget {
  readonly api: ApiProxy

  private catalog?: CatalogState
  private readonly workspaceStreams = new Set<AsyncValueQueue>()
  private readonly controlStreams = new Set<AsyncValueQueue>()
  private readonly eventStreams = new Map<string, AsyncValueQueue>()
  private readonly rcMuxStreams = new Set<AsyncValueQueue>()
  private readonly rcHostStreams = new Set<AsyncValueQueue>()
  private readonly follows = new Set<FollowState>()
  private readonly pendingRequestIds = new Map<string, string>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly pendingThreads = new Map<string, JsonRecord>()
  private readonly blankThreads = new Set<string>()
  private readonly selectedModels = new Map<string, CodexModelSelection>()
  private readonly selectedPermissions = new Map<string, CodexPermissionPreset>()
  private readonly imageAttachments = new Map<string, CodexImageAttachmentEntry>()
  private modelDirectory?: CodexModelDirectory
  private modelDirectoryPromise?: Promise<CodexModelDirectory>
  private lastProjectionSeq = 0
  private commandSeq = 0
  private selectedWorkspaceId?: string
  private closed = false

  constructor(
    private readonly client: CodexClientLike,
    private readonly host: { deviceId: string; name: string },
    private readonly sessionGeneration: HarnessSessionGeneration = 'legacy',
  ) {
    this.api = this.createApiProxy()
  }

  static remote(
    core: ConstructorParameters<typeof CodexRemoteClient>[0],
    host: { deviceId: string; name: string },
    sessionGeneration: HarnessSessionGeneration = 'legacy',
  ): CodexVirtualHarness {
    return new CodexVirtualHarness(new CodexRemoteClient(core), host, sessionGeneration)
  }

  async workspaces(signal?: AbortSignal): Promise<CodexVirtualWorkspaceView[]> {
    return (await this.refreshCatalog(signal)).workspaces
  }

  async selectWorkspace(workspaceId: string, signal?: AbortSignal): Promise<CodexVirtualWorkspaceView> {
    const catalog = await loadCatalog(this.client, signal)
    const workspace = catalog.workspaces.find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) throw new Error('The selected CodeX workspace is no longer available.')
    this.selectedWorkspaceId = workspace.workspaceId
    this.catalog = catalog
    return workspace
  }

  async preferredSessionId(signal?: AbortSignal): Promise<string | undefined> {
    const catalog = this.catalog
    const selected = catalog?.workspaces.find(workspace => workspace.workspaceId === this.selectedWorkspaceId)
    const selectedSessionIds = new Set(selected?.sessionIds ?? [])
    const sessions = (catalog?.sessions ?? []).filter(session => selectedSessionIds.has(session.id))
    const idleNamed = sessions.filter(session => session.status !== 'running'
      && session.status !== 'waiting'
      && displayTitle(session) !== null)
    const idle = sessions.filter(session => session.status !== 'running' && session.status !== 'waiting')
    // The most recently updated Thread is often the one still owned by the
    // interactive Codex process. Prefer the previous named Thread when one is
    // available, then fall back through the complete catalog.
    const preferredNamed = idleNamed.length > 1 ? [...idleNamed.slice(1), idleNamed[0]!] : idleNamed
    const candidates = [...new Set([...preferredNamed, ...idle, ...sessions].map(session => session.id))]
    for (const sessionId of candidates) {
      const threadId = nativeThreadId(sessionId)
      try {
        const thread = await this.fetchThread(threadId, signal)
        return sessionId
      } catch {
        // A currently active or concurrently changing CodeX Thread may reject
        // a full history read. Keep looking so the native UI does not remain
        // on an ungrouped placeholder Session after entering the Workspace.
      }
    }
    return undefined
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
        case 'workspace/list': {
          const catalog = await this.refreshCatalog(signal)
          return business(success({
            items: nativeVisibleWorkspaces(catalog, this.selectedWorkspaceId).map(nativeWorkspace),
            archivedSessionIds: catalog.sessions.filter(item => item.archived).map(item => item.id),
          }))
        }
        case 'workspace/create': return business(await this.createWorkspace(requestArg(args), signal))
        case 'workspace/rename': return business(await this.renameWorkspace(requestArg(args)))
        case 'workspace/delete': return business(failure('workspace-read-only', 'CodeX virtual Workspaces cannot be deleted.'))
        case 'workspace/insertBefore': return business({
          workspaceIds: nativeVisibleWorkspaces(await this.currentCatalog(signal), this.selectedWorkspaceId).map(item => item.workspaceId),
        })
        case 'workspace/insertSessionBefore': return business(await this.workspaceForSession(requestArg(args), signal))
        case 'workspace/archiveSession': return business(await this.archiveSession(requestArg(args), signal))
        case 'session/list': return business(success({ items: await this.sessionSummaries(signal) }))
        case 'session/search': return business(await this.searchSessions(requestArg(args), signal))
        case 'session/create': return business(await this.createSession(requestArg(args), signal))
        case 'session/fork': return business(await this.forkSession(requestArg(args), signal))
        case 'session/history': return business(await this.sessionHistory(requestArg(args), signal))
        case 'session/page': return business(await this.sessionPage(requestArg(args), signal))
        case 'session/prompt': return business(await this.prompt(requestArg(args), signal))
        case 'session/cancel': return business(await this.cancel(requestArg(args), signal))
        case 'session/rename': return business(await this.renameSession(requestArg(args), signal))
        case 'session/updateQueue': return business(failure('queue-item-not-found', 'CodeX does not expose a DSH inbox queue.'))
        case 'session/attachment': return business(await this.attachment(requestArg(args), signal))
        case 'session/modelCatalog': return business(success(modelCatalog(await this.models(signal))))
        case 'session/models': {
          const sessionId = requiredString(requestArg(args).sessionId, 'sessionId')
          nativeThreadId(sessionId)
          const directory = await this.models(signal)
          return business(success({
            current: this.modelSelection(sessionId, directory),
            routable: true,
            groups: directory.groups,
            failures: [],
          }))
        }
        case 'session/selectModel': return business(await this.selectModel(requestArg(args), signal))
        case 'session/canOpenWorkspacePath': return business(this.selectedWorkspaceId !== undefined)
        case 'session/openWorkspacePath': return business(failure('bad-request', 'Opening Host paths is unavailable in CodeX mode.'))
        case 'host/describe': return business(success(await this.describeHost(signal)))
        case 'host/listDirectory': return business(await this.listDirectory(requestArg(args), signal))
        case 'directoryPicker/list': return business(await this.listDirectory(requestArg(args), signal))
        case 'skills/list': return business(success({ items: [] }))
        case 'commands/list': return ok(this.commandList(args))
        case 'commands/execute': return ok(await this.executeCommand(args, signal))
        default: return fail('method-not-found', `CodeX virtual Harness does not implement ${endpoint}.`)
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
    throw Object.assign(new Error(`CodeX virtual Harness does not implement stream ${endpoint}.`), {
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
    this.pendingRequestIds.clear()
    this.pendingThreads.clear()
    this.blankThreads.clear()
    this.selectedModels.clear()
    this.selectedPermissions.clear()
    this.imageAttachments.clear()
  }

  private async refreshCatalog(signal?: AbortSignal): Promise<CatalogState> {
    const catalog = await loadCatalog(this.client, signal, this.pendingThreads)
    if (this.selectedWorkspaceId !== undefined
      && !catalog.workspaces.some(workspace => workspace.workspaceId === this.selectedWorkspaceId)) {
      this.selectedWorkspaceId = undefined
    }
    this.catalog = catalog
    return catalog
  }

  private async currentCatalog(signal?: AbortSignal): Promise<CatalogState> {
    return this.catalog ?? this.refreshCatalog(signal)
  }

  private models(signal?: AbortSignal): Promise<CodexModelDirectory> {
    if (this.modelDirectory !== undefined) return Promise.resolve(this.modelDirectory)
    this.modelDirectoryPromise ??= loadModelDirectory(this.client, signal)
      .then(directory => {
        this.modelDirectory = directory
        return directory
      })
      .finally(() => { this.modelDirectoryPromise = undefined })
    return this.modelDirectoryPromise
  }

  private modelSelection(sessionId: string, directory?: CodexModelDirectory): CodexModelSelection {
    return this.selectedModels.get(sessionId) ?? directory?.default ?? modelSelection()
  }

  private permissionSelection(sessionId: string): CodexPermissionPreset | undefined {
    return this.selectedPermissions.get(sessionId)
  }

  private setPermissionSelection(sessionId: string, preset: CodexPermissionPreset | undefined): void {
    if (preset === undefined) this.selectedPermissions.delete(sessionId)
    else this.selectedPermissions.set(sessionId, preset)
    this.publishProjection(sessionId, 'permissions', codexPermissionsProjection(preset), this.nextProjectionSeq())
  }

  private commandList(args: JsonRecord): unknown[] {
    nativeThreadId(requiredString(args.agentId, 'agentId'))
    return [{
      name: 'permission',
      description: 'Switch the CodeX Remote sandbox mode and approval policy',
      input: { hint: '<preset>' },
    }]
  }

  private async executeCommand(args: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(args.agentId, 'agentId')
    const threadId = nativeThreadId(sessionId)
    const line = requiredString(args.line, 'command line').trim()
    if (!Array.isArray(args.images)) throw new Error('The CodeX command image list is required.')
    const match = /^\/permission(?:\s+([\s\S]*))?$/u.exec(line)
    if (match === null) return undefined

    const commandId = `codex-permission:${++this.commandSeq}`
    if (args.images.length > 0) return {
      commandId,
      result: { kind: 'error', text: 'CodeX Remote permission commands do not accept attachments.' },
    }
    const requested = (match[1] ?? '').trim()
    if (requested === '') {
      await this.readHistoryPage(threadId, { maxMessages: 1 }, signal)
      return {
        commandId,
        result: { kind: 'success', text: `current preset ${this.permissionSelection(sessionId) ?? 'Host settings (not reported)'}` },
      }
    }
    if (!isCodexPermissionPreset(requested)) return {
      commandId,
      result: { kind: 'error', text: `unknown preset "${requested}" (available: workspace-write, danger-full-access)` },
    }
    const result = await this.client.request('thread/resume', { threadId, permissionPreset: requested }, signal)
    const effective = codexPermissionPresetFromResponse(result)
    if (effective === undefined) throw new Error('The Host did not confirm the CodeX permission preset.')
    this.setPermissionSelection(sessionId, effective)
    if (effective !== requested) throw new Error('The Host did not apply the requested CodeX permission preset.')
    return { commandId, result: { kind: 'success', text: `preset ${effective}` } }
  }

  private sessionTitle(sessionId: string): string | null {
    const session = this.catalog?.sessions.find(item => item.id === sessionId)
    return session === undefined ? null : displayTitle(session)
  }

  private async selectModel(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    nativeThreadId(sessionId)
    const provider = requiredString(request.provider, 'provider')
    const model = requiredString(request.model, 'model')
    const reasoningEffort = string(request.reasoningEffort)
    const directory = await this.models(signal)
    const available = directory.models.get(model)
    if (provider !== CODEX_PROVIDER || available === undefined) {
      return failure('model-unavailable', 'The selected CodeX model is unavailable on this Host.')
    }
    const supportedEfforts = available.reasoning?.efforts.map(effort => effort.id) ?? []
    if (reasoningEffort !== undefined && !supportedEfforts.includes(reasoningEffort)) {
      return failure('model-unavailable', 'The selected reasoning effort is unavailable for this CodeX model.')
    }
    const selected: CodexModelSelection = {
      provider,
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    }
    this.selectedModels.set(sessionId, selected)
    const seq = Date.now()
    this.publishProjection(sessionId, 'modelSelection', modelSelectionProjection(selected), seq)
    return success({ selected })
  }

  private publishProjection(sessionId: string, key: string, value: unknown, seq: number): void {
    for (const queue of this.controlStreams) queue.push({ type: 'projection', sessionId, key, value, seq })
    this.broadcastRcMux({ type: 'session/projection', sessionId, key, value, seq })
  }

  private nextProjectionSeq(): number {
    const seq = Math.max(Date.now(), this.lastProjectionSeq + 1)
    this.lastProjectionSeq = seq
    return seq
  }

  private updateThreadName(threadId: string, name: string): void {
    const pending = this.pendingThreads.get(threadId)
    if (pending !== undefined) this.pendingThreads.set(threadId, { ...pending, name })
    if (this.catalog === undefined) return

    const threads = this.catalog.threads.map(thread => string(thread.id) === threadId ? { ...thread, name } : thread)
    const sessions = this.catalog.sessions.map(session => {
      if (session.nativeId !== threadId) return session
      const { title: _title, ...rest } = session
      return name.trim() === '' ? rest : { ...rest, title: name }
    })
    this.catalog = { ...this.catalog, threads, sessions }
  }

  private async sessionSummaries(signal?: AbortSignal): Promise<unknown[]> {
    const catalog = await this.refreshCatalog(signal)
    const directory = await this.models(signal).catch(() => undefined)
    return catalog.sessions.map(session => {
      const blank = this.blankThreads.has(session.nativeId)
        || this.pendingThreads.has(session.nativeId)
      return this.sessionSummary(session, {
        blank,
        modelSelection: this.modelSelection(session.id, directory),
        lastPromptAt: session.updatedAt || null,
      })
    })
  }

  private sessionSummary(
    session: DisplaySession,
    options: { blank: boolean; modelSelection: CodexModelSelection; lastPromptAt: number | null; asOfSeq?: number },
  ): unknown {
    return {
      sessionId: session.id,
      updatedAt: session.updatedAt,
      running: session.status === 'running' || session.status === 'waiting',
      blank: options.blank,
      ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
      projections: {
        asOfSeq: options.asOfSeq ?? 0,
        values: {
          title: displayTitle(session),
          sessionListMetadata: { blank: options.blank, lastPromptAt: options.lastPromptAt },
          modelSelection: modelSelectionProjection(options.modelSelection),
          permissions: codexPermissionsProjection(this.permissionSelection(session.id)),
          imageLimits: codexImageLimitsProjection(),
        },
      },
    }
  }

  private async searchSessions(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const query = requiredString(request.query, 'query').trim()
    if (query.length === 0 || query.length > 500 || query.includes('\0')) {
      return failure('bad-request', 'The CodeX Session search query is invalid.')
    }
    const catalog = await this.currentCatalog(signal)
    const needle = query.toLocaleLowerCase()
    const matches = catalog.threads.flatMap(thread => {
      const session = projectCodexThread(thread)
      if (session === undefined) return []
      const candidates = [session.title, session.preview, session.cwd, session.nativeId]
        .filter((value): value is string => value !== undefined && value.length > 0)
      const snippet = candidates.find(value => value.toLocaleLowerCase().includes(needle))
      if (snippet === undefined) return []
      return [{ sessionId: session.id, snippet: truncateCodePoints(snippet, SESSION_SEARCH_SNIPPET_CODE_POINTS) }]
    })
    return success({
      items: matches.slice(0, SESSION_SEARCH_RESULT_LIMIT),
      hasMore: matches.length > SESSION_SEARCH_RESULT_LIMIT,
    })
  }

  private async workspaceFollow(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const queue = new AsyncValueQueue(signal)
    this.workspaceStreams.add(queue)
    const catalog = await this.refreshCatalog(signal)
    queue.push({
      type: 'baseline',
      value: {
        items: nativeVisibleWorkspaces(catalog, this.selectedWorkspaceId).map(nativeWorkspace),
        archivedSessionIds: catalog.sessions.filter(item => item.archived).map(item => item.id),
      },
    })
    return queue.iterate(() => this.workspaceStreams.delete(queue))
  }

  private async sessionControl(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const queue = new AsyncValueQueue(signal)
    this.controlStreams.add(queue)
    queue.push({ type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } })
    return queue.iterate(() => this.controlStreams.delete(queue))
  }

  private async remoteEvents(signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const queue = new AsyncValueQueue(signal)
    const clientId = `codex-events:${this.host.deviceId}:${Date.now().toString(36)}`
    this.eventStreams.set(clientId, queue)
    const home = (await this.currentCatalog(signal)).workspaces[0]?.path ?? '/'
    queue.push({ type: 'ready', clientId, host: { home } })
    return queue.iterate(() => this.eventStreams.delete(clientId))
  }

  private async sessionFollow(request: JsonRecord, signal: AbortSignal): Promise<AsyncIterable<unknown>> {
    const sessionId = sessionIdFromAddress(record(request.address))
    const threadId = nativeThreadId(sessionId)
    const history = await this.readHistoryPage(threadId, {
      maxMessages: optionalPositiveInteger(request.maxMessages),
    }, signal)
    const directory = await this.models(signal).catch(() => undefined)
    const queue = new AsyncValueQueue(signal)
    const follow: FollowState = {
      sessionId,
      threadId,
      queue,
      nextSeq: history.cursor + 1,
      turn: history.nextTurn,
      stepOpen: history.activeTurnId !== undefined,
      startedItems: new Set(),
      completedItems: new Set(),
      streamedBlocks: new Map(),
      nextBlockIndex: 0,
      streamActive: false,
      assistantStreamRevision: 0,
      liveItems: new Map(),
      liveToolOutput: new Map(),
      liveToolResultSeq: new Map(),
      pendingToolImages: [],
      requestId: this.pendingRequestIds.get(sessionId),
      ...(history.activeTurnId === undefined ? {} : { activeTurnId: history.activeTurnId }),
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
          title: this.sessionTitle(sessionId),
          sessionListMetadata: { blank: history.cursor < 0, lastPromptAt: null },
          modelSelection: modelSelectionProjection(this.modelSelection(sessionId, directory)),
          permissions: codexPermissionsProjection(this.permissionSelection(sessionId)),
          imageLimits: codexImageLimitsProjection(),
        },
      },
      ...(this.sessionGeneration === 'v3' ? { assistantStream: { revision: 0 } } : {}),
    })
    try {
      const stream = await this.client.subscribe(
        threadId,
        frame => this.acceptCodexFrame(follow, frame),
        signal,
        () => this.closeFollowAfterRemoteStreamClosed(follow),
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

  private acceptCodexFrame(follow: FollowState, frame: { method: string; params: unknown }): void {
    const params = record(frame.params)
    if (frame.method === 'thread/name/updated') {
      const name = string(params.threadName)
      if (name === undefined) return
      const seq = this.nextProjectionSeq()
      this.updateThreadName(follow.threadId, name)
      const title = name.trim() === '' ? null : name.slice(0, 256)
      this.publishProjection(follow.sessionId, 'title', title, seq)
      return
    }
    if (frame.method === 'thread/settings/updated') {
      const preset = codexPermissionPresetFromResponse(params)
      this.setPermissionSelection(follow.sessionId, preset)
      return
    }
    if (frame.method === 'turn/started') {
      const turn = record(params.turn)
      this.endAssistantAttempt(follow, { kind: 'abandoned' })
      this.resetLiveTurn(follow)
      follow.turn += 1
      follow.activeTurnId = string(turn.id)
      follow.requestId = this.pendingRequestIds.get(follow.sessionId)
      follow.stepOpen = true
      this.pushEvent(follow, 'turn/start', { turn: follow.turn })
      this.pushEvent(follow, 'step/start', { turn: follow.turn, step: 1 })
      this.emitRemoteEvent('api-session/status', [follow.sessionId, true])
      for (const item of array(turn.items)) this.acceptCompletedItem(follow, record(item), false)
      return
    }
    if (frame.method === 'item/started' || frame.method === 'item/completed') {
      const item = record(params.item)
      const itemId = string(item.id)
      if (frame.method === 'item/started' && itemId !== undefined) {
        follow.startedItems.add(itemId)
        follow.liveItems.set(itemId, item)
        if (isToolItemType(string(item.type))) this.ensureToolStarted(follow, item)
      }
      if (frame.method === 'item/completed') this.acceptCompletedItem(follow, item, true)
      return
    }
    if (frame.method === 'item/agentMessage/delta') {
      const itemId = string(params.itemId) ?? `assistant:${follow.turn}`
      const delta = string(params.delta)
      if (delta === undefined) return
      this.appendStreamDelta(follow, `agent:${itemId}`, itemId, 'text', delta)
      return
    }
    if (frame.method === 'item/reasoning/summaryPartAdded') {
      const itemId = string(params.itemId)
      if (itemId !== undefined) this.ensureStreamBlock(
        follow,
        `reasoning-summary:${itemId}:${integer(params.summaryIndex) ?? 0}`,
        itemId,
        'reasoning',
      )
      return
    }
    if (frame.method === 'item/reasoning/summaryTextDelta'
      || frame.method === 'item/reasoning/textDelta'
      || frame.method === 'item/plan/delta') {
      const itemId = string(params.itemId)
      const delta = string(params.delta)
      if (itemId === undefined || delta === undefined) return
      const key = frame.method === 'item/plan/delta'
        ? `plan:${itemId}`
        : frame.method === 'item/reasoning/summaryTextDelta'
          ? `reasoning-summary:${itemId}:${integer(params.summaryIndex) ?? 0}`
          : `reasoning-content:${itemId}:${integer(params.contentIndex) ?? 0}`
      this.appendStreamDelta(follow, key, itemId, 'reasoning', delta)
      return
    }
    if (frame.method === 'turn/plan/updated') {
      const todos = array(params.plan).flatMap(value => {
        const item = record(value)
        const content = string(item.step)
        if (content === undefined) return []
        const status = item.status === 'inProgress'
          ? 'in_progress'
          : item.status === 'completed' ? 'completed' : 'pending'
        return [{ content, status }]
      })
      this.pushEvent(follow, 'todo/write', { todos })
      return
    }
    if (frame.method === 'item/commandExecution/outputDelta'
      || frame.method === 'item/fileChange/outputDelta'
      || frame.method === 'item/mcpToolCall/progress') {
      const itemId = string(params.itemId)
      const delta = frame.method === 'item/mcpToolCall/progress'
        ? string(params.message)
        : string(params.delta)
      if (itemId === undefined || delta === undefined) return
      const type = frame.method === 'item/commandExecution/outputDelta'
        ? 'commandExecution'
        : frame.method === 'item/fileChange/outputDelta' ? 'fileChange' : 'mcpToolCall'
      const item = follow.liveItems.get(itemId) ?? { id: itemId, type, status: 'inProgress' }
      follow.liveItems.set(itemId, item)
      this.ensureToolStarted(follow, item)
      const separator = frame.method === 'item/mcpToolCall/progress' && follow.liveToolOutput.has(itemId) ? '\n' : ''
      const output = appendBoundedText(follow.liveToolOutput.get(itemId) ?? '', `${separator}${delta}`)
      follow.liveToolOutput.set(itemId, output)
      this.emitToolResult(follow, item, output)
      return
    }
    if (frame.method === 'item/fileChange/patchUpdated') {
      const itemId = string(params.itemId)
      if (itemId === undefined) return
      const previous = follow.liveItems.get(itemId) ?? { id: itemId, type: 'fileChange', status: 'inProgress' }
      const item = { ...previous, changes: sanitizedFileChanges(params.changes) }
      follow.liveItems.set(itemId, item)
      this.ensureToolStarted(follow, item)
      this.emitToolResult(follow, item, fileChangeSummary(item))
      return
    }
    if (frame.method === 'thread/status/changed') {
      const status = record(params.status)
      const running = status.type === 'active'
      this.emitRemoteEvent('api-session/status', [follow.sessionId, running])
      if (status.type === 'systemError') {
        this.broadcastRcHost({
          type: 'host/agent-error',
          sessionId: follow.sessionId,
          message: 'CodeX reported a thread system error.',
        })
      }
      return
    }
    if (frame.method === 'model/rerouted') {
      const model = string(params.toModel)
      if (model === undefined) return
      const previous = this.selectedModels.get(follow.sessionId)
      const selected: CodexModelSelection = {
        provider: CODEX_PROVIDER,
        model,
        ...(previous?.reasoningEffort === undefined ? {} : { reasoningEffort: previous.reasoningEffort }),
      }
      this.selectedModels.set(follow.sessionId, selected)
      const seq = this.pushEvent(follow, 'request/context', { provider: CODEX_PROVIDER, model })
      this.publishProjection(follow.sessionId, 'modelSelection', modelSelectionProjection(selected), seq)
      return
    }
    if (frame.method === 'turn/completed') {
      const turn = record(params.turn)
      for (const item of array(turn.items)) this.acceptCompletedItem(follow, record(item), true)
      if (follow.stepOpen) {
        this.closeAllStreamBlocks(follow)
        if (follow.streamActive) this.finishStream(follow)
        this.endAssistantAttempt(follow, { kind: 'abandoned' })
        this.pushEvent(follow, 'step/end', { turn: follow.turn, step: 1 })
        follow.stepOpen = false
      }
      this.pushEvent(follow, 'turn/end', {
        turn: follow.turn,
        reason: turn.status === 'failed' || turn.error !== undefined && turn.error !== null
          ? { kind: 'error', error: { message: 'CodeX turn failed.', code: 'codex-turn-failed' } }
          : { kind: 'completed' },
      })
      this.emitRemoteEvent('api-session/status', [follow.sessionId, false])
      this.emitRemoteEvent('api-session/activity', [follow.sessionId, Date.now()])
      follow.activeTurnId = undefined
      this.pendingRequestIds.delete(follow.sessionId)
      void this.refreshAndPublishWorkspaces()
      return
    }
    if (frame.method === 'item/commandExecution/requestApproval'
      || frame.method === 'item/fileChange/requestApproval') {
      const requestHandle = string(params.requestHandle)
      if (requestHandle === undefined) return
      const command = commandText(params.command)
      this.pendingApprovals.set(requestHandle, { requestHandle, sessionId: follow.sessionId })
      this.emitApproval({
        eventId: requestHandle,
        agentId: follow.sessionId,
        request: {
          toolName: frame.method.includes('fileChange') ? 'CodeX file change' : 'CodeX command',
          ...(command === undefined ? {} : { reason: command }),
        },
      })
    }
  }

  private acceptCompletedItem(follow: FollowState, item: JsonRecord, settleAssistant: boolean): void {
    const itemId = string(item.id) ?? `item:${follow.nextSeq}`
    if (follow.completedItems.has(itemId)) return
    const type = string(item.type)
    if (type === 'agentMessage' && !settleAssistant) return
    follow.completedItems.add(itemId)
    this.closeItemStreamBlocks(follow, itemId, itemText(item))
    if (type === 'agentMessage' && follow.streamActive && follow.streamedBlocks.size === 0) this.finishStream(follow)
    const supplementalImages = type === 'agentMessage' ? follow.pendingToolImages : []
    let assistantMessageSeq: number | undefined
    for (const event of itemEvents(
      item,
      follow.turn,
      1,
      follow.requestId,
      this.modelSelection(follow.sessionId),
      follow.sessionId,
      supplementalImages,
    )) {
      if (event.type === 'tool/call' && follow.startedItems.has(itemId)) continue
      if (event.type === 'tool/result') this.pushToolResult(follow, itemId, event)
      else {
        const seq = this.pushEvent(follow, event.type, event.data, event.view)
        if (event.type === 'assistant/message') assistantMessageSeq = seq
      }
    }
    if (type === 'agentMessage' && assistantMessageSeq !== undefined) {
      this.endAssistantAttempt(follow, {
        kind: 'committed',
        eventType: 'assistant/message',
        seq: assistantMessageSeq,
      })
    }
    if (type === 'agentMessage' && supplementalImages.length > 0) follow.pendingToolImages = []
    else if (type !== undefined && isToolItemType(type)) {
      follow.pendingToolImages.push(...toolOutputImageBlocks(item))
    }
    follow.liveItems.delete(itemId)
    follow.liveToolOutput.delete(itemId)
    follow.liveToolResultSeq.delete(itemId)
    follow.liveToolResultSeq.delete(`${itemId}:call`)
  }

  private pushEvent(
    follow: FollowState,
    type: string,
    data: unknown,
    view?: ToolEventView,
    placement?: { replaceSeq: number },
  ): number {
    const seq = follow.nextSeq++
    const event: NativeEvent = {
      type,
      seq,
      time: Date.now(),
      data: adaptEventData(
        type,
        type === 'assistant/message' && this.sessionGeneration === 'v3' && follow.assistantAttempt !== undefined
          ? { ...record(data), stream: follow.assistantAttempt.stream }
          : data,
        this.sessionGeneration,
      ),
      ...(isSurfaceEvent(type)
        ? placement === undefined
          ? { surfaceOp: 'append' as const }
          : {
              surfaceOp: this.sessionGeneration === 'v3'
                ? { op: 'replace' as const, startSeq: placement.replaceSeq, endSeq: placement.replaceSeq }
                : { op: 'replace' as const, start: placement.replaceSeq, end: placement.replaceSeq },
              sourceEventSeqs: [placement.replaceSeq],
            }
          : {}),
    }
    this.cacheImageBlocks(follow.sessionId, event.data)
    if (!follow.rcOnly) {
      follow.queue.push({
        type: 'event',
        event,
        ...(view === undefined ? {} : { view }),
      })
    }
    this.broadcastRcMux({
      type: 'session/event',
      sessionId: follow.sessionId,
      event,
      ...(view === undefined ? {} : { view }),
    })
    return seq
  }

  private cacheImageBlocks(sessionId: string, value: unknown): void {
    for (const block of collectImageBlocks(value)) {
      const attachment = record(block.attachment)
      const attachmentId = string(attachment.attachmentId)
      const data = string(block.data)
      if (attachmentId === undefined || data === undefined || !attachmentId.startsWith(CODEX_IMAGE_ATTACHMENT_PREFIX)) continue
      this.imageAttachments.set(attachmentId, { sessionId, attachment, data })
    }
  }

  private ensureStreamBlock(
    follow: FollowState,
    key: string,
    itemId: string,
    kind: 'text' | 'reasoning',
  ): StreamedBlock {
    const current = follow.streamedBlocks.get(key)
    if (current !== undefined) return current
    const block = { itemId, index: follow.nextBlockIndex++, kind, text: '' }
    follow.streamedBlocks.set(key, block)
    follow.streamActive = true
    this.pushAssistantChunk(follow, { type: 'block-start', index: block.index, blockType: kind })
    return block
  }

  private appendStreamDelta(
    follow: FollowState,
    key: string,
    itemId: string,
    kind: 'text' | 'reasoning',
    delta: string,
  ): void {
    const block = this.ensureStreamBlock(follow, key, itemId, kind)
    block.text = appendBoundedText(block.text, delta)
    this.pushAssistantChunk(follow, {
      type: kind === 'reasoning' ? 'reasoning-delta' : 'text-delta', index: block.index, text: delta,
    })
  }

  private closeItemStreamBlocks(follow: FollowState, itemId: string, fallback?: string): void {
    const matches = [...follow.streamedBlocks].filter(([, block]) => block.itemId === itemId)
    for (const [key, block] of matches) {
      const text = block.text || fallback || ''
      this.pushAssistantChunk(follow, {
        type: 'block-end', index: block.index, block: { type: block.kind, text },
      })
      follow.streamedBlocks.delete(key)
    }
  }

  private closeAllStreamBlocks(follow: FollowState): void {
    for (const block of follow.streamedBlocks.values()) {
      this.pushAssistantChunk(follow, {
        type: 'block-end', index: block.index, block: { type: block.kind, text: block.text },
      })
    }
    follow.streamedBlocks.clear()
  }

  private finishStream(follow: FollowState): void {
    this.pushAssistantChunk(follow, { type: 'finish', reason: { kind: 'stop' } })
    follow.streamActive = false
  }

  private pushAssistantChunk(follow: FollowState, chunk: JsonRecord): void {
    if (this.sessionGeneration !== 'v3' || follow.rcOnly === true) {
      this.pushEvent(follow, 'assistant/chunk', { turn: follow.turn, step: 1, chunk })
      return
    }
    let attempt = follow.assistantAttempt
    if (attempt === undefined) {
      attempt = {
        attemptId: `codex-attempt:${follow.activeTurnId ?? follow.turn}:${follow.nextSeq}`,
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
    attempt.stream.push({ time, chunk })
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
    if (this.sessionGeneration === 'v3' && follow.rcOnly !== true) {
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
  }

  private ensureToolStarted(follow: FollowState, item: JsonRecord): void {
    const itemId = string(item.id)
    if (itemId === undefined) return
    if (!follow.startedItems.has(itemId)) follow.startedItems.add(itemId)
    if (follow.liveItems.get(itemId) !== item) follow.liveItems.set(itemId, item)
    const call = itemEvents(
      item,
      follow.turn,
      1,
      follow.requestId,
      this.modelSelection(follow.sessionId),
      follow.sessionId,
    ).find(event => event.type === 'tool/call')
    if (call !== undefined && !follow.liveToolResultSeq.has(`${itemId}:call`)) {
      this.pushEvent(follow, call.type, call.data, call.view)
      follow.liveToolResultSeq.set(`${itemId}:call`, -1)
    }
  }

  private emitToolResult(follow: FollowState, item: JsonRecord, resultText: string): void {
    const itemId = string(item.id)
    if (itemId === undefined) return
    const result = toolResultEvent(item, follow.turn, 1, itemId, resultText)
    this.pushToolResult(follow, itemId, result)
  }

  private pushToolResult(follow: FollowState, itemId: string, event: ProjectedNativeEvent): void {
    const previous = follow.liveToolResultSeq.get(itemId)
    const projected = previous === undefined ? event : toolResultContentReplacement(event)
    const seq = this.pushEvent(
      follow,
      projected.type,
      projected.data,
      projected.view,
      previous === undefined ? undefined : { replaceSeq: previous },
    )
    follow.liveToolResultSeq.set(itemId, seq)
  }

  private resetLiveTurn(follow: FollowState): void {
    follow.startedItems.clear()
    follow.completedItems.clear()
    follow.streamedBlocks.clear()
    follow.nextBlockIndex = 0
    follow.streamActive = false
    follow.assistantAttempt = undefined
    follow.liveItems.clear()
    follow.liveToolOutput.clear()
    follow.liveToolResultSeq.clear()
    follow.pendingToolImages = []
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
      toolName: string(input.request.toolName) ?? 'CodeX',
      ...(typeof input.request.reason === 'string' ? { reason: input.request.reason } : {}),
    }, input.eventId)
  }

  private async answerRemoteEvent(args: JsonRecord, signal: AbortSignal): Promise<undefined> {
    const eventId = string(args.eventId)
    const outcome = record(args.outcome)
    if (eventId === undefined) throw new Error('The CodeX approval result is missing its event id.')
    const pending = this.pendingApprovals.get(eventId)
    if (pending === undefined) return undefined
    this.pendingApprovals.delete(eventId)
    const decision = outcome.kind === 'result' && outcome.value === 'allowed-once'
      ? 'accept'
      : outcome.kind === 'result' && outcome.value === 'cancelled'
        ? 'cancel'
        : 'decline'
    await this.client.respond(pending.requestHandle, decision, signal)
    return undefined
  }

  private async createWorkspace(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const path = string(request.path)
    if (path === undefined || path.trim() === '') return failure('bad-request', 'A CodeX working directory is required.')
    const catalog = await this.currentCatalog(signal)
    const existing = catalog.workspaces.find(item => item.path === path)
    if (existing !== undefined) return success({ workspace: nativeWorkspace(existing), created: false })
    return failure('workspace-not-found', 'The selected directory is not visible to CodeX Remote.')
  }

  private async renameWorkspace(request: JsonRecord): Promise<unknown> {
    return failure('workspace-read-only', `CodeX virtual Workspace ${string(request.workspaceId) ?? ''} cannot be renamed.`)
  }

  private async workspaceForSession(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = string(request.sessionId)
    const catalog = await this.currentCatalog(signal)
    const workspace = catalog.workspaces.find(item => sessionId !== undefined && item.sessionIds.includes(sessionId))
    return workspace === undefined
      ? failure('workspace-not-found', 'The CodeX virtual Workspace was not found.')
      : success({ workspace: nativeWorkspace(workspace) })
  }

  private selectedWorkspace(catalog: CatalogState): CodexVirtualWorkspaceView | undefined {
    return this.selectedWorkspaceId === undefined
      ? undefined
      : catalog.workspaces.find(item => item.workspaceId === this.selectedWorkspaceId)
  }

  private async describeHost(signal: AbortSignal): Promise<unknown> {
    const catalog = await this.currentCatalog(signal)
    const workspace = this.selectedWorkspace(catalog)
    const models = await this.models(signal).catch(() => undefined)
    return {
      version: 'CodeX Remote',
      cwd: workspace?.path ?? '',
      home: workspace?.path ?? '',
      provider: 'CodeX',
      ...(models === undefined ? {} : { model: models.default.model }),
      attachedSessions: catalog.sessions.length,
      canOpenPath: workspace !== undefined,
    }
  }

  private async listDirectory(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const catalog = await this.currentCatalog(signal)
    const workspace = this.selectedWorkspace(catalog)
    if (workspace === undefined) return failure('workspace-not-found', 'The CodeX virtual Workspace was not found.')
    const path = string(request.path) ?? workspace.path
    if (!containsPath(workspace.path, path)) {
      return failure('workspace-not-found', 'The selected directory is outside the current CodeX virtual Workspace.')
    }
    const listing = record(await this.client.request('dsh/directoryList', { path }, signal))
    if (!isCodexDirectoryListing(listing)) {
      return failure('internal', 'CodeX Remote returned an invalid directory listing.')
    }
    const listedPaths = [
      listing.path,
      listing.home,
      ...listing.crumbs.map(item => item.path),
      ...listing.entries.map(item => item.path),
    ]
    if (listedPaths.some(path => !containsPath(workspace.path, path))) {
      return failure('internal', 'CodeX Remote returned a directory outside the current Workspace.')
    }
    return success(listing)
  }

  private async archiveSession(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    await this.client.request('thread/archive', { threadId: nativeThreadId(sessionId) }, signal)
    const catalog = await this.refreshCatalog(signal)
    this.publishWorkspaceBaseline(catalog)
    return success({ archivedSessionIds: [sessionId] })
  }

  private async createSession(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const catalog = await this.currentCatalog(signal)
    const workspaceId = string(request.workspaceId) ?? this.selectedWorkspaceId
    const workspace = workspaceId === undefined ? undefined : catalog.workspaces.find(item => item.workspaceId === workspaceId)
    const cwd = string(request.cwd)
      ?? workspace?.path
    if (cwd === undefined) return failure('workspace-not-found', 'The CodeX virtual Workspace was not found.')
    if (workspace !== undefined && !containsPath(workspace.path, cwd)) {
      return failure('workspace-not-found', 'The selected directory is outside the current CodeX virtual Workspace.')
    }
    const directory = await this.models(signal)
    const selection = directory.default
    const requestedPreset = CODEX_DEFAULT_PERMISSION
    const result = record(await this.client.request('thread/start', {
      cwd,
      model: selection.model,
      permissionPreset: requestedPreset,
    }, signal))
    const permissionPreset = codexPermissionPresetFromResponse(result) ?? requestedPreset
    const thread = { ...record(result.thread), cwd, turns: array(record(result.thread).turns) }
    const projected = projectCodexThread(thread)
    if (projected === undefined) return failure('internal', 'CodeX returned an invalid Thread.')
    this.pendingThreads.set(projected.nativeId, thread)
    this.blankThreads.add(projected.nativeId)
    this.selectedModels.set(projected.id, selection)
    this.selectedPermissions.set(projected.id, permissionPreset)
    await this.refreshAndPublishWorkspaces()
    const seq = this.nextProjectionSeq()
    this.emitRemoteEvent('api-session/added', [this.sessionSummary(projected, {
      blank: true,
      modelSelection: selection,
      lastPromptAt: null,
      asOfSeq: seq,
    })])
    this.publishProjection(projected.id, 'title', displayTitle(projected), seq)
    return success({ sessionId: projected.id })
  }

  private async forkSession(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const result = record(await this.client.request('thread/fork', {
      threadId: nativeThreadId(sessionId),
    }, signal))
    const permissionPreset = codexPermissionPresetFromResponse(result)
    const projected = projectCodexThread(record(result.thread))
    if (projected === undefined) return failure('internal', 'CodeX returned an invalid forked Thread.')
    this.selectedModels.set(projected.id, this.modelSelection(sessionId, await this.models(signal)))
    this.setPermissionSelection(projected.id, permissionPreset)
    await this.refreshAndPublishWorkspaces()
    const seq = this.nextProjectionSeq()
    this.publishProjection(projected.id, 'title', displayTitle(projected), seq)
    return success({ sessionId: projected.id })
  }

  private async prompt(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const content = array(request.content)
    const input = codexPromptInput(content)
    if (input === undefined) return failure('attachment-error', 'CodeX virtual Sessions accept text and pasted PNG, JPEG, WebP, or GIF images only.')
    const threadId = nativeThreadId(sessionId)
    const selection = this.modelSelection(sessionId, await this.models(signal))
    const isFreshBlankThread = this.blankThreads.has(threadId) || this.pendingThreads.has(threadId)
    await this.ensureRcFollow(sessionId)
    if (!isFreshBlankThread) {
      const resumeResult = await this.client.request('thread/resume', {
        threadId,
        model: selection.model,
      }, signal)
      const serverPreset = codexPermissionPresetFromResponse(resumeResult)
      if (serverPreset !== undefined) {
        this.setPermissionSelection(sessionId, serverPreset)
      }
    }
    this.pendingRequestIds.set(sessionId, string(request.requestId) ?? '')
    const mode = request.mode === 'steer' ? 'turn/steer' : 'turn/start'
    if (mode === 'turn/steer') {
      const active = this.activeTurnId(threadId)
      if (active === undefined) return failure('steer-unavailable', 'The CodeX Thread has no active turn to steer.')
      await this.client.request(mode, { threadId, expectedTurnId: active, input }, signal)
    } else {
      await this.client.request(mode, {
        threadId,
        input,
        ...codexModelParams(selection),
      }, signal)
    }
    this.blankThreads.delete(threadId)
    return success({ accepted: true })
  }

  private async attachment(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const attachmentId = requiredString(request.attachmentId, 'attachmentId')
    if (!attachmentId.startsWith(CODEX_IMAGE_ATTACHMENT_PREFIX)) {
      return failure('attachment-error', 'The CodeX image is not available in this virtual Session.', { reason: 'not-referenced' })
    }
    nativeThreadId(sessionId)
    const cached = this.imageAttachments.get(attachmentId)
    if (cached?.sessionId === sessionId) return success({ attachment: cached.attachment, data: cached.data })

    await this.hydrateImageAttachments(sessionId, signal)
    const hydrated = this.imageAttachments.get(attachmentId)
    return hydrated?.sessionId === sessionId
      ? success({ attachment: hydrated.attachment, data: hydrated.data })
      : failure('attachment-error', 'The CodeX image is not available in this virtual Session.', { reason: 'not-referenced' })
  }

  private async hydrateImageAttachments(sessionId: string, signal: AbortSignal): Promise<void> {
    const threadId = nativeThreadId(sessionId)
    const result = record(await this.client.request('thread/read', { threadId, includeTurns: true }, signal))
    const thread = record(result.thread)
    if (string(thread.id) !== threadId) throw new Error('CodeX returned an invalid Thread history.')
    this.cacheHistoryImages(projectCodexNativeHistory(thread, sessionId))
  }

  private async cancel(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const threadId = nativeThreadId(sessionId)
    const turnId = this.activeTurnId(threadId)
    if (turnId !== undefined) await this.client.request('turn/interrupt', { threadId, turnId }, signal)
    return success({ accepted: true })
  }

  private async renameSession(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const title = requiredString(request.title, 'title')
    await this.client.request('thread/name/set', { threadId: nativeThreadId(sessionId), name: title }, signal)
    const seq = this.nextProjectionSeq()
    this.updateThreadName(nativeThreadId(sessionId), title)
    this.publishProjection(sessionId, 'title', title, seq)
    await this.refreshAndPublishWorkspaces()
    return success({ title, seq })
  }

  private async sessionPage(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = sessionIdFromAddress(record(request.address))
    const page = await this.readHistoryPage(nativeThreadId(sessionId), {
      beforeSeq: optionalNonNegativeInteger(request.beforeSeq),
      throughSeq: optionalInteger(request.throughSeq),
      maxMessages: optionalPositiveInteger(request.maxMessages),
    }, signal)
    return success({ records: page.records, hasMore: page.hasMore })
  }

  private activeTurnId(threadId: string): string | undefined {
    for (const follow of this.follows) if (follow.threadId === threadId && follow.stepOpen) return follow.activeTurnId
    return undefined
  }

  private async fetchThread(threadId: string, signal?: AbortSignal): Promise<JsonRecord> {
    const result = record(await this.client.request('thread/read', { threadId, includeTurns: false }, signal))
    const thread = record(result.thread)
    if (string(thread.id) !== threadId) throw new Error('CodeX returned an invalid Thread history.')
    return thread
  }

  private async readHistoryPage(
    threadId: string,
    page: { beforeSeq?: number; throughSeq?: number; maxMessages?: number },
    signal?: AbortSignal,
  ): Promise<CodexNativeHistoryPage> {
    let value: unknown
    try {
      value = record(await this.client.request('dsh/sessionHistory', {
        threadId,
        ...(page.beforeSeq === undefined ? {} : { beforeSeq: page.beforeSeq }),
        ...(page.throughSeq === undefined ? {} : { throughSeq: page.throughSeq }),
        ...(page.maxMessages === undefined ? {} : { maxMessages: page.maxMessages }),
      }, signal))
    } catch (error) {
      if (!isLegacySessionHistoryUnsupported(error)) throw error
      const result = record(await this.client.request('thread/read', { threadId, includeTurns: true }, signal))
      const thread = record(result.thread)
      if (string(thread.id) !== threadId) throw new Error('CodeX returned an invalid Thread history.')
      value = paginateCodexNativeHistory(
        projectCodexNativeHistory(thread, `codex:${threadId}`, this.sessionGeneration),
        {
          beforeSeq: page.beforeSeq,
          throughSeq: page.throughSeq,
          maxMessages: page.maxMessages,
        },
      )
    }
    value = adaptCodexHistoryPage(value, this.sessionGeneration)
    if (!isCodexNativeHistoryPage(value, `codex:${threadId}`)) {
      throw new Error('CodeX Remote returned an invalid paginated History.')
    }
    if (Object.hasOwn(value, 'permissionPreset')) {
      const preset = value.permissionPreset
      this.setPermissionSelection(`codex:${threadId}`, preset === 'workspace-write' || preset === 'danger-full-access' ? preset : undefined)
    }
    this.cacheHistoryImages(value)
    return value
  }

  private cacheHistoryImages(history: CodexNativeHistoryPage | CodexNativeHistory): void {
    const sessionId = history.header.id
    const entries = 'entries' in history ? history.entries : history.records
    for (const entry of entries) this.cacheImageBlocks(sessionId, entry.event.data)
  }

  private async sessionHistory(request: JsonRecord, signal: AbortSignal): Promise<unknown> {
    const sessionId = requiredString(request.sessionId, 'sessionId')
    const beforeSeq = optionalNonNegativeInteger(request.beforeSeq)
    const history = await this.readHistoryPage(nativeThreadId(sessionId), {
      beforeSeq,
      maxMessages: optionalPositiveInteger(request.maxMessages),
    }, signal)
    const directory = await this.models(signal).catch(() => undefined)
    // rc.2 has one global mux rather than the alpha session/follow stream. A
    // history read is the reliable signal that the native client has opened a
    // Session, so attach the CodeX live stream here before returning its tail.
    if (beforeSeq === undefined) await this.ensureRcFollow(sessionId, history)
    return success({
      events: history.records.map(entry => ({
        event: entry.event,
        ...(entry.view === undefined ? {} : { view: entry.view }),
      })),
      hasMore: history.hasMore,
      ...(beforeSeq !== undefined ? {} : {
        projections: {
          asOfSeq: history.cursor,
          values: {
            title: this.sessionTitle(sessionId),
            sessionListMetadata: { blank: history.cursor < 0, lastPromptAt: null },
            modelSelection: modelSelectionProjection(this.modelSelection(sessionId, directory)),
            permissions: codexPermissionsProjection(this.permissionSelection(sessionId)),
            imageLimits: codexImageLimitsProjection(),
          },
        },
      }),
    })
  }

  private async ensureRcFollow(sessionId: string, seedHistory?: CodexNativeHistoryPage): Promise<void> {
    if (this.followsHas(sessionId)) return
    const threadId = nativeThreadId(sessionId)
    // The Host bounds CodeX streams per connection. rc.2 only renders one
    // active conversation, so release older rc-only follows when navigation
    // moves to another Session. Alpha follows own their lifecycle separately.
    const stale = [...this.follows].filter(follow => follow.rcOnly && follow.sessionId !== sessionId)
    for (const follow of stale) {
      this.follows.delete(follow)
      follow.queue.close()
      await follow.close?.().catch(() => undefined)
    }
    const history = seedHistory ?? await this.readHistoryPage(threadId, {}, undefined)
    const controller = new AbortController()
    const follow: FollowState = {
      sessionId,
      threadId,
      queue: new AsyncValueQueue(controller.signal),
      nextSeq: history.cursor + 1,
      turn: history.nextTurn,
      stepOpen: history.activeTurnId !== undefined,
      startedItems: new Set(),
      completedItems: new Set(),
      streamedBlocks: new Map(),
      nextBlockIndex: 0,
      streamActive: false,
      assistantStreamRevision: 0,
      liveItems: new Map(),
      liveToolOutput: new Map(),
      liveToolResultSeq: new Map(),
      pendingToolImages: [],
      requestId: this.pendingRequestIds.get(sessionId),
      rcOnly: true,
      ...(history.activeTurnId === undefined ? {} : { activeTurnId: history.activeTurnId }),
    }
    this.follows.add(follow)
    try {
      const stream = await this.client.subscribe(
        threadId,
        frame => this.acceptCodexFrame(follow, frame),
        controller.signal,
        () => this.closeFollowAfterRemoteStreamClosed(follow),
      )
      follow.close = async () => {
        controller.abort()
        await stream.close()
      }
    } catch (error) {
      this.follows.delete(follow)
      controller.abort()
      follow.queue.close()
      throw error
    }
  }

  private followsHas(sessionId: string): boolean {
    for (const follow of this.follows) if (follow.sessionId === sessionId) return true
    return false
  }

  private closeFollowAfterRemoteStreamClosed(follow: FollowState): void {
    this.follows.delete(follow)
    follow.queue.close()
    this.emitRemoteEvent('api-session/status', [follow.sessionId, false])
  }

  private async refreshAndPublishWorkspaces(): Promise<void> {
    const catalog = await this.refreshCatalog().catch(() => undefined)
    if (catalog !== undefined) this.publishWorkspaceBaseline(catalog)
  }

  private publishWorkspaceBaseline(catalog: CatalogState): void {
    for (const queue of this.workspaceStreams) {
      for (const workspace of nativeVisibleWorkspaces(catalog, this.selectedWorkspaceId)) {
        queue.push({ type: 'upsert', workspace: nativeWorkspace(workspace) })
      }
      queue.push({ type: 'archived', archivedSessionIds: catalog.sessions.filter(item => item.archived).map(item => item.id) })
    }
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
        if (pending === undefined) return { accepted: false, reason: 'not-pending' }
        const result = message.result
        const outcome = result.ok ? result.value : undefined
        const decision = outcome === 'allowed-once' ? 'accept' : outcome === 'cancelled' ? 'cancel' : 'decline'
        await this.client.respond(pending.requestHandle, decision)
        this.pendingApprovals.delete(pending.requestHandle)
        return { accepted: true }
      },
    }
  }

  private async *rcMux(request: RpcRequest<unknown>, signal: AbortSignal): AsyncIterable<unknown> {
    const queue = new AsyncValueQueue(signal)
    this.rcMuxStreams.add(queue)
    const catalog = await this.currentCatalog(signal)
    for (const session of catalog.sessions) queue.push({
      rpcId: `${String(request.rpcId)}:${session.id}:subscribed`,
      payload: { type: 'session/subscribed', sessionId: session.id, lastSeq: -1 },
    })
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

  private broadcastRcMux(payload: unknown, rpcId = `codex-mux:${Date.now()}:${Math.random()}`): void {
    for (const queue of this.rcMuxStreams) queue.push({ rpcId, payload })
  }

  private broadcastRcHost(payload: unknown): void {
    const frame = { rpcId: `codex-host:${Date.now()}:${Math.random()}`, payload }
    for (const queue of this.rcHostStreams) queue.push(frame)
  }
}

async function loadCatalog(
  client: CodexClientLike,
  signal?: AbortSignal,
  pendingThreads?: Map<string, JsonRecord>,
): Promise<CatalogState> {
  let projects = await loadCodexProjects(client, signal)
  const threads: JsonRecord[] = []
  let cursor: string | null | undefined
  for (let page = 0; page < MAX_CODEX_PAGES; page += 1) {
    const result = record(await client.request('thread/list', {
      limit: CODEX_PAGE_LIMIT,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false,
      ...(cursor === undefined ? {} : { cursor }),
    }, signal))
    for (const value of array(result.data)) {
      const thread = record(value)
      if (string(thread.id) !== undefined) threads.push(thread)
    }
    cursor = typeof result.nextCursor === 'string' && result.nextCursor.length > 0 ? result.nextCursor : undefined
    if (cursor === undefined) break
  }
  if (pendingThreads !== undefined) {
    const listedIds = new Set(threads.map(thread => string(thread.id)).filter((id): id is string => id !== undefined))
    for (const [threadId, thread] of pendingThreads) {
      if (listedIds.has(threadId)) pendingThreads.delete(threadId)
      else threads.unshift(thread)
    }
  }
  if (projects.length === 0) {
    projects = deriveCodexCwdWorkspaces(threads).map(workspace => ({
      id: workspace.id,
      name: workspace.name,
      roots: [{ path: workspace.path }],
      position: workspace.position,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }))
  }
  const projected = threads.map(thread => {
    const session = projectCodexThread(thread)
    return session === undefined ? undefined : { thread, session }
  }).filter((value): value is { thread: JsonRecord; session: DisplaySession } => value !== undefined)
  const projectWorkspaces = projects.map(projectWorkspace)
  const workspaceByProjectId = new Map(projects.map((project, index) => [project.id, projectWorkspaces[index]!]))
  const visibleSessionIds = new Set<string>()
  const visibleThreads: JsonRecord[] = []

  for (const { thread, session } of projected) {
    const projectWorkspaceForSession = findProjectWorkspace(thread, session, projects, workspaceByProjectId)
    if (projectWorkspaceForSession !== undefined) {
      addSessionToWorkspace(projectWorkspaceForSession, session)
      visibleSessionIds.add(session.id)
      visibleThreads.push(thread)
    }
  }
  const sessions = projected
    .map(value => value.session)
    .filter(session => visibleSessionIds.has(session.id))

  return {
    threads: visibleThreads,
    sessions,
    projects,
    workspaces: projectWorkspaces,
  }
}

async function loadCodexProjects(client: CodexClientLike, signal?: AbortSignal): Promise<CodexProject[]> {
  const projects: CodexProject[] = []
  let cursor: string | null | undefined
  try {
    for (let page = 0; page < MAX_CODEX_PAGES; page += 1) {
      const result = record(await client.request('project/list', {
        limit: CODEX_PAGE_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      }, signal))
      for (const value of array(result.data)) {
        const project = projectCodexProject(value, projects.length)
        if (project !== undefined && !projects.some(item => item.id === project.id)) projects.push(project)
      }
      cursor = typeof result.nextCursor === 'string' && result.nextCursor.length > 0 ? result.nextCursor : undefined
      if (cursor === undefined) break
    }
  } catch (error) {
    if (isProjectListUnsupported(error)) return []
    throw error
  }
  return projects.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

async function loadModelDirectory(client: CodexClientLike, signal?: AbortSignal): Promise<CodexModelDirectory> {
  const models = new Map<string, CodexModelView>()
  let defaultModelId: string | undefined
  let cursor: string | null | undefined
  for (let page = 0; page < MAX_CODEX_PAGES; page += 1) {
    const result = record(await client.request('model/list', {
      limit: CODEX_PAGE_LIMIT,
      includeHidden: false,
      ...(cursor === undefined ? {} : { cursor }),
    }, signal))
    for (const value of array(result.data)) {
      const source = record(value)
      if (source.hidden === true) continue
      const id = string(source.model) ?? string(source.id)
      if (id === undefined || models.has(id)) continue
      const efforts = array(source.supportedReasoningEfforts).map(value => {
        const effort = record(value)
        const effortId = string(effort.reasoningEffort)
        if (effortId === undefined) return undefined
        const description = string(effort.description)
        return {
          id: effortId,
          name: reasoningEffortName(effortId),
          ...(description === undefined ? {} : { description }),
        }
      }).filter((value): value is NonNullable<typeof value> => value !== undefined)
      const defaultEffort = string(source.defaultReasoningEffort)
      const description = string(source.description)
      const model: CodexModelView = {
        id,
        name: string(source.displayName) ?? id,
        ...(description === undefined ? {} : { description }),
        ...(efforts.length === 0 ? {} : {
          reasoning: {
            efforts,
            ...(defaultEffort === undefined || !efforts.some(effort => effort.id === defaultEffort)
              ? {}
              : { defaultEffort }),
          },
        }),
      }
      models.set(id, model)
      if (source.isDefault === true) defaultModelId = id
    }
    cursor = typeof result.nextCursor === 'string' && result.nextCursor.length > 0 ? result.nextCursor : undefined
    if (cursor === undefined) break
  }
  const defaultModel = models.get(defaultModelId ?? '') ?? (models.values().next().value as CodexModelView | undefined)
  if (defaultModel === undefined) throw new Error('CodeX did not advertise any available models.')
  const defaultEffort = defaultModel.reasoning?.defaultEffort
  return {
    default: {
      provider: CODEX_PROVIDER,
      model: defaultModel.id,
      ...(defaultEffort === undefined ? {} : { reasoningEffort: defaultEffort }),
    },
    groups: [{ id: CODEX_PROVIDER, name: 'CodeX', models: [...models.values()] }],
    models,
  }
}

export function projectCodexNativeHistory(
  thread: JsonRecord,
  sessionId: string,
  sessionGeneration: HarnessSessionGeneration = 'legacy',
): CodexNativeHistory {
  const entries: CodexNativeHistory['entries'] = []
  let seq = 0
  let turnNumber = 0
  const active = activeTurnId(thread.turns)
  const append = (
    type: string,
    data: unknown,
    time = Date.now(),
    view?: ToolEventView,
    sourceEventSeqs?: number[],
  ): number => {
    const eventSeq = seq++
    entries.push({
      type: 'event',
      event: {
        type,
        seq: eventSeq,
        time,
        data: adaptEventData(type, data, sessionGeneration),
        ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }),
        ...(isSurfaceEvent(type) ? { surfaceOp: 'append' as const } : {}),
      },
      ...(view === undefined ? {} : { view }),
    })
    return eventSeq
  }
  for (const rawTurn of array(thread.turns)) {
    const turn = record(rawTurn)
    const turnItems = array(turn.items).map(record)
    const toolImages = turnItems.flatMap(toolOutputImageBlocks)
    let imageOwner = -1
    for (let index = 0; index < turnItems.length; index += 1) {
      if (turnItems[index]!.type === 'agentMessage') imageOwner = index
    }
    turnNumber += 1
    const turnActive = isActiveCodexTurn(turn)
    const time = normalizeTime(turn.createdAt) || normalizeTime(turn.startedAt) || normalizeTime(thread.createdAt) || Date.now()
    append('turn/start', { turn: turnNumber }, time)
    append('step/start', { turn: turnNumber, step: 1 }, time)
    for (let itemIndex = 0; itemIndex < turnItems.length; itemIndex += 1) {
      const item = turnItems[itemIndex]!
      let toolCallSeq: number | undefined
      for (const event of itemEvents(
        item,
        turnNumber,
        1,
        undefined,
        modelSelection(),
        sessionId,
        itemIndex === imageOwner ? toolImages : [],
      )) {
        const eventSeq = append(
          event.type,
          event.data,
          normalizeTime(item.createdAt) || time,
          event.view,
          event.type === 'tool/result' && toolCallSeq !== undefined ? [toolCallSeq] : undefined,
        )
        if (event.type === 'tool/call') toolCallSeq = eventSeq
      }
    }
    if (turnActive) continue
    append('step/end', { turn: turnNumber, step: 1 }, normalizeTime(turn.updatedAt) || normalizeTime(turn.completedAt) || time)
    append('turn/end', {
      turn: turnNumber,
      reason: turn.status === 'failed' || turn.error !== undefined && turn.error !== null
        ? { kind: 'error', error: { message: 'CodeX turn failed.', code: 'codex-turn-failed' } }
        : { kind: 'completed' },
    }, normalizeTime(turn.updatedAt) || normalizeTime(turn.completedAt) || time)
  }
  const projected = projectCodexThread(thread)
  return {
    header: {
      version: sessionGeneration === 'v3' ? 3 : 1,
      id: sessionId,
      createdAt: projected?.createdAt ?? Date.now(),
      ...(projected?.cwd === undefined ? {} : { cwd: projected.cwd }),
      ...(sessionGeneration === 'v3' ? { isSeeded: false } : {}),
    },
    entries,
    lastSeq: seq - 1,
    nextTurn: turnNumber,
    ...(active === undefined ? {} : { activeTurnId: active }),
  }
}

export function paginateCodexNativeHistory(
  history: CodexNativeHistory,
  request: { beforeSeq?: number; throughSeq?: number; maxMessages?: number },
): CodexNativeHistoryPage {
  const throughSeq = Math.min(request.throughSeq ?? history.lastSeq, history.lastSeq)
  const endSeq = Math.min(throughSeq, request.beforeSeq === undefined ? throughSeq : request.beforeSeq - 1)
  const window = endSeq < 0 ? [] : history.entries.filter(entry => entry.event.seq <= endSeq)
  const maxMessages = request.maxMessages ?? DEFAULT_HISTORY_MESSAGES
  let messages = 0
  let cut = 0
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const event = window[index]!.event
    if (!isSurfaceEvent(event.type) || event.surfaceOp !== 'append') continue
    messages += 1
    if (messages >= maxMessages) {
      cut = Math.min(event.seq, ...(event.sourceEventSeqs ?? []))
      break
    }
  }
  return {
    header: history.header,
    cursor: history.lastSeq,
    nextTurn: history.nextTurn,
    records: window.filter(entry => entry.event.seq >= cut),
    hasMore: window.some(entry => entry.event.seq < cut),
    ...(history.activeTurnId === undefined ? {} : { activeTurnId: history.activeTurnId }),
  }
}

function adaptEventData(type: string, data: unknown, sessionGeneration: HarnessSessionGeneration): unknown {
  if (sessionGeneration !== 'v3' || type !== 'assistant/message') return data
  const value = record(data)
  return Array.isArray(value.stream) ? value : { ...value, stream: [] }
}

function adaptCodexHistoryPage(value: unknown, sessionGeneration: HarnessSessionGeneration): unknown {
  if (sessionGeneration !== 'v3') return value
  const page = record(value)
  const sourceHeader = record(page.header)
  const { seedLength: _seedLength, ...header } = sourceHeader
  const records = Array.isArray(page.records)
    ? page.records.map(raw => {
        const entry = record(raw)
        const sourceEvent = record(entry.event)
        const sourceSurfaceOp = record(sourceEvent.surfaceOp)
        const surfaceOp = sourceEvent.surfaceOp === 'append'
          ? 'append'
          : sourceSurfaceOp.op === 'replace'
              && integer(sourceSurfaceOp.startSeq) !== undefined
              && integer(sourceSurfaceOp.endSeq) !== undefined
            ? sourceSurfaceOp
            : sourceSurfaceOp.op === 'replace'
                && integer(sourceSurfaceOp.start) !== undefined
                && integer(sourceSurfaceOp.end) !== undefined
              ? {
                  op: 'replace',
                  startSeq: sourceSurfaceOp.start,
                  endSeq: sourceSurfaceOp.end,
                }
              : sourceEvent.surfaceOp
        return {
          ...entry,
          event: {
            ...sourceEvent,
            data: adaptEventData(string(sourceEvent.type) ?? '', sourceEvent.data, sessionGeneration),
            ...(surfaceOp === undefined ? {} : { surfaceOp }),
          },
        }
      })
    : page.records
  return {
    ...page,
    header: { ...header, version: 3, isSeeded: sourceHeader.isSeeded === true },
    records,
  }
}

function itemEvents(
  item: JsonRecord,
  turn: number,
  step: number,
  requestId?: string,
  selection: CodexModelSelection = modelSelection(),
  sessionId = CODEX_SESSION_PREFIX,
  supplementalImages: JsonRecord[] = [],
): ProjectedNativeEvent[] {
  const type = string(item.type)
  const id = string(item.id) ?? `${turn}:${step}:${hashString(JSON.stringify(item))}`
  const text = itemText(item)
  if (type === 'userMessage') return [{
    type: 'user/message',
    data: {
      id,
      role: 'user',
      content: messageContent(item, `${sessionId}:${id}`, 'text', text),
      source: requestId === undefined || requestId === '' ? { kind: 'user' } : { kind: 'user', rpcId: requestId },
    },
  }]
  if (type === 'agentMessage' || type === 'reasoning' || type === 'plan') return [{
    type: 'assistant/message',
    data: {
      turn,
      step,
      message: {
        id,
        role: 'assistant',
        content: messageContent(
          item,
          `${sessionId}:${id}`,
          type === 'reasoning' ? 'reasoning' : 'text',
          text,
          type === 'agentMessage' ? supplementalImages : [],
        ),
        source: { kind: 'model', provider: selection.provider, model: selection.model },
      },
    },
  }]
  if (type !== undefined && isToolItemType(type)) {
    const name = toolEventName(type)
    const args = toolArguments(item)
    return [
      {
        type: 'tool/call',
        data: { turn, step, callId: id, name, arguments: JSON.stringify(args) },
        view: { for: 'call', view: toolCallView(item, type, args) },
      },
      toolResultEvent(item, turn, step, id, toolResultText(item, type, text)),
    ]
  }
  if (type === 'error') return [{
    type: 'assistant/message',
    data: {
      turn,
      step,
      message: {
        id,
        role: 'assistant',
        content: [{ type: 'text', text: text ?? 'CodeX reported an error.' }],
        source: { kind: 'model', provider: selection.provider, model: selection.model },
      },
    },
  }]
  return []
}

function messageContent(
  item: JsonRecord,
  attachmentSeed: string,
  fallbackType: 'text' | 'reasoning',
  fallbackText?: string,
  supplementalImages: JsonRecord[] = [],
): JsonRecord[] {
  const source = item.content ?? item.input
  const blocks = contentBlocks(source, attachmentSeed)
  const images = contentBlocks(supplementalImages, `${attachmentSeed}:tool-output`)
  if (blocks.length > 0 || images.length > 0) {
    return [...(blocks.length > 0 ? blocks : [{ type: fallbackType, text: fallbackText ?? '' }]), ...images]
  }
  return [{ type: fallbackType, text: fallbackText ?? '' }]
}

function toolOutputImageBlocks(item: JsonRecord): JsonRecord[] {
  const candidates = [
    record(item.result).content,
    record(item.output).content,
    item.contentItems,
    Array.isArray(item.output) ? item.output : undefined,
  ]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    const images = candidate.flatMap(value => {
      const block = record(value)
      return isImageContent(block) && parseImageBlock(block) !== undefined ? [block] : []
    })
    if (images.length > 0) return images
  }
  return []
}

function contentBlocks(value: unknown, attachmentSeed: string): JsonRecord[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  if (!Array.isArray(value)) return []
  const blocks: JsonRecord[] = []
  let imageIndex = 0
  for (const raw of value) {
    if (typeof raw === 'string') {
      blocks.push({ type: 'text', text: raw })
      continue
    }
    const block = record(raw)
    const image = imageContentBlock(block, attachmentSeed, imageIndex)
    if (image !== undefined) {
      imageIndex += 1
      blocks.push(image)
      continue
    }
    const text = string(block.text) ?? string(block.content)
    if (text !== undefined) blocks.push({ type: block.type === 'reasoning' ? 'reasoning' : 'text', text })
  }
  return blocks
}

function imageContentBlock(block: JsonRecord, attachmentSeed: string, index: number): JsonRecord | undefined {
  if (!isImageContent(block)) return undefined
  const image = parseImageBlock(block)
  if (image === undefined) return undefined
  const dimensions = imageDimensions(image.mediaType, image.data)
  const name = string(block.name)
  const attachment = {
    attachmentId: `${CODEX_IMAGE_ATTACHMENT_PREFIX}${hashString(`${attachmentSeed}:${index}`)}:${index}`,
    mediaType: image.mediaType,
    bytes: base64ByteLength(image.data),
    width: dimensions.width,
    height: dimensions.height,
    ...(name === undefined ? {} : { name }),
  }
  return {
    type: 'image',
    attachment,
    mediaType: image.mediaType,
    data: image.data,
    url: image.url,
    ...(name === undefined ? {} : { name }),
  }
}

function isImageContent(block: JsonRecord): boolean {
  return block.type === 'image' || block.type === 'input_image'
}

function parseImageBlock(block: JsonRecord): { mediaType: string; data: string; url: string } | undefined {
  const url = string(block.url)
    ?? string(block.image_url)
    ?? string(record(block.image_url).url)
  const parsed = url === undefined ? undefined : parseDataImageUrl(url)
  if (parsed !== undefined) return parsed

  const data = string(block.data)
  if (data === undefined || !isCanonicalBase64(data)) return undefined
  if (data.length > MAX_CODEX_IMAGE_BASE64) return undefined
  const mediaType = string(block.mediaType) ?? string(block.mimeType) ?? sniffImageMediaType(data)
  return mediaType !== undefined && CODEX_IMAGE_MEDIA_TYPES.has(mediaType)
    ? { mediaType, data, url: `data:${mediaType};base64,${data}` }
    : undefined
}

function parseDataImageUrl(value: string): { mediaType: string; data: string; url: string } | undefined {
  const match = DATA_IMAGE_URL.exec(value)
  if (match === null) return undefined
  const mediaType = match[1]!
  const data = match[2]!
  if (!CODEX_IMAGE_MEDIA_TYPES.has(mediaType) || !isCanonicalBase64(data)) return undefined
  return { mediaType, data, url: `data:${mediaType};base64,${data}` }
}

function collectImageBlocks(value: unknown, output: JsonRecord[] = []): JsonRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) collectImageBlocks(item, output)
    return output
  }
  if (!isRecord(value)) return output
  if (value.type === 'image') output.push(value)
  for (const [key, child] of Object.entries(value)) {
    if (key === 'attachment') continue
    if (key === 'content' || key === 'message' || key === 'inserted' || key === 'chunk' || key === 'block') {
      collectImageBlocks(child, output)
    }
  }
  return output
}

function base64ByteLength(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.max(1, Math.floor(value.length * 3 / 4) - padding)
}

function imageDimensions(mediaType: string, data: string): { width: number; height: number } {
  const bytes = base64PrefixBytes(data, 256 * 1024)
  const parsed = mediaType === 'image/png'
    ? pngDimensions(bytes)
    : mediaType === 'image/jpeg'
      ? jpegDimensions(bytes)
      : mediaType === 'image/gif'
        ? gifDimensions(bytes)
        : mediaType === 'image/webp'
          ? webpDimensions(bytes)
          : undefined
  return parsed ?? { width: 1, height: 1 }
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24
    || bytes[0] !== 0x89
    || bytes[1] !== 0x50
    || bytes[2] !== 0x4e
    || bytes[3] !== 0x47
    || bytes[4] !== 0x0d
    || bytes[5] !== 0x0a
    || bytes[6] !== 0x1a
    || bytes[7] !== 0x0a) return undefined
  return positiveDimensions(readUint32BE(bytes, 16), readUint32BE(bytes, 20))
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]!
    offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > bytes.length) return undefined
    const length = readUint16BE(bytes, offset)
    if (length < 2 || offset + length > bytes.length) return undefined
    if (isJpegSof(marker) && length >= 7) {
      return positiveDimensions(readUint16BE(bytes, offset + 5), readUint16BE(bytes, offset + 3))
    }
    offset += length
  }
  return undefined
}

function gifDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 10
    || bytes[0] !== 0x47
    || bytes[1] !== 0x49
    || bytes[2] !== 0x46
    || bytes[3] !== 0x38
    || (bytes[4] !== 0x37 && bytes[4] !== 0x39)
    || bytes[5] !== 0x61) return undefined
  return positiveDimensions(readUint16LE(bytes, 6), readUint16LE(bytes, 8))
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 30
    || stringFromBytes(bytes, 0, 4) !== 'RIFF'
    || stringFromBytes(bytes, 8, 12) !== 'WEBP') return undefined
  const chunk = stringFromBytes(bytes, 12, 16)
  if (chunk === 'VP8X') {
    return positiveDimensions(1 + readUint24LE(bytes, 24), 1 + readUint24LE(bytes, 27))
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const b0 = bytes[21]!
    const b1 = bytes[22]!
    const b2 = bytes[23]!
    const b3 = bytes[24]!
    const width = 1 + b0 + ((b1 & 0x3f) << 8)
    const height = 1 + ((b1 & 0xc0) >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10)
    return positiveDimensions(width, height)
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return positiveDimensions(readUint16LE(bytes, 26) & 0x3fff, readUint16LE(bytes, 28) & 0x3fff)
  }
  return undefined
}

function sniffImageMediaType(data: string): string | undefined {
  const bytes = base64PrefixBytes(data, 32)
  if (pngDimensions(bytes) !== undefined) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (gifDimensions(bytes) !== undefined) return 'image/gif'
  if (bytes.length >= 12 && stringFromBytes(bytes, 0, 4) === 'RIFF' && stringFromBytes(bytes, 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function base64PrefixBytes(value: string, maxBytes: number): Uint8Array {
  const chars = value.slice(0, Math.ceil(maxBytes / 3) * 4)
  let binary: string
  try {
    binary = atob(chars)
  } catch {
    return new Uint8Array()
  }
  const bytes = new Uint8Array(Math.min(binary.length, maxBytes))
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) + bytes[offset + 1]!
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + (bytes[offset + 1]! << 8)
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + (bytes[offset + 1]! << 8) + (bytes[offset + 2]! << 16)
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! * 0x1000000) + (bytes[offset + 1]! * 0x10000) + (bytes[offset + 2]! * 0x100) + bytes[offset + 3]!
}

function positiveDimensions(width: number, height: number): { width: number; height: number } | undefined {
  return width > 0 && height > 0 ? { width, height } : undefined
}

function isJpegSof(marker: number): boolean {
  return (marker >= 0xc0 && marker <= 0xc3)
    || (marker >= 0xc5 && marker <= 0xc7)
    || (marker >= 0xc9 && marker <= 0xcb)
    || (marker >= 0xcd && marker <= 0xcf)
}

function stringFromBytes(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.length < end) return ''
  let output = ''
  for (let index = start; index < end; index += 1) output += String.fromCharCode(bytes[index]!)
  return output
}

function toolResultEvent(
  item: JsonRecord,
  turn: number,
  step: number,
  id: string,
  resultText: string,
): ProjectedNativeEvent {
  const type = string(item.type) ?? 'unknown'
  return {
    type: 'tool/result',
    data: {
      turn,
      step,
      message: {
        id: `${id}:result`,
        role: 'user',
        content: [{
          type: 'tool-result',
          toolCallId: id,
          content: [{ type: 'text', text: resultText }],
          ...(item.status === 'failed' || item.success === false ? { isError: true } : {}),
        }],
        source: { kind: 'tool', callId: id },
      },
    },
    view: { for: 'result', view: toolResultView(item, type, resultText) },
  }
}

function toolResultContentReplacement(event: ProjectedNativeEvent): ProjectedNativeEvent {
  const data = record(event.data)
  const message = record(data.message)
  const content = array(message.content)
  const result = record(content[0])
  if (result.isError === undefined) return event
  const { isError: _isError, ...stableResult } = result
  return {
    ...event,
    data: {
      ...data,
      message: { ...message, content: [stableResult] },
    },
  }
}

function isToolItemType(type: string | undefined): boolean {
  return type === 'commandExecution'
    || type === 'mcpToolCall'
    || type === 'dynamicToolCall'
    || type === 'fileChange'
    || type === 'functionCallOutput'
    || type === 'hookPrompt'
    || type === 'collabAgentToolCall'
    || type === 'subAgentActivity'
    || type === 'webSearch'
    || type === 'imageView'
    || type === 'imageGeneration'
    || type === 'sleep'
    || type === 'enteredReviewMode'
    || type === 'exitedReviewMode'
    || type === 'contextCompaction'
}

function toolEventName(type: string): string {
  if (type === 'fileChange') return 'codex.fileChange'
  if (type === 'commandExecution') return 'codex.command'
  if (type === 'webSearch') return 'codex.webSearch'
  if (type === 'collabAgentToolCall' || type === 'subAgentActivity') return 'codex.subagent'
  if (type === 'imageView' || type === 'imageGeneration') return 'codex.image'
  if (type === 'enteredReviewMode' || type === 'exitedReviewMode') return 'codex.reviewMode'
  if (type === 'contextCompaction') return 'codex.compaction'
  return `codex.${type}`
}

function toolResultText(item: JsonRecord, type: string, text?: string): string {
  if (type === 'fileChange') return fileChangeSummary(item)
  if (type === 'webSearch') {
    const count = array(item.results).length
    return count === 0 ? 'Web search completed.' : `Web search returned ${count} result${count === 1 ? '' : 's'}.`
  }
  if (type === 'imageView') return `Viewed image: ${string(item.path) ?? 'image'}`
  if (type === 'imageGeneration') {
    const savedPath = string(item.savedPath)
    return savedPath === undefined ? `Image generation ${string(item.status) ?? 'completed'}.` : `Generated image: ${savedPath}`
  }
  if (type === 'contextCompaction') return 'CodeX compacted the conversation context.'
  if (type === 'enteredReviewMode') return `Entered review mode${string(item.review) ? `: ${string(item.review)}` : '.'}`
  if (type === 'exitedReviewMode') return `Exited review mode${string(item.review) ? `: ${string(item.review)}` : '.'}`
  if (type === 'sleep') return `Waited ${integer(item.durationMs) ?? 0} ms.`
  if (type === 'subAgentActivity') {
    return [string(record(item.kind).type) ?? string(item.kind) ?? 'Subagent activity', string(item.agentPath)]
      .filter((value): value is string => value !== undefined).join(': ')
  }
  return text ?? itemText(record(item.result)) ?? itemText(record(item.output)) ?? string(item.status) ?? type
}

function isSurfaceEvent(type: string): boolean {
  return type === 'user/message' || type === 'assistant/message' || type === 'tool/result'
}

function toolCallView(item: JsonRecord, type: string, args: JsonRecord): JsonRecord {
  if (type === 'commandExecution') {
    return {
      card: 'terminal',
      title: commandText(item.command) ?? 'CodeX command',
      ...(typeof item.cwd === 'string' ? { cwd: item.cwd } : {}),
    }
  }
  const locations = fileLocations(item)
  if (type === 'fileChange') {
    return {
      card: 'generic',
      title: locations.length === 0 ? 'CodeX file changes' : `Modify ${locations.length} file${locations.length === 1 ? '' : 's'}`,
      kind: 'edit',
      rawInput: args,
      ...(locations.length === 0 ? {} : { locations }),
    }
  }
  if (type === 'webSearch') {
    return {
      card: 'generic',
      title: string(item.query) ?? 'CodeX web search',
      kind: 'search',
      rawInput: args,
    }
  }
  if (type === 'imageView' || type === 'imageGeneration') {
    const path = string(item.path) ?? string(item.savedPath)
    return {
      card: 'generic',
      title: type === 'imageView' ? 'View image' : 'Generate image',
      kind: type === 'imageView' ? 'read' : 'other',
      ...(path === undefined ? {} : { locations: [{ path }] }),
    }
  }
  if (type === 'collabAgentToolCall' || type === 'subAgentActivity') {
    return {
      card: 'generic',
      title: type === 'collabAgentToolCall'
        ? `Subagent: ${string(item.tool) ?? 'collaboration'}`
        : `Subagent activity: ${string(item.agentPath) ?? string(item.agentThreadId) ?? 'agent'}`,
      kind: 'other',
      rawInput: args,
    }
  }
  if (type === 'contextCompaction') return { card: 'generic', title: 'Compact conversation context', kind: 'other' }
  if (type === 'enteredReviewMode') return { card: 'generic', title: 'Enter review mode', kind: 'other' }
  if (type === 'exitedReviewMode') return { card: 'generic', title: 'Exit review mode', kind: 'other' }
  return {
    card: 'generic',
    title: toolDisplayName(item, type),
    kind: 'other',
  }
}

function toolResultView(item: JsonRecord, type: string, resultText: string): JsonRecord {
  if (type === 'commandExecution') {
    return {
      card: 'terminal',
      output: resultText,
      ...(typeof item.exitCode === 'number' && Number.isSafeInteger(item.exitCode) ? { exitCode: item.exitCode } : {}),
    }
  }
  return {
    card: 'generic',
    ...(type === 'fileChange' ? { title: item.status === 'inProgress' ? 'CodeX file changes' : 'CodeX file changes completed' } : {}),
    ...(type === 'mcpToolCall' && item.status === 'inProgress'
      ? { title: 'CodeX MCP tool in progress', content: [{ type: 'text', text: resultText }] }
      : {}),
  }
}

function toolDisplayName(item: JsonRecord, type: string): string {
  return string(item.name)
    ?? string(item.tool)
    ?? string(record(item.tool).name)
    ?? (type === 'mcpToolCall' ? 'CodeX MCP tool' : humanizeItemType(type))
}

function fileLocations(item: JsonRecord): Array<{ path: string }> {
  return array(item.changes)
    .map(value => string(record(value).path))
    .filter((path): path is string => path !== undefined && path.length > 0)
    .map(path => ({ path }))
}

function nativeWorkspace(view: CodexVirtualWorkspaceView): Omit<CodexVirtualWorkspaceView, 'sessionCount'> {
  const { sessionCount: _sessionCount, ...workspace } = view
  return workspace
}

function nativeVisibleWorkspaces(catalog: CatalogState, selectedWorkspaceId?: string): CodexVirtualWorkspaceView[] {
  return catalog.workspaces.filter(workspace => workspace.sessionIds.length > 0 || workspace.workspaceId === selectedWorkspaceId)
}

function projectWorkspace(project: CodexProject): CodexVirtualWorkspaceView {
  const root = project.roots[0]!
  return {
    workspaceId: codexProjectWorkspaceId(project.id),
    path: root.path,
    title: project.name.trim() || basename(root.path),
    sessionIds: [],
    sessionCount: 0,
    createdAt: isoTime(project.createdAt),
    updatedAt: isoTime(project.updatedAt || project.createdAt),
  }
}

function projectCodexProject(value: unknown, fallbackPosition: number): CodexProject | undefined {
  const source = record(value)
  const id = string(source.id)
  if (id === undefined) return undefined
  const roots = array(source.roots)
    .map(root => string(record(root).path))
    .filter((path): path is string => path !== undefined && path.length > 0)
    .map(path => ({ path }))
  if (roots.length === 0) return undefined
  return {
    id,
    name: string(source.name) ?? basename(roots[0]!.path),
    roots,
    position: finiteNumber(source.position) ?? fallbackPosition,
    createdAt: normalizeTime(source.createdAt),
    updatedAt: normalizeTime(source.updatedAt),
  }
}

function findProjectWorkspace(
  thread: JsonRecord,
  session: DisplaySession,
  projects: CodexProject[],
  workspaceByProjectId: Map<string, CodexVirtualWorkspaceView>,
): CodexVirtualWorkspaceView | undefined {
  const explicitProjectId = string(thread.projectId)
  const explicitWorkspace = explicitProjectId === undefined ? undefined : workspaceByProjectId.get(explicitProjectId)
  if (explicitWorkspace !== undefined) return explicitWorkspace
  if (session.cwd === undefined) return undefined
  const match = projects
    .flatMap(project => project.roots.map(root => ({ project, root })))
    .filter(value => containsPath(value.root.path, session.cwd!))
    .sort((left, right) => {
      const length = right.root.path.length - left.root.path.length
      if (length !== 0) return length
      const position = left.project.position - right.project.position
      if (position !== 0) return position
      return left.project.id.localeCompare(right.project.id)
    })[0]
  return match === undefined ? undefined : workspaceByProjectId.get(match.project.id)
}

function addSessionToWorkspace(workspace: CodexVirtualWorkspaceView, session: DisplaySession): void {
  if (!workspace.sessionIds.includes(session.id)) {
    workspace.sessionIds.push(session.id)
    workspace.sessionCount = workspace.sessionIds.length
  }
  const createdAt = isoTime(session.createdAt)
  const updatedAt = isoTime(session.updatedAt || session.createdAt)
  if (createdAt < workspace.createdAt) workspace.createdAt = createdAt
  if (updatedAt > workspace.updatedAt) workspace.updatedAt = updatedAt
}

function containsPath(root: string, candidate: string): boolean {
  const normalizedRoot = normalizePathForCompare(root)
  const normalizedCandidate = normalizePathForCompare(candidate)
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}/`)
    || normalizedCandidate.startsWith(`${normalizedRoot}\\`)
}

function normalizePathForCompare(path: string): string {
  return path.replace(/[\\/]+$/u, '') || path
}

function modelSelection(): CodexModelSelection {
  return { provider: CODEX_PROVIDER, model: CODEX_MODEL }
}

function codexPromptInput(content: unknown[]): JsonRecord[] | undefined {
  if (content.length === 0 || content.length > MAX_CODEX_PROMPT_PARTS) return undefined
  const input: JsonRecord[] = []
  for (const value of content) {
    if (!isRecord(value)) return undefined
    if (value.type === 'text') {
      if (typeof value.text !== 'string' || value.text.length === 0 || value.text.length > MAX_CODEX_PROMPT_TEXT) return undefined
      input.push({ type: 'text', text: value.text })
      continue
    }
    if (value.type === 'image') {
      if (typeof value.mediaType !== 'string' || !CODEX_IMAGE_MEDIA_TYPES.has(value.mediaType)
        || typeof value.data !== 'string' || value.data.length > MAX_CODEX_IMAGE_BASE64
        || !isCanonicalBase64(value.data)) return undefined
      input.push({ type: 'image', mediaType: value.mediaType, data: value.data })
      continue
    }
    return undefined
  }
  return input
}

function isCanonicalBase64(value: string): boolean {
  return value.length >= 4 && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
}

function modelSelectionProjection(selection: CodexModelSelection): { lastUsed: CodexModelSelection; next: CodexModelSelection } {
  return { lastUsed: selection, next: selection }
}

function codexPermissionsProjection(preset: CodexPermissionPreset | undefined): unknown {
  return {
    options: [
      {
        value: 'workspace-write',
        name: 'workspace-write',
        description: 'Write inside the workspace; wider command and file access requires one-time approval.',
      },
      {
        value: 'danger-full-access',
        name: 'danger-full-access',
        description: 'Full Host file access without approval prompts for subsequent turns in this virtual Session.',
      },
    ],
    currentValue: preset ?? 'Host settings (not reported)',
  }
}

function codexImageLimitsProjection(): unknown {
  return {
    maxImageBytes: 20 * 1024 * 1024,
    maxImagesPerMessage: MAX_CODEX_PROMPT_PARTS,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    maxImageDimension: 8_192,
    mediaTypes: [...CODEX_IMAGE_MEDIA_TYPES],
  }
}

function isCodexPermissionPreset(value: string): value is CodexPermissionPreset {
  return value === 'workspace-write' || value === 'danger-full-access'
}

function modelCatalog(directory: CodexModelDirectory): unknown {
  return {
    default: directory.default,
    routableProviders: [CODEX_PROVIDER],
    groups: directory.groups,
    failures: [],
  }
}

function codexModelParams(selection: CodexModelSelection): { model: string; effort?: string } {
  return {
    model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { effort: selection.reasoningEffort }),
  }
}

function reasoningEffortName(effort: string): string {
  const names: Record<string, string> = {
    none: 'None',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra High',
    max: 'Max',
    ultra: 'Ultra',
  }
  return names[effort] ?? effort
}

function displayTitle(session: DisplaySession): string | null {
  const value = session.title ?? session.preview
  return value === undefined || value.trim() === '' ? null : value.slice(0, 256)
}

function itemText(value: JsonRecord): string | undefined {
  if (typeof value.text === 'string') return value.text
  if (typeof value.content === 'string') return value.content
  const content = Array.isArray(value.content)
    ? value.content
    : Array.isArray(value.input) ? value.input : undefined
  if (content !== undefined) {
    const text = content.map(part => {
      if (typeof part === 'string') return part
      const block = record(part)
      return string(block.text) ?? string(block.content) ?? ''
    }).filter(Boolean).join('\n')
    if (text !== '') return text
  }
  if (Array.isArray(value.summary)) return value.summary.filter(item => typeof item === 'string').join('\n')
  if (typeof value.output === 'string') return value.output
  if (typeof value.aggregatedOutput === 'string') return value.aggregatedOutput
  return undefined
}

function toolArguments(item: JsonRecord): JsonRecord {
  if (item.type === 'commandExecution') return { command: commandText(item.command) ?? item.command ?? '' }
  if (item.type === 'fileChange') return {
    changes: array(item.changes).map(value => {
      const change = record(value)
      const kind = typeof change.kind === 'string' ? change.kind : string(record(change.kind).type)
      return {
        ...(typeof change.path === 'string' ? { path: change.path } : {}),
        ...(kind === undefined ? {} : { kind }),
      }
    }),
  }
  if (item.type === 'webSearch') return { query: string(item.query) ?? '' }
  if (item.type === 'imageView') return { path: string(item.path) ?? '' }
  if (item.type === 'imageGeneration') return {
    ...(string(item.revisedPrompt) === undefined ? {} : { prompt: string(item.revisedPrompt) }),
    transparentBackground: item.transparentBackground === true,
  }
  if (item.type === 'collabAgentToolCall') return {
    tool: string(item.tool) ?? 'collaboration',
    receiverThreadIds: array(item.receiverThreadIds).filter(value => typeof value === 'string'),
    ...(string(item.model) === undefined ? {} : { model: string(item.model) }),
  }
  if (item.type === 'subAgentActivity') return {
    agentThreadId: string(item.agentThreadId) ?? '',
    agentPath: string(item.agentPath) ?? '',
    kind: string(record(item.kind).type) ?? string(item.kind) ?? 'activity',
  }
  if (item.type === 'sleep') return { durationMs: integer(item.durationMs) ?? 0 }
  if (item.type === 'enteredReviewMode' || item.type === 'exitedReviewMode') return {
    review: string(item.review) ?? '',
  }
  if (item.type === 'contextCompaction') return {}
  return { name: item.name ?? item.tool ?? item.type ?? 'tool', arguments: item.arguments ?? item.input ?? {} }
}

function fileChangeSummary(item: JsonRecord): string {
  const changes = array(item.changes).map(value => {
    const change = record(value)
    const path = string(change.path)
    const kind = typeof change.kind === 'string' ? change.kind : string(record(change.kind).type)
    return [kind, path].filter((part): part is string => part !== undefined && part.length > 0).join(' ')
  }).filter(Boolean)
  return changes.length === 0 ? 'File changes completed.' : changes.join('\n')
}

function sanitizedFileChanges(value: unknown): JsonRecord[] {
  return array(value).flatMap(raw => {
    const change = record(raw)
    const path = string(change.path)
    if (path === undefined) return []
    const kind = typeof change.kind === 'string' ? change.kind : string(record(change.kind).type)
    return [{ path, ...(kind === undefined ? {} : { kind }) }]
  })
}

function appendBoundedText(current: string, delta: string): string {
  const value = `${current}${delta}`
  if (value.length <= MAX_LIVE_TOOL_OUTPUT) return value
  return `… earlier output omitted …\n${value.slice(value.length - MAX_LIVE_TOOL_OUTPUT)}`
}

function humanizeItemType(type: string): string {
  const names: Record<string, string> = {
    functionCallOutput: 'CodeX function output',
    hookPrompt: 'CodeX hook prompt',
    dynamicToolCall: 'CodeX tool',
    collabAgentToolCall: 'CodeX subagent',
    subAgentActivity: 'CodeX subagent activity',
    webSearch: 'CodeX web search',
    imageView: 'CodeX image view',
    imageGeneration: 'CodeX image generation',
    sleep: 'CodeX wait',
    enteredReviewMode: 'CodeX review mode',
    exitedReviewMode: 'CodeX review mode',
    contextCompaction: 'CodeX context compaction',
  }
  return names[type] ?? 'CodeX tool'
}

function commandText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string').join(' ')
  const source = record(value)
  return string(source.command) ?? string(source.text)
}

function sessionIdFromAddress(address: JsonRecord): string {
  if (address.kind === 'session') return requiredString(address.sessionId, 'sessionId')
  return requiredString(address.childSessionId, 'childSessionId')
}

function nativeThreadId(sessionId: string): string {
  if (!sessionId.startsWith(CODEX_SESSION_PREFIX) || sessionId.length === CODEX_SESSION_PREFIX.length) {
    throw new Error('The selected Session does not belong to CodeX.')
  }
  return sessionId.slice(CODEX_SESSION_PREFIX.length)
}

function activeTurnId(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const turn = record(value[index])
    if (isActiveCodexTurn(turn) && typeof turn.id === 'string' && turn.id.length > 0) return turn.id
  }
  return undefined
}

function isActiveCodexTurn(turn: JsonRecord): boolean {
  return turn.status === 'inProgress' || turn.status === 'running'
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

function success<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

function failure(code: string, message: string, details: JsonRecord = {}): { ok: false; error: { code: string; message: string; details: JsonRecord } } {
  return { ok: false, error: { code, message, details } }
}

function ok(value?: unknown): TypertRpcResult {
  return value === undefined ? { ok: true } : { ok: true, value }
}

function business(value: unknown): TypertRpcResult {
  const result = record(value)
  if (result.ok === true) return ok(result.value)
  if (result.ok === false) {
    const error = record(result.error)
    return fail(string(error.code) ?? 'internal', string(error.message) ?? 'CodeX virtual Harness rejected the request.', record(error.details))
  }
  return ok(value)
}

function isCodexDirectoryListing(value: unknown): value is CodexDirectoryListing {
  const listing = record(value)
  return typeof listing.path === 'string'
    && typeof listing.home === 'string'
    && Array.isArray(listing.crumbs)
    && listing.crumbs.every(isCodexDirectoryEntry)
    && Array.isArray(listing.entries)
    && listing.entries.every(isCodexDirectoryEntry)
    && typeof listing.truncated === 'boolean'
}

function isCodexDirectoryEntry(value: unknown): value is CodexDirectoryEntry {
  const entry = record(value)
  return typeof entry.name === 'string'
    && typeof entry.path === 'string'
    && typeof entry.hidden === 'boolean'
}

function fail(code: string, message: string, details: JsonRecord = {}): TypertRpcResult {
  return { ok: false, error: { code, message, details } }
}

function failFrom(error: unknown): TypertRpcResult {
  const source = error instanceof Error ? error : new Error(String(error))
  return fail(errorCode(source) ?? 'internal', source.message, errorDetails(source))
}

function isLegacySessionHistoryUnsupported(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return errorCode(error) === 'METHOD_NOT_ALLOWED'
    || errorCode(error) === 'METHOD_NOT_FOUND'
    || error.message.includes('The requested Codex method is not available over Remote.')
}

function errorCode(error: Error): string | undefined {
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function errorDetails(error: Error): JsonRecord {
  return 'details' in error && isRecord(error.details) ? error.details : {}
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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const parsed = integer(value)
  if (parsed === undefined) throw new Error('The CodeX History cursor is invalid.')
  return parsed
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  const parsed = optionalInteger(value)
  if (parsed !== undefined && parsed < 0) throw new Error('The CodeX History cursor is invalid.')
  return parsed
}

function optionalPositiveInteger(value: unknown): number | undefined {
  const parsed = optionalInteger(value)
  if (parsed !== undefined && parsed <= 0) throw new Error('The CodeX History page size is invalid.')
  return parsed
}

function isCodexNativeHistoryPage(value: unknown, sessionId: string): value is CodexNativeHistoryPage {
  const page = record(value)
  const header = record(page.header)
  return header.id === sessionId
    && integer(page.cursor) !== undefined
    && integer(page.nextTurn) !== undefined
    && Array.isArray(page.records)
    && typeof page.hasMore === 'boolean'
    && (page.activeTurnId === undefined || typeof page.activeTurnId === 'string')
}

function truncateCodePoints(value: string, maximum: number): string {
  return [...value].slice(0, maximum).join('')
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`The CodeX ${field} is required.`)
  return value
}

function normalizeTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return value < 10_000_000_000 ? Math.floor(value * 1000) : Math.floor(value)
}

function isoTime(value: unknown): string {
  return new Date(normalizeTime(value) || Date.now()).toISOString()
}

function isProjectListUnsupported(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = errorCode(error)
  return code === 'METHOD_NOT_ALLOWED'
    || code === 'METHOD_NOT_FOUND'
    || code === 'CODEX_UPSTREAM_ERROR'
    || error.message.includes('The requested Codex method is not available over Remote.')
}

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/u, '')
  const parts = normalized.split(/[\\/]/u)
  return parts.at(-1) || path
}

function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
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
