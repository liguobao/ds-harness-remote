import type { AgentBackend, ChatItem, RemoteSession, WorkspaceView } from '../types'
import { parseHandoffMessage } from './handoff-context'
import { isSubagentSession } from './session-kind'
import { isAbsoluteHostPath, normalizeWorkspacePath } from './workspace-key'

export interface HandoffBackendAvailability {
  codexAvailable: boolean
  cursorAvailable: boolean
  antigravityAvailable: boolean
  piAvailable: boolean
  opencodeAvailable: boolean
  claudeAvailable: boolean
  hermesAvailable: boolean
  customAcpBackends?: readonly string[]
}

const TARGET_BACKEND_ORDER: readonly AgentBackend[] = [
  'codex',
  'claude',
  'harness',
  'hermes',
  'opencode',
  'cursor',
  'antigravity',
  'pi',
]

/** Map Host platform strings to `normalizeWorkspacePath` conventions. */
export function normalizeHostPlatform(platform?: string): string | undefined {
  if (!platform) return undefined
  const lower = platform.trim().toLowerCase()
  if (!lower) return undefined
  if (lower === 'windows' || lower === 'win32') return 'win32'
  return lower
}

function isBackendAvailable(availability: HandoffBackendAvailability, backend: AgentBackend): boolean {
  switch (backend) {
    case 'harness':
      return true
    case 'codex':
      return availability.codexAvailable
    case 'claude':
      return availability.claudeAvailable
    case 'hermes':
      return availability.hermesAvailable
    case 'opencode':
      return availability.opencodeAvailable
    case 'cursor':
      return availability.cursorAvailable
    case 'antigravity':
      return availability.antigravityAvailable
    case 'pi':
      return availability.piAvailable
    default:
      return (availability.customAcpBackends ?? []).includes(backend)
  }
}

/** Return available handoff targets with cross-backend agents ordered first and `sourceBackend` last. */
export function availableHandoffTargets(
  availability: HandoffBackendAvailability,
  sourceBackend: AgentBackend,
): AgentBackend[] {
  const ordered: AgentBackend[] = []
  const seen = new Set<AgentBackend>()

  for (const backend of TARGET_BACKEND_ORDER) {
    if (!seen.has(backend) && isBackendAvailable(availability, backend)) {
      seen.add(backend)
      ordered.push(backend)
    }
  }
  for (const custom of availability.customAcpBackends ?? []) {
    if (custom && custom !== 'harness' && custom !== 'codex'
      && !TARGET_BACKEND_ORDER.includes(custom) && !seen.has(custom)) {
      seen.add(custom)
      ordered.push(custom)
    }
  }

  const cross = ordered.filter(backend => backend !== sourceBackend)
  const same = ordered.filter(backend => backend === sourceBackend)
  return [...cross, ...same]
}

/** Match a target workspace by exact normalized path; fail-closed without guessing unrelated paths. */
export function matchTargetWorkspace({
  workspaces,
  targetBackend,
  sourceCwd,
  hostPlatform,
}: {
  workspaces: readonly WorkspaceView[]
  targetBackend: AgentBackend
  sourceCwd?: string
  hostPlatform?: string
}): {
  matched?: WorkspaceView
  otherWorkspaces: WorkspaceView[]
  normalizedSourceCwd?: string
  canRegisterSourceCwd: boolean
} {
  const platform = normalizeHostPlatform(hostPlatform)
  const targetWorkspaces = workspaces.filter(workspace => (workspace.backend ?? 'harness') === targetBackend)
  const trimmedCwd = sourceCwd?.trim()
  const hasAbsoluteCwd = trimmedCwd !== undefined && trimmedCwd.length > 0 && !trimmedCwd.includes('\0') && isAbsoluteHostPath(trimmedCwd)
  const normalizedSourceCwd = hasAbsoluteCwd ? normalizeWorkspacePath(trimmedCwd, platform) : undefined

  const matched = normalizedSourceCwd === undefined
    ? undefined
    : targetWorkspaces.find(workspace => normalizeWorkspacePath(workspace.path, platform) === normalizedSourceCwd)

  const otherWorkspaces = matched === undefined
    ? targetWorkspaces
    : targetWorkspaces.filter(workspace => workspace.workspaceId !== matched.workspaceId)

  return {
    ...(matched !== undefined ? { matched } : {}),
    otherWorkspaces,
    ...(normalizedSourceCwd !== undefined ? { normalizedSourceCwd } : {}),
    canRegisterSourceCwd: hasAbsoluteCwd && matched === undefined,
  }
}

export interface HandoffOriginRef {
  sourceBackend: AgentBackend
  sourceSessionId: string
  sourceTitle?: string
}

export interface HandoffTargetSessionOption {
  session: RemoteSession
  isOrigin: boolean
}

