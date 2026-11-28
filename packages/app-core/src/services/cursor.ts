import type { AgentAcpClient } from '@dsh-remote/client-core'
import type { AgentAcpFrameData } from '@dsh-remote/protocol'
import { loadAcpDirectoryCatalog, mergeAcpDirectoryCatalog, type AcpCatalogFilterOptions, type AcpManagedBackend } from '../lib/workspace-key'
import type {
  AgentBackend,
  ApprovalActivity,
  AskUserQuestionItem,
  ChatImage,
  ChatItem,
  ChatMessage,
  HistoryEntry,
  NativeSessionEvent,
  QuestionActivity,
  RemoteSession,
  ToolActivity,
  WorkspaceView,
} from '../types'
import { foldHistory } from '../state/event-reducer'
import { insertTerminalLocalMessages, isTerminalLocalMessage } from '../state/message-helpers'

export function acpWorkspaceId(backend: AcpManagedBackend, path: string): string {
  return `${backend}:cwd:${encodeURIComponent(path)}`
}

export function acpWorkspacePath(backend: AcpManagedBackend, workspaceId: string): string | undefined {
  const prefix = `${backend}:cwd:`
  if (!workspaceId.startsWith(prefix)) return undefined
  try {
    return decodeURIComponent(workspaceId.slice(prefix.length))
  } catch {
    return undefined
  }
}

export function createAcpWorkspace(backend: AcpManagedBackend, path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: acpWorkspaceId(backend, path),
    backend,
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function acpPermissionsValue(currentValue = 'workspace-write') {
  return {
    options: [
      { value: 'workspace-write', name: 'workspace-write', description: 'Interactive one-time approval for tool executions and commands.' },
      { value: 'danger-full-access', name: 'danger-full-access', description: 'Auto-approve tool requests for subsequent turns in this session.' },
    ],
    currentValue,
  }
}

export function createAcpSession(input: {
  backend: AcpManagedBackend
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  const supportsImages = input.backend === 'antigravity' || input.backend === 'hermes' || input.backend === 'kimi'
  return {
    sessionId: `${input.backend}:${input.acpSessionId}`,
    backend: input.backend,
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: {
        backend: input.backend,
        permissions: acpPermissionsValue(),
        ...(supportsImages ? {
          imageLimits: {
            maxImageBytes: 8 * 1024 * 1024,
            maxImagesPerMessage: 4,
            maxMessageImageBytes: 32 * 1024 * 1024,
            maxImagePixels: 40_000_000,
            maxImageDimension: 8192,
            mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
          },
        } : {}),
      },
    },
  }
}

export async function loadCursorCatalog(
  client: AgentAcpClient,
  remembered: WorkspaceView[] = [],
  warmPath?: string,
  options?: AcpCatalogFilterOptions,
): Promise<{ workspaces: WorkspaceView[]; sessions: RemoteSession[]; pinnedSessionIds?: string[] }> {
  return loadAcpDirectoryCatalog({
    backend: 'cursor',
    label: 'Cursor',
    client,
    remembered,
    warmPath,
    options,
    createWorkspace: createCursorWorkspace,
    createSession: createCursorSession,
  })
}

export function mergeCursorCatalog(
  catalog: { workspaces: WorkspaceView[]; sessions: RemoteSession[]; pinnedSessionIds?: string[] },
  workspaces: WorkspaceView[],
  sessions: RemoteSession[],
  options?: AcpCatalogFilterOptions,
): { workspaces: WorkspaceView[]; sessions: RemoteSession[]; pinnedSessionIds?: string[] } {
  return mergeAcpDirectoryCatalog({
    backend: 'cursor',
    catalog,
    workspaces,
    sessions,
    options,
  })
}

export async function loadCustomAcpCatalog(
  backend: AcpManagedBackend,
  client: AgentAcpClient,
  remembered: WorkspaceView[] = [],
  warmPath?: string,
  options?: AcpCatalogFilterOptions,
): Promise<{ workspaces: WorkspaceView[]; sessions: RemoteSession[]; pinnedSessionIds?: string[] }> {
  return loadAcpDirectoryCatalog({
    backend,
    label: backend,
    client,
    remembered,
    warmPath,
    options,
    createWorkspace: (path, title) => createAcpWorkspace(backend, path, title),
    createSession: input => createAcpSession({ backend, ...input }),
  })
}

export function mergeCustomAcpCatalog(
  backend: AcpManagedBackend,
  catalog: { workspaces: WorkspaceView[]; sessions: RemoteSession[]; pinnedSessionIds?: string[] },
  workspaces: WorkspaceView[],
  sessions: RemoteSession[],
  options?: AcpCatalogFilterOptions,
): { workspaces: WorkspaceView[]; sessions: RemoteSession[]; pinnedSessionIds?: string[] } {
  return mergeAcpDirectoryCatalog({
    backend,
    catalog,
    workspaces,
    sessions,
    options,
  })
}

export async function readAcpHistory(
  client: AgentAcpClient,
  sessionId: string,
  backend: AgentBackend,
  signal?: AbortSignal,
): Promise<{
  events: unknown[]
  modes?: { currentModeId?: string; availableModes?: Array<{ id: string; name?: string; description?: string }> }
  availableCommands?: Array<{ name: string; description?: string; input?: { hint?: string } }>
  permissionPreset?: string
  running?: boolean
}> {
  if (typeof client.loadSessionDetails === 'function') {
    const details = await client.loadSessionDetails(sessionId, backend, signal)
    return {
      events: details.events,
      ...(details.modes !== undefined ? { modes: details.modes } : {}),
      ...(details.commands !== undefined ? { availableCommands: details.commands } : {}),
      ...(details.permissionPreset !== undefined ? { permissionPreset: details.permissionPreset } : {}),
      ...(details.running !== undefined ? { running: details.running } : {}),
    }
  }
  const events = await client.loadSessionHistory(sessionId, backend, signal)
  return { events }
}

export function cursorWorkspaceId(path: string): string {
  return `cursor:cwd:${encodeURIComponent(path)}`
}

export function cursorWorkspacePath(workspaceId: string): string | undefined {
  if (!workspaceId.startsWith('cursor:cwd:')) return undefined
  try {
    return decodeURIComponent(workspaceId.slice('cursor:cwd:'.length))
  } catch {
    return undefined
  }
}

export function antigravityWorkspaceId(path: string): string {
  return `antigravity:cwd:${encodeURIComponent(path)}`
}

export function antigravityWorkspacePath(workspaceId: string): string | undefined {
  if (!workspaceId.startsWith('antigravity:cwd:')) return undefined
  try {
    return decodeURIComponent(workspaceId.slice('antigravity:cwd:'.length))
  } catch {
    return undefined
  }
}

export function piWorkspaceId(path: string): string {
  return `pi:cwd:${encodeURIComponent(path)}`
}

export function piWorkspacePath(workspaceId: string): string | undefined {
  if (!workspaceId.startsWith('pi:cwd:')) return undefined
  try {
    return decodeURIComponent(workspaceId.slice('pi:cwd:'.length))
  } catch {
    return undefined
  }
}

export function opencodeWorkspaceId(path: string): string {
  return `opencode:cwd:${encodeURIComponent(path)}`
}

export function claudeWorkspaceId(path: string): string {
  return `claude:cwd:${encodeURIComponent(path)}`
}

export function hermesWorkspaceId(path: string): string {
  return `hermes:cwd:${encodeURIComponent(path)}`
}

export function kimiWorkspaceId(path: string): string {
  return `kimi:cwd:${encodeURIComponent(path)}`
}

export function opencodeWorkspacePath(workspaceId: string): string | undefined {
  if (!workspaceId.startsWith('opencode:cwd:')) return undefined
  try {
    return decodeURIComponent(workspaceId.slice('opencode:cwd:'.length))
  } catch {
    return undefined
  }
}

export function createCursorWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: cursorWorkspaceId(path),
    backend: 'cursor',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createPiWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: piWorkspaceId(path),
    backend: 'pi',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createAntigravityWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: antigravityWorkspaceId(path),
    backend: 'antigravity',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createOpencodeWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: opencodeWorkspaceId(path),
    backend: 'opencode',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createClaudeWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: claudeWorkspaceId(path),
    backend: 'claude',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function cursorNativeId(session: RemoteSession): string {
  if (session.nativeId !== undefined && session.nativeId.length > 0) return session.nativeId
  if (session.backend && session.backend !== 'harness' && session.sessionId.startsWith(`${session.backend}:`)) {
    return session.sessionId.slice(session.backend.length + 1)
  }
  if (session.sessionId.startsWith('cursor:')) return session.sessionId.slice('cursor:'.length)
  if (session.sessionId.startsWith('pi:')) return session.sessionId.slice('pi:'.length)
  if (session.sessionId.startsWith('antigravity:')) return session.sessionId.slice('antigravity:'.length)
  if (session.sessionId.startsWith('claude:')) return session.sessionId.slice('claude:'.length)
  if (session.sessionId.startsWith('hermes:')) return session.sessionId.slice('hermes:'.length)
  if (session.sessionId.startsWith('kimi:')) return session.sessionId.slice('kimi:'.length)
  if (session.sessionId.startsWith('opencode:')) return session.sessionId.slice('opencode:'.length)
  return session.sessionId
}

export function createCursorSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `cursor:${input.acpSessionId}`,
    backend: 'cursor',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'cursor', permissions: acpPermissionsValue() },
    },
  }
}

