import {
  deriveCodexCwdWorkspaces,
  projectCodexThread,
  type CodexRemoteClient,
  type DisplayHistoryItem,
  type DisplaySession,
} from '@dsh-remote/client-core'
import { strings } from '../locales/i18n'
import type {
  ChatItem,
  CodexPermissionPreset,
  HistoryEntry,
  ModelCatalogModel,
  ModelReasoningEffort,
  NativeSessionEvent,
  RemoteSession,
  SessionHistoryPage,
  SessionModels,
  WorkspaceView,
} from '../types'

const PAGE_LIMIT = 100
const MAX_PAGES = 32
const CODEX_PROVIDER = 'codex'
const CODEX_PERMISSION_DEFAULT: CodexPermissionPreset = 'workspace-write'
const CODEX_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

interface CodexProject {
  id: string
  name: string
  roots: string[]
  position: number
  createdAt: number
  updatedAt: number
}

export interface CodexCatalog {
  workspaces: WorkspaceView[]
  sessions: RemoteSession[]
}

export interface CodexSessionRead {
  thread: Record<string, unknown>
  session: RemoteSession
}

export async function createCodexWorkspace(
  client: CodexRemoteClient,
  path: string,
  idempotencyKey: string,
): Promise<WorkspaceView> {
  const result = record(await client.request('project/create', {
    name: basename(path),
    roots: [{ path }],
    idempotencyKey,
  }))
  const project = parseCodexProject(result.project, 0)
  if (project === undefined) throw new Error(strings.runtime.codexInvalidResponse)
  return projectWorkspace(project)
}

export async function loadCodexCatalog(client: CodexRemoteClient): Promise<CodexCatalog> {
  const [listedProjects, threads] = await Promise.all([
    loadProjects(client),
    loadThreads(client),
  ])
  const projects = listedProjects.length > 0
    ? listedProjects
    : deriveCodexCwdWorkspaces(threads).map(workspace => ({
        id: workspace.id,
        name: workspace.name,
        roots: [workspace.path],
        position: workspace.position,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      }))
  const workspaces = projects.map(projectWorkspace)
  const workspaceByProjectId = new Map(projects.map((project, index) => [project.id, workspaces[index]!]))
  const sessions: RemoteSession[] = []

  for (const thread of threads) {
    const display = projectCodexThread(thread)
    if (display === undefined || display.archived === true) continue
    const workspace = findThreadWorkspace(thread, display, projects, workspaceByProjectId)
    if (workspace === undefined) continue
    const session = codexSession(display)
    workspace.sessionIds.push(session.sessionId)
    sessions.push(session)
    const updatedAt = new Date(session.updatedAt || Date.now()).toISOString()
    if (updatedAt > workspace.updatedAt) workspace.updatedAt = updatedAt
  }

  sessions.sort((left, right) => right.updatedAt - left.updatedAt || left.sessionId.localeCompare(right.sessionId))
  return { workspaces, sessions }
}

export async function readCodexSession(
  client: CodexRemoteClient,
  threadId: string,
  permissionPreset = CODEX_PERMISSION_DEFAULT,
): Promise<CodexSessionRead> {
  const result = record(await client.request('thread/read', { threadId, includeTurns: false }))
  const thread = record(result.thread)
  const display = projectCodexThread(thread)
  if (display === undefined || display.nativeId !== threadId) throw new Error(strings.runtime.codexInvalidResponse)
  return { thread, session: codexSession(display, permissionPreset) }
}