export interface HandoffTargetSessionsResolution {
  originSession?: RemoteSession
  sessions: HandoffTargetSessionOption[]
}

/** Return true when `session` belongs to `targetBackend` and the target workspace (by id or normalized path). */
export function isSessionInTargetWorkspace({
  session,
  targetBackend,
  workspace,
  registerPath,
  hostPlatform,
}: {
  session: RemoteSession
  targetBackend: AgentBackend
  workspace?: WorkspaceView
  registerPath?: string
  hostPlatform?: string
}): boolean {
  if ((session.backend ?? 'harness') !== targetBackend) return false
  const platform = normalizeHostPlatform(hostPlatform)
  const trimmedSessionCwd = session.cwd?.trim()
  const normalizedSessionCwd = trimmedSessionCwd && trimmedSessionCwd.length > 0 && !trimmedSessionCwd.includes('\0')
    ? normalizeWorkspacePath(trimmedSessionCwd, platform)
    : undefined

  if (workspace !== undefined) {
    if ((workspace.backend ?? 'harness') !== targetBackend) return false
    if (workspace.sessionIds.includes(session.sessionId)) return true
    const trimmedWsPath = workspace.path?.trim()
    if (trimmedWsPath && !trimmedWsPath.includes('\0') && normalizedSessionCwd !== undefined
      && normalizeWorkspacePath(trimmedWsPath, platform) === normalizedSessionCwd) {
      return true
    }
    const trimmedRegister = registerPath?.trim()
    if (trimmedRegister && trimmedRegister.length > 0 && !trimmedRegister.includes('\0') && normalizedSessionCwd !== undefined) {
      return normalizeWorkspacePath(trimmedRegister, platform) === normalizedSessionCwd
    }
    return false
  }

  const trimmedRegister = registerPath?.trim()
  if (trimmedRegister && trimmedRegister.length > 0 && !trimmedRegister.includes('\0') && normalizedSessionCwd !== undefined) {
    return normalizeWorkspacePath(trimmedRegister, platform) === normalizedSessionCwd
  }
  return false
}

/** Find the most recent embedded `<handoff_context>` origin in `items`, optionally filtered by `targetBackend`. */
export function findLatestHandoffOrigin(
  items: readonly ChatItem[],
  targetBackend?: AgentBackend,
): HandoffOriginRef | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (item?.kind !== 'message' || item.role !== 'user') continue
    const parsed = parseHandoffMessage(item.text)
    if (parsed === undefined) continue
    if (targetBackend !== undefined && parsed.meta.sourceBackend !== targetBackend) continue
    return {
      sourceBackend: parsed.meta.sourceBackend,
      sourceSessionId: parsed.meta.sourceSessionId,
      ...(parsed.meta.sourceTitle !== undefined ? { sourceTitle: parsed.meta.sourceTitle } : {}),
    }
  }
  return undefined
}

/**
 * Resolve eligible non-archived root sessions in the target workspace for handing back
 * to an existing/origin session or starting fresh, placing the detected origin session first.
 */
export function resolveHandoffTargetSessions({
  items,
  sessions,
  targetBackend,
  targetWorkspace,
  registerPath,
  archivedSessionIds,
  sourceSessionId,
  hostPlatform,
}: {
  items: readonly ChatItem[]
  sessions: readonly RemoteSession[]
  targetBackend: AgentBackend
  targetWorkspace?: WorkspaceView
  registerPath?: string
  archivedSessionIds: readonly string[]
  sourceSessionId?: string
  hostPlatform?: string
}): HandoffTargetSessionsResolution {
  const originRef = findLatestHandoffOrigin(items, targetBackend)
  const originId = originRef !== undefined && originRef.sourceSessionId !== sourceSessionId
    ? originRef.sourceSessionId
    : undefined
  const archivedSet = new Set(archivedSessionIds)

  const eligible = sessions.filter(session => {
    if ((session.backend ?? 'harness') !== targetBackend) return false
    if (isSubagentSession(session)) return false
    if (archivedSet.has(session.sessionId)) return false
    if (sourceSessionId !== undefined && session.sessionId === sourceSessionId) return false
    if (session.blank === true && session.sessionId !== originId) return false
    return isSessionInTargetWorkspace({
      session,
      targetBackend,
      workspace: targetWorkspace,
      registerPath,
      hostPlatform,
    })
  })

  const originSession = originId !== undefined
    ? eligible.find(session => session.sessionId === originId)
    : undefined
  const remaining = eligible
    .filter(session => session.sessionId !== originSession?.sessionId)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  return {
    ...(originSession !== undefined ? { originSession } : {}),
    sessions: [
      ...(originSession !== undefined ? [{ session: originSession, isOrigin: true }] : []),
      ...remaining.map(session => ({ session, isOrigin: false })),
    ],
  }
}