export function createPiSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `pi:${input.acpSessionId}`,
    backend: 'pi',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'pi', permissions: acpPermissionsValue() },
    },
  }
}

export function createAntigravitySession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `antigravity:${input.acpSessionId}`,
    backend: 'antigravity',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'antigravity', permissions: acpPermissionsValue(), imageLimits: {
        maxImageBytes: 8 * 1024 * 1024, maxImagesPerMessage: 4, maxMessageImageBytes: 32 * 1024 * 1024,
        maxImagePixels: 40_000_000, maxImageDimension: 8192, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      } },
    },
  }
}

export function createOpencodeSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `opencode:${input.acpSessionId}`,
    backend: 'opencode',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'opencode', permissions: acpPermissionsValue() },
    },
  }
}

export function createHermesWorkspace(path: string, title?: string): WorkspaceView {
  const now = new Date().toISOString()
  const label = title?.trim() || path.split(/[\\/]/).filter(Boolean).at(-1) || path
  return {
    workspaceId: hermesWorkspaceId(path),
    backend: 'hermes',
    path,
    title: label,
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function createHermesSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `hermes:${input.acpSessionId}`,
    backend: 'hermes',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: {
        backend: 'hermes',
        permissions: acpPermissionsValue(),
        imageLimits: {
          maxImageBytes: 8 * 1024 * 1024,
          maxImagesPerMessage: 4,
          maxMessageImageBytes: 32 * 1024 * 1024,
          maxImagePixels: 40_000_000,
          maxImageDimension: 8192,
          mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        },
      },
    },
  }
}

export function createKimiWorkspace(path: string, title?: string): WorkspaceView {
  return createAcpWorkspace('kimi', path, title)
}