export async function readCodexHistoryPage(
  client: CodexRemoteClient,
  threadId: string,
  beforeSeq?: number,
  maxMessages = 60,
): Promise<SessionHistoryPage> {
  const page = record(await client.request('dsh/sessionHistory', {
    threadId,
    ...(beforeSeq === undefined ? {} : { beforeSeq }),
    maxMessages,
  }))
  const header = record(page.header)
  if (header.id !== `codex:${threadId}` || !Array.isArray(page.records) || typeof page.hasMore !== 'boolean') {
    throw new Error(strings.runtime.codexInvalidResponse)
  }
  const events = page.records.flatMap(value => {
    const entry = record(value)
    const event = record(entry.event)
    if (entry.type !== 'event'
      || typeof event.type !== 'string'
      || !Number.isSafeInteger(event.seq)
      || !Number.isFinite(event.time)
      || !isRecord(event.data)) return []
    return [{
      event: event as unknown as NativeSessionEvent,
      ...(isRecord(entry.view) ? { view: entry.view as HistoryEntry['view'] } : {}),
    } satisfies HistoryEntry]
  })
  const activeTurnId = string(page.activeTurnId)
  return {
    events,
    hasMore: page.hasMore,
    ...(activeTurnId === undefined ? {} : { activeTurnId }),
  }
}

export async function loadCodexModels(client: CodexRemoteClient): Promise<SessionModels> {
  const models: ModelCatalogModel[] = []
  let defaultModel: string | undefined
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = record(await client.request('model/list', {
      limit: PAGE_LIMIT,
      includeHidden: false,
      ...(cursor === undefined ? {} : { cursor }),
    }))
    if (!Array.isArray(result.data)) throw new Error(strings.runtime.codexInvalidResponse)
    for (const value of result.data) {
      const source = record(value)
      if (source.hidden === true) continue
      const id = string(source.model) ?? string(source.id)
      if (id === undefined || models.some(model => model.id === id)) continue
      const efforts = Array.isArray(source.supportedReasoningEfforts)
        ? source.supportedReasoningEfforts.flatMap(value => {
            const effort = record(value)
            const effortId = string(effort.reasoningEffort)
            if (effortId === undefined || !CODEX_EFFORTS.has(effortId)) return []
            return [{
              id: effortId,
              name: reasoningEffortName(effortId),
              ...(string(effort.description) === undefined ? {} : { description: string(effort.description)! }),
            } satisfies ModelReasoningEffort]
          })
        : []
      const defaultEffort = string(source.defaultReasoningEffort)
      models.push({
        id,
        name: string(source.displayName) ?? id,
        ...(string(source.description) === undefined ? {} : { description: string(source.description)! }),
        ...(efforts.length === 0 ? {} : {
          reasoning: {
            efforts,
            ...(defaultEffort === undefined || !efforts.some(effort => effort.id === defaultEffort)
              ? {}
              : { defaultEffort }),
          },
        }),
      })
      if (source.isDefault === true) defaultModel = id
    }
    cursor = string(result.nextCursor)
    if (cursor === undefined) break
  }
  const selected = models.find(model => model.id === defaultModel) ?? models[0]
  if (selected === undefined) throw new Error(strings.runtime.codexInvalidResponse)
  return {
    current: {
      provider: CODEX_PROVIDER,
      model: selected.id,
      ...(selected.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: selected.reasoning.defaultEffort }),
    },
    routable: true,
    groups: [{ id: CODEX_PROVIDER, name: 'CodeX', models }],
    failures: [],
  }
}

export function codexSession(
  display: DisplaySession,
  permissionPreset = CODEX_PERMISSION_DEFAULT,
): RemoteSession {
  return {
    sessionId: display.id,
    backend: 'codex',
    nativeId: display.nativeId,
    updatedAt: display.updatedAt || display.createdAt || Date.now(),
    running: display.status === 'running' || display.status === 'waiting',
    blank: display.title === undefined && display.preview === undefined,
    ...(display.title === undefined ? {} : { title: display.title }),
    ...(display.cwd === undefined ? {} : { cwd: display.cwd }),
    projections: {
      values: {
        ...(display.preview === undefined ? {} : { summary: display.preview }),
        backend: 'codex',
        codexStatus: display.status,
        permissions: codexPermissions(permissionPreset),
        imageLimits: codexImageLimits(),
      },
    },
  }
}