export function createKimiSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return createAcpSession({
    backend: 'kimi',
    acpSessionId: input.acpSessionId,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.title === undefined ? {} : { title: input.title }),
  })
}

export function createClaudeSession(input: {
  acpSessionId: string
  cwd?: string
  title?: string
}): RemoteSession {
  return {
    sessionId: `claude:${input.acpSessionId}`,
    backend: 'claude',
    nativeId: input.acpSessionId,
    updatedAt: Date.now(),
    running: false,
    blank: input.title === undefined,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    projections: {
      values: { backend: 'claude', permissions: acpPermissionsValue() },
    },
  }
}

/** In-flight assistant bubble; must be renamed on prompt_completed so turns do not merge. */
const CURSOR_ASSISTANT_LIVE_ID = 'cursor-assistant-live'
let cursorAssistantSeq = 0
let acpTurnSeq = 0

/** ACP has no native turn number; scope activity to one prompt in this session's projection. */
function activeAcpTurn(messages: ChatItem[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const item = messages[index]!
    if (item.turnEnd !== undefined) return undefined
    if (item.kind === 'message' && item.role === 'user' && item.nativeSeq !== undefined) return undefined
    if (item.turn?.startsWith('acp-live:')) return item.turn
  }
  return undefined
}

function acpTurn(messages: ChatItem[]): string {
  return activeAcpTurn(messages) ?? `acp-live:${++acpTurnSeq}`
}

export async function createCursorWorkspaceSession(
  client: AgentAcpClient,
  path: string,
  mode: 'agent' | 'plan' | 'ask' = 'agent',
): Promise<{ workspace: WorkspaceView; session: RemoteSession }> {
  const created = await client.createSession(path, mode, 'cursor')
  const workspace = createCursorWorkspace(path)
  const session = createCursorSession({
    acpSessionId: created.sessionId,
    cwd: path,
  })
  return {
    workspace: { ...workspace, sessionIds: [session.sessionId], updatedAt: new Date().toISOString() },
    session,
  }
}

export async function createAntigravityWorkspaceSession(
  client: AgentAcpClient,
  path: string,
  mode: 'agent' | 'plan' | 'ask' = 'agent',
): Promise<{ workspace: WorkspaceView; session: RemoteSession }> {
  const created = await client.createSession(path, mode, 'antigravity')
  const workspace = createAntigravityWorkspace(path)
  const session = createAntigravitySession({
    acpSessionId: created.sessionId,
    cwd: path,
  })
  return {
    workspace: { ...workspace, sessionIds: [session.sessionId], updatedAt: new Date().toISOString() },
    session,
  }
}

export async function createOpencodeWorkspaceSession(
  client: AgentAcpClient,
  path: string,
  mode: 'agent' | 'plan' | 'ask' = 'agent',
): Promise<{ workspace: WorkspaceView; session: RemoteSession }> {
  const created = await client.createSession(path, mode, 'opencode')
  const workspace = createOpencodeWorkspace(path)
  const session = createOpencodeSession({
    acpSessionId: created.sessionId,
    cwd: path,
  })
  return {
    workspace: { ...workspace, sessionIds: [session.sessionId], updatedAt: new Date().toISOString() },
    session,
  }
}

/** Apply a live Agent ACP frame onto the in-memory Cursor chat list. */
export function applyCursorFrame(messages: ChatItem[], sessionId: string, frame: AgentAcpFrameData): ChatItem[] {
  const method = frame.frame.method
  const params = isRecord(frame.frame.params) ? frame.frame.params : {}
  if (method === 'session/update') return applySessionUpdate(messages, sessionId, params)
  if (method === 'cursor/ask_question') {
    const questionCard = upsertAcpQuestion(messages, sessionId, params)
    if (questionCard !== undefined) return questionCard
  }
  if (method === 'session/request_permission' || method === 'cursor/ask_question' || method === 'cursor/create_plan') {
    return upsertApproval(messages, sessionId, params, method)
  }
  if (method === 'cursor/update_todos') {
    return messages
  }
  return messages
}

/** Align pre-open prompts with their turns in the fresh transcript. */
export function reconcileAcpCachedPrompts(history: ChatItem[], cached: ChatItem[]): {
  history: ChatItem[]
  confirmedIds: Set<string>
  retainedIds: Set<string>
} {
  const confirmedIds = new Set<string>()
  const retainedIds = new Set<string>()
  if (!cached.some(item => item.id.startsWith('local:'))) return { history, confirmedIds, retainedIds }

  const turns = (items: ChatItem[]) => {
    const result: Array<{ prompt: ChatMessage; index: number; reply: string; reasoning: string; toolId?: string; completed: boolean; replyIds: string[] }> = []
    let turn: (typeof result)[number] | undefined
    for (const [index, item] of items.entries()) {
      if (item.kind === 'message' && item.role === 'user') {
        if (turn?.prompt.id.startsWith('local:') && item.id.startsWith('cursor-user:')
          && turn.replyIds.length === 0 && turn.prompt.text === item.text) continue
        turn = { prompt: item, index, reply: '', reasoning: '', completed: false, replyIds: [] }
        result.push(turn)
      } else if (turn && (item.kind === 'tool' || (item.kind === 'message' && item.role === 'assistant'))) {
        if (item.kind === 'tool') turn.toolId ??= item.id.replace(/^cursor-tool:acp-live:\d+:/u, '')
        else {
          turn.reply += item.text
          turn.reasoning += item.reasoning ?? ''
        }
        turn.replyIds.push(item.id)
        turn.completed ||= item.turnEnd?.reason === 'completed' || item.turnEnd?.reason === 'stopped'
      }
    }
    return result
  }
  const signature = (turn: ReturnType<typeof turns>[number]) => turn.reply || turn.reasoning || turn.toolId
    ? JSON.stringify([turn.prompt.text, turn.prompt.images?.length ?? 0, turn.reply, turn.reply ? '' : turn.reasoning,
      turn.reply || turn.reasoning ? '' : turn.toolId])
    : undefined
  const samePrompt = (local: ChatMessage, saved: ChatMessage) => {
    const images = saved.images ?? []
    const sentImages = local.promptImages ?? []
    return local.text === saved.text && (local.images?.length ?? 0) === images.length
      && (images.length === 0 || (sentImages.length === images.length && images.every((image, index) => {
        const sent = sentImages[index]!
        return image.uri === `data:${sent.mediaType};base64,${sent.data}`
      })))
  }

  const historyTurns = turns(history)
  const cachedTurns = turns(cached)
  const historyTurnsById = new Map(historyTurns.map(turn => [turn.prompt.id, turn]))
  const cachedTurnsById = new Map(cachedTurns.map(turn => [turn.prompt.id, turn]))
  const historyTail = historyTurns.at(-1)
  const candidates = new Map<string, typeof historyTurns>()
  for (const turn of historyTurns) {
    const key = signature(turn)
    if (key === undefined) continue
    const matches = candidates.get(key)
    if (matches) matches.push(turn)
    else candidates.set(key, [turn])
  }

  let lastMatchedIndex = -1
  const claimedHistoryPrompts = new Set<string>()
  const unmatchedTail: typeof historyTurns = []
  const nextCandidate = new Map<string, number>()
  for (const turn of cachedTurns) {
    const prompt = turn.prompt
    const key = signature(turn)
    if (!prompt.id.startsWith('local:')) {
      // Previously loaded turns reserve their places, including when a later
      // user turn has exactly the same prompt and reply.
      const previous = historyTurnsById.get(prompt.id)
      if (previous && signature(previous) === key && previous.prompt.text === prompt.text) {
        lastMatchedIndex = Math.max(lastMatchedIndex, previous.index)
        unmatchedTail.length = 0
      }
      continue
    }
    if (prompt.sendState !== undefined || !turn.completed || key === undefined) {
      // A later saved prompt marks the boundary even if the earlier reply has
      // not been flushed. Use the predecessor recorded when the Host accepted
      // the prompt, since a restore may already have inserted more history.
      const after = prompt.acpPromptAfter
      if (after !== undefined && prompt.sendState === undefined && turn.replyIds.length === 0
        && !prompt.files?.length && !prompt.images?.length) {
        const cachedAnchor = after === null ? undefined : cachedTurnsById.get(after)
        const anchor = after === null ? undefined : historyTurnsById.get(after)
        const anchored = anchor && cachedAnchor && anchor.prompt.nativeSeq !== undefined
          && anchor.prompt.nativeTime === cachedAnchor.prompt.nativeTime
          && anchor.prompt.text === cachedAnchor.prompt.text && signature(anchor) === signature(cachedAnchor)
        const next = anchored ? historyTurns.find(candidate => candidate.index > anchor.index)
          : after === null && historyTurns[0]?.index === 0 ? historyTurns[0] : undefined
        if (next && (next !== historyTail || next.completed) && !claimedHistoryPrompts.has(next.prompt.id) && samePrompt(prompt, next.prompt)
          && !historyTurns.some(candidate => candidate.index > next.index && samePrompt(prompt, candidate.prompt))) {
          lastMatchedIndex = Math.max(lastMatchedIndex, next.index)
          claimedHistoryPrompts.add(next.prompt.id)
          // A confirmed successor proves the snapshot already reached past the
          // locals buffered so far, so they are not a stale tail to retain.
          unmatchedTail.length = 0
          confirmedIds.add(prompt.id)
        }
      }
      continue
    }
    const matches = candidates.get(key) ?? []
    let offset = nextCandidate.get(key) ?? 0
    while (offset < matches.length) {
      const candidate = matches[offset]!
      if (candidate.index > lastMatchedIndex && samePrompt(prompt, candidate.prompt)) break
      offset++
    }
    const match = matches[offset]
    if (!match) {
      unmatchedTail.push(turn)
      continue
    }
    nextCandidate.set(key, offset + 1)
    lastMatchedIndex = match.index
    claimedHistoryPrompts.add(match.prompt.id)
    unmatchedTail.length = 0
    confirmedIds.add(prompt.id)
  }
  const firstCachedTail = unmatchedTail[0]
  if (historyTail && firstCachedTail && historyTail.toolId === undefined
    && lastMatchedIndex === (historyTurns.at(-2)?.index ?? -1)
    && samePrompt(firstCachedTail.prompt, historyTail.prompt)
    && firstCachedTail.reply.startsWith(historyTail.reply)
    && firstCachedTail.reasoning.startsWith(historyTail.reasoning)) {
    // The read reached the next user message before its full reply was persisted.
    // Keep the completed local reply in place of the unfinished history rows.
    confirmedIds.add(firstCachedTail.prompt.id)
    for (const id of firstCachedTail.replyIds) retainedIds.add(id)
    if (historyTail.replyIds.length > 0) {
      const unfinishedIds = new Set(historyTail.replyIds)
      history = history.filter(item => !unfinishedIds.has(item.id))
    }
    unmatchedTail.shift()
    lastMatchedIndex = historyTail.index
  }
  // A snapshot that ends at an earlier matched turn can lag the live stream.
  // Keep the completed local suffix so the next read still has its reply anchors.
  if (history.length === 0 || (historyTail && lastMatchedIndex === historyTail.index)) {
    for (const turn of unmatchedTail) {
      retainedIds.add(turn.prompt.id)
      for (const id of turn.replyIds) retainedIds.add(id)
    }
  }
  return { history, confirmedIds, retainedIds }
}