export function updateCodexSession(
  current: RemoteSession,
  display: DisplaySession,
): RemoteSession {
  const permission = codexPermissionPreset(current)
  const next = codexSession(display, permission)
  return {
    ...current,
    ...next,
    projections: {
      values: {
        ...current.projections?.values,
        ...next.projections?.values,
      },
    },
  }
}

export function withCodexPermission(session: RemoteSession, preset: string): RemoteSession {
  if (session.backend !== 'codex' || !isCodexPermissionPreset(preset)) return session
  return {
    ...session,
    projections: {
      values: {
        ...session.projections?.values,
        permissions: codexPermissions(preset),
      },
    },
  }
}

export function codexPermissionPreset(session: RemoteSession): CodexPermissionPreset {
  const permissions = record(session.projections?.values?.permissions)
  return permissions.currentValue === 'danger-full-access' ? 'danger-full-access' : 'workspace-write'
}

export function codexPermissionPresetFromResponse(value: unknown): CodexPermissionPreset | undefined {
  const root = record(value)
  return codexPermissionPresetFromPolicyRecord(root)
    ?? codexPermissionPresetFromPolicyRecord(record(root.threadSettings))
}

function codexPermissionPresetFromPolicyRecord(value: Record<string, unknown>): CodexPermissionPreset | undefined {
  const sandbox = value.sandbox ?? value.sandboxPolicy
  if (value.approvalPolicy === 'never' && isDangerFullAccessSandbox(sandbox)) return 'danger-full-access'
  if (value.approvalPolicy === 'on-request' && isWorkspaceWriteSandbox(sandbox)) return 'workspace-write'
  return undefined
}

export function codexThreadId(session: RemoteSession): string {
  if (session.backend !== 'codex' || typeof session.nativeId !== 'string' || session.nativeId.length === 0) {
    throw new Error(strings.runtime.codexInvalidResponse)
  }
  return session.nativeId
}

export function codexItemsToChat(items: DisplayHistoryItem[]): ChatItem[] {
  const output: ChatItem[] = []
  items.forEach((item, index) => {
    const createdAt = item.createdAt ?? index
    if (item.kind === 'message' && item.role !== undefined) {
      output.push({
        kind: 'message',
        id: item.id,
        sessionId: item.sessionId,
        role: item.role,
        text: item.text ?? '',
        ...(item.nativeRef.turnId === undefined ? {} : { replyGroup: item.nativeRef.turnId }),
        ...(item.nativeRef.turnId === undefined ? {} : { turn: item.nativeRef.turnId }),
        ...(item.images === undefined || item.images.length === 0 ? {} : { images: item.images }),
        ...(item.role === 'assistant' && item.status === 'running' ? { streaming: true as const } : {}),
        createdAt,
      })
      return
    }
    if (item.kind === 'status' && item.details?.type === 'reasoning') {
      output.push({
        kind: 'message', id: item.id, sessionId: item.sessionId, role: 'assistant', text: '',
        ...(item.nativeRef.turnId === undefined ? {} : { replyGroup: item.nativeRef.turnId }),
        ...(item.nativeRef.turnId === undefined ? {} : { turn: item.nativeRef.turnId }),
        reasoning: item.text ?? '',
        ...(item.status === 'running' ? { streaming: true as const, streamingPhase: 'reasoning' as const } : {}),
        createdAt,
      })
      return
    }
    if (item.kind === 'error') {
      output.push({
        kind: 'message', id: item.id, sessionId: item.sessionId, role: 'assistant',
        text: item.text ?? strings.chat.codexError, createdAt,
      })
      return
    }
    if (item.kind === 'approval' && item.nativeRef.requestHandle !== undefined) {
      output.push({
        kind: 'approval',
        id: item.id,
        sessionId: item.sessionId,
        approvalId: item.nativeRef.requestHandle,
        toolName: item.text ?? strings.chat.codexOperation,
        ...(item.nativeRef.turnId === undefined ? {} : { turn: item.nativeRef.turnId }),
        ...(typeof item.details?.reason === 'string' ? { reason: item.details.reason } : {}),
        ...(item.status === 'running' ? {} : { outcome: 'unavailable' as const }),
        createdAt,
      })
      return
    }
    const text = item.text ?? item.details?.type?.toString() ?? strings.chat.codexOperation
    output.push({
      kind: 'tool',
      id: item.id,
      sessionId: item.sessionId,
      toolName: codexToolName(item),
      ...(item.nativeRef.turnId === undefined ? {} : { turn: item.nativeRef.turnId }),
      summary: text.split('\n', 1)[0],
      ...(item.images === undefined || item.images.length === 0 ? {} : { images: item.images }),
      ...(text.length === 0 ? {} : {
        [item.status === 'running' ? 'callDetail' : 'resultDetail']: {
          text,
          format: item.kind === 'file-change' ? 'code' : 'markdown',
        },
      }),
      state: item.status === 'failed' || item.status === 'declined'
        ? 'failed'
        : item.status === 'running' ? 'running' : 'finished',
      createdAt,
    })
  })
  return output
}