/**
 * ACP history and live have different synthetic IDs and no shared sequence cursor.
 * Only reconcile the contiguous history suffix / new-subscription prefix, never
 * globally dedupe identical answers (which may belong to separate turns).
 */
export function mergeAcpHistoryAndLive(history: ChatItem[], live: ChatItem[]): ChatItem[] {
  const historyIds = new Set(history.map(item => item.id))
  const terminalLocals: ChatItem[] = []
  const nonTerminalLive: ChatItem[] = []
  for (const item of live) {
    if (isTerminalLocalMessage(item)) {
      if (!historyIds.has(item.id)) terminalLocals.push(item)
    } else {
      nonTerminalLive.push(item)
    }
  }
  const sameMessageImages = (a?: ChatImage[], b?: ChatImage[]): boolean => {
    const left = a ?? []
    const right = b ?? []
    if (left.length !== right.length) return false
    return left.every((img, idx) => {
      const other = right[idx]!
      if (img.attachmentId !== undefined && other.attachmentId !== undefined) {
        return img.attachmentId === other.attachmentId
      }
      return true
    })
  }
  const same = (a: ChatItem, b: ChatItem): boolean => {
    if (a.kind !== b.kind) return false
    if (a.kind === 'message' && b.kind === 'message') {
      return a.role === b.role && a.text === b.text && (a.reasoning ?? '') === (b.reasoning ?? '')
        && sameMessageImages(a.images, b.images)
    }
    if (a.kind === 'tool' && b.kind === 'tool') {
      // ACP live tool IDs contain a local turn prefix; history uses the call ID.
      return b.id.endsWith(`:${a.id}`) && a.toolName === b.toolName
    }
    return a.id === b.id
  }
  for (let count = Math.min(history.length, nonTerminalLive.length); count > 0; count--) {
    const suffix = history.slice(history.length - count)
    const slice = nonTerminalLive.slice(0, count)
    // Text alone is not identity: two independent assistant replies can say the
    // same thing. Require a shared ID, a tool call anchor, a local optimistic
    // user prompt matching the history suffix, or a full user+assistant turn.
    const anchored = slice.some((item, index) => {
      const previous = suffix[index]!
      return previous.id === item.id
        || (previous.kind === 'tool' && item.kind === 'tool' && same(previous, item))
        || (previous.kind === 'message' && item.kind === 'message' && previous.role === 'user' && item.id.startsWith('local:'))
    }) || (
      count >= 2
      && slice.some((item, index) => suffix[index]!.kind === 'message' && item.kind === 'message' && item.role === 'user')
      && slice.some((item, index) => suffix[index]!.kind === 'message' && item.kind === 'message' && item.role === 'assistant')
    )
    if (anchored && slice.every((item, index) => same(suffix[index]!, item))) {
      // Prefer live rows at the boundary: preserve completion/stream state and
      // keep their IDs so subsequent chunks update rather than duplicate them.
      const overlap = slice.map((item, index) => {
        const previous = suffix[index]!
        const nativeTime = item.nativeTime ?? previous.nativeTime
        if (item.kind === 'tool' && previous.kind === 'tool') {
          return { ...previous, ...item,
            state: item.state === 'running' && previous.state !== 'running' ? previous.state : item.state,
            arguments: item.arguments ?? previous.arguments,
            callDetail: item.callDetail ?? previous.callDetail, resultDetail: item.resultDetail ?? previous.resultDetail }
        }
        if (item.kind === 'message' && previous.kind === 'message') {
          const preserveImages = previous.images !== undefined && previous.images.length > 0
            && (item.images === undefined || !item.images.some(img => img.attachmentId !== undefined || img.uri?.startsWith('data:')))
          const mergedFiles = item.files !== undefined && item.files.length > 0 ? item.files : previous.files
          if (preserveImages || mergedFiles !== item.files) {
            return {
              ...item,
              ...(nativeTime === undefined ? {} : { nativeTime }),
              ...(preserveImages ? { images: previous.images } : {}),
              ...(mergedFiles === undefined ? {} : { files: mergedFiles }),
            }
          }
        }
        return nativeTime === undefined ? item : { ...item, nativeTime }
      })
      const merged = [...history.slice(0, history.length - count), ...overlap, ...nonTerminalLive.slice(count)]
      return insertTerminalLocalMessages(merged, terminalLocals)
    }
  }
  return insertTerminalLocalMessages([...history, ...nonTerminalLive], terminalLocals)
}

/** Fold Host ACP transcript events into the Android chat projection. */
export function foldAcpHistory(events: unknown[], sessionId: string): ChatItem[] {
  const entries: HistoryEntry[] = []
  for (const [index, value] of events.entries()) {
    if (!isRecord(value) || !isRecord(value.event)) continue
    const raw = value.event
    if (typeof raw.type !== 'string' || !isRecord(raw.data)) continue
    const event: NativeSessionEvent = {
      type: raw.type,
      seq: typeof raw.seq === 'number' && Number.isSafeInteger(raw.seq) && raw.seq >= 0 ? raw.seq : index,
      time: typeof raw.time === 'number' && Number.isFinite(raw.time) && raw.time > 0 ? raw.time : 0,
      data: raw.data,
    }
    entries.push({ event })
  }
  return foldHistory(entries, sessionId, true)
}