export function mergeCodexLive(current: ChatItem[], live: ChatItem[]): ChatItem[] {
  if (live.length === 0) return current
  let next = [...current]
  for (const rawItem of live) {
    let item = rawItem
    if (item.kind === 'message' && item.role === 'user') {
      const messageText = item.text
      const optimistic = next.findIndex(value => value.kind === 'message'
        && value.role === 'user'
        && value.id.startsWith('local:')
        && value.text === messageText)
      if (optimistic >= 0) {
        const local = next[optimistic]
        if (local?.kind === 'message' && local.images !== undefined) item = { ...item, images: local.images }
        next.splice(optimistic, 1)
      }
    }
    const index = next.findIndex(value => value.id === item.id)
    if (index < 0) next.push(item)
    else next[index] = preserveLocalOutcome(next[index]!, item)
  }
  return next
}

function preserveLocalOutcome(current: ChatItem, incoming: ChatItem): ChatItem {
  if (current.kind === 'approval' && incoming.kind === 'approval' && current.outcome !== undefined) {
    return { ...incoming, outcome: current.outcome }
  }
  return incoming
}

async function loadProjects(client: CodexRemoteClient): Promise<CodexProject[]> {
  const projects: CodexProject[] = []
  let cursor: string | undefined
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = record(await client.request('project/list', {
        limit: PAGE_LIMIT,
        ...(cursor === undefined ? {} : { cursor }),
      }))
      if (!Array.isArray(result.data)) throw new Error(strings.runtime.codexInvalidResponse)
      for (const value of result.data) {
        const project = parseCodexProject(value, projects.length)
        if (project !== undefined && !projects.some(existing => existing.id === project.id)) projects.push(project)
      }
      cursor = string(result.nextCursor)
      if (cursor === undefined) break
    }
  } catch (error) {
    if (!isProjectListUnavailable(error)) throw error
  }
  return projects.sort((left, right) => left.position - right.position || left.name.localeCompare(right.name))
}

function parseCodexProject(value: unknown, fallbackPosition: number): CodexProject | undefined {
  const source = record(value)
  const id = string(source.id)
  const name = string(source.name)
  const roots = Array.isArray(source.roots)
    ? source.roots.flatMap(root => string(record(root).path) ?? [])
    : []
  if (id === undefined || name === undefined || roots.length === 0) return undefined
  return {
    id,
    name,
    roots,
    position: finiteNumber(source.position) ?? fallbackPosition,
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
  }
}

async function loadThreads(client: CodexRemoteClient): Promise<Record<string, unknown>[]> {
  const threads: Record<string, unknown>[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = record(await client.request('thread/list', {
      limit: PAGE_LIMIT,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      archived: false,
      ...(cursor === undefined ? {} : { cursor }),
    }))
    if (!Array.isArray(result.data)) throw new Error(strings.runtime.codexInvalidResponse)
    for (const value of result.data) {
      const thread = record(value)
      if (string(thread.id) !== undefined) threads.push(thread)
    }
    cursor = string(result.nextCursor)
    if (cursor === undefined) break
  }
  return threads
}