function applySessionUpdate(messages: ChatItem[], sessionId: string, params: Record<string, unknown>): ChatItem[] {
  const update = isRecord(params.update) ? params.update : params
  const kind = stringValue(update.sessionUpdate) ?? stringValue(update.type)
  if (kind === 'agent_message_chunk' || kind === 'agent_message') {
    const text = extractText(update)
    if (text === undefined || text.length === 0) return messages
    messages = retireAssistantBeforeActivity(messages)
    return appendAssistantDelta(messages, sessionId, text, CURSOR_ASSISTANT_LIVE_ID)
  }
  if (kind === 'agent_thought_chunk' || kind === 'agent_thought') {
    const text = extractText(update)
    if (text === undefined || text.length === 0) return messages
    messages = retireAssistantBeforeActivity(messages)
    return appendAssistantReasoningDelta(messages, sessionId, text, CURSOR_ASSISTANT_LIVE_ID)
  }
  if (kind === 'prompt_completed' || kind === 'prompt_failed') {
    let next = messages
    const live = next.find(item => item.kind === 'message' && item.id === CURSOR_ASSISTANT_LIVE_ID)
    const hasLiveContent = live !== undefined
      && live.kind === 'message'
      && ((live.text?.length ?? 0) > 0 || (live.reasoning?.length ?? 0) > 0)
    if (!hasLiveContent && Array.isArray(update.catchUp)) {
      for (const item of update.catchUp) {
        if (!isRecord(item) || typeof item.method !== 'string') continue
        next = applyCursorFrame(next, sessionId, {
          streamId: 'catch-up',
          frame: { method: item.method, params: item.params },
        })
      }
    }
    // Retire the live id so the next turn opens a new left-side bubble instead
    // of appending into the previous assistant message.
    const reason = kind === 'prompt_failed' ? 'failed'
      : update.stopReason === 'cancelled' || update.stopReason === 'aborted' || update.stopReason === 'interrupted'
        ? 'stopped' : 'completed'
    const turn = activeAcpTurn(next)
    const time = Date.now()
    const usage = normalizeAcpChatUsage(update.usage)
    const finalized = finalizeAssistantLive(next)
    const lastAssistantIdx = usage === undefined
      ? -1
      : finalized.reduce((acc, item, idx) => (item.kind === 'message' && item.role === 'assistant' && (turn === undefined || item.turn === turn) ? idx : acc), -1)
    return finalized.map((item, idx) => {
      const turnMatched = turn !== undefined && item.turn === turn
      const withUsage = idx === lastAssistantIdx && item.kind === 'message' && usage !== undefined
        ? { ...item, usage }
        : item
      if (!turnMatched) return withUsage
      if (withUsage.kind === 'tool') {
        return {
          ...withUsage,
          turnEnd: { reason, time },
          ...(withUsage.state === 'running' ? { state: reason === 'completed' ? 'finished' as const : 'failed' as const } : {}),
        }
      }
      if (withUsage.kind === 'approval') {
        return {
          ...withUsage,
          turnEnd: { reason, time },
          ...(withUsage.outcome === undefined ? { outcome: 'unavailable' as const } : {}),
        }
      }
      if (withUsage.kind === 'question') {
        return {
          ...withUsage,
          turnEnd: { reason, time },
          ...(withUsage.outcome === undefined ? { outcome: 'cancelled' as const } : {}),
        }
      }
      return { ...withUsage, turnEnd: { reason, time } }
    })
  }
  if (kind === 'user_message_chunk') {
    const text = extractText(update)
    if (text === undefined || text.length === 0) return messages
    return appendUserDelta(messages, sessionId, text, 'cursor-user-live')
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    // A spoken reply closes the preceding activity range, as it does in DSH.
    // Retain its position when another tool starts instead of appending later text into it.
    const live = messages.find(item => item.id === CURSOR_ASSISTANT_LIVE_ID)
    if (kind === 'tool_call' && live?.kind === 'message' && live.text.trim() !== '') {
      messages = finalizeAssistantLive(messages)
    }
    const callId = stringValue(update.toolCallId) ?? stringValue(update.callId) ?? stringValue(update.name) ?? 'tool'
    const turn = acpTurn(messages)
    const id = `cursor-tool:${turn}:${callId}`
    const existing = messages.findIndex(item => item.kind === 'tool' && item.id === id)
    const previous = existing < 0 ? undefined : messages[existing] as ToolActivity
    const toolName = stringValue(update.title) ?? stringValue(update.toolName) ?? stringValue(update.name) ?? previous?.toolName ?? 'tool'
    const meta = isRecord(update._meta) ? update._meta : {}
    const terminalOutput = isRecord(meta.terminal_output) ? meta.terminal_output : {}
    const terminalExit = isRecord(meta.terminal_exit) ? meta.terminal_exit : {}
    const exitCode = typeof terminalExit.exit_code === 'number' && Number.isInteger(terminalExit.exit_code)
      ? terminalExit.exit_code : undefined
    const statusStr = stringValue(update.status)
    const rawOutputError = isRecord(update.rawOutput) && update.rawOutput.isError === true
    const state = statusStr === 'failed' || rawOutputError || (exitCode !== undefined && exitCode !== 0)
      || previous?.state === 'failed' ? 'failed'
      : exitCode !== undefined || statusStr === 'completed' || (kind === 'tool_call_update' && update.output !== undefined) ? 'finished'
        : previous?.state ?? 'running'
    const argumentsText = boundedDetail(update.rawInput ?? update.parameters)
    const delta = typeof terminalOutput.data === 'string' ? terminalOutput.data : undefined
    const output = delta === undefined ? decodeAcpToolOutput(update)
      : `${previous?.resultDetail?.text ?? ''}${delta}`.slice(-16_000)
    const next: ToolActivity = {
      ...previous,
      kind: 'tool', id, sessionId, turn, toolName, state,
      ...(stringValue(update.toolName) ?? stringValue(update.name) ? { toolKey: stringValue(update.toolName) ?? stringValue(update.name) } : {}),
      createdAt: previous?.createdAt ?? Date.now(),
      ...(argumentsText === undefined ? {} : { arguments: argumentsText, callDetail: { text: argumentsText, format: 'code' } }),
      ...(output === undefined ? {} : { resultDetail: { text: output, format: 'code' } }),
    }
    if (existing >= 0) {
      const copy = messages.slice()
      copy[existing] = next
      return copy
    }
    return [...messages, next]
  }
  return messages
}

function upsertAcpQuestion(
  messages: ChatItem[],
  sessionId: string,
  params: Record<string, unknown>,
): ChatItem[] | undefined {
  const requestHandle = stringValue(params.requestHandle)
  if (requestHandle === undefined || !Array.isArray(params.questions) || params.questions.length === 0) return undefined
  const title = stringValue(params.title)
  const questions: AskUserQuestionItem[] = []
  for (const [idx, raw] of params.questions.entries()) {
    if (!isRecord(raw)) continue
    const prompt = stringValue(raw.prompt) ?? stringValue(raw.question)
    if (prompt === undefined) continue
    const id = stringValue(raw.id) ?? `q-${idx + 1}`
    const header = stringValue(raw.header) ?? title
    const options = Array.isArray(raw.options)
      ? raw.options.flatMap(opt => {
          if (!isRecord(opt)) return []
          const label = stringValue(opt.label) ?? stringValue(opt.id)
          if (label === undefined) return []
          const description = stringValue(opt.description)
          return [{ label, ...(description === undefined ? {} : { description }) }]
        })
      : undefined
    const multiSelect = raw.multiSelect === true || raw.allowMultiple === true
    questions.push({
      id,
      question: prompt,
      ...(header === undefined ? {} : { header }),
      ...(options && options.length > 0 ? { options } : {}),
      ...(multiSelect ? { multiSelect: true } : {}),
    })
  }
  if (questions.length === 0) return undefined
  const id = `cursor-question:${requestHandle}`
  const item: QuestionActivity = {
    kind: 'question',
    id,
    sessionId,
    turn: acpTurn(messages),
    frameRpcId: requestHandle,
    questionState: 'open',
    questions,
    createdAt: Date.now(),
  }
  const existing = messages.findIndex(entry => entry.id === id)
  if (existing >= 0) {
    const copy = messages.slice()
    copy[existing] = item
    return copy
  }
  return [...messages, item]
}

function normalizeAcpChatUsage(raw: unknown): ChatMessage['usage'] | undefined {
  if (!isRecord(raw)) return undefined
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  const inputTokens = num(raw.inputTokens)
  const outputTokens = num(raw.outputTokens)
  const totalTokens = num(raw.totalTokens)
  const cacheReadTokens = num(raw.cacheReadTokens ?? raw.cachedReadTokens)
  const cacheWriteTokens = num(raw.cacheWriteTokens ?? raw.cachedWriteTokens)
  const reasoningTokens = num(raw.reasoningTokens ?? raw.thoughtTokens)
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  }
}

export function normalizeAcpTodos(raw: unknown): Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; priority?: string }> | undefined {
  if (!Array.isArray(raw)) return undefined
  const items: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; priority?: string }> = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const content = stringValue(entry.content) ?? stringValue(entry.title) ?? stringValue(entry.label)
    if (content === undefined) continue
    const rawStatus = stringValue(entry.status)
    const status = rawStatus === 'completed' || rawStatus === 'done'
      ? 'completed'
      : rawStatus === 'in_progress' || rawStatus === 'inProgress' || rawStatus === 'running'
        ? 'in_progress'
        : 'pending'
    const priority = stringValue(entry.priority)
    items.push({ content, status, ...(priority !== undefined ? { priority } : {}) })
  }
  return items
}

function upsertApproval(
  messages: ChatItem[],
  sessionId: string,
  params: Record<string, unknown>,
  method: string,
): ChatItem[] {
  const requestHandle = stringValue(params.requestHandle)
  if (requestHandle === undefined) return messages
  const id = `cursor-approval:${requestHandle}`
  const toolCall = isRecord(params.toolCall) ? params.toolCall : {}
  const rawInput = isRecord(toolCall.rawInput) ? toolCall.rawInput : {}
  const toolName = method === 'cursor/create_plan'
    ? (stringValue(params.name) ?? 'plan')
    : method === 'cursor/ask_question'
      ? (stringValue(params.title) ?? 'question')
      : (stringValue(params.toolName) ?? stringValue(toolCall.title) ?? 'permission')
  const reason = method === 'cursor/create_plan'
    ? [stringValue(params.overview), stringValue(params.plan)].filter(Boolean).join('\n\n') || undefined
    : method === 'cursor/ask_question'
      ? summarizeQuestions(params)
      : boundedDetail(stringValue(params.reason) ?? stringValue(rawInput.message) ?? toolCall.rawInput)
  const item: ApprovalActivity = {
    kind: 'approval',
    id,
    sessionId,
    turn: acpTurn(messages),
    approvalId: requestHandle,
    toolName,
    ...(reason === undefined ? {} : { reason }),
    createdAt: Date.now(),
  }
  const existing = messages.findIndex(entry => entry.id === id)
  if (existing >= 0) {
    const copy = messages.slice()
    const previous = messages[existing]!
    copy[existing] = previous.kind === 'approval'
      ? { ...previous, ...item }
      : item
    return copy
  }
  return [...messages, item]
}