function projectWorkspace(project: CodexProject): WorkspaceView {
  const path = project.roots[0]!
  return {
    workspaceId: `codex:project:${project.id}`,
    backend: 'codex',
    nativeId: project.id,
    path,
    title: project.name.trim() || basename(path),
    sessionIds: [],
    createdAt: new Date(project.createdAt || Date.now()).toISOString(),
    updatedAt: new Date(project.updatedAt || project.createdAt || Date.now()).toISOString(),
  }
}

function findThreadWorkspace(
  thread: Record<string, unknown>,
  display: DisplaySession,
  projects: CodexProject[],
  byProjectId: Map<string, WorkspaceView>,
): WorkspaceView | undefined {
  const explicit = string(thread.projectId)
  if (explicit !== undefined && byProjectId.has(explicit)) return byProjectId.get(explicit)
  if (display.cwd === undefined) return undefined
  const match = projects
    .flatMap(project => project.roots.map(root => ({ project, root })))
    .filter(value => containsPath(value.root, display.cwd!))
    .sort((left, right) => right.root.length - left.root.length || left.project.position - right.project.position)[0]
  return match === undefined ? undefined : byProjectId.get(match.project.id)
}

function codexPermissions(currentValue: string) {
  return {
    currentValue,
    options: [
      { value: 'workspace-write', name: strings.chat.codexWorkspaceWrite, description: strings.chat.codexWorkspaceWriteDescription },
      { value: 'danger-full-access', name: strings.chat.codexFullAccess, description: strings.chat.codexFullAccessDescription },
    ],
  }
}

function codexImageLimits() {
  return {
    maxImageBytes: 20 * 1024 * 1024,
    maxImagesPerMessage: 16,
    maxMessageImageBytes: 100 * 1024 * 1024,
    maxImagePixels: 40_000_000,
    maxImageDimension: 8_192,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  }
}

function codexToolName(item: DisplayHistoryItem): string {
  const type = typeof item.details?.type === 'string' ? item.details.type : undefined
  if (item.kind === 'file-change') return strings.chat.codexFileChange
  if (type === 'commandExecution') return strings.chat.codexCommand
  if (type === 'webSearch') return strings.chat.codexWebSearch
  if (type === 'collabAgentToolCall' || type === 'subAgentActivity') return strings.chat.codexSubagent
  if (type === 'plan') return strings.chat.codexPlan
  return strings.chat.codexOperation
}

function reasoningEffortName(effort: string): string {
  const names: Record<string, string> = {
    none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High',
    xhigh: 'Extra High', max: 'Max', ultra: 'Ultra',
  }
  return names[effort] ?? effort
}

export function isCodexPermissionPreset(value: string): value is CodexPermissionPreset {
  return value === 'workspace-write' || value === 'danger-full-access'
}

function isDangerFullAccessSandbox(value: unknown): boolean {
  return value === 'danger-full-access' || record(value).type === 'dangerFullAccess'
}

function isWorkspaceWriteSandbox(value: unknown): boolean {
  return value === 'workspace-write' || record(value).type === 'workspaceWrite'
}

function isProjectListUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  return code === 'METHOD_NOT_ALLOWED'
    || code === 'METHOD_NOT_FOUND'
    || code === 'CODEX_UPSTREAM_ERROR'
    || error.message.includes('The requested Codex method is not available over Remote.')
}

function containsPath(root: string, candidate: string): boolean {
  const normalizedRoot = root.replace(/[\\/]+$/u, '') || root
  const normalizedCandidate = candidate.replace(/[\\/]+$/u, '') || candidate
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}/`)
    || normalizedCandidate.startsWith(`${normalizedRoot}\\`)
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/u, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? path
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return value < 10_000_000_000 ? Math.floor(value * 1_000) : Math.floor(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