function appendAssistantDelta(messages: ChatItem[], sessionId: string, text: string, id: string): ChatItem[] {
  const existing = messages.findIndex(item => item.kind === 'message' && item.id === id)
  if (existing >= 0) {
    const current = messages[existing] as ChatMessage
    const copy = messages.slice()
    copy[existing] = {
      ...current,
      text: `${current.text ?? ''}${text}`,
      streaming: true,
      streamingPhase: 'text',
    }
    return copy
  }
  return [...messages, {
    kind: 'message',
    id,
    sessionId,
    role: 'assistant',
    turn: acpTurn(messages),
    text,
    createdAt: Date.now(),
    streaming: true,
    streamingPhase: 'text',
  }]
}

/** Map ACP `agent_thought_chunk` onto the same live assistant bubble as Harness reasoning. */
function appendAssistantReasoningDelta(
  messages: ChatItem[],
  sessionId: string,
  text: string,
  id: string,
): ChatItem[] {
  const existing = messages.findIndex(item => item.kind === 'message' && item.id === id)
  if (existing >= 0) {
    const current = messages[existing] as ChatMessage
    const copy = messages.slice()
    copy[existing] = {
      ...current,
      reasoning: `${current.reasoning ?? ''}${text}`,
      streaming: true,
      streamingPhase: current.text ? 'text' : 'reasoning',
    }
    return copy
  }
  return [...messages, {
    kind: 'message',
    id,
    sessionId,
    role: 'assistant',
    turn: acpTurn(messages),
    text: '',
    reasoning: text,
    createdAt: Date.now(),
    streaming: true,
    streamingPhase: 'reasoning',
  }]
}

function retireAssistantBeforeActivity(messages: ChatItem[]): ChatItem[] {
  const index = messages.findIndex(item => item.id === CURSOR_ASSISTANT_LIVE_ID)
  return index >= 0 && index < messages.length - 1 ? finalizeAssistantLive(messages) : messages
}

export function finalizeAssistantLive(messages: ChatItem[]): ChatItem[] {
  let changed = false
  const next = messages.map(item => {
    if (item.kind !== 'message' || (item.id !== CURSOR_ASSISTANT_LIVE_ID && item.id !== 'cursor-user-live')) return item
    changed = true
    return {
      ...item,
      id: `${item.role === 'user' ? 'cursor-user' : 'cursor-assistant'}:${++cursorAssistantSeq}`,
      streaming: false,
      streamingPhase: undefined,
    }
  })
  return changed ? next : messages
}

function appendUserDelta(messages: ChatItem[], sessionId: string, text: string, id: string): ChatItem[] {
  const existing = messages.findIndex(item => item.kind === 'message' && item.id === id)
  if (existing >= 0) {
    const current = messages[existing] as ChatMessage
    const copy = messages.slice()
    copy[existing] = { ...current, text: `${current.text ?? ''}${text}` }
    return copy
  }
  return [...messages, {
    kind: 'message',
    id,
    sessionId,
    role: 'user',
    text,
    createdAt: Date.now(),
  }]
}

function boundedDetail(value: unknown): string | undefined {
  if (value === undefined) return undefined
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return text?.slice(0, 16_000)
  } catch { return undefined }
}

function decodeAcpToolOutput(update: Record<string, unknown>): string | undefined {
  if (Array.isArray(update.content)) {
    const decoded = update.content.flatMap(item => {
      if (!isRecord(item)) return []
      if (item.type === 'content' && isRecord(item.content) && item.content.type === 'text' && typeof item.content.text === 'string') {
        return [item.content.text]
      }
      if (
        item.type === 'diff'
        && typeof item.path === 'string'
        && typeof item.newText === 'string'
        && (item.oldText === null || item.oldText === undefined || typeof item.oldText === 'string')
      ) {
        return [`File: ${item.path}\n--- before\n${item.oldText ?? ''}\n+++ after\n${item.newText}`]
      }
      if (item.type === 'text' && typeof item.text === 'string') {
        return [item.text]
      }
      return []
    })
    if (decoded.length > 0) return decoded.join('\n\n').slice(0, 16_000)
  }
  if (isRecord(update.rawOutput) && Array.isArray(update.rawOutput.content)) {
    const textParts = update.rawOutput.content
      .filter(item => isRecord(item) && item.type === 'text' && typeof item.text === 'string')
      .map(item => (item as { text: string }).text)
    if (textParts.length > 0) return textParts.join('\n\n').slice(0, 16_000)
  }
  if (update.rawOutput !== undefined) return boundedDetail(update.rawOutput)
  if (update.output !== undefined) return boundedDetail(update.output)
  if (Array.isArray(update.content) && update.content.length === 0) return undefined
  return boundedDetail(update.content)
}

function extractText(update: Record<string, unknown>): string | undefined {
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

function summarizeTodos(params: Record<string, unknown>): string | undefined {
  if (!Array.isArray(params.todos)) return undefined
  const lines = params.todos
    .map(todo => {
      if (!isRecord(todo)) return undefined
      const content = stringValue(todo.content)
      const status = stringValue(todo.status) ?? 'pending'
      return content === undefined ? undefined : `- [${status}] ${content}`
    })
    .filter((line): line is string => line !== undefined)
  return lines.length === 0 ? undefined : `Todos:\n${lines.join('\n')}`
}

function summarizeQuestions(params: Record<string, unknown>): string | undefined {
  if (!Array.isArray(params.questions)) return undefined
  const lines = params.questions
    .map(question => (isRecord(question) ? stringValue(question.prompt) : undefined))
    .filter((line): line is string => line !== undefined)
  return lines.length === 0 ? undefined : lines.join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
